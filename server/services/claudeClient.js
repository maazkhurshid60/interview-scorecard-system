const axios = require('axios');
const logger = require('../utils/logger');
const Setting = require('../models/Setting');
const { withRetry } = require('../utils/retry');
const { SpendCapError } = require('../utils/errors');
const { round, currentMonthRange } = require('../utils/helpers');
const { DEFAULT_COST_RATE_TABLE } = require('../utils/constants');
const { getSecrets } = require('../utils/secrets');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const SPEND_SETTING_KEYS = [
  'aiCostRateTable',
  'monthlyAiSpendCapUsd',
  'aiSpendWarnPercent',
  'aiMonthlySpend',
  'aiSpendWarnedMonths',
];

const MODEL_SETTING_KEYS = ['claudeModelCheap', 'claudeModelDefault', 'claudeModelDeep'];

/**
 * Fetches every Setting this module needs in one round trip.
 * @returns {Promise<Record<string, any>>} key -> value map (missing keys are undefined).
 */
async function loadSpendSettings() {
  const docs = await Setting.find({ key: { $in: SPEND_SETTING_KEYS } });
  const map = {};
  docs.forEach((doc) => { map[doc.key] = doc.value; });
  return map;
}

/**
 * Resolves the three tier model ids, letting an admin-editable Setting
 * override the .env bootstrap value at runtime — no redeploy needed to
 * switch a tier from Sonnet to Opus. Same override-then-fallback pattern
 * transcriptProvider.js already uses for activeTranscriptProvider.
 * @returns {Promise<{cheap: string, default: string, deep: string}>}
 */
async function getModelIds() {
  const docs = await Setting.find({ key: { $in: MODEL_SETTING_KEYS } });
  const map = {};
  docs.forEach((doc) => { map[doc.key] = doc.value; });
  return {
    cheap: map.claudeModelCheap || process.env.CLAUDE_MODEL_CHEAP,
    default: map.claudeModelDefault || process.env.CLAUDE_MODEL_DEFAULT,
    deep: map.claudeModelDeep || process.env.CLAUDE_MODEL_DEEP,
  };
}

/**
 * Resolves which cost-rate tier a model id belongs to, against the
 * currently-configured model ids (Setting override, or .env fallback) —
 * never hardcodes a model string.
 * @param {string} model
 * @returns {Promise<'cheap'|'default'|'deep'>}
 */
async function resolveTier(model) {
  const models = await getModelIds();
  if (model === models.cheap) return 'cheap';
  if (model === models.deep) return 'deep';
  return 'default';
}

/**
 * Checks the current month's AI spend against the configured cap before a
 * Claude call is allowed to proceed. Warns once (via Slack + log) after
 * crossing AI_SPEND_WARN_PERCENT, and blocks entirely once the cap is hit.
 * @throws {SpendCapError} if the monthly cap has been reached.
 */
async function checkSpendCap() {
  const settings = await loadSpendSettings();
  const capUsd = Number(settings.monthlyAiSpendCapUsd ?? process.env.MONTHLY_AI_SPEND_CAP_USD ?? 200);
  const warnPercent = Number(settings.aiSpendWarnPercent ?? process.env.AI_SPEND_WARN_PERCENT ?? 80);
  const { key: monthKey } = currentMonthRange();
  const spend = settings.aiMonthlySpend?.[monthKey] || 0;

  if (spend >= capUsd) {
    throw new SpendCapError(`Monthly AI spend cap of $${capUsd} reached (current: $${round(spend, 2)}). Raise the cap in Settings.`);
  }

  const warnThreshold = capUsd * (warnPercent / 100);
  if (spend >= warnThreshold) {
    const warnedMonths = settings.aiSpendWarnedMonths || [];
    if (!warnedMonths.includes(monthKey)) {
      logger.warn(`[ClaudeClient] Monthly AI spend $${round(spend, 2)} crossed ${warnPercent}% of the $${capUsd} cap.`);
      try {
        // eslint-disable-next-line global-require
        const slackNotifier = require('./slackNotifier');
        await slackNotifier.notifySpendWarning({ monthKey, spend, capUsd });
      } catch (err) {
        logger.warn(`[ClaudeClient] Spend warning notification failed: ${err.message}`);
      }
      await Setting.findOneAndUpdate(
        { key: 'aiSpendWarnedMonths' },
        { $addToSet: { value: monthKey }, $set: { updatedAt: new Date() } },
        { upsert: true }
      );
    }
  }
}

/**
 * Atomically adds costUsd to the running total for the current calendar
 * month in Setting key `aiMonthlySpend` (shape: { "YYYY-MM": totalUsd }).
 * @param {number} costUsd
 */
