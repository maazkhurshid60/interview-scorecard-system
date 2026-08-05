const logger = require('../utils/logger');
const { callClaude, getModelIds } = require('./claudeClient');
const { STAGE_MODEL_TIER } = require('../utils/constants');

/** Below this word count, a transcript is treated as empty/noise — never scored. */
const MIN_TRANSCRIPT_WORDS = 30;

const SYSTEM_PROMPT = `You are scoring one candidate interview transcript against a fixed rubric for a single hiring stage. This is decision-support for a human recruiter, not a final verdict — score strictly against the anchors given, never on vibes.

For EACH attribute provided, return exactly one object: { "attributeId": "...", "score": <1-5 integer>, "justification": "<short, cites what was actually said in the transcript>" }.

Score 5 only when the transcript shows behavior matching that attribute's "what a 5 looks like" description. Score 1-2 when the transcript shows behavior matching that attribute's red-flag description. Use 3-4 for everything in between.

Respond ONLY with a valid JSON array, no other text, no markdown fences, no preamble:
[ { "attributeId": "a1", "score": 4, "justification": "..." } ]`;

/**
 * Resolves the actual Claude model id to use for a given stage type, via
 * the tier mapping in constants.js. Model ids come from an admin-editable
 * Setting (Settings page dropdown) falling back to .env — never hardcoded.
 * @param {string} stageType
 * @returns {Promise<string>}
 */
async function resolveModelForStage(stageType) {
  const tier = STAGE_MODEL_TIER[stageType] || 'default';
  const models = await getModelIds();
  return models[tier];
}

function buildUserPrompt(transcriptText, attributes) {
  const rubric = attributes.map((a) => (
    `attributeId: "${a.attributeId}"\nname: ${a.name}\nquestion: ${a.question || '(none)'}\nwhat a 5 looks like: ${a.anchor5 || '(none)'}\nred flags (1-2): ${a.redFlags || '(none)'}`
  )).join('\n\n');

  return `TRANSCRIPT:\n${transcriptText}\n\n---\nRUBRIC (score every attribute below):\n\n${rubric}`;
}

/**
 * Scores ONE interview's transcript against ONE stage's rubric via Claude,
 * and persists the result directly onto the interview document: proposed
 * scores go to interview.scores[].aiScore/aiJustification (keyed by
 * attributeId — never by array position), interview.status becomes
 * 'scored', and aiTokensUsed/aiCostUsd are recorded. These are PROPOSED
 * scores only — they do not count until a human approves them
 * (scoringController, built separately).
 *
 * Guardrail: if the transcript is empty or too short to be a real
 * interview, this does NOT call Claude — it marks transcriptStatus
 * 'failed' and returns a message asking for re-upload instead (the
 * Interview schema has no free-text field for this, so the message is
 * returned to the caller to surface, not persisted).
 *
 * @param {object} params
 * @param {import('mongoose').Document} params.interview - Must have transcriptText set.
 * @param {string} params.stageType - The stage's stageType (selects the model tier).
 * @param {Array<{attributeId:string, name:string, question?:string, anchor5?:string, redFlags?:string}>} params.attributes
 *   The scorecard's rubric attributes for this stage.
 * @returns {Promise<{interview: import('mongoose').Document, message?: string}>}
 * @throws {import('../utils/errors').ApiKeyError} on 401/403 — never scored on a bad key.
 * @throws {import('../utils/errors').SpendCapError} if the monthly AI spend cap is reached.
 * @throws {import('../utils/errors').RateLimitError} if 429 persists through retries.
 * @throws {import('../utils/errors').ServiceError} on persistent network failure.
 */
async function scoreInterview({ interview, stageType, attributes }) {
  const transcriptText = (interview.transcriptText || '').trim();
  const wordCount = transcriptText ? transcriptText.split(/\s+/).filter(Boolean).length : 0;

  if (wordCount < MIN_TRANSCRIPT_WORDS) {
    interview.transcriptStatus = 'failed';
    await interview.save();
    const message = `Transcript is empty or too short to score (${wordCount} words, need at least ${MIN_TRANSCRIPT_WORDS}). Please re-upload a complete transcript.`;
    logger.warn(`[AIScorer] Interview ${interview._id}: ${message}`);
    return { interview, message };
  }

  const model = await resolveModelForStage(stageType);
  logger.info(`[AIScorer] Scoring interview ${interview._id} stage=${stageType} model=${model} attributes=${attributes.length}`);

  const { text, inputTokens, outputTokens, costUsd } = await callClaude({
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(transcriptText, attributes) }],
    maxTokens: 4096,
    expectJson: true,
  });

  const results = JSON.parse(text);
  const resultsByAttributeId = new Map(results.map((r) => [r.attributeId, r]));

  interview.scores = attributes.map((attr) => {
    const result = resultsByAttributeId.get(attr.attributeId);
    const existing = (interview.scores || []).find((s) => s.attributeId === attr.attributeId);
    return {
      attributeId: attr.attributeId,
      aiScore: result?.score,
      aiJustification: result?.justification,
      approvedScore: existing?.approvedScore, // preserve any prior human approval if re-scored
      overridden: existing?.overridden || false,
      overriddenBy: existing?.overriddenBy,
      overrideReason: existing?.overrideReason,
    };
  });
  interview.status = 'scored';
  // Accumulate, don't overwrite — a re-scored interview's cost should
  // reflect every attempt ever made against it, matching how the monthly
  // spend total (claudeClient.js's recordSpend) already accumulates.
  interview.aiTokensUsed = {
    input: (interview.aiTokensUsed?.input || 0) + inputTokens,
    output: (interview.aiTokensUsed?.output || 0) + outputTokens,
  };
  interview.aiCostUsd = (interview.aiCostUsd || 0) + costUsd;

  await interview.save();
  logger.info(`[AIScorer] Interview ${interview._id} scored. costUsd=${costUsd}`);

  return { interview };
}

module.exports = { scoreInterview };