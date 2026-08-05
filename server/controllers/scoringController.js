const Interview = require('../models/Interview');
const Application = require('../models/Application');
const Requisition = require('../models/Requisition');
require('../models/Candidate'); // registers the Candidate model for populate('candidateId')
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const { asyncHandler, getEnabledStagesSorted } = require('../utils/helpers');
const { ValidationError } = require('../utils/errors');
const { FINAL_DECISIONS } = require('../utils/constants');
const { computeStageAverage, isStagePassed, computeApplicationResult } = require('../services/scoringEngine');
const slackNotifier = require('../services/slackNotifier');

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
    const ordered = getEnabledStagesSorted(requisitionForType);
    const currentIndex = ordered.findIndex((s) => s.key === interview.stageKey);
    const next = ordered[currentIndex + 1];
    if (next) application.currentStageKey = next.key;
    await application.save();

    logger.info(`[Scoring] Marked status-only interview ${interview._id} approved (no scores).`);
    return res.json({ interview, stageAverage: null, passed: null });
  }

  if (interview.status !== 'scored' && interview.status !== 'approved') {
    throw new ValidationError(['status'], 'Interview must be scored before it can be approved.');
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
  if (passed) {
    const ordered = getEnabledStagesSorted(requisitionForType);
    const currentIndex = ordered.findIndex((s) => s.key === interview.stageKey);
    const next = ordered[currentIndex + 1];
    if (next) application.currentStageKey = next.key;
  }
  await application.save();

  logger.info(`[Scoring] Approved interview ${interview._id}. stageAverage=${stageAverage} passed=${passed}`);
  res.json({ interview, stageAverage, passed });
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
    const scoreEntry = interview.scores.find((s) => s.attributeId === attributeId);
    if (!scoreEntry) {
      throw new ValidationError(['attributeId'], `No score entry found for attributeId "${attributeId}" on this interview.`);
    }

    const oldValue = scoreEntry.approvedScore;
    scoreEntry.approvedScore = approvedScore;
    scoreEntry.overridden = true;
    scoreEntry.overriddenBy = req.user._id;
    scoreEntry.overrideReason = reason;

    await AuditLog.create({
      action: 'score_override', userId: req.user._id, requisitionId: interview.requisitionId, applicationId: interview.applicationId,
      targetType: 'score', targetId: attributeId, oldValue, newValue: approvedScore, reason,
    });
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
  await application.save();

  if (oldDisposition !== result.disposition) {
    await AuditLog.create({
      action: 'disposition_change', userId: req.user._id, requisitionId: application.requisitionId, applicationId: application._id,
      targetType: 'application', targetId: application._id.toString(),
      oldValue: oldDisposition, newValue: result.disposition,
      reason: 'Recomputed after score approval/override.',
    });
  }

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

module.exports = { approve, override, recompute, decision };
