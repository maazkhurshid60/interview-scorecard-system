const logger = require('../utils/logger');
const { normalizeOrigin } = require('../utils/allowedOrigins');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protection against cross-site request forgery (CSRF), needed now that login
 * lives in cookies: a browser attaches cookies to ANY request to this API,
 * including ones fired by a page on another website.
 *
 * Every browser states which website a request came from in the Origin header
 * (always for cross-site requests and for POST / PUT / PATCH / DELETE). So for
 * anything that changes data, a request that names an origin we do not allow
 * is refused. Requests with no Origin header at all cannot come from a browser
 * page on another site (health checks, curl, server-to-server) and pass.
 *
 * @param {string[]} allowedOrigins - normalized origins (see utils/allowedOrigins.js)
 * @returns {Function} Express middleware
 */
function createOriginGuard(allowedOrigins) {
  return function rejectForeignOrigin(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (!origin || allowedOrigins.includes(normalizeOrigin(origin))) return next();
    logger.warn(`[OriginGuard] Refused ${req.method} ${req.originalUrl} from origin ${origin}.`);
    return res.status(403).json({ error: 'FORBIDDEN', message: 'This request came from a website that is not allowed.' });
  };
}

module.exports = { createOriginGuard };
