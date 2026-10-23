const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const logger = require('../utils/logger');

/**
 * Login sessions = two HTTP-only cookies (scripts on the page cannot read them):
 *
 *   access_token   short-lived JWT (default 15 min). Sent to every /api route.
 *   refresh_token  long-lived random secret (default 7 days), sent ONLY to
 *                  /api/auth. Used to get a new access token without logging in
 *                  again, and rotated (replaced) every time it is used.
 *
 * Settings (all optional):
 *   ACCESS_TOKEN_MINUTES     default 15   (5-120)
 *   REFRESH_TOKEN_DAYS       default 7    (1-90)   idle limit: unused for this long = logged out
 *   REFRESH_TOKEN_MAX_DAYS   default 30   (>= REFRESH_TOKEN_DAYS, up to 180)  absolute limit since login
 *   COOKIE_SAMESITE          default lax  (lax | strict | none). Use "none" only when the website and
 *                            the API are on different sites (it forces Secure cookies).
 * Cookies are marked Secure (HTTPS only) in production and whenever SameSite=none.
 */

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';
const ACCESS_PATH = '/api';
const REFRESH_PATH = '/api/auth';
/** A refresh token reused within this window is treated as two tabs racing, not theft. */
const REUSE_GRACE_MS = 10 * 1000;

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, min), max) : fallback;
};

function getSessionConfig(env = process.env) {
  const accessMinutes = clamp(env.ACCESS_TOKEN_MINUTES, 5, 120, 15);
  const refreshDays = clamp(env.REFRESH_TOKEN_DAYS, 1, 90, 7);
  const maxDays = Math.max(refreshDays, clamp(env.REFRESH_TOKEN_MAX_DAYS, 1, 180, 30));
  const requested = String(env.COOKIE_SAMESITE || 'lax').toLowerCase();
  const sameSite = ['lax', 'strict', 'none'].includes(requested) ? requested : 'lax';
  const secure = env.NODE_ENV === 'production' || sameSite === 'none';
  return { accessMinutes, refreshDays, maxDays, sameSite, secure };
}

const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

function signAccessToken(userId) {
  const { accessMinutes } = getSessionConfig();
  return jwt.sign({ sub: String(userId) }, process.env.JWT_SECRET, { expiresIn: `${accessMinutes}m` });
}

function cookieOptions(path, maxAgeMs) {
  const { sameSite, secure } = getSessionConfig();
  return { httpOnly: true, secure, sameSite, path, ...(maxAgeMs ? { maxAge: maxAgeMs } : {}) };
}

function setSessionCookies(res, accessToken, refreshToken) {
  const { accessMinutes, refreshDays } = getSessionConfig();
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_PATH, accessMinutes * 60 * 1000));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(REFRESH_PATH, refreshDays * 24 * 60 * 60 * 1000));
}

function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, cookieOptions(ACCESS_PATH));
  res.clearCookie(REFRESH_COOKIE, cookieOptions(REFRESH_PATH));
}

/** Creates a refresh token row and returns the raw value to put in the cookie. */
async function createRefreshToken(userId, req, { familyId, familyStartedAt } = {}) {
  const { refreshDays } = getSessionConfig();
  const raw = crypto.randomBytes(48).toString('base64url');
  await RefreshToken.create({
    userId,
    tokenHash: hashToken(raw),
    familyId: familyId || crypto.randomUUID(),
    familyStartedAt: familyStartedAt || new Date(),
    expiresAt: new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000),
    userAgent: String(req.get?.('user-agent') || '').slice(0, 200),
    ip: req.ip,
  });
  return raw;
}

/** Starts a brand-new login session (new token family) and sets both cookies. */
async function startSession(req, res, user) {
  const refreshToken = await createRefreshToken(user._id, req);
  setSessionCookies(res, signAccessToken(user._id), refreshToken);
}

/**
 * Exchanges the refresh cookie for a new pair of tokens (rotation).
 * @returns {Promise<{user: object}|{failure: string}>} The user on success, otherwise why it failed
 *   (cookies are cleared by the caller on failure).
 */
async function refreshSession(req, res) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) return { failure: 'no_token' };

  const { maxDays } = getSessionConfig();
  const now = new Date();
  const stored = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
  if (!stored) return { failure: 'unknown_token' };
  if (stored.expiresAt <= now) return { failure: 'expired' };

  if (now - stored.familyStartedAt > maxDays * 24 * 60 * 60 * 1000) {
    await revokeFamily(stored.familyId);
    return { failure: 'session_too_old' };
  }

  const user = await User.findById(stored.userId);
  if (!user || !user.active) {
    await revokeFamily(stored.familyId);
    return { failure: 'user_inactive' };
  }
  // A password change signs out every session that began before it.
  if (user.passwordChangedAt && user.passwordChangedAt > stored.createdAt) {
    await revokeFamily(stored.familyId);
    return { failure: 'password_changed' };
  }

  // A revoked token (logout, password change, theft detected) never works again.
  if (stored.revokedAt) return { failure: 'revoked' };

  // Mark this token used. The conditional update means only ONE request can win
  // if two arrive at the same instant.
  let usedAt = stored.usedAt;
  if (!usedAt) {
    const won = await RefreshToken.findOneAndUpdate({ _id: stored._id, usedAt: null, revokedAt: null }, { usedAt: now });
    if (!won) {
      // Another request got there between our read and our update: look again.
      const fresh = await RefreshToken.findById(stored._id);
      if (!fresh || fresh.revokedAt) return { failure: 'revoked' };
      usedAt = fresh.usedAt || now;
    }
  }
  // Already used. Within a few seconds it is two tabs racing, so carry on;
  // later than that it is a replay of a stolen token, so end the whole session.
  if (usedAt && now - usedAt > REUSE_GRACE_MS) {
    logger.warn(`[Session] Refresh token reuse detected for user=${stored.userId}; revoking the whole session family.`);
    await revokeFamily(stored.familyId);
    return { failure: 'token_reuse' };
  }

  const refreshToken = await createRefreshToken(user._id, req, {
    familyId: stored.familyId,
    familyStartedAt: stored.familyStartedAt,
  });
  setSessionCookies(res, signAccessToken(user._id), refreshToken);
  return { user };
}

async function revokeFamily(familyId) {
  if (!familyId) return;
  await RefreshToken.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date() });
}

/** Ends the session that owns this refresh cookie (used by logout). */
async function revokeSessionByCookie(req) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) return;
  const stored = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
  if (stored) await revokeFamily(stored.familyId);
}

/** Signs a user out everywhere: used after a password change, deactivation or deletion. */
async function revokeAllForUser(userId) {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
}

module.exports = {
  ACCESS_COOKIE, REFRESH_COOKIE, REUSE_GRACE_MS,
  getSessionConfig, signAccessToken, setSessionCookies, clearSessionCookies,
  startSession, refreshSession, revokeSessionByCookie, revokeAllForUser,
};
