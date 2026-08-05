import dayjs from 'dayjs';

/** Formats a date/timestamp as e.g. "Jul 29, 2026 3:45 PM". Returns '—' if empty. */
export function formatDate(value) {
  if (!value) return '—';
  return dayjs(value).format('MMM D, YYYY h:mm A');
}

/** Formats a 1-5 score to 2 decimal places, e.g. "3.50". Returns '—' if null/undefined. */
export function formatScore(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toFixed(2);
}

/** Formats a USD amount, e.g. "$12.34". */
export function formatCurrency(value) {
  if (value === null || value === undefined) return '$0.00';
  return `$${Number(value).toFixed(2)}`;
}

/** Formats a disposition value into a readable label ("NO_HIRE" -> "No Hire"). */
export function formatDisposition(value) {
  if (!value) return 'Pending';
  return value.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
