const { google } = require('googleapis');
const logger = require('../utils/logger');
const { getCalendarTimeZone } = require('../utils/calendarTimeZone');
const { withRetry } = require('../utils/retry');
const { getSecrets } = require('../utils/secrets');
const { ValidationError } = require('../utils/errors');

/**
 * Builds an OAuth2 client authorized as the one connected organizer account.
 * googleapis handles refreshing the hourly access token internally using
 * the stored refresh token — callers never manage that by hand. Client
 * ID/secret/refresh token come from an admin-editable Setting, falling back
 * to .env — same override pattern as the Claude model tiers.
 * @returns {Promise<import('google-auth-library').OAuth2Client>}
 */
async function getOAuthClient() {
  const { googleClientId, googleClientSecret, googleRefreshToken } = await getSecrets();
  const client = new google.auth.OAuth2(
    googleClientId,
    googleClientSecret,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials({ refresh_token: googleRefreshToken });
  return client;
}

async function getMeetClient() {
  return google.meet({ version: 'v2', auth: await getOAuthClient() });
}

async function getCalendarClient() {
  return google.calendar({ version: 'v3', auth: await getOAuthClient() });
}

/**
 * Logs the identifiers and artifact metadata needed to diagnose a Meet
 * transcript that appears in Drive but is not returned by the Meet API.
 * Tokens, attendees, and transcript text are deliberately never logged.
 */
async function logTranscriptDiagnostics(interview, conferenceRecordName, transcripts) {
  const diagnostic = {
    interviewId: String(interview._id),
    storedConferenceId: interview.conferenceId || null,
    calendarEventId: interview.calendarEventId || null,
    resolvedConferenceRecord: conferenceRecordName || null,
    transcriptCount: transcripts?.length || 0,
    transcripts: (transcripts || []).map((item) => ({
      name: item.name,
      state: item.state,
      startTime: item.startTime,
      endTime: item.endTime,
      documentId: item.docsDestination?.document || null,
      exportUri: item.docsDestination?.exportUri || null,
    })),
  };

  try {
    const auth = await getOAuthClient();
    const accessToken = await auth.getAccessToken();
    if (accessToken?.token) {
      const tokenInfo = await auth.getTokenInfo(accessToken.token);
      diagnostic.oauthScopes = tokenInfo.scopes || [];
    }
  } catch (err) {
    diagnostic.oauthScopeCheck = `unavailable: ${err.message}`;
  }

  if (interview.calendarEventId) {
    try {
      const calendar = await getCalendarClient();
      const { data: event } = await calendar.events.get({
        calendarId: 'primary',
        eventId: interview.calendarEventId,
        fields: 'id,conferenceData(conferenceId,entryPoints(entryPointType,uri))',
      });
      diagnostic.calendarConferenceId = event.conferenceData?.conferenceId || null;
      diagnostic.calendarMeetUri = (event.conferenceData?.entryPoints || [])
        .find((entry) => entry.entryPointType === 'video')?.uri || null;
    } catch (err) {
      diagnostic.calendarEventCheck = `unavailable: ${err.message}`;
    }
  }

  logger.info(`[GoogleMeet][TranscriptDiagnostics] ${JSON.stringify(diagnostic)}`);
}

/**
 * Creates a Google Meet space via the Meet REST API.
 *
 * The returned `conferenceId` is NOT a real conference record yet — no call
 * has happened. It's the Meet *space* resource name (e.g. "spaces/abc123"),
 * stored so fetchTranscript() can later look up the conference record that
 * gets created once a call actually takes place in this space. Once
 * resolved, the caller should overwrite it with the real conference record
 * name (see fetchTranscript's `resolvedConferenceId` return field).
 *
 * @param {import('mongoose').Document} interview - Unused directly, kept for interface parity with other providers.
 * @returns {Promise<{meetingUri: string, conferenceId: string}>}
 * @throws {import('../utils/errors').ApiKeyError} on 401/403 — reconnect Google in Settings.
 * @throws {import('../utils/errors').RateLimitError} if 429 persists (Meet API ~60 req/min/project).
 * @throws {import('../utils/errors').ServiceError} on persistent network failure.
 */
async function createMeeting(interview, details = {}) {
  const { startTime, endTime, localStartTime, localEndTime, candidateEmail, candidateName, requisitionTitle, stageLabel } = details;
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (!startTime || !endTime || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new ValidationError(['meetingStart', 'meetingEnd'], 'Choose a valid meeting start and end time.');
  }
  if (start.getTime() < Date.now() - 2 * 60 * 1000) {
    throw new ValidationError(['meetingStart'], 'The meeting start time must be in the future.');
  }
  if (end.getTime() - start.getTime() > 60 * 60 * 1000) {
    throw new ValidationError(['meetingEnd'], 'Interview duration cannot be longer than 1 hour.');
  }

  const calendar = await getCalendarClient();
  // Calendar must interpret the selected wall-clock time in the organizer's
  // calendar timezone. A browser can be set to a different timezone (for
  // example, Pacific time), which would otherwise move a Pakistan meeting to
  // the following day in Google Calendar.
  const timeZone = getCalendarTimeZone()
    || details.timeZone
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  // A timestamp ending in Z is an absolute UTC instant. Supplying it alongside
  // a timezone can make Calendar display a different calendar day. Prefer the
  // local date/time selected by the recruiter and let Calendar apply its IANA
  // timezone. Keep the UTC timestamps above for validation and persistence.
  const localDateTime = (value, fallback) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value || '')
    ? value
    : fallback.toISOString();
  const additionalAttendeeEmails = Array.isArray(details.additionalAttendeeEmails)
    ? details.additionalAttendeeEmails.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const invalidEmail = additionalAttendeeEmails.find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (invalidEmail) throw new ValidationError(['additionalAttendeeEmails'], `Invalid attendee email: ${invalidEmail}`);
  if (additionalAttendeeEmails.length > 50) {
    throw new ValidationError(['additionalAttendeeEmails'], 'You can invite up to 50 additional attendees.');
  }
  const attendeeEmails = [...new Set([candidateEmail, ...additionalAttendeeEmails]
    .map((email) => String(email || '').trim().toLowerCase())
    .filter(Boolean))];
  const { data } = await withRetry('GoogleCalendar', () => calendar.events.insert({
    calendarId: 'primary',
    conferenceDataVersion: 1,
    sendUpdates: attendeeEmails.length > 0 ? 'all' : 'none',
    requestBody: {
      summary: `${candidateName || 'Candidate'} — ${stageLabel || 'Interview'} — ${requisitionTitle || 'Interview'}`,
      description: `Interview with ${candidateName || 'candidate'}.`,
      start: { dateTime: localDateTime(localStartTime, start), timeZone },
      end: { dateTime: localDateTime(localEndTime, end), timeZone },
      attendees: attendeeEmails.map((email) => ({ email })),
      conferenceData: { createRequest: { requestId: `interview-${interview._id}-${Date.now()}` } },
    },
  }));
  const entryPoint = (data.conferenceData?.entryPoints || []).find((entry) => entry.entryPointType === 'video');
  if (!data.id || !entryPoint?.uri) throw new Error('Google Calendar did not return a Meet link.');

  logger.info(`[GoogleMeet] Calendar event created: ${data.id} uri=${entryPoint.uri}`);
  return {
    meetingUri: entryPoint.uri,
    conferenceId: data.conferenceData?.conferenceId ? `meetingCode:${data.conferenceData.conferenceId}` : undefined,
    calendarEventId: data.id,
    // Google returns the canonical event times after applying the organizer's
    // calendar timezone. Persist those values so app displays and email
    // notifications always match the Calendar event.
    meetingStart: data.start?.dateTime ? new Date(data.start.dateTime) : start,
    meetingEnd: data.end?.dateTime ? new Date(data.end.dateTime) : end,
  };
}

