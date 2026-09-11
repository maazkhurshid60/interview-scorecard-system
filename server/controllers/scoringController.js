const Interview = require('../models/Interview');
const Application = require('../models/Application');
const Requisition = require('../models/Requisition');
require('../models/Candidate'); // registers the Candidate model for populate('candidateId')
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const { asyncHandler, getEnabledStagesSorted } = require('../utils/helpers');
const { ValidationError } = require('../utils/errors');
const { FINAL_DECISIONS } = require('../utils/constants');
const { computeStageAverage, isStagePassed, computeApplicationResult, rankApplications } = require('../services/scoringEngine');
const slackNotifier = require('../services/slackNotifier');

/**
 * Recomputes an application's weightedTotal / allGatesPassed / disposition
 * from its interviews' APPROVED scores, mirrors the per-stage results onto
 * stageProgress, saves, and audits a disposition change.
 *
 * Per spec ("Recompute whenever an approval/override changes a score"), this
 * runs automatically on approval rather than waiting for a manual call —
 * otherwise the ranking table sits empty (or stale) after HR approves a
 * stage, which is exactly when the numbers change.
 *
 * Always derives stage averages live from approvedScore, never from the
 * cached interview.stageAverage, so it can't propagate a stale value.
 *
 * @param {import('mongoose').Document} application
 * @param {import('mongoose').Document} requisition
 * @param {string} userId
 * @param {string} reason - audit reason if the disposition changes
 * @returns {Promise<object>} the computeApplicationResult payload
 */
async function recomputeAndPersist(application, requisition, userId, reason) {
  const interviews = await Interview.find({ applicationId: application._id });
  const interviewsByStageKey = new Map(interviews.map((i) => [i.stageKey, i]));

  const result = computeApplicationResult({
    stages: requisition.stages,
    interviewsByStageKey,
    hireThreshold: requisition.hireThreshold,
    maybeThreshold: requisition.maybeThreshold,
  });

  result.stageResults.forEach((r) => {
    const progress = application.stageProgress.find((p) => p.stageKey === r.stageKey);
    if (progress) { progress.stageAverage = r.stageAverage; progress.passed = r.passed; }
  });

  const oldDisposition = application.disposition;
  application.weightedTotal = result.weightedTotal;
  application.allGatesPassed = result.allGatesPassed;
  application.disposition = result.disposition;
  if (result.disposition === 'NO_HIRE' || result.allGatesPassed === false || application.stageProgress.some((p) => p.status === 'failed')) {
    application.currentStageKey = null;
  }
  await application.save();

  if (oldDisposition !== result.disposition) {
    await AuditLog.create({
      action: 'disposition_change', userId, requisitionId: application.requisitionId, applicationId: application._id,
      targetType: 'application', targetId: application._id.toString(),
      oldValue: oldDisposition, newValue: result.disposition, reason,
    });
  }

  await persistRanks(application);
  return result;
}

/**
 * Re-ranks every application in the requisition and persists the result.
 *
 * Rank is requisition-wide — one candidate's new weighted total can reorder
 * everyone else — so it can't be derived from a single application. Written
 * with updateOne rather than save() to avoid two live documents for the same
 * record. Application.rank is a real schema field that requisitionController
 * .getOne() sorts by; without this it stays undefined forever and that sort
 * silently does nothing.
 * @param {import('mongoose').Document} application - the just-recomputed application
 */
async function persistRanks(application) {
  const siblings = await Application.find({ requisitionId: application.requisitionId }).select('_id weightedTotal rank');
  const ranked = rankApplications(siblings.map((a) => a.toObject()));

  const writes = ranked
    .filter((a) => {
      const current = siblings.find((s) => String(s._id) === String(a._id));
      return current && current.rank !== a.rank;
    })
    .map((a) => Application.updateOne({ _id: a._id }, { $set: { rank: a.rank } }));
  await Promise.all(writes);

  const mine = ranked.find((a) => String(a._id) === String(application._id));
  if (mine) application.rank = mine.rank; // keep the returned document consistent
}

