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
const { assertCalendarMeetingCancelled } = require('../utils/meetingLifecycle');
const { assertRequisitionOpen, assertRequisitionNotClosed } = require('../utils/requisitionStatus');
const { uploadFile, deleteFile } = require('../services/fileStorage');
const { assertPdfUpload } = require('../utils/uploadValidation');
const { enqueueEmail, cancelPendingEmails } = require('../services/emailQueue');
const { getCalendarTimeZone } = require('../utils/calendarTimeZone');
const { destroyFileIfUnreferenced } = require('../services/fileReferenceCleanup');
const transcriptProvider = require('../services/transcriptProvider');
const { scoreInterview } = require('../services/aiScorer');
const slackNotifier = require('../services/slackNotifier');
const emailNotifier = require('../services/emailNotifier');
const { getSecrets } = require('../utils/secrets');
const { extractArtifactText } = require('../utils/textExtractor');
const { getCaptchaConfig, verifyCaptcha } = require('../services/captchaService');
const { recomputeAndPersist, getOrCreateNextInterview } = require('./scoringController');

/** Temporary diagnostic: remove after transcript parsing is verified. */
function logParsedText(interviewId, source, text) {
  const value = String(text || '');
  logger.info(`[Interview] Parsed ${source} text for ${interviewId} (${value.length} chars):\n${value}`);
}

/**
 * Queues an email with the candidate's current meeting link (it is sent in the
 * background). Never throws — a missing candidate email or a queueing failure is
 * reported in the return value, never as an error on the caller (creating or
 * resending a meeting must still succeed even if the email can't go out).
 * @param {import('mongoose').Document} interview
 * @returns {Promise<{queued:boolean, reason?:string}>}
 */
async function emailMeetingLinkToCandidate(interview) {
  try {
    const application = await Application.findById(interview.applicationId).populate('candidateId', 'name email');
    const candidate = application?.candidateId;
    if (!candidate?.email) {
      logger.warn(`[Interview] No candidate email on file for application ${interview.applicationId} — skipping meeting email.`);
      return { queued: false, reason: 'No candidate email on file.' };
    }
    const requisition = await Requisition.findById(interview.requisitionId);
    const stageConfig = requisition?.stages.find((s) => s.key === interview.stageKey);
    return await enqueueEmail({
      type: 'meeting-link',
      to: candidate.email,
      payload: {
        candidateEmail: candidate.email,
        candidateName: candidate.name,
        requisitionTitle: requisition?.title || 'your role',
        stageLabel: stageConfig?.label || interview.stageKey,
        meetingUri: interview.meetingUri,
      },
    });
  } catch (err) {
    // The meeting itself is already saved — a failure anywhere in here (DB
    // lookup, credential read, transport setup) must never turn a successful
    // meeting creation into a 500 the caller has to retry.
    logger.warn(`[Interview] Could not queue the meeting-link email for ${interview._id}: ${err.message}`);
    return { queued: false, reason: 'Could not queue the email — the meeting link was still saved.' };
  }
}

/**
 * Google Calendar does not send an invitation to the owner of the calendar
 * hosting the event. Send that account an explicit confirmation instead.
 * GOOGLE_CALENDAR_HOST_EMAIL overrides GMAIL_USER when those accounts differ.
 */
