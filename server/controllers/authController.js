const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const logger = require('../utils/logger');
const { asyncHandler, sanitizeUser } = require('../utils/helpers');

const TOKEN_TTL = '12h';

/**
 * Signs a JWT for a given user id. Subject (`sub`) is the user's Mongo _id.
 * @param {string} userId
 * @returns {string}
 */
function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

/**
 * POST /api/auth/login
 * Verifies email + password, returns a JWT + the sanitized user on success.
 * Body: { email, password }
 * Errors: 400 if fields missing; 401 if credentials are wrong or user inactive.
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', fields: ['email', 'password'], message: 'Email and password are required.' });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user || !user.active) {
    logger.warn(`[Auth] Login failed for ${email}: no such active user.`);
    return res.status(401).json({ error: 'AUTH_ERROR', message: 'Invalid email or password.' });
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    logger.warn(`[Auth] Login failed for ${email}: bad password.`);
    return res.status(401).json({ error: 'AUTH_ERROR', message: 'Invalid email or password.' });
  }

  const token = signToken(user._id.toString());
  logger.info(`[Auth] Login succeeded for ${email} (role=${user.role}).`);
  return res.json({ token, user: sanitizeUser(user) });
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user (requireAuth must run first).
 */
const me = asyncHandler(async (req, res) => {
  return res.json({ user: sanitizeUser(req.user) });
});

module.exports = { login, me };
