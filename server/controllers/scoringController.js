const Interview = require('../models/Interview');
const Application = require('../models/Application');
const Requisition = require('../models/Requisition');
require('../models/Candidate'); // registers the Candidate model for populate('candidateId')
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const { asyncHandler, getEnabledStagesSorted } = require('../utils/helpers');
const { ValidationError } = require('../utils/errors');
const { assertCalendarMeetingCancelled } = require('../utils/meetingLifecycle');
const { assertRequisitionOpen, assertRequisitionNotClosed } = require('../utils/requisitionStatus');
const { FINAL_DECISIONS } = require('../utils/constants');
const { computeStageAverage, isStagePassed, computeApplicationResult, rankApplications } = require('../services/scoringEngine');
const slackNotifier = require('../services/slackNotifier');
const emailNotifier = require('../services/emailNotifier');
const { enqueueEmail, cancelPendingEmails } = require('../services/emailQueue');
const { uploadFile, deleteFile } = require('../services/fileStorage');
const { assertPdfUpload } = require('../utils/uploadValidation');
const { generateOfferLetter } = require('../services/offerLetterService');
const { listTemplates } = require('../services/offerLetterTemplates');

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
    let progress = application.stageProgress.find((p) => p.stageKey === r.stageKey);
    if (!progress) {
      progress = {
        stageKey: r.stageKey,
        status: r.passed === true ? 'passed' : r.passed === false ? 'failed' : 'pending',
        stageAverage: r.stageAverage,
        passed: r.passed,
      };
      application.stageProgress.push(progress);
    } else {
      progress.stageAverage = r.stageAverage;
      progress.passed = r.passed;
      if (r.passed === true) {
        progress.status = 'passed';
      } else if (r.passed === false) {
        progress.status = 'failed';
      }
    }
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
  // A completed interview may be approved while a requisition is on hold, but
  // that must not quietly start the next stage. Closed requisitions never
  // reach this helper because their mutations are rejected at the endpoint.
  if (requisition.status !== 'open') return null;

  const ordered = getEnabledStagesSorted(requisition);
  const currentIndex = ordered.findIndex((s) => s.key === currentStageKey);
  const next = ordered[currentIndex + 1];
  if (!next) return null;

  application.currentStageKey = next.key;

  const isHrInterview = next.key === 'hr_interview' || next.stageType === 'hr_interview' || String(next.key).toLowerCase().includes('hr_interview');
  let existing = await Interview.findOne({ applicationId: application._id, stageKey: next.key });
  if (!existing) {
    existing = await Interview.create({
      applicationId: application._id,
      requisitionId: application.requisitionId,
      stageKey: next.key,
      meetingMode: 'online',
      provider: 'google_meet',
      designatedScorerId: userId,
      candidateAvailability: isHrInterview ? (application.candidateAvailability || undefined) : undefined,
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
  assertCalendarMeetingCancelled(interview, 'approve or re-approve this stage');

  const requisitionForType = await Requisition.findById(interview.requisitionId);
  assertRequisitionNotClosed(requisitionForType, 'approve interview scores');
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

    logger.info(`[Scoring] Marked status-only interview ${interview._id} approved (no scores). nextInterviewId=${nextInterviewId}`);
    return res.json({ interview, stageAverage: null, passed: true, application, nextInterviewId });
  }

  // If overrides array is passed in the request body (e.g. from manual rubric submit), process them first
  const { overrides } = req.body;
  if (Array.isArray(overrides) && overrides.length > 0) {
    for (const { attributeId, approvedScore, reason } of overrides) {
      const numScore = Number(approvedScore);
      if (numScore < 1 || numScore > 5) {
        throw new ValidationError(['approvedScore'], `approvedScore must be between 1 and 5 (attribute ${attributeId}).`);
      }
      let scoreEntry = interview.scores.find((s) => s.attributeId === attributeId);
      if (scoreEntry) {
        scoreEntry.approvedScore = numScore;
        scoreEntry.overridden = true;
        scoreEntry.overriddenBy = req.user._id;
        scoreEntry.overrideReason = reason || 'Manual score entry';
      } else {
        interview.scores.push({
          attributeId,
          approvedScore: numScore,
          overridden: true,
          overriddenBy: req.user._id,
          overrideReason: reason || 'Manual score entry',
        });
      }
    }
    interview.status = 'scored';
    interview.markModified('scores');
  }

  if (interview.status !== 'scored' && interview.status !== 'approved') {
    const isManual = stageConfigForType?.inputType === 'manual_rubric' || stageConfigForType?.stageType === 'simulation' || stageConfigForType?.stageType === 'task_performance' || (interview.scores && interview.scores.some((s) => s.approvedScore != null));
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
  interview.markModified('scores');
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
  const requisition = await Requisition.findById(interview.requisitionId);
  assertRequisitionNotClosed(requisition, 'override interview scores');

  const { overrides } = req.body;

  if (!Array.isArray(overrides) || overrides.length === 0) {
    throw new ValidationError(['overrides'], 'overrides must be a non-empty array of { attributeId, approvedScore, reason }.');
  }

  for (const { attributeId, approvedScore, reason } of overrides) {
    const numScore = Number(approvedScore);
    if (numScore < 1 || numScore > 5) {
      throw new ValidationError(['approvedScore'], `approvedScore must be between 1 and 5 (attribute ${attributeId}).`);
    }
    const trimmedReason = String(reason || '').trim();
    if (trimmedReason.length < 10) {
      throw new ValidationError(['reason'], `Override reason for attribute "${attributeId}" must be at least 10 characters long.`);
    }
    let scoreEntry = interview.scores.find((s) => s.attributeId === attributeId);
    if (scoreEntry) {
      const oldValue = scoreEntry.approvedScore;
      scoreEntry.approvedScore = numScore;
      scoreEntry.overridden = true;
      scoreEntry.overriddenBy = req.user._id;
      scoreEntry.overrideReason = trimmedReason;

      await AuditLog.create({
        action: 'score_override', userId: req.user._id, requisitionId: interview.requisitionId, applicationId: interview.applicationId,
        targetType: 'score', targetId: attributeId, oldValue, newValue: numScore, reason: trimmedReason,
      });
    } else {
      interview.scores.push({
        attributeId,
        approvedScore: numScore,
        overridden: true,
        overriddenBy: req.user._id,
        overrideReason: trimmedReason,
      });

      await AuditLog.create({
        action: 'score_override', userId: req.user._id, requisitionId: interview.requisitionId, applicationId: interview.applicationId,
        targetType: 'score', targetId: attributeId, oldValue: null, newValue: numScore, reason: trimmedReason,
      });
    }
  }

  if (interview.status !== 'approved') {
    interview.status = 'scored';
  }

  interview.markModified('scores');
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
  assertRequisitionNotClosed(requisition, 'recompute scores');
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
  const requisition = await Requisition.findById(application.requisitionId);
  assertRequisitionNotClosed(requisition, 'record a final decision');

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

/**
 * GET /api/scoring/offer-letter-templates
 * The offer letter templates staff can choose from, with the fields each one needs and
 * whether its Word file is present on this server.
 */
const getOfferLetterTemplates = asyncHandler(async (req, res) => {
  res.json({ templates: listTemplates() });
});

/**
 * POST /api/scoring/application/:id/offer-letter-preview   { templateKey, fields }
 * Makes the letter exactly as it would be sent and returns the PDF (base64), without storing or emailing anything.
 */
const previewOfferLetter = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id).populate('candidateId', 'name');
  if (!application) return res.status(404).json({ error: 'NOT_FOUND', message: 'Application not found.' });
  if (application.finalDecision !== 'hired') {
    throw new ValidationError(['finalDecision'], 'An offer letter can only be made after the candidate is marked Hired.');
  }
  const requisition = await Requisition.findById(application.requisitionId);
  assertRequisitionNotClosed(requisition, 'make an offer letter');

  const generated = await generateOfferLetter({
    templateKey: req.body?.templateKey,
    fields: req.body?.fields,
    candidateName: application.candidateId?.name,
  });
  // JSON (not raw PDF bytes) so the app's API client keeps its normal error messages and session renewal.
  res.set('Cache-Control', 'no-store');
  res.json({ fileName: generated.fileName, pdfBase64: generated.pdf.toString('base64') });
});