async function emailCalendarHost(interview, action) {
  try {
    const { gmailUser } = await getSecrets();
    const hostEmail = process.env.GOOGLE_CALENDAR_HOST_EMAIL || gmailUser;
    if (!hostEmail) return { queued: false, reason: 'No Calendar host email configured.' };

    const application = await Application.findById(interview.applicationId).populate('candidateId', 'name');
    const requisition = await Requisition.findById(interview.requisitionId);
    const stage = requisition?.stages?.find((item) => item.key === interview.stageKey);
    const candidateName = application?.candidateId?.name || 'Candidate';
    const stageLabel = stage?.label || interview.stageKey;
    const isCancelled = action === 'cancelled';
    const timeZone = process.env.GOOGLE_CALENDAR_TIME_ZONE || 'Asia/Karachi';
    const meetingTime = interview.meetingStart
      ? new Intl.DateTimeFormat('en-PK', {
        dateStyle: 'full', timeStyle: 'short', timeZone,
      }).format(new Date(interview.meetingStart))
      : 'Not specified';

    const message = {
      to: hostEmail,
      subject: `${isCancelled ? 'Cancelled' : 'Scheduled'}: ${candidateName} — ${stageLabel}`,
      text: isCancelled
        ? [
          'Hello,',
          '',
          'This is to confirm that the following interview has been cancelled.',
          '',
          `Candidate: ${candidateName}`,
          `Position: ${requisition?.title || 'Interview'}`,
          `Interview stage: ${stageLabel}`,
          `Previously scheduled: ${meetingTime} (${timeZone})`,
          '',
          'The Google Calendar event has been removed and the candidate has been notified.',
          '',
          'Regards,',
          'Red Star Technologies Hiring Team',
        ].join('\n')
        : [
          'Hello,',
          '',
          'This is to confirm that an interview has been scheduled in your Google Calendar.',
          '',
          `Candidate: ${candidateName}`,
          `Position: ${requisition?.title || 'Interview'}`,
          `Interview stage: ${stageLabel}`,
          `Date and time: ${meetingTime} (${timeZone})`,
          `Duration: ${interview.meetingEnd && interview.meetingStart ? `${Math.round((new Date(interview.meetingEnd) - new Date(interview.meetingStart)) / 60000)} minutes` : 'Not specified'}`,
          `Google Meet link: ${interview.meetingUri || 'Not available'}`,
          '',
          'The candidate has been invited through Google Calendar. Please review the event on your calendar before the interview.',
          '',
          'Regards,',
          'Red Star Technologies Hiring Team',
        ].join('\n'),
    };
    const result = await enqueueEmail({ type: 'plain', to: hostEmail, payload: message });
    if (result.queued) {
      logger.info(`[Interview] Calendar host notification (${action}) queued for ${hostEmail} for ${interview._id}.`);
    } else {
      logger.warn(`[Interview] Calendar host notification (${action}) could not be queued for ${hostEmail} for ${interview._id}: ${result.reason || 'unknown error'}`);
    }
    return { ...result, hostEmail };
  } catch (err) {
    logger.warn(`[Interview] Could not notify Calendar host for ${interview._id}: ${err.message}`);
    return { queued: false, reason: 'Could not notify the Calendar host.' };
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
    const label = ordered.find((s) => s.key === key)?.label || key;
    assertCalendarMeetingCancelled(interview, `start the ${label} stage`);
  }
}

async function assertInterviewMutable(interview, action) {
  const requisition = await Requisition.findById(interview.requisitionId);
  if (!requisition) throw new ValidationError(['requisitionId'], 'Requisition not found.');
  assertRequisitionNotClosed(requisition, action);
  return requisition;
}

/**
 * GET /api/interviews?applicationId=X or ?requisitionId=X
 * Lightweight lookup so the UI can link back to a candidate's earlier
 * (already-approved) stages — there's no other way to discover an
 * interview's id once you've navigated away from it.
 */
const list = asyncHandler(async (req, res) => {
  const { applicationId, requisitionId, applicationIds } = req.query;
  if (!applicationId && !requisitionId && !applicationIds) {
    throw new ValidationError(['applicationId'], 'applicationId, applicationIds, or requisitionId query param is required.');
  }
  const filter = {};
  if (applicationId) filter.applicationId = applicationId;
  if (requisitionId) filter.requisitionId = requisitionId;
  if (applicationIds) {
    const ids = String(applicationIds).split(',').map((id) => id.trim()).filter(Boolean);
    if (ids.length > 0) filter.applicationId = { $in: ids };
  }
  const interviews = await Interview.find(filter).select('_id applicationId stageKey status stageAverage');
  res.json({ interviews });
});

