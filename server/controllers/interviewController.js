const { google } = require('googleapis');
const Interview = require('../models/Interview');
const Application = require('../models/Application');
const Requisition = require('../models/Requisition');
const Scorecard = require('../models/Scorecard');
const AuditLog = require('../models/AuditLog');
require('../models/Candidate'); // registers the Candidate model for populate('candidateId')
const logger = require('../utils/logger');
const { asyncHandler, getEnabledStagesSorted } = require('../utils/helpers');
const { ValidationError, TranscriptNotReadyError } = require('../utils/errors');
const { uploadBuffer } = require('../config/cloudinary');
const transcriptProvider = require('../services/transcriptProvider');
const { scoreInterview } = require('../services/aiScorer');
const slackNotifier = require('../services/slackNotifier');
const emailNotifier = require('../services/emailNotifier');
const { extractArtifactText } = require('../utils/textExtractor');

/**
 * Emails the candidate their current meeting link. Never throws — a missing
 * candidate email or a send failure is reported in the return value, never
 * as an error on the caller (creating/resending a meeting must still succeed
 * even if the email itself can't go out).
 * @param {import('mongoose').Document} interview
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
async function emailMeetingLinkToCandidate(interview) {
  try {
    const application = await Application.findById(interview.applicationId).populate('candidateId', 'name email');
    const candidate = application?.candidateId;
    if (!candidate?.email) {
      logger.warn(`[Interview] No candidate email on file for application ${interview.applicationId} — skipping meeting email.`);
      return { sent: false, reason: 'No candidate email on file.' };
    }
    const requisition = await Requisition.findById(interview.requisitionId);
    const stageConfig = requisition?.stages.find((s) => s.key === interview.stageKey);
    return await emailNotifier.sendMeetingLinkEmail({
      candidateEmail: candidate.email,
      candidateName: candidate.name,
      requisitionTitle: requisition?.title || 'your role',
      stageLabel: stageConfig?.label || interview.stageKey,
      meetingUri: interview.meetingUri,
    });
  } catch (err) {
    // The meeting itself is already saved — a failure anywhere in here (DB
    // lookup, credential read, transport setup) must never turn a successful
    // meeting creation into a 500 the caller has to retry.
    logger.warn(`[Interview] Could not email meeting link for ${interview._id}: ${err.message}`);
    return { sent: false, reason: 'Could not send the email — the meeting link was still saved.' };
  }
}

/**
 * Checks that every enabled stage before `stageKey` (in pipeline order) has
 * an APPROVED interview for this application. Throws a clear error if not —
 * this is the core "stages cannot be scored/started out of order" guarantee.
 * @returns {Promise<void>}
 */
async function assertPriorStagesApproved(requisition, applicationId, stageKey) {
  const ordered = getEnabledStagesSorted(requisition);
  const targetIndex = ordered.findIndex((s) => s.key === stageKey);
  if (targetIndex <= 0) return; // first stage (or not found — let the caller validate stageKey itself)

  const priorKeys = ordered.slice(0, targetIndex).map((s) => s.key);
  const priorInterviews = await Interview.find({ applicationId, stageKey: { $in: priorKeys } });

  for (const key of priorKeys) {
    const interview = priorInterviews.find((i) => i.stageKey === key);
    if (!interview || interview.status !== 'approved') {
      const label = ordered.find((s) => s.key === key)?.label || key;
      const err = new ValidationError(['stageKey'], `Stage "${label}" must be approved before this stage can proceed.`);
      err.statusCode = 409;
      throw err;
    }
  }
}

/**
 * GET /api/interviews?applicationId=X or ?requisitionId=X
 * Lightweight lookup so the UI can link back to a candidate's earlier
 * (already-approved) stages — there's no other way to discover an
 * interview's id once you've navigated away from it.
 */
const list = asyncHandler(async (req, res) => {
  const { applicationId, requisitionId } = req.query;
  if (!applicationId && !requisitionId) {
    throw new ValidationError(['applicationId'], 'applicationId or requisitionId query param is required.');
  }
  const filter = {};
  if (applicationId) filter.applicationId = applicationId;
  if (requisitionId) filter.requisitionId = requisitionId;
  const interviews = await Interview.find(filter).select('_id applicationId stageKey status stageAverage');
  res.json({ interviews });
});

