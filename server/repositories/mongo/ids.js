import mongoose from 'mongoose';

/**
 * What an id looks like is a database detail (a MongoDB ObjectId today), so the checks live here rather than in
 * controllers. Controllers use these to reject a malformed id from a URL or form before asking for it.
 */

/** True when the value can be used as an id (an ObjectId, or a 24-character hex string). */
export function isValidId(value) {
  return mongoose.isValidObjectId(value);
}

/** The stricter check some public endpoints use on URL parameters. */
export function isValidIdString(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

/** The id as its canonical text (lower-case hex), whatever form it was given in. */
export function normalizeId(value) {
  return String(new mongoose.Types.ObjectId(value));
}