/** GET /api/interviews/:id */
const getOne = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });
  // calendarTimeZone: the zone meetings are booked in, so the page picks and shows times in it too.
  res.json({ interview, calendarTimeZone: getCalendarTimeZone() });
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
  if (!requisition) throw new ValidationError(['requisitionId'], 'Requisition not found.');
  assertRequisitionOpen(requisition, 'start a new interview stage');
  const stageConfig = requisition.stages.find((s) => s.key === stageKey && s.enabled);
  if (!stageConfig) throw new ValidationError(['stageKey'], 'That stage is not enabled on this requisition.');

  const existing = await Interview.findOne({ applicationId, stageKey });
  if (existing) {
    return res.status(409).json({ error: 'VALIDATION_ERROR', message: 'An interview for this application+stage already exists.', interviewId: existing._id });
  }

  await assertPriorStagesApproved(requisition, applicationId, stageKey);

  const isHrStage = stageKey === 'hr_interview' || stageConfig?.stageType === 'hr_interview' || String(stageKey).toLowerCase().includes('hr_interview');
  const interview = await Interview.create({
    applicationId,
    requisitionId: requisition._id,
    stageKey,
    meetingMode: meetingMode || 'online',
    provider: provider || 'google_meet',
    designatedScorerId: req.user._id,
    candidateAvailability: isHrStage ? (application.candidateAvailability || undefined) : undefined,
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
  await assertInterviewMutable(interview, 'create or change a meeting');

  if (req.body?.meetingUri) {
    if (interview.calendarEventId) await transcriptProvider.cancelMeeting(interview);
    interview.meetingUri = req.body.meetingUri;
    interview.provider = 'manual';
    interview.conferenceId = undefined;
    interview.calendarEventId = undefined;
    interview.meetingStart = undefined;
    interview.meetingEnd = undefined;
  } else {
    // Replacing a Google-created meeting must close its Calendar event first.
    // If Google cannot cancel it, do not create another event and leave two
    // active invitations for the candidate. Persist the cleared metadata
    // before creating the replacement so a later retry never targets a
    // Calendar event that has already been cancelled.
    if (interview.calendarEventId) {
      await transcriptProvider.cancelMeeting(interview);
      interview.meetingUri = undefined;
      interview.conferenceId = undefined;
      interview.calendarEventId = undefined;
      interview.meetingStart = undefined;
      interview.meetingEnd = undefined;
      await interview.save();
      logger.info(`[Interview] Previous Calendar meeting cancelled before replacement for ${interview._id}.`);
    }

    const application = await Application.findById(interview.applicationId).populate('candidateId', 'name email');
    const requisition = await Requisition.findById(interview.requisitionId);
    const stage = requisition?.stages?.find((item) => item.key === interview.stageKey);
    const { meetingUri, conferenceId, calendarEventId, meetingStart, meetingEnd } = await transcriptProvider.createMeeting(interview, {
      startTime: req.body?.meetingStart,
      endTime: req.body?.meetingEnd,
      localStartTime: req.body?.localStartTime,
      localEndTime: req.body?.localEndTime,
      // Keep the Calendar event in the timezone in which the recruiter picked
      // the date and time. Without this, the provider falls back to the
      // server timezone, which can move the event onto a different date.
      timeZone: req.body?.timeZone,
      additionalAttendeeEmails: req.body?.additionalAttendeeEmails,
      candidateEmail: application?.candidateId?.email,
      candidateName: application?.candidateId?.name,
      requisitionTitle: requisition?.title,
      stageLabel: stage?.label || interview.stageKey,
    });
    interview.meetingUri = meetingUri;
    interview.conferenceId = conferenceId;
    interview.calendarEventId = calendarEventId;
    interview.meetingStart = meetingStart;
    interview.meetingEnd = meetingEnd;
    // Only google_meet actually reaches this line in Phase 1 — zoom/fathom throw
    // "not enabled" inside createMeeting() before ever returning.
    interview.provider = 'google_meet';
  }
  interview.status = 'scheduled';
  await interview.save();

  // Calendar sends the candidate the official invitation itself. Keep the
  // existing email fallback only for manually pasted meeting links.
  const emailResult = interview.calendarEventId
    ? { queued: true, reason: 'Google Calendar invitation sent.' }
    : await emailMeetingLinkToCandidate(interview);
  const hostEmailResult = interview.calendarEventId
    ? await emailCalendarHost(interview, 'scheduled')
    : null;

  logger.info(`[Interview] Meeting set for ${interview._id}: ${interview.meetingUri}`);
  res.json({
    interview,
    emailQueued: emailResult.queued,
    emailReason: emailResult.reason,
    hostEmailQueued: hostEmailResult?.queued,
    hostEmailReason: hostEmailResult?.reason,
    hostEmail: hostEmailResult?.hostEmail,
  });
});

/**
 * POST /api/interviews/:id/send-meeting-email
 * Manually (re)sends the current meeting link to the candidate — for when
 * the auto-send on creation failed, was missed, or the link since changed.
 */