/** GET /api/interviews/:id */
const getOne = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });
  res.json({ interview });
});

/**
 * POST /api/interviews
 * Creates an interview instance for an application + stage. ENFORCEMENT:
 * refuses to create it unless every earlier enabled stage is already
 * approved, and refuses a duplicate interview for the same stage.
 */
const create = asyncHandler(async (req, res) => {
  const { applicationId, stageKey, meetingMode, provider } = req.body;
  if (!applicationId || !stageKey) throw new ValidationError(['applicationId', 'stageKey'], 'applicationId and stageKey are required.');

  const application = await Application.findById(applicationId);
  if (!application) throw new ValidationError(['applicationId'], 'No application found with that id.');
  if (application.disposition === 'NO_HIRE' || (application.stageProgress || []).some((p) => p.status === 'failed')) {
    throw new ValidationError(['applicationId'], 'This candidate has failed a stage and cannot have new interviews created.');
  }

  const requisition = await Requisition.findById(application.requisitionId);
  const stageConfig = requisition.stages.find((s) => s.key === stageKey && s.enabled);
  if (!stageConfig) throw new ValidationError(['stageKey'], 'That stage is not enabled on this requisition.');

  const existing = await Interview.findOne({ applicationId, stageKey });
  if (existing) {
    return res.status(409).json({ error: 'VALIDATION_ERROR', message: 'An interview for this application+stage already exists.', interviewId: existing._id });
  }

  await assertPriorStagesApproved(requisition, applicationId, stageKey);

  const interview = await Interview.create({
    applicationId,
    requisitionId: requisition._id,
    stageKey,
    meetingMode: meetingMode || 'online',
    provider: provider || 'google_meet',
    designatedScorerId: req.user._id,
  });

  application.currentStageKey = stageKey;
  const progress = application.stageProgress.find((p) => p.stageKey === stageKey);
  if (progress) progress.status = 'scheduled';
  await application.save();

  logger.info(`[Interview] Created ${interview._id} for application=${applicationId} stage=${stageKey}`);
  res.status(201).json({ interview });
});

/**
 * POST /api/interviews/:id/meeting
 * Body {} -> creates a real meeting via the active provider. Body {meetingUri}
 * -> HR pasted a link directly (marks provider 'manual', since that link's
 * transcript can't be auto-fetched).
 */
const createMeeting = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });

  if (req.body?.meetingUri) {
    interview.meetingUri = req.body.meetingUri;
    interview.provider = 'manual';
  } else {
    const { meetingUri, conferenceId } = await transcriptProvider.createMeeting(interview);
    interview.meetingUri = meetingUri;
    interview.conferenceId = conferenceId;
    // Only google_meet actually reaches this line in Phase 1 — zoom/fathom throw
    // "not enabled" inside createMeeting() before ever returning.
    interview.provider = 'google_meet';
  }
  interview.status = 'scheduled';
  await interview.save();

  const emailResult = await emailMeetingLinkToCandidate(interview);

  logger.info(`[Interview] Meeting set for ${interview._id}: ${interview.meetingUri}`);
  res.json({ interview, emailSent: emailResult.sent, emailReason: emailResult.reason });
});

/**
 * POST /api/interviews/:id/send-meeting-email
 * Manually (re)sends the current meeting link to the candidate — for when
 * the auto-send on creation failed, was missed, or the link since changed.
 */
const sendMeetingEmail = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });
  if (!interview.meetingUri) {
    throw new ValidationError(['meetingUri'], 'This interview has no meeting link yet.');
  }

  const result = await emailMeetingLinkToCandidate(interview);
  res.json(result);
});

/**
 * DELETE /api/interviews/:id/meeting
 * Cancels a created/pasted meeting so a fresh one can be set. Only ever
 * touches the meeting link itself — if this stage already has scores, the
 * scores/status/transcript are left completely untouched, so cancelling a
 * stale link can never orphan or reset evidence a human already reviewed.
 */
