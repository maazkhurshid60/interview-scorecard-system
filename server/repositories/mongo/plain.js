import mongoose from 'mongoose';

/**
 * Turns what Mongoose hands back (documents, lean objects, ObjectIds) into plain data that does not depend on
 * Mongoose or MongoDB: ids become strings, nested objects and arrays are copied, and Mongoose's own `__v` version
 * counter is dropped. Dates and other values are kept as they are.
 *
 * Every repository returns its results through this, so nothing above the repositories ever sees a Mongoose
 * document or an ObjectId. Controllers can then be written without knowing which database sits underneath.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function plain(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toObject === 'function') return plain(value.toObject());
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (Array.isArray(value)) return value.map(plain);
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const copy = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key === '__v') continue;
      copy[key] = plain(inner);
    }
    return copy;
  }
  return value;
}