const sendMeetingEmail = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });
  await assertInterviewMutable(interview, 'send a meeting email');
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
  await assertInterviewMutable(interview, 'cancel a meeting');

  if (interview.calendarEventId) {
    try {
      await transcriptProvider.cancelMeeting(interview);
    } catch (err) {
      logger.warn(`[Interview] Calendar cancellation warning for ${interview._id}: ${err.message}. Clearing local meeting link anyway.`);
    }
  }

  const hostEmailResult = interview.calendarEventId
    ? await emailCalendarHost(interview, 'cancelled')
    : null;

  interview.meetingUri = undefined;
  interview.conferenceId = undefined;
  interview.calendarEventId = undefined;
  interview.meetingStart = undefined;
  interview.meetingEnd = undefined;

  if (!interview.scores?.length) {
    interview.status = 'pending';
    if (interview.transcriptStatus === 'pending') {
      interview.transcriptStatus = 'none';
    }
  }
  await interview.save();

  logger.info(`[Interview] Meeting cancelled for ${interview._id}.`);
  res.json({
    interview,
    hostEmailQueued: hostEmailResult?.queued,
    hostEmailReason: hostEmailResult?.reason,
    hostEmail: hostEmailResult?.hostEmail,
  });
});

/** POST /api/interviews/:id/consent */
const recordConsent = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });
  await assertInterviewMutable(interview, 'record consent');

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
  await assertInterviewMutable(interview, 'fetch a transcript');

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

  logParsedText(interview._id, 'Google Meet transcript', result.text);
  logger.info(`[Interview] Transcript ready for ${interview._id}.`);
  res.json({ interview });
});

/**
 * POST /api/interviews/:id/upload-transcript
 * Manual transcript upload (in-person / fallback). Extracts clean text from
 * .txt/.md/.pdf/.docx into transcriptText. The raw transcript file itself is
 * not persisted; only the extracted text is retained for scoring.
 */
const uploadTranscript = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });
  await assertInterviewMutable(interview, 'upload a transcript');
  if (!req.file) throw new ValidationError(['transcript'], 'A transcript file is required (field name "transcript").');

  let text;
  try {
    text = await extractArtifactText(req.file.buffer, req.file.originalname);
  } catch (err) {
    throw new ValidationError(['transcript'], err.message);
  }

  interview.transcriptText = text;
  interview.transcriptStatus = 'ready';
  // A manually uploaded transcript can be a fallback for a Google-scheduled
  // interview. Keep its provider when a Calendar event exists so cancelling
  // the interview still deletes that event and notifies attendees.
  if (!interview.calendarEventId) interview.provider = 'manual';
  await interview.save();

  logParsedText(interview._id, 'uploaded transcript', text);
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
  await assertInterviewMutable(interview, 'upload an artifact');
  assertPdfUpload(req.file, { field: 'artifact', label: 'artifact' });

  const oldArtifactPublicId = interview.artifactFilePublicId;
  const uploaded = await uploadFile({ file: req.file, folder: 'interview-artifacts' });
  interview.artifactFileUrl = uploaded.url;
  interview.artifactFilePublicId = uploaded.publicId;
  interview.artifactFileName = uploaded.name;
  interview.artifactFileSize = uploaded.size;
  interview.artifactFileMimeType = uploaded.mimeType;

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
  logParsedText(interview._id, 'extracted artifact', interview.transcriptText);
  if (oldArtifactPublicId) {
    destroyFileIfUnreferenced(oldArtifactPublicId)
      .catch((err) => logger.warn(`[Interview] Could not clean up replaced artifact ${oldArtifactPublicId}: ${err.message}`));
  }
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
  assertRequisitionNotClosed(requisition, 'score an interview');
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

  const application = await Application.findById(interview.applicationId).populate('candidateId', 'name');

  const { interview: scored, message } = await scoreInterview({
    interview,
    stageType: stageConfig.stageType,
    attributes: scorecardStage.attributes,
    requisition,
    application,
  });

  if (message) {
    return res.json({ interview: scored, message });
  }

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
 * One-time OAuth consent callback (alternative to the OAuth Playground flow).
 * The refresh token is a long-lived credential, so it is NEVER logged or
 * returned in full — only a short preview is returned to confirm the exchange
 * worked. To obtain a usable token, use the Google OAuth Playground.
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
    logger.info('[Interview] Google OAuth callback completed; a refresh token was issued (value not logged).');
  }

  res.json({
    message: 'Google authorization succeeded. The refresh token is not logged or returned for security — generate one with the Google OAuth Playground and set it in Settings or GOOGLE_REFRESH_TOKEN.',
    refreshTokenIssued: Boolean(tokens.refresh_token),
  });
});

