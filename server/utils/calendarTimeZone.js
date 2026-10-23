/**
 * The time zone interviews are scheduled in: GOOGLE_CALENDAR_TIME_ZONE (for
 * example "Asia/Karachi"). The server books meetings in this zone, and the web
 * app picks, checks and shows meeting times in the same zone, so they agree no
 * matter which time zone a staff computer is set to.
 *
 * Returns null when it is not set or is not a real time zone name; the app then
 * falls back to the browser's own zone (the previous behaviour).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
function getCalendarTimeZone(env = process.env) {
  const zone = String(env.GOOGLE_CALENDAR_TIME_ZONE || '').trim();
  if (!zone) return null;
  try {
    // Throws a RangeError for a name that is not a real IANA time zone.
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

module.exports = { getCalendarTimeZone };
