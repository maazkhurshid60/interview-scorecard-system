const logger = require('../utils/logger');
const Setting = require('../models/Setting');
const googleMeet = require('./googleMeet');

/** Stub for a not-yet-implemented provider — Zoom/Fathom are wired in Phase 2. */
function notEnabledStub(name) {
  return {
    async createMeeting() {
      throw new Error(`${name} provider not enabled — wired in Phase 2.`);
    },
    async fetchTranscript() {
      throw new Error(`${name} provider not enabled — wired in Phase 2.`);
    },
  };
}

/** Registry of provider implementations, keyed by the same strings used in ACTIVE_TRANSCRIPT_PROVIDER / Setting. */
const PROVIDERS = {
  google_meet: googleMeet,
  zoom: notEnabledStub('Zoom'),
  fathom: notEnabledStub('Fathom'),
};

/**
 * Resolves which provider is currently active. Reads the runtime-editable
 * Setting first (so Settings > active provider takes effect without a
 * restart), falling back to the .env bootstrap value.
 * @returns {Promise<string>} One of 'google_meet' | 'zoom' | 'fathom'.
 */
async function getActiveProvider() {
  const setting = await Setting.findOne({ key: 'activeTranscriptProvider' });
  return setting?.value || process.env.ACTIVE_TRANSCRIPT_PROVIDER || 'google_meet';
}

/**
 * Provider abstraction. Dispatches to the active provider's implementation.
 * Phase 1 only implements google_meet; zoom/fathom throw "not enabled".
 * Keeping this interface stable means adding a provider later is a new
 * file, not a rewrite.
 *
 * @param {import('mongoose').Document} interview
 * @returns {Promise<{meetingUri: string, conferenceId: string}>}
 */
async function createMeeting(interview) {
  const provider = await getActiveProvider();
  const impl = PROVIDERS[provider];
  if (!impl) throw new Error(`Unknown transcript provider "${provider}".`);
  logger.info(`[TranscriptProvider] createMeeting via provider=${provider} interview=${interview._id}`);
  return impl.createMeeting(interview);
}

/**
 * Pulls the transcript for an interview from the active provider.
 * @param {import('mongoose').Document} interview
 * @returns {Promise<{status: 'pending'|'ready'|'failed', text?: string}>}
 */
async function fetchTranscript(interview) {
  const provider = await getActiveProvider();
  const impl = PROVIDERS[provider];
  if (!impl) throw new Error(`Unknown transcript provider "${provider}".`);
  logger.info(`[TranscriptProvider] fetchTranscript via provider=${provider} interview=${interview._id}`);
  return impl.fetchTranscript(interview);
}

module.exports = { createMeeting, fetchTranscript };