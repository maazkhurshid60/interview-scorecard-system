/**
 * Shared utility functions used across controllers/services.
 */

/**
 * Wraps an async Express route handler so a rejected promise is forwarded to
 * next(err) instead of crashing the process. Use on every async controller.
 * @param {Function} fn - async (req, res, next) => void
 * @returns {Function} Express-compatible handler.
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Removes fields that must never leave the server (password hash, __v) from
 * a Mongoose user document before sending it to the client.
 * @param {import('mongoose').Document} userDoc
 * @returns {object} Plain object safe to serialize in an API response.
 */
function sanitizeUser(userDoc) {
  if (!userDoc) return null;
  const obj = typeof userDoc.toObject === 'function' ? userDoc.toObject() : { ...userDoc };
  delete obj.passwordHash;
  delete obj.__v;
  return obj;
}

/**
 * Rounds a number to a fixed number of decimal places (default 2), returning
 * a Number (not a string). Used for scores/costs/weights before persisting
 * or returning to the client.
 * @param {number} value
 * @param {number} [decimals=2]
 * @returns {number}
 */
function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Given a set of stage weights, re-normalizes them so the enabled/scored
 * subset sums to exactly 1 (100%). Stages not in `weights` (or with weight 0
 * because they don't contribute, e.g. pass_fail/status_only) are left untouched
 * by the caller — this only rescales the map it's given.
 * @param {Record<string, number>} weights - stageKey -> raw weight
 * @returns {Record<string, number>} stageKey -> normalized weight summing to 1
 */
function normalizeWeights(weights) {
  const keys = Object.keys(weights);
  const total = keys.reduce((sum, k) => sum + (weights[k] || 0), 0);
  if (total <= 0) return weights;

  // Rounding each share independently (e.g. to 4 decimals) can leave the sum
  // a hair off 1 (0.9999 or 1.0001) purely from rounding drift. Largest-
  // remainder method: floor everyone to 1/10000ths, then hand the leftover
  // units to whichever shares had the biggest fractional remainder — this
  // guarantees the result sums to EXACTLY 1, not "close to 1".
  const SCALE = 10000;
  const raw = keys.map((k) => ((weights[k] || 0) / total) * SCALE);
  const floors = raw.map(Math.floor);
  const remainder = SCALE - floors.reduce((sum, v) => sum + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let n = 0; n < remainder; n++) floors[order[n].i] += 1;

  const normalized = {};
  keys.forEach((k, i) => { normalized[k] = floors[i] / SCALE; });
  return normalized;
}

/**
 * Sleeps for the given number of milliseconds. Used by retry/backoff logic
 * in external-API service wrappers.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns the first and last day (UTC) of the current calendar month, used
 * for grouping AI usage/spend by month.
 * @returns {{ start: Date, end: Date, key: string }} key is 'YYYY-MM'
 */
function currentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const key = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return { start, end, key };
}

/**
 * Returns a requisition's enabled stages sorted by their pipeline order.
 * Used to determine stage sequence for out-of-order enforcement.
 * @param {{stages: Array<{enabled:boolean, order:number}>}} requisition
 * @returns {Array<object>}
 */
function getEnabledStagesSorted(requisition) {
  return (requisition.stages || []).filter((s) => s.enabled).sort((a, b) => a.order - b.order);
}

module.exports = {
  asyncHandler,
  sanitizeUser,
  round,
  normalizeWeights,
  sleep,
  currentMonthRange,
  getEnabledStagesSorted,
};