async function recordSpend(costUsd) {
  const { key: monthKey } = currentMonthRange();
  await Setting.findOneAndUpdate(
    { key: 'aiMonthlySpend' },
    { $inc: { [`value.${monthKey}`]: costUsd }, $set: { updatedAt: new Date() } },
    { upsert: true }
  );
}

/** Strips ```json / ``` fences a model sometimes wraps JSON in. */
function stripJsonFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/** Safely parses JSON, returning undefined (never throwing) on failure. */
function safeParseJson(text) {
  try {
    return JSON.parse(stripJsonFences(text));
  } catch (err) {
    return undefined;
  }
}

/**
 * Performs one POST to the Anthropic Messages API, wrapped in the shared
 * retry/backoff policy (auth errors never retried, 429 waits+retries,
 * network errors back off 3s/9s/27s).
 * @param {{model:string, system?:string, messages:Array, maxTokens?:number}} params
 * @returns {Promise<object>} Raw Anthropic response body.
 */
async function postToAnthropic({ model, system, messages, maxTokens }) {
  const { anthropicApiKey } = await getSecrets();
  return withRetry('Claude', async () => {
    const response = await axios.post(
      ANTHROPIC_API_URL,
      { model, system, messages, max_tokens: maxTokens || 4096 },
      {
        headers: {
          'x-api-key': anthropicApiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        // 180s, not 60s: a full multi-stage rubric generation on the deep
        // (Opus) tier genuinely takes longer than 60s to finish — retrying
        // a call that always exceeds the timeout just fails 3x in a row
        // instead of once. A slow-but-real response beats a fast timeout.
        timeout: 180000,
      }
    );
    return response.data;
  });
}

/**
 * Shared Anthropic Claude API wrapper. ALL Claude calls in the system go
 * through this one function so token usage, cost, and error handling live
 * in exactly one place.
 *
 * @param {object} params
 * @param {string} params.model - Resolved model id (from .env — never hardcoded by the caller's caller).
 * @param {string} [params.system] - System prompt.
 * @param {Array<{role:string, content:string}>} params.messages - Anthropic messages array.
 * @param {number} [params.maxTokens] - Max output tokens (default 4096).
 * @param {boolean} [params.expectJson] - If true, response.text is guaranteed valid JSON (as a string) or this throws.
 * @returns {Promise<{text:string, inputTokens:number, outputTokens:number, costUsd:number}>}
 * @throws {import('../utils/errors').ApiKeyError} on 401/403 (bad key).
 * @throws {import('../utils/errors').RateLimitError} if 429 persists through retries.
 * @throws {import('../utils/errors').ServiceError} if network errors persist through retries.
 * @throws {import('../utils/errors').SpendCapError} if the monthly AI spend cap has been reached.
 * @throws {Error} if expectJson is true and Claude still returns invalid JSON after one retry.
 */
async function callClaude({ model, system, messages, maxTokens, expectJson }) {
  await checkSpendCap();

  logger.info(`[ClaudeClient] Calling model=${model} expectJson=${!!expectJson}`);
  const data = await postToAnthropic({ model, system, messages, maxTokens });
  let text = (data.content || []).map((block) => block.text || '').join('');
  const inputTokens = data.usage?.input_tokens || 0;
  let outputTokens = data.usage?.output_tokens || 0;

  if (expectJson) {
    let parsed = safeParseJson(text);
    if (parsed === undefined) {
      logger.warn('[ClaudeClient] Invalid JSON on first attempt; retrying with a stricter nudge.');
      const stricterMessages = [
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: 'Your last response was not valid JSON. Respond with valid JSON only — no prose, no markdown fences, no explanation.' },
      ];
      const retryData = await postToAnthropic({ model, system, messages: stricterMessages, maxTokens });
      text = (retryData.content || []).map((block) => block.text || '').join('');
      outputTokens += retryData.usage?.output_tokens || 0;
      parsed = safeParseJson(text);
      if (parsed === undefined) {
        logger.error('[ClaudeClient] Claude returned invalid JSON even after the stricter retry.');
        throw new Error('Claude did not return valid JSON after retry.');
      }
    }
    text = JSON.stringify(parsed); // normalized — caller can JSON.parse(text) with confidence
  }

  const settings = await loadSpendSettings();
  const rateTable = settings.aiCostRateTable || DEFAULT_COST_RATE_TABLE;
  const tier = await resolveTier(model);
  const rate = rateTable[tier] || DEFAULT_COST_RATE_TABLE[tier];
  const costUsd = round(
    (inputTokens / 1_000_000) * rate.inputPerMTokens + (outputTokens / 1_000_000) * rate.outputPerMTokens,
    6
  );

  await recordSpend(costUsd);
  logger.info(`[ClaudeClient] model=${model} inputTokens=${inputTokens} outputTokens=${outputTokens} costUsd=${costUsd}`);

  return { text, inputTokens, outputTokens, costUsd };
}

module.exports = { callClaude, getModelIds };