const cancelMeeting = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });

  interview.meetingUri = undefined;
  interview.conferenceId = undefined;

  if (!interview.scores?.length) {
    interview.status = 'pending';
    if (interview.transcriptStatus === 'pending') {
      interview.transcriptStatus = 'none';
    }
  }
  await interview.save();

  logger.info(`[Interview] Meeting cancelled for ${interview._id}.`);
  res.json({ interview });
});

/** POST /api/interviews/:id/consent */
const recordConsent = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });

  interview.consentObtained = true;
  await interview.save();

  await AuditLog.create({
    action: 'consent_capture', userId: req.user._id, requisitionId: interview.requisitionId, applicationId: interview.applicationId,
    targetType: 'interview', targetId: interview._id.toString(), newValue: { consentObtained: true },
    reason: 'Candidate consent confirmed before recording/scoring.',
  });

  res.json({ interview });
});

/**
 * POST /api/interviews/:id/fetch-transcript
 * Pulls the transcript from the active provider. Not ready yet is NOT an
 * error condition per spec — surfaced as TRANSCRIPT_NOT_READY (202), not a
 * 4xx/5xx failure, so the UI knows to keep polling.
 */
const fetchTranscript = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });

  const result = await transcriptProvider.fetchTranscript(interview);

  if (result.resolvedConferenceId) interview.conferenceId = result.resolvedConferenceId;

  if (result.status === 'pending') {
    interview.transcriptStatus = 'pending';
    await interview.save();
    throw new TranscriptNotReadyError(120);
  }

  interview.transcriptText = result.text;
  interview.transcriptStatus = 'ready';
  await interview.save();

  logger.info(`[Interview] Transcript ready for ${interview._id}.`);
  res.json({ interview });
});

/**
 * POST /api/interviews/:id/upload-transcript
 * Manual transcript upload (in-person / fallback). The uploaded file's text
 * is read straight from the in-memory buffer into transcriptText — the
 * Interview schema has no separate field to track a raw transcript file, so
 * the raw upload itself is never persisted anywhere, just its text content.
 */
const uploadTranscript = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });
  if (!req.file) throw new ValidationError(['transcript'], 'A transcript file is required (field name "transcript").');

  const text = req.file.buffer.toString('utf8');

  interview.transcriptText = text;
  interview.transcriptStatus = 'ready';
  if (interview.provider !== 'manual') interview.provider = 'manual';
  await interview.save();

  await AuditLog.create({
    action: 'transcript_upload', userId: req.user._id, requisitionId: interview.requisitionId, applicationId: interview.applicationId,
    targetType: 'interview', targetId: interview._id.toString(), newValue: { transcriptStatus: 'ready', wordCount: text.split(/\s+/).length },
    reason: 'Manual transcript upload.',
  });

  logger.info(`[Interview] Manual transcript uploaded for ${interview._id} (${text.length} chars).`);
  res.json({ interview });
});

/**
 * POST /api/interviews/:id/upload-artifact — deliverable/CV for
 * task_performance/resume_screen stages. The uploaded file is stored on
 * Cloudinary (HR reference/download) AND its text is extracted into
 * transcriptText, so score() and aiScorer — which only ever read
 * transcriptText — can score an artifact exactly like a transcript, with no
 * changes to either.
 */
const uploadArtifact = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });
  if (!req.file) throw new ValidationError(['artifact'], 'An artifact file is required (field name "artifact").');

  const uploaded = await uploadBuffer(req.file.buffer, { folder: 'interview-artifacts', filename: `${Date.now()}-${req.file.originalname}` });
  interview.artifactFileUrl = uploaded.secureUrl;
  interview.artifactFilePublicId = uploaded.publicId;

  try {
    interview.transcriptText = await extractArtifactText(req.file.buffer, req.file.originalname);
    interview.transcriptStatus = 'ready';
  } catch (err) {
    interview.transcriptStatus = 'failed';
    await interview.save();
    logger.warn(`[Interview] Artifact text extraction failed for ${interview._id}: ${err.message}`);
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: err.message, interview });
  }

  await interview.save();
  logger.info(`[Interview] Artifact uploaded for ${interview._id}: ${interview.artifactFileUrl} (${interview.transcriptText.length} chars extracted)`);
  res.json({ interview });
});