async function getOrCreateNextInterview(application, requisition, currentStageKey, userId) {
  const ordered = getEnabledStagesSorted(requisition);
  const currentIndex = ordered.findIndex((s) => s.key === currentStageKey);
  const next = ordered[currentIndex + 1];
  if (!next) return null;

  application.currentStageKey = next.key;

  let existing = await Interview.findOne({ applicationId: application._id, stageKey: next.key });
  if (!existing) {
    existing = await Interview.create({
      applicationId: application._id,
      requisitionId: application.requisitionId,
      stageKey: next.key,
      meetingMode: 'online',
      provider: 'google_meet',
      designatedScorerId: userId,
    });
    const nextProgress = application.stageProgress?.find((p) => p.stageKey === next.key);
    if (nextProgress) nextProgress.status = 'scheduled';
  }
  return existing._id;
}

/**
 * PATCH /api/scoring/interview/:id/approve
 * Approves AI scores for a stage: approvedScore := aiScore for every
 * attribute that wasn't already overridden (overrides made before approving
 * are preserved, not stomped). Evaluates the stage's gate immediately and
 * updates the Application's stage progress.
 *
 * status_only stages (e.g. 'offer') have no rubric and are never scored —
 * scoringEngine gives them no gate/weight at all — so this is also the one
 * action that marks them reached/complete: no scores, no gate, just
 * advances the pipeline, same endpoint HR already uses for every stage.
 */
const approve = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });

  const requisitionForType = await Requisition.findById(interview.requisitionId);
  const stageConfigForType = requisitionForType.stages.find((s) => s.key === interview.stageKey);

  if (stageConfigForType.inputType === 'status_only') {
    interview.status = 'approved';
    await interview.save();

    await AuditLog.create({
      action: 'score_approve', userId: req.user._id, requisitionId: interview.requisitionId, applicationId: interview.applicationId,
      targetType: 'interview', targetId: interview._id.toString(),
      newValue: { status: 'approved' },
      reason: 'Status-only stage marked reached/complete (no rubric, no gate).',
    });

    const application = await Application.findById(interview.applicationId);
    const progress = application.stageProgress.find((p) => p.stageKey === interview.stageKey);
    if (progress) progress.status = 'approved';

    const nextInterviewId = await getOrCreateNextInterview(application, requisitionForType, interview.stageKey, req.user._id);
    await recomputeAndPersist(application, requisitionForType, req.user._id, 'Recomputed after status-only stage approval.');

    console.log('[DEBUG - BACKEND APPROVE (STATUS ONLY)]', { interviewId: interview._id, passed: true, nextInterviewId });
    logger.info(`[Scoring] Marked status-only interview ${interview._id} approved (no scores). nextInterviewId=${nextInterviewId}`);
    return res.json({ interview, stageAverage: null, passed: true, application, nextInterviewId });
  }

  if (interview.status !== 'scored' && interview.status !== 'approved') {
    const isManual = stageConfigForType?.inputType === 'manual_rubric' || stageConfigForType?.stageType === 'simulation' || (interview.scores && interview.scores.some((s) => s.approvedScore != null));
    if (isManual && interview.scores && interview.scores.length > 0) {
      interview.status = 'scored';
    } else {
      throw new ValidationError(['status'], 'Interview must be scored before it can be approved.');
    }
  }

  const oldScores = interview.scores.map((s) => ({ attributeId: s.attributeId, approvedScore: s.approvedScore }));
  interview.scores.forEach((s) => {
    if (s.approvedScore === undefined || s.approvedScore === null) s.approvedScore = s.aiScore;
  });
  interview.status = 'approved';
  await interview.save();

  await AuditLog.create({
    action: 'score_approve', userId: req.user._id, requisitionId: interview.requisitionId, applicationId: interview.applicationId,
    targetType: 'interview', targetId: interview._id.toString(),
    oldValue: oldScores, newValue: interview.scores.map((s) => ({ attributeId: s.attributeId, approvedScore: s.approvedScore })),
    reason: 'Stage scores approved.',
  });

  const stageAverage = computeStageAverage(interview);
  const passed = isStagePassed(stageAverage, stageConfigForType.passThreshold);
  interview.stageAverage = stageAverage;
  await interview.save();

  const application = await Application.findById(interview.applicationId);
  const progress = application.stageProgress.find((p) => p.stageKey === interview.stageKey);
  if (progress) {
    progress.stageAverage = stageAverage;
    progress.passed = passed;
    progress.status = passed ? 'passed' : 'failed';
  }

  let nextInterviewId = null;
  if (passed) {
    nextInterviewId = await getOrCreateNextInterview(application, requisitionForType, interview.stageKey, req.user._id);
  }

  const result = await recomputeAndPersist(application, requisitionForType, req.user._id, 'Recomputed after stage approval.');

  console.log('[DEBUG - BACKEND APPROVE]', { interviewId: interview._id, passed, nextInterviewId });
  logger.info(`[Scoring] Approved interview ${interview._id}. stageAverage=${stageAverage} passed=${passed} weightedTotal=${result.weightedTotal} disposition=${result.disposition} nextInterviewId=${nextInterviewId}`);
  res.json({ interview, stageAverage, passed, application, nextInterviewId });
});