async function cancelMeeting(interview) {
  if (!interview.calendarEventId) return { cancelled: false };
  try {
    const calendar = await getCalendarClient();
    await withRetry('GoogleCalendar', () => calendar.events.delete({
      calendarId: 'primary', eventId: interview.calendarEventId, sendUpdates: 'all',
    }));
    logger.info(`[GoogleMeet] Calendar event cancelled: ${interview.calendarEventId}`);
  } catch (err) {
    const status = err.code || err.status || err.response?.status;
    const message = err.message || '';
    if (status === 404 || status === 410 || message.includes('Resource has been deleted') || message.includes('Not Found')) {
      logger.info(`[GoogleMeet] Calendar event ${interview.calendarEventId} was already deleted directly in Google Calendar.`);
    } else {
      logger.warn(`[GoogleMeet] Error cancelling event ${interview.calendarEventId}: ${err.message}. Clearing local reference.`);
    }
  }
  return { cancelled: true };
}

/**
 * Finds the most recent conference record for a Meet space.
 * @param {ReturnType<typeof getMeetClient>} meet
 * @param {string} spaceName - e.g. "spaces/abc123".
 * @returns {Promise<object|null>} The conference record resource, or null if none exist yet.
 */
async function findConferenceRecordForSpace(meet, spaceName) {
  const { data } = await withRetry('GoogleMeet', () => meet.conferenceRecords.list({
    filter: `space.name="${spaceName}"`,
  }));
  const records = data.conferenceRecords || [];
  if (records.length === 0) return null;
  // Most recent call in this space (records aren't guaranteed pre-sorted).
  return records.sort((a, b) => new Date(b.startTime) - new Date(a.startTime))[0];
}

async function findConferenceRecordForMeetingCode(meet, meetingCode) {
  const { data } = await withRetry('GoogleMeet', () => meet.conferenceRecords.list({
    filter: `space.meeting_code="${meetingCode}"`,
  }));
  const records = data.conferenceRecords || [];
  if (records.length === 0) return null;
  return records.sort((a, b) => new Date(b.startTime) - new Date(a.startTime))[0];
}

