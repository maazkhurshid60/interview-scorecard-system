const logger = require('../utils/logger');

/**
 * Minimal fixed-window, in-memory rate limiter keyed by client IP.
 *
 * Used on the PUBLIC (unauthenticated) endpoints, where each request can cost
 * real money (AI scoring) or storage (Cloudinary uploads). State is per
 * process, which is fine for a single API instance; run several instances and
 * the effective limit is multiplied by the instance count.
 *
 * Relies on `app.set('trust proxy', ...)` (see index.js) so `req.ip` is the
 * real visitor and not the hosting proxy.
 *
 * @param {object} options
 * @param {string} options.name - Label for logs.
 * @param {number} options.windowMs - Window length in milliseconds.
 * @param {number} options.max - Max requests per IP per window.
 * @param {string} [options.message] - Message returned with the 429.
 * @returns {Function} Express middleware.
 */
function rateLimit({ name, windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }

  // Drop expired entries so the map can't grow without bound.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(ip);
    }
  }, Math.max(windowMs, 60 * 1000));
  sweep.unref(); // never keep the process alive just for this timer

  return function limiter(req, res, next) {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    let entry = hits.get(ip);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      if (entry.count === max + 1) {
        logger.warn(`[RateLimit] "${name}" limit of ${max}/${Math.round(windowMs / 60000)}min exceeded by ${ip}.`);
      }
      return res.status(429).json({
        error: 'RATE_LIMITED',
        message: message || 'Too many requests. Please wait a while and try again.',
      });
    }
    return next();
  };
}

// 5 applications per IP per hour: enough for a real candidate (or a few on one
// shared network) but stops a script from flooding AI scoring and file uploads.
const publicApplyLimiter = rateLimit({
  name: 'public-apply',
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many applications from this network. Please try again in a while.',
});

// Candidate availability submissions are cheap, but still unauthenticated.
const publicAvailabilityLimiter = rateLimit({
  name: 'public-availability',
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many submissions. Please try again in a while.',
});

// Making a PDF preview runs LibreOffice, which is heavy; signed-in staff only, but still capped.
const offerPreviewLimiter = rateLimit({
  name: 'offer-letter-preview',
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many previews. Please wait a minute and try again.',
});

module.exports = { rateLimit, publicApplyLimiter, publicAvailabilityLimiter, offerPreviewLimiter };
