const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const User = require('../models/User');
const { ACCESS_COOKIE } = require('../services/sessionService');

/**
 * Finds the access token on a request: an explicit "Authorization: Bearer ..."
 * header wins (API tools), otherwise the HTTP-only access_token cookie the
 * website uses.
 */
function readAccessToken(req) {
  const [scheme, bearer] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Bearer' && bearer) return bearer;
  return req.cookies?.[ACCESS_COOKIE] || null;
}

async function requireAuth(req, res, next) {
  try {
    const token = readAccessToken(req);

    if (!token) {
      return res.status(401).json({ error: 'AUTH_ERROR', message: 'You are not signed in.' });
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
    // A password reset invalidates JWTs issued before the new password was
    // saved, including sessions on other devices.
    if (user.passwordChangedAt && payload.iat && payload.iat * 1000 < user.passwordChangedAt.getTime()) {
      return res.status(401).json({ error: 'AUTH_ERROR', message: 'Your password was changed. Please sign in again.' });
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
function requireRole(...roles) {
  // Accept both requireRole('a', 'b') and requireRole(['a', 'b']).
  const allowedRoles = roles.flat();
  return function checkRole(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'AUTH_ERROR', message: 'Not authenticated.' });
    }
    // Owner role has unrestricted access across all routes
    if (req.user.role === 'owner' || allowedRoles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have permission to perform this action.' });
  };
}

module.exports = { requireAuth, requireRole };