/**
 * Fetches all entries for a transcript, following pagination.
 * @param {ReturnType<typeof getMeetClient>} meet
 * @param {string} transcriptName - e.g. "conferenceRecords/xxx/transcripts/yyy".
 * @returns {Promise<Array<object>>}
 */
async function listAllTranscriptEntries(meet, transcriptName) {
  const entries = [];
  let pageToken;
  do {
    const { data } = await withRetry('GoogleMeet', () => meet.conferenceRecords.transcripts.entries.list({
      parent: transcriptName,
      pageToken,
      pageSize: 100,
    }));
    entries.push(...(data.transcriptEntries || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return entries;
}

/**
 * Resolves a participant resource name to a human-readable display name,
 * caching lookups so each participant is only fetched once per transcript.
 * @param {ReturnType<typeof getMeetClient>} meet
 * @param {string} participantName - e.g. "conferenceRecords/xxx/participants/yyy".
 * @param {Map<string,string>} cache
 * @returns {Promise<string>}
 */
async function resolveSpeakerName(meet, participantName, cache) {
  if (!participantName) return 'Unknown speaker';
  if (cache.has(participantName)) return cache.get(participantName);
  try {
    const { data } = await withRetry('GoogleMeet', () => meet.conferenceRecords.participants.get({ name: participantName }));
    const displayName = data.signedinUser?.displayName
      || data.anonymousUser?.displayName
      || data.phoneUser?.displayName
      || 'Unknown speaker';
    cache.set(participantName, displayName);
    return displayName;
  } catch (err) {
    logger.warn(`[GoogleMeet] Could not resolve participant ${participantName}: ${err.message}`);
    cache.set(participantName, 'Unknown speaker');
    return 'Unknown speaker';
  }
}

/**
 * Fetches the conference transcript for an interview's Meet space.
 *
 * Transcripts are generated AFTER the call as artifacts on the organizer's
 * account — they are NEVER instant. This returns 'pending' (not an error)
 * until Google has produced the artifact; the caller re-checks later rather
 * than blocking the request thread.
 *
 * Requires: transcription was enabled during the meeting; the organizer's
 * Workspace edition produces transcripts; a valid OAuth refresh token.
 *
 * @param {import('mongoose').Document} interview - Must have `conferenceId` set
 *   (either a space name from createMeeting, or an already-resolved conference record name).
 * @returns {Promise<{status:'pending'|'ready', text?:string, resolvedConferenceId?:string}>}
 *   `resolvedConferenceId` is set once a real conference record is found, so the
 *   caller can persist it and skip the space->record lookup on future calls.
 * @throws {import('../utils/errors').ApiKeyError} on 401/403 — "Reconnect Google in Settings".
 * @throws {import('../utils/errors').RateLimitError} if 429 persists.
 * @throws {import('../utils/errors').ServiceError} on persistent network failure.
 */
async function fetchTranscript(interview) {
  const meet = await getMeetClient();
  const stored = interview.conferenceId;
  if (!stored) {
    throw new ValidationError(['conferenceId'], 'This interview has no meeting yet — create the meeting before fetching a transcript.');
  }

  let conferenceRecordName = stored.startsWith('conferenceRecords/') ? stored : null;

  if (!conferenceRecordName) {
    logger.info(`[GoogleMeet] Looking up conference record for ${stored}`);
    const record = stored.startsWith('meetingCode:')
      ? await findConferenceRecordForMeetingCode(meet, stored.slice('meetingCode:'.length))
      : await findConferenceRecordForSpace(meet, stored);
    if (!record) {
      logger.info('[GoogleMeet] No conference record yet — call hasn\'t happened or hasn\'t synced. status=pending');
      return { status: 'pending' };
    }
    conferenceRecordName = record.name;
  }

  const { data: transcriptsData } = await withRetry('GoogleMeet', () => meet.conferenceRecords.transcripts.list({
    parent: conferenceRecordName,
  }));
  const transcripts = transcriptsData.transcripts || [];
  await logTranscriptDiagnostics(interview, conferenceRecordName, transcripts);
  if (transcripts.length === 0) {
    logger.info(`[GoogleMeet] Conference record ${conferenceRecordName} has no transcript artifact yet. status=pending`);
    return { status: 'pending', resolvedConferenceId: conferenceRecordName };
  }

  const transcript = transcripts[0];
  const entries = await listAllTranscriptEntries(meet, transcript.name);
  if (entries.length === 0) {
    logger.info(`[GoogleMeet] Transcript ${transcript.name} has no entries yet. status=pending`);
    return { status: 'pending', resolvedConferenceId: conferenceRecordName };
  }

  const speakerCache = new Map();
  entries.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  const lines = [];
  for (const entry of entries) {
    const speaker = await resolveSpeakerName(meet, entry.participant, speakerCache);
    lines.push(`${speaker}: ${entry.text}`);
  }

  logger.info(`[GoogleMeet] Transcript ready for ${conferenceRecordName} (${entries.length} entries).`);
  return { status: 'ready', text: lines.join('\n'), resolvedConferenceId: conferenceRecordName };
}

module.exports = { createMeeting, cancelMeeting, fetchTranscript };