/**
 * PATCH /api/scoring/interview/:id/override
 * Body: { overrides: [{ attributeId, approvedScore, reason }] }
 * Overrides one or more attribute scores, always matched by attributeId —
 * never by array position. Every override is individually audited.
 */
const override = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });

  const { overrides } = req.body;
  if (!Array.isArray(overrides) || overrides.length === 0) {
    throw new ValidationError(['overrides'], 'overrides must be a non-empty array of { attributeId, approvedScore, reason }.');
  }

  for (const { attributeId, approvedScore, reason } of overrides) {
    if (approvedScore < 1 || approvedScore > 5) {
      throw new ValidationError(['approvedScore'], `approvedScore must be between 1 and 5 (attribute ${attributeId}).`);
    }
    let scoreEntry = interview.scores.find((s) => s.attributeId === attributeId);
    if (!scoreEntry) {
      scoreEntry = { attributeId };
      interview.scores.push(scoreEntry);
    }

    const oldValue = scoreEntry.approvedScore;
    scoreEntry.approvedScore = approvedScore;
    scoreEntry.overridden = true;
    scoreEntry.overriddenBy = req.user._id;
    scoreEntry.overrideReason = reason || 'Manual score entry';

    await AuditLog.create({
      action: 'score_override', userId: req.user._id, requisitionId: interview.requisitionId, applicationId: interview.applicationId,
      targetType: 'score', targetId: attributeId, oldValue, newValue: approvedScore, reason: reason || 'Manual score entry',
    });
  }

  if (interview.status !== 'approved') {
    interview.status = 'scored';
  }

  await interview.save();
  logger.info(`[Scoring] Overrode ${overrides.length} score(s) on interview ${interview._id}.`);
  res.json({ interview });
});

/**
 * POST /api/scoring/application/:id/recompute
 * Pure recompute: stage averages, gates, weighted total, allGatesPassed,
 * and disposition — via scoringEngine, using only approvedScore. A high
 * weightedTotal can never yield HIRE unless every gate passed.
 */
const recompute = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id);
  if (!application) return res.status(404).json({ error: 'NOT_FOUND', message: 'Application not found.' });

  const requisition = await Requisition.findById(application.requisitionId);
  const result = await recomputeAndPersist(
    application, requisition, req.user._id, 'Recomputed after score approval/override.'
  );

  logger.info(`[Scoring] Recomputed application ${application._id}: weightedTotal=${result.weightedTotal} disposition=${result.disposition}`);
  res.json({ application, stageResults: result.stageResults });
});

/**
 * PATCH /api/scoring/application/:id/decision
 * Records the final human decision (hired/rejected/withdrawn) — always a
 * manual action, always audited. Not gated on allGatesPassed: a human can
 * reject/withdraw at any point, and can act against the computed
 * disposition too (it's a recommendation, the human has final authority).
 */