/**
 * POST /api/interviews/:id/send-offer
 * Uploads an offer letter PDF document, emails the offer letter link
 * to the candidate, and approves/completes the Offer stage in the pipeline!
 */
const sendOffer = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });
  assertCalendarMeetingCancelled(interview, 'complete this stage');

  assertPdfUpload(req.file, { field: 'offerLetter', label: 'offer letter' });

  const requisition = await Requisition.findById(interview.requisitionId);
  assertRequisitionNotClosed(requisition, 'send an offer');

  // Upload the NEW file first and delete the previous one only after the new one is saved, so a failed
  // upload never leaves the interview pointing at a file that has already been deleted.
  const previousPublicId = interview.artifactFilePublicId;
  const uploaded = await uploadFile({ file: req.file, folder: 'interview-offer-letters' });
  interview.artifactFileUrl = uploaded.url;
  interview.artifactFilePublicId = uploaded.publicId;
  interview.artifactFileName = uploaded.name;
  interview.artifactFileSize = uploaded.size;
  interview.artifactFileMimeType = uploaded.mimeType;

  // Find candidate details to send email
  const application = await Application.findById(interview.applicationId).populate('candidateId', 'name email');
  const candidate = application?.candidateId;

  // The email is queued and sent in the background. Production attaches the PDF
  // itself (the queue keeps it until sent); other environments send a link.
  let emailResult = { queued: false, reason: 'No candidate email on file.' };
  if (candidate?.email) {
    emailResult = await enqueueEmail({
      type: 'offer-letter',
      to: candidate.email,
      payload: {
        candidateEmail: candidate.email,
        candidateName: candidate.name,
        requisitionTitle: requisition?.title,
        offerLetterUrl: interview.artifactFileUrl,
      },
      attachment: emailNotifier.shouldAttachOfferLetter()
        ? { filename: req.file.originalname, content: req.file.buffer, contentType: 'application/pdf' }
        : undefined,
      related: application ? { kind: 'interview-offer', applicationId: application._id } : undefined,
    });
  }

  // Mark stage as approved
  interview.status = 'approved';
  try {
    await interview.save();
  } catch (err) {
    // The new file was never recorded, so remove it; the previous letter is still in place.
    await deleteFile(uploaded.publicId).catch((cleanupErr) => logger.warn(`[Interview] Could not remove unsaved offer letter ${uploaded.publicId}: ${cleanupErr.message}`));
    throw err;
  }

  // The new letter is saved, so the previous file is no longer needed.
  if (previousPublicId && previousPublicId !== uploaded.publicId) {
    try {
      await deleteFile(previousPublicId);
    } catch (err) {
      logger.warn(`[Interview] Could not remove previous offer letter for interview ${interview._id}: ${err.message}`);
    }
  }
  // A resend replaces any earlier offer email that is still waiting or retrying, so the candidate gets one.
  if (emailResult.queued && application) {
    await cancelPendingEmails({ type: 'offer-letter', applicationId: application._id, exceptJobId: emailResult.jobId });
  }

  await AuditLog.create({
    action: 'score_approve',
    userId: req.user._id,
    requisitionId: interview.requisitionId,
    applicationId: interview.applicationId,
    targetType: 'interview',
    targetId: interview._id.toString(),
    newValue: { status: 'approved', artifactFileUrl: interview.artifactFileUrl, emailQueued: emailResult.queued },
    reason: 'Offer letter uploaded, email to candidate queued, and stage approved.',
  });

  const progress = application.stageProgress.find((p) => p.stageKey === interview.stageKey);
  if (progress) progress.status = 'approved';

  const nextInterviewId = await getOrCreateNextInterview(application, requisition, interview.stageKey, req.user._id);
  await recomputeAndPersist(application, requisition, req.user._id, 'Recomputed after offer stage completion.');

  logger.info(`[Interview] Offer uploaded & stage approved for interview ${interview._id}. emailQueued=${emailResult.queued}`);
  res.json({
    interview,
    application,
    passed: true,
    nextInterviewId,
    emailQueued: emailResult.queued,
    emailReason: emailResult.reason,
  });
});

