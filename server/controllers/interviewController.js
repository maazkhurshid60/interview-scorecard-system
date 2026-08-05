const fs = require('fs');
const { google } = require('googleapis');
const Interview = require('../models/Interview');
const Application = require('../models/Application');
const Requisition = require('../models/Requisition');
const Scorecard = require('../models/Scorecard');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const { asyncHandler, getEnabledStagesSorted } = require('../utils/helpers');
const { ValidationError, TranscriptNotReadyError } = require('../utils/errors');
const { relativeUploadPath } = require('../middleware/upload');
const transcriptProvider = require('../services/transcriptProvider');
const { scoreInterview } = require('../services/aiScorer');
const slackNotifier = require('../services/slackNotifier');
const { extractArtifactText } = require('../utils/textExtractor');

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

  logger.info(`[Interview] Meeting set for ${interview._id}: ${interview.meetingUri}`);
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
 * is read into transcriptText and the raw file is deleted immediately —
 * the Interview schema has no separate field to track a raw transcript
 * file, so keeping an untracked orphan file on disk would serve no purpose
 * once its content is safely captured in the document.
 */
const uploadTranscript = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });
  if (!req.file) throw new ValidationError(['transcript'], 'A transcript file is required (field name "transcript").');

  const text = fs.readFileSync(req.file.path, 'utf8');
  fs.unlink(req.file.path, (err) => {
    if (err) logger.warn(`[Interview] Could not remove temp transcript upload ${req.file.path}: ${err.message}`);
  });

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
 * task_performance/resume_screen stages. The uploaded file is kept on disk
 * (HR reference/download) AND its text is extracted into transcriptText,
 * so score() and aiScorer — which only ever read transcriptText — can score
 * an artifact exactly like a transcript, with no changes to either.
 */
const uploadArtifact = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });
  if (!req.file) throw new ValidationError(['artifact'], 'An artifact file is required (field name "artifact").');

  interview.artifactFileUrl = relativeUploadPath(req.file);

  try {
    interview.transcriptText = await extractArtifactText(req.file.path);
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
  list, getOne, create, createMeeting, recordConsent, fetchTranscript,
  uploadTranscript, uploadArtifact, score, googleOAuthCallback,
};
