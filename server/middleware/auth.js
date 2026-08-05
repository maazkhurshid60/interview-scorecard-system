const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const User = require('../models/User');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'AUTH_ERROR', message: 'Missing or malformed Authorization header.' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'AUTH_ERROR', message: 'Invalid or expired token.' });
    }

    const user = await User.findById(payload.sub);
    if (!user || !user.active) {
      return res.status(401).json({ error: 'AUTH_ERROR', message: 'User not found or inactive.' });
    }

    req.user = user;
    return next();
  } catch (err) {
    logger.error(`[Auth] requireAuth failed: ${err.message}`);
    return res.status(401).json({ error: 'AUTH_ERROR', message: 'Authentication failed.' });
  }
}

/**
 * Restricts a route to one or more roles. Must run after requireAuth.
 * @param {...string} allowedRoles
 * @returns {Function} Express middleware.
 */
function requireRole(...allowedRoles) {
  return function checkRole(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'AUTH_ERROR', message: 'Not authenticated.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have permission to perform this action.' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
