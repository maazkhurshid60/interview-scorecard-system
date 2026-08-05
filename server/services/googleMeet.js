const { google } = require('googleapis');
const logger = require('../utils/logger');
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
async function createMeeting(interview) {
  const meet = await getMeetClient();
  logger.info('[GoogleMeet] Creating a new Meet space.');
  const { data } = await withRetry('GoogleMeet', () => meet.spaces.create({ requestBody: {} }));
  logger.info(`[GoogleMeet] Space created: ${data.name} uri=${data.meetingUri}`);
  return { meetingUri: data.meetingUri, conferenceId: data.name };
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
    const record = await findConferenceRecordForSpace(meet, stored);
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

module.exports = { createMeeting, fetchTranscript };