/**
 * POST /api/scoring/application/:id/send-offer-letter
 * Stores the offer letter for a hired candidate and emails it. The letter is either a PDF
 * uploaded by staff (multipart, field "offerLetter") or made from a template on the server
 * (JSON { templateKey, fields }). A non-fatal email failure is reported in the response
 * (emailQueued / emailReason) and does not undo the upload.
 */
const sendOfferLetter = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id).populate('candidateId', 'name email');
  if (!application) return res.status(404).json({ error: 'NOT_FOUND', message: 'Application not found.' });

  if (application.finalDecision !== 'hired') {
    throw new ValidationError(['finalDecision'], 'An offer letter can only be sent after the candidate is marked Hired.');
  }

  const requisition = await Requisition.findById(application.requisitionId);
  assertRequisitionNotClosed(requisition, 'send an offer letter');

  // The letter is either the PDF staff uploaded, or one made from a template (the template wins if both arrive).
  let file = req.file;
  let template = null;
  if (req.body?.templateKey) {
    const generated = await generateOfferLetter({
      templateKey: req.body.templateKey,
      fields: req.body.fields,
      candidateName: application.candidateId?.name,
    });
    file = { buffer: generated.pdf, originalname: generated.fileName, size: generated.pdf.length, mimetype: 'application/pdf' };
    template = { key: generated.templateKey, fields: generated.fields };
  }

  assertPdfUpload(file, { field: 'offerLetter', label: 'offer letter' });

  // Upload the NEW file first and delete the old one only after the new one is saved, so a failed
  // upload never leaves the application pointing at a file that has already been deleted.
  const previousPublicId = application.offerLetterPublicId;
  const upload = await uploadFile({ file, folder: 'offer-letters' });

  application.offerLetterTemplateKey = template ? template.key : null;
  application.offerLetterFields = template ? template.fields : null;
  application.offerLetterUrl = upload.url;
  application.offerLetterPublicId = upload.publicId;
  application.offerLetterFileName = upload.name;
  application.offerLetterFileSize = upload.size;
  application.offerLetterFileMimeType = upload.mimeType;
  application.offerLetterUploadedAt = new Date();

  // The delivery status stays "pending" until the email queue really sends the email
  // (it then updates it to "sent"). Saved BEFORE queueing so that update cannot be overwritten.
  application.offerLetterDeliveryStatus = 'pending';
  application.offerLetterSentAt = null;
  try {
    await application.save();
  } catch (err) {
    // The new file was never recorded, so remove it; the previous letter is still in place.
    await deleteFile(upload.publicId).catch((cleanupErr) => logger.warn(`[Scoring] Could not remove unsaved offer letter ${upload.publicId}: ${cleanupErr.message}`));
    throw err;
  }

  // The new letter is saved, so the previous file is no longer needed.
  if (previousPublicId && previousPublicId !== upload.publicId) {
    try {
      await deleteFile(previousPublicId);
    } catch (err) {
      logger.warn(`[Scoring] Could not remove previous offer letter for ${application._id}: ${err.message}`);
    }
  }

  // The email is sent in the background. Production attaches the PDF itself (the queue keeps it
  // until sent); other environments send a link.
  const candidate = application.candidateId;
  const emailResult = await enqueueEmail({
    type: 'offer-letter',
    to: candidate?.email,
    payload: {
      candidateEmail: candidate?.email,
      candidateName: candidate?.name,
      requisitionTitle: requisition.title,
      offerLetterUrl: upload.url,
    },
    attachment: emailNotifier.shouldAttachOfferLetter()
      ? { filename: file.originalname, content: file.buffer, contentType: 'application/pdf' }
      : undefined,
    related: { kind: 'offer-letter', applicationId: application._id },
  });
  // A resend replaces any earlier offer email that is still waiting or retrying, so the candidate gets one.
  if (emailResult.queued) await cancelPendingEmails({ type: 'offer-letter', applicationId: application._id, exceptJobId: emailResult.jobId });

  await AuditLog.create({
    action: 'offer_letter_sent',
    userId: req.user._id,
    requisitionId: application.requisitionId,
    applicationId: application._id,
    targetType: 'application',
    targetId: application._id.toString(),
    newValue: { offerLetterUrl: upload.url, emailQueued: emailResult.queued, ...(template ? { templateKey: template.key } : {}) },
    reason: template ? 'Offer letter made from a template for a hired candidate.' : 'Offer letter uploaded for a hired candidate.',
  });

  logger.info(`[Scoring] Offer letter ${template ? `made from template "${template.key}"` : 'uploaded'} for application ${application._id}; email queued=${emailResult.queued}.`);
  res.json({ application, emailQueued: emailResult.queued, emailReason: emailResult.reason });
});