/**
 * POST /api/interviews/:id/score
 * ENFORCEMENT: refuses to score without recorded consent, and refuses to
 * score without a ready transcript. Runs aiScorer and returns PROPOSED
 * scores — they do not count until approved (scoringController).
 */
const score = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });

  const requisition = await Requisition.findById(interview.requisitionId);
  const stageConfig = requisition.stages.find((s) => s.key === interview.stageKey);

  // Consent is about recording a live conversation (per the Interview
  // schema's own comment) — it doesn't apply to an uploaded artifact.
  if (stageConfig.inputType === 'transcript' && !interview.consentObtained) {
    const err = new ValidationError(['consentObtained'], 'Candidate consent must be recorded before scoring.');
    err.statusCode = 403;
    throw err;
  }
  if (interview.transcriptStatus === 'pending') throw new TranscriptNotReadyError(120);
  if (interview.transcriptStatus !== 'ready' || !interview.transcriptText) {
    const message = stageConfig.inputType === 'artifact'
      ? 'No artifact uploaded yet to score.'
      : 'No transcript available to score yet.';
    throw new ValidationError(['transcriptText'], message);
  }

  await assertPriorStagesApproved(requisition, interview.applicationId, interview.stageKey);

  const scorecard = await Scorecard.findOne({ requisitionId: interview.requisitionId });
  const scorecardStage = scorecard?.stages.find((s) => s.stageKey === interview.stageKey);
  if (!scorecardStage || scorecardStage.attributes.length === 0) {
    throw new ValidationError(['stageKey'], 'No rubric found for this stage — generate or edit the scorecard first.');
  }

  const { interview: scored, message } = await scoreInterview({
    interview,
    stageType: stageConfig.stageType,
    attributes: scorecardStage.attributes,
  });

  if (message) {
    return res.json({ interview: scored, message });
  }

  const application = await Application.findById(interview.applicationId).populate('candidateId', 'name');
  const progress = application.stageProgress.find((p) => p.stageKey === interview.stageKey);
  if (progress) progress.status = 'scored';
  await application.save();

  try {
    const stageAverage = scored.scores.length
      ? Math.round((scored.scores.reduce((sum, s) => sum + (s.aiScore || 0), 0) / scored.scores.length) * 100) / 100
      : null;
    await slackNotifier.notifyTranscriptReady({
      requisitionTitle: requisition.title,
      candidateName: application.candidateId?.name || 'Candidate',
      stageLabel: stageConfig.label,
      aiStageAverage: stageAverage,
      interviewId: scored._id.toString(),
    });
  } catch (err) {
    logger.warn(`[Interview] Slack notify failed (non-fatal): ${err.message}`);
  }

  logger.info(`[Interview] Scored ${scored._id}.`);
  res.json({ interview: scored });
});

/**
 * GET /api/interviews/google/callback
 * One-time OAuth consent callback for obtaining a fresh Google refresh
 * token through the app itself (alternative to the OAuth Playground flow).
 * The full refresh token is logged server-side, not returned in the HTTP
 * response body, so it doesn't linger in browser history/dev tools.
 */
const googleOAuthCallback = asyncHandler(async (req, res) => {
  const { code } = req.query;
  if (!code) throw new ValidationError(['code'], 'Missing OAuth authorization code.');

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  const { tokens } = await client.getToken(code);

  if (tokens.refresh_token) {
    logger.info(`[Interview] Google OAuth callback obtained a new refresh token: ${tokens.refresh_token}`);
  }

  res.json({
    message: 'Google authorization succeeded. Copy the new refresh token from the server log into GOOGLE_REFRESH_TOKEN in .env and restart the server.',
    refreshTokenPreview: tokens.refresh_token ? `${tokens.refresh_token.slice(0, 12)}...` : null,
  });
});

module.exports = {
  list, getOne, create, createMeeting, cancelMeeting, sendMeetingEmail, recordConsent, fetchTranscript,
  uploadTranscript, uploadArtifact, score, googleOAuthCallback,
};
