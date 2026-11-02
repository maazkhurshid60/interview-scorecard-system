import { parseId, parsePublicRef } from './helpers.js';

/**
 * What an id looks like is a database detail, so the checks live here rather than in controllers. This is the
 * PostgreSQL side of ../mongo/ids.js: an id is a UUID (in any letter case, from a URL or a form). An old 24-character MongoDB
 * id is not an id here; only the public job and availability links still accept one (they look the record up by its `legacyId`).
 */

/** True when the value can be used as an id (a UUID). */
export function isValidId(value) {
  return parseId(value) !== undefined;
}

/** The stricter check some public endpoints use on URL parameters (a UUID is all they accept here). */
export function isValidIdString(value) {
  return parseId(value) !== undefined;
}

/**
 * True when the value can be the last part of a public link (a job application link, an availability link): a record's random
 * public token, or the old 24-character id of a link shared before the move. A record's own id is not accepted there.
 */
export function isValidPublicRef(value) {
  return parsePublicRef(value) !== null;
}

/** The id as its canonical text (lower case), whatever letter case it was given in. Throws for anything that is not an id. */
export function normalizeId(value) {
  const id = parseId(value);
  if (id === undefined) throw Object.assign(new Error('An id must be a UUID'), { name: 'BSONError' });
  return id;
}
