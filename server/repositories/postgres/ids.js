import { newId } from './helpers.js';

/**
 * What an id looks like is a database detail, so the checks live here rather than in controllers. This is the
 * PostgreSQL side of ../mongo/ids.js: ids are still 24 hexadecimal characters (`newId` in helpers.js makes them), so
 * the same things count as valid, and the same things go wrong, as with MongoDB.
 */

const HEX_ID = /^[0-9a-fA-F]{24}$/;
const bsonError = (message) => Object.assign(new Error(message), { name: 'BSONError' });

/** The 24 hex characters of an id given as an id object or as 12 raw bytes, or undefined. */
function hexOfObject(value) {
  if (value && typeof value === 'object') {
    if ((value._bsontype === 'ObjectId' || value._bsontype === 'ObjectID') && typeof value.toHexString === 'function') return value.toHexString();
    if (value instanceof Uint8Array && value.length === 12) return Buffer.from(value).toString('hex');
  }
  return undefined;
}

/** True when the value can be used as an id (an id object, a 24-character hex string, 12 raw bytes, or a number of seconds). */
export function isValidId(value) {
  if (typeof value === 'string') return HEX_ID.test(value);
  if (typeof value === 'number') return true;
  return hexOfObject(value) !== undefined;
}

/** The stricter check some public endpoints use on URL parameters. */
export function isValidIdString(value) {
  return isValidId(value);
}

/** The id as its canonical text (lower-case hex), whatever form it was given in. */
export function normalizeId(value) {
  if (value === undefined || value === null) return newId();
  if (typeof value === 'string') {
    if (HEX_ID.test(value)) return value.toLowerCase();
    throw bsonError('input must be a 24 character hex string, 12 byte Uint8Array, or an integer');
  }
  if (typeof value === 'number') return newId(Math.trunc(value));
  const hex = hexOfObject(value);
  if (hex !== undefined) return hex;
  throw bsonError('Argument passed in does not match the accepted types');
}
