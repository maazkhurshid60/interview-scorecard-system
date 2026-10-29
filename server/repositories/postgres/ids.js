import { parseId, parsePublicRef } from './helpers.js';

/**
 * What an id looks like is a database detail, so the checks live here rather than in controllers. This is the
 * PostgreSQL side of ../mongo/ids.js: an id is an auto-increment number (1, 2, 3, ...), given as a number or as digits
 * (from a URL). An old 24-character MongoDB id is not an id here; only the public job and availability links still accept
 * one (they look the record up by its `legacyId`).
 */

/** True when the value can be used as an id (a whole number from 1 up, as a number or as digits). */
export function isValidId(value) {
  return parseId(value) !== undefined;
}

/** The stricter check some public endpoints use on URL parameters (a number is all they accept here). */
export function isValidIdString(value) {
  return parseId(value) !== undefined;
}

/**
 * True when the value can be the last part of a public link (a job application link, an availability link): a random token,
 * or the old 24-character id of a link shared before the move. A plain number is not accepted (it could be guessed).
 */
export function isValidPublicRef(value) {
  return parsePublicRef(value) !== null;
}

/** The id as its canonical text (digits without a leading zero), whatever form it was given in. Throws for anything that is not an id. */
export function normalizeId(value) {
  const number = parseId(value);
  if (number === undefined) throw Object.assign(new Error('An id must be a whole number from 1 up, as a number or as digits'), { name: 'BSONError' });
  return String(number);
}