const passFail = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);

  if (!interview) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Interview not found.',
    });
  }
  assertCalendarMeetingCancelled(interview, 'save this stage decision');

  const requisition = await Requisition.findById(interview.requisitionId);

  if (!requisition) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Job Opening not found.',
    });
  }
  assertRequisitionNotClosed(requisition, 'record a pass or fail result');

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

/**
 * PATCH /api/scoring/application/:id/override-initial-screening
 * Body: { passed: boolean, score?: number, reason?: string }
 * Overrides the candidate's initial screening pass/fail decision or AI score.
 * If passed is set to true, automatically creates/advances the candidate to Stage 1
 * of the requisition's pipeline.
 */
const overrideInitialScreening = asyncHandler(async (req, res) => {
  const application = await Application.findById(req.params.id);
  if (!application) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Application not found.' });
  }

  const requisition = await Requisition.findById(application.requisitionId);
  if (!requisition) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });
  }
  assertRequisitionOpen(requisition, 'advance a candidate from initial screening');

  const { passed, score, reason } = req.body;
  if (typeof passed !== 'boolean') {
    throw new ValidationError(['passed'], 'passed must be a boolean.');
  }

  const trimmedReason = String(reason || '').trim();
  if (trimmedReason.length < 10) {
    throw new ValidationError(['reason'], 'Override justification reason must be at least 10 characters long.');
  }

  const oldScreening = application.initialScreening || {};
  application.initialScreening = {
    aiScore: score !== undefined ? Number(score) : (oldScreening.aiScore || 3.0),
    aiJustification: oldScreening.aiJustification || 'Initial screening',
    passed,
    overridden: true,
    overriddenBy: req.user._id,
    overrideReason: trimmedReason,
  };

  const enabledStages = (requisition.stages || []).filter((s) => s.enabled);
  const firstStage = enabledStages[0] || requisition.stages[0];
  const firstStageKey = firstStage ? firstStage.key : null;

  let nextInterviewId = null;
  if (passed && firstStageKey) {
    application.disposition = null;
    application.currentStageKey = firstStageKey;
    
    const Interview = require('../models/Interview');
    const isHrStage = firstStageKey === 'hr_interview' || firstStage?.stageType === 'hr_interview' || String(firstStageKey).toLowerCase().includes('hr_interview');
    let existing = await Interview.findOne({ applicationId: application._id, stageKey: firstStageKey });
    if (!existing) {
      existing = await Interview.create({
        applicationId: application._id,
        requisitionId: requisition._id,
        stageKey: firstStageKey,
        meetingMode: 'online',
        provider: 'google_meet',
        status: 'pending',
        candidateAvailability: isHrStage ? (application.candidateAvailability || undefined) : undefined,
      });
    }
    nextInterviewId = existing._id;
    const progressItem = application.stageProgress.find((p) => p.stageKey === firstStageKey);
    if (progressItem) progressItem.status = 'scheduled';
  } else if (!passed) {
    application.currentStageKey = null;
    application.disposition = 'NO_HIRE';
  }

  await application.save();

  await AuditLog.create({
    action: 'score_override',
    userId: req.user._id,
    requisitionId: requisition._id,
    applicationId: application._id,
    targetType: 'application',
    targetId: application._id.toString(),
    oldValue: oldScreening,
    newValue: application.initialScreening,
    reason: reason || 'Initial screening overridden by HR.',
  });

  try {
    const allApps = await Application.find({ requisitionId: requisition._id });
    const ranked = rankApplications(allApps);
    for (const app of ranked) {
      await Application.updateOne({ _id: app._id }, { rank: app.rank });
    }
  } catch (rankErr) {
    logger.warn(`[Scoring] Ranking error: ${rankErr.message}`);
  }

  logger.info(`[Scoring] HR overridden initial screening for app ${application._id}: passed=${passed}, score=${score}, nextInterviewId=${nextInterviewId}`);
  res.json({ application, nextInterviewId });
});

module.exports = { approve, override, recompute, decision, sendOfferLetter, getOfferLetterTemplates, previewOfferLetter, passFail, overrideInitialScreening, recomputeAndPersist, getOrCreateNextInterview };