const decision = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id).populate('candidateId', 'name');
  if (!application) return res.status(404).json({ error: 'NOT_FOUND', message: 'Application not found.' });

  const { decision: finalDecision, reason } = req.body;
  if (!FINAL_DECISIONS.includes(finalDecision)) {
    throw new ValidationError(['decision'], `decision must be one of: ${FINAL_DECISIONS.join(', ')}.`);
  }

  const oldDecision = application.finalDecision;
  application.finalDecision = finalDecision;
  application.finalDecisionBy = req.user._id;
  if (finalDecision === 'rejected' && reason) application.rejectionReason = reason;
  await application.save();

  await AuditLog.create({
    action: 'final_decision', userId: req.user._id, requisitionId: application.requisitionId, applicationId: application._id,
    targetType: 'application', targetId: application._id.toString(),
    oldValue: oldDecision, newValue: finalDecision, reason,
  });

  try {
    const requisition = await Requisition.findById(application.requisitionId);
    await slackNotifier.notifyFinalDecision({
      requisitionTitle: requisition.title,
      candidateName: application.candidateId?.name || 'Candidate',
      decision: finalDecision,
      applicationId: application._id.toString(),
    });
  } catch (err) {
    logger.warn(`[Scoring] Slack notify failed (non-fatal): ${err.message}`);
  }

  logger.info(`[Scoring] Final decision "${finalDecision}" recorded for application ${application._id} by user=${req.user._id}`);
  res.json({ application });
});

const passFail = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);

  if (!interview) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Interview not found.',
    });
  }

  const requisition = await Requisition.findById(interview.requisitionId);

  if (!requisition) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Requisition not found.',
    });
  }

  const stageConfig = requisition.stages.find(
    (s) => s.key === interview.stageKey
  );

  if (!stageConfig) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Stage configuration not found.',
    });
  }

  if (stageConfig.inputType !== 'pass_fail') {
    throw new ValidationError(
      ['stage'],
      'This endpoint is only for pass_fail stages.'
    );
  }

  const { passed } = req.body;

  if (typeof passed !== 'boolean') {
    throw new ValidationError(
      ['passed'],
      'passed must be a boolean.'
    );
  }

  // Reuse existing Interview fields.
  // No schema change required.
  interview.passFailResult = passed ? 'pass' : 'fail';
  interview.stageAverage = passed ? 5 : 1;
  interview.status = 'approved';

  await interview.save();

  await AuditLog.create({
    action: 'score_approve',
    userId: req.user._id,
    requisitionId: interview.requisitionId,
    applicationId: interview.applicationId,
    targetType: 'interview',
    targetId: interview._id.toString(),
    oldValue: null,
    newValue: { passed },
    reason: passed
      ? 'Marked pass_fail stage as passed.'
      : 'Marked pass_fail stage as failed.',
  });

  const application = await Application.findById(interview.applicationId);

  if (!application) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Application not found.',
    });
  }

  const progress = application.stageProgress.find(
    (p) => p.stageKey === interview.stageKey
  );

  if (progress) {
    progress.stageAverage = passed ? 5 : 1;
    progress.passed = passed;
    progress.status = passed ? 'passed' : 'failed';
  }

  let nextInterviewId = null;
  // Only PASS moves the candidate to the next stage.
  if (passed) {
    nextInterviewId = await getOrCreateNextInterview(application, requisition, interview.stageKey, req.user._id);
  }

  const result = await recomputeAndPersist(
    application,
    requisition,
    req.user._id,
    `Recomputed after HR marked pass_fail stage as ${passed ? 'passed' : 'failed'
    }.`
  );

  console.log('[DEBUG - BACKEND PASSFAIL]', { interviewId: interview._id, passed, nextInterviewId });
  logger.info(
    `[Scoring] HR marked pass_fail interview ${interview._id} ` +
    `passed=${passed} weightedTotal=${result.weightedTotal} ` +
    `disposition=${result.disposition} nextInterviewId=${nextInterviewId}`
  );

  res.json({
    interview,
    stageAverage: passed ? 5 : 1,
    passed,
    application,
    nextInterviewId,
  });
});

module.exports = { approve, override, recompute, decision, passFail };
