const logger = require('./logger');
const { sleep } = require('./helpers');
const { ApiKeyError, RateLimitError, ServiceError } = require('./errors');

/**
 * Shared retry-with-backoff wrapper implementing the exact pattern from
 * INSTRUCTIONS.md's "Per-Service Error Handling Pattern": auth errors are
 * never retried, rate limits wait for retry-after then retry, and
 * network/timeout errors back off 3s / 9s / 27s. Every external-API service
 * (Claude, Google Meet, Slack) uses this so the behavior is identical and
 * defined in exactly one place.
 *
 * @param {string} serviceName - Used in log lines and thrown errors, e.g. 'Claude'.
 * @param {() => Promise<any>} apiCallFn - Performs one attempt; should reject with
 *   an axios-shaped error (error.response.status / error.response.headers) on failure.
 * @returns {Promise<any>} Whatever apiCallFn resolves with.
 * @throws {ApiKeyError} on 401/403 — never retried, key is wrong.
 * @throws {RateLimitError} if 429 persists through all retries.
 * @throws {ServiceError} if network/timeout errors persist through all retries.
 */
async function withRetry(serviceName, apiCallFn) {
  const maxRetries = 3;
  let lastError;
  let lastWasRateLimit = false;
  let lastRetryAfter;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await apiCallFn();
    } catch (error) {
      lastError = error;
      const status = error.response?.status ?? error.code;
      // OAuth2 token refresh failures (e.g. a revoked/expired Google refresh
      // token) surface as HTTP 400 with body {error: 'invalid_grant'}, not
      // 401/403 — still an auth problem retrying can never fix.
      const isOAuthGrantError = status === 400 && error.response?.data?.error === 'invalid_grant';

      if (status === 401 || status === 403 || isOAuthGrantError) {
        // Prefer the real API's own error detail (e.g. Anthropic's
        // {error:{message:"invalid x-api-key"}}) over axios's generic
        // "Request failed with status code 401" — the former is actually
        // actionable, the latter just restates the HTTP status.
        const detail = error.response?.data?.error?.message || error.response?.data?.error_description || error.message;
        logger.error(`[${serviceName}] Auth/key invalid: ${detail}`);
        throw new ApiKeyError(serviceName, detail);
      }

      if (status === 429) {
        lastWasRateLimit = true;
        lastRetryAfter = Number(error.response?.headers?.['retry-after']) || 60;
        logger.warn(`[${serviceName}] Rate limited. Waiting ${lastRetryAfter}s (attempt ${attempt}/${maxRetries})...`);
        await sleep(lastRetryAfter * 1000);
        continue;
      }

      lastWasRateLimit = false;
      const backoff = 3 ** attempt * 1000; // 3s, 9s, 27s
      logger.warn(`[${serviceName}] Attempt ${attempt}/${maxRetries} failed: ${error.message}. Retrying in ${backoff / 1000}s...`);
      if (attempt < maxRetries) await sleep(backoff);
    }
  }

  logger.error(`[${serviceName}] All ${maxRetries} attempts failed: ${lastError.message}`);
  if (lastWasRateLimit) throw new RateLimitError(serviceName, lastRetryAfter);
  throw new ServiceError(serviceName, lastError.message);
}

module.exports = { withRetry };