const requestAvailability = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });

  const application = await Application.findById(interview.applicationId).populate('candidateId');
  if (!application || !application.candidateId) {
    throw new ValidationError(['applicationId'], 'Candidate information not found.');
  }
  const requisition = await Requisition.findById(interview.requisitionId);
  const stageConfig = (requisition?.stages || []).find((s) => s.key === interview.stageKey);
  const stageLabel = stageConfig?.label || interview.stageKey;

  const candidateEmail = application.candidateId.email;
  const candidateName = application.candidateId.name;
  const requisitionTitle = requisition?.title || 'Job Opening';

  const clientHost = process.env.CLIENT_URL || req.headers.origin || 'http://localhost:5173';
  const availabilityUrl = `${clientHost}/interview/${interview._id}/availability`;

  let emailResult = { queued: false, reason: 'No candidate email on file.' };
  if (candidateEmail) {
    emailResult = await enqueueEmail({
      type: 'availability-request',
      to: candidateEmail,
      payload: { candidateEmail, candidateName, requisitionTitle, stageLabel, availabilityUrl },
    });
  }

  logger.info(`[Interview] Availability request created for interview ${interview._id} to ${candidateEmail}: ${availabilityUrl}. emailQueued=${emailResult.queued}`);
  res.json({
    queued: emailResult.queued,
    emailReason: emailResult.reason,
    interview,
    availabilityUrl,
    candidateEmail,
    candidateName,
    requisitionTitle,
    stageLabel,
  });
});

const getPublicAvailability = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found or expired.' });

  const requisition = await Requisition.findById(interview.requisitionId).select('title employmentType location status');
  if (!requisition || requisition.status !== 'open') {
    const statusMsg = requisition?.status === 'closed'
      ? 'This position is closed and is no longer accepting availability.'
      : 'This position is currently not active and is not accepting availability.';
    return res.status(400).json({ error: 'REQUISITION_NOT_OPEN', message: statusMsg });
  }

  const application = await Application.findById(interview.applicationId).populate('candidateId', 'name email');
  const stageConfig = (requisition?.stages || []).find((s) => s.key === interview.stageKey);

  res.json({
    candidateName: application?.candidateId?.name || 'Candidate',
    requisitionTitle: requisition?.title || 'Job Opening',
    stageLabel: stageConfig?.label || interview.stageKey,
    candidateAvailability: interview.candidateAvailability || null,
    captcha: (() => {
      const { enabled, siteKey } = getCaptchaConfig();
      return { enabled, siteKey: enabled ? siteKey : undefined };
    })(),
  });
});

const submitPublicAvailability = asyncHandler(async (req, res) => {
  const interview = await Interview.findById(req.params.id);
  if (!interview) return res.status(404).json({ error: 'NOT_FOUND', message: 'Interview not found.' });

  const requisition = await Requisition.findById(interview.requisitionId).select('status');
  if (!requisition || requisition.status !== 'open') {
    const statusMsg = requisition?.status === 'closed'
      ? 'This position is closed and is no longer accepting availability.'
      : 'This position is currently not active and is not accepting availability.';
    return res.status(400).json({ error: 'REQUISITION_NOT_OPEN', message: statusMsg });
  }

  const captchaResult = await verifyCaptcha(req.body?.captchaToken, req.ip);
  if (!captchaResult.valid) {
    return res.status(400).json({
      error: 'CAPTCHA_FAILED',
      message: 'Please complete the security check and submit your availability again.',
    });
  }

  const { preferredDate, startTime, endTime, notes } = req.body;
  if (!preferredDate) {
    throw new ValidationError(['preferredDate'], 'Preferred date is required.');
  }

  interview.candidateAvailability = {
    preferredDate: String(preferredDate).trim(),
    startTime: startTime ? String(startTime).trim() : '',
    endTime: endTime ? String(endTime).trim() : '',
    notes: notes ? String(notes).trim() : '',
    submittedAt: new Date(),
  };

  await interview.save();
  logger.info(`[Interview] Candidate submitted availability for interview ${interview._id}: ${preferredDate}`);

  res.json({
    message: 'Availability submitted successfully.',
    candidateAvailability: interview.candidateAvailability,
  });
});

module.exports = {
  list, getOne, create, createMeeting, cancelMeeting, sendMeetingEmail, recordConsent, fetchTranscript,
  uploadTranscript, uploadArtifact, score, googleOAuthCallback, sendOffer, getOrCreateNextInterview,
  requestAvailability, getPublicAvailability, submitPublicAvailability,
};
