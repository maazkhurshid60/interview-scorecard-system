const DEFAULT_ORIGIN = 'http://localhost:5173';

/** An origin is scheme + host (+ optional port) only: no path, query or wildcard. */
const ORIGIN_PATTERN = /^https?:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

/** Lower-cases and removes trailing slashes so "https://App.com/" equals "https://app.com". */
function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Works out which website addresses may call the API from a browser (CORS).
 *
 *   ALLOWED_ORIGINS  comma-separated list of origins, e.g.
 *                    "https://app.ownerstalent.com,https://staging.example.com"
 *   CLIENT_URL       fallback when ALLOWED_ORIGINS is not set (older setups)
 *   (neither set)    http://localhost:5173, for local development only
 *
 * Safety rules: a wildcard ("*") is never accepted, and an entry that is not a
 * plain origin (a typo, or one with a path) is ignored and reported rather than
 * silently allowed. If ALLOWED_ORIGINS is set but nothing valid is left, no
 * browser origin is allowed (fail closed) instead of falling back to something wider.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ origins: string[], ignored: string[], source: string }}
 */
function getAllowedOrigins(env = process.env) {
  const hasAllowed = String(env.ALLOWED_ORIGINS || '').trim() !== '';
  const hasClientUrl = String(env.CLIENT_URL || '').trim() !== '';
  const source = hasAllowed ? 'ALLOWED_ORIGINS' : hasClientUrl ? 'CLIENT_URL' : 'default';
  const raw = hasAllowed ? env.ALLOWED_ORIGINS : hasClientUrl ? env.CLIENT_URL : DEFAULT_ORIGIN;

  const origins = [];
  const ignored = [];
  for (const entry of String(raw).split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const origin = normalizeOrigin(trimmed);
    if (origin === '*' || !ORIGIN_PATTERN.test(origin)) {
      ignored.push(trimmed);
    } else if (!origins.includes(origin)) {
      origins.push(origin);
    }
  }
  return { origins, ignored, source };
}

module.exports = { getAllowedOrigins, normalizeOrigin, DEFAULT_ORIGIN };
