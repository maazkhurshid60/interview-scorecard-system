import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Meeting times are picked, checked and shown in the CALENDAR's time zone (the
 * server's GOOGLE_CALENDAR_TIME_ZONE), not in whatever zone the staff member's
 * computer happens to be set to. The server books the meeting in that zone, so
 * the page must use it too, or the same meeting appears on a different day.
 */

function isValidZone(zone) {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The zone to use: the calendar's when it is known and valid, otherwise the browser's own. */
export function resolveZone(calendarTimeZone) {
  return isValidZone(calendarTimeZone) ? calendarTimeZone : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The real moment in time for a wall-clock time on a given day in `zone`.
 * Example: ('2026-10-30', '08:00', 'Asia/Karachi') is 03:00 UTC, on any computer.
 * @param {string} day - 'YYYY-MM-DD'
 * @param {string} time - 'HH:mm'
 * @param {string} zone - IANA zone name
 * @returns {Date}
 */
export function wallClockToInstant(day, time, zone) {
  return dayjs.tz(`${day} ${time}`, 'YYYY-MM-DD HH:mm', zone).toDate();
}

/**
 * The calendar day chosen in a date picker, as 'YYYY-MM-DD'. A picker returns a
 * Date at local midnight/noon, so its LOCAL parts are the day the person clicked.
 */
export function pickedDay(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Formats a moment in `zone`, for example formatInZone(date, 'Asia/Karachi', 'h:mm A'). */
export function formatInZone(value, zone, format) {
  return dayjs(value).tz(zone).format(format);
}

/**
 * A sensible starting slot: the next full hour (plus 30 minutes for the end),
 * worked out in `zone`. The date is returned as a local-noon Date so a date
 * picker highlights the right day on any computer.
 * @param {string} zone
 * @param {Date|number} [now] - for testing
 * @returns {{ date: Date, startTime: string, endTime: string }}
 */
export function defaultMeetingSlot(zone, now = new Date()) {
  const start = dayjs(now).tz(zone).add(1, 'hour').startOf('hour');
  return {
    date: new Date(start.year(), start.month(), start.date(), 12, 0, 0),
    startTime: start.format('HH:mm'),
    endTime: start.add(30, 'minute').format('HH:mm'),
  };
}
