import crypto from 'node:crypto';
import { inspect } from 'node:util';

/**
 * Small pieces every PostgreSQL repository needs, so that it behaves exactly like its MongoDB twin: ids that look like
 * MongoDB ObjectIds, and errors with the same shape, because middleware/errorHandler.js (and so every API answer) is
 * written around those shapes.
 */

// ------------------------------------------------------------------------------------------------------------- ids

let counter = crypto.randomBytes(3).readUIntBE(0, 3);
const processBytes = crypto.randomBytes(5);

/**
 * A new id of the same shape as a MongoDB ObjectId (24 hex characters: 4 bytes of time, 5 bytes unique to this process,
 * 3 bytes of counter), so new rows sort by creation time just as ObjectIds do.
 */
export function newId() {
  counter = (counter + 1) % 0x1000000;
  const buffer = Buffer.alloc(12);
  buffer.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
  processBytes.copy(buffer, 4);
  buffer.writeUIntBE(counter, 9, 3);
  return buffer.toString('hex');
}

/**
 * Turns an id from a URL or form into the id text stored in the database, or throws the error MongoDB would have:
 * 24 hex characters (any letter case) are an id; anything else is "invalid" (a CastError, which the API answers with a 400).
 * @param {*} value
 * @param {string} path the field name, for the error ("_id" for a record's own id)
 */
export function castId(value, path = '_id') {
  const text = typeof value === 'string' ? value : (value && typeof value.toString === 'function' ? String(value) : '');
  if (/^[0-9a-fA-F]{24}$/.test(text)) return text.toLowerCase();
  throw castError(path, value);
}

// ----------------------------------------------------------------------------------------------------------- errors

/** The error MongoDB (Mongoose) throws for an id it cannot read. */
export function castError(path, value) {
  const error = new Error(`Cast to ObjectId failed for value "${value}" (type ${typeof value}) at path "${path}"`);
  error.name = 'CastError';
  error.kind = 'ObjectId';
  error.path = path;
  error.value = value;
  return error;
}

/** The error MongoDB throws when a unique value is already taken. `fields` are the field names, for example ['name']. */
export function duplicateKeyError(fields, values = {}) {
  const error = new Error(`E11000 duplicate key error: ${fields.join(', ')} already exists`);
  error.name = 'MongoServerError';
  error.code = 11000;
  error.keyPattern = Object.fromEntries(fields.map((field) => [field, 1]));
  error.keyValue = Object.fromEntries(fields.map((field) => [field, values[field]]));
  return error;
}

/**
 * The error Mongoose throws when a required value is missing. `problems` is `{ field: 'message' }`.
 * The message text is sent to the client as it is, so it matches Mongoose's wording exactly.
 */
export function validationError(model, problems) {
  const fields = Object.keys(problems);
  const error = new Error(`${model} validation failed: ${fields.map((field) => `${field}: ${problems[field]}`).join(', ')}`);
  error.name = 'ValidationError';
  error.errors = Object.fromEntries(fields.map((field) => [field, { name: 'ValidatorError', kind: 'required', path: field, message: problems[field] }]));
  return error;
}

/** Mongoose's message for a missing required field. */
export const requiredMessage = (field) => `Path \`${field}\` is required.`;

/**
 * Turns Prisma's "unique value already taken" error (P2002) into the MongoDB-shaped duplicate error; any other error
 * is passed on unchanged.
 */
export function translateError(error, values = {}, rawFields) {
  if (error && error.code !== 'P2002' && rawFields && /duplicate key value violates unique constraint|Code: `23505`/.test(String(error.message))) {
    return duplicateKeyError(rawFields, values); // raw SQL reports the clash without Prisma's detail, so the caller names the fields
  }
  if (error && error.code === 'P2002') {
    const target = error.meta && error.meta.target;
    const fields = Array.isArray(target) ? target : (typeof target === 'string' ? [target.replace(/^.*_(\w+)_key$/, '$1')] : ['field']);
    return duplicateKeyError(fields, values);
  }
  return error;
}

// ------------------------------------------------------------------------------------------------------- searching

/**
 * Escapes the characters that mean something in a SQL LIKE pattern (% and _), so that Prisma's case-insensitive equals
 * (which is a LIKE underneath) matches the text literally, as a MongoDB regex built from escaped text did.
 */
export const escapeLike = (text) => String(text).replace(/[\\%_]/g, '\\$&');

// --------------------------------------------------------------------------------------------------------- ordering

/**
 * MongoDB sorts text by its raw bytes (so "Zeta" comes before "alpha"); PostgreSQL sorts by the language rules of the
 * database. This compares the way MongoDB does, for use with `Array.sort`.
 */
export const compareBytes = (a, b) => Buffer.compare(Buffer.from(String(a), 'utf8'), Buffer.from(String(b), 'utf8'));

// ------------------------------------------------------------------------------------------------------ raw writes

/**
 * Prisma rounds numbers that need 17 digits when it writes JSON, so JSON is written with raw SQL as text. This is the
 * text for such a `$n::jsonb` parameter: nothing (an empty column) for undefined, the JSON `null` for null.
 */
export const jsonParam = (value) => (value === undefined ? null : JSON.stringify(value));

/** The JSON read back from a `"column"::text` value: undefined for an empty column (so the field is left out), else the parsed value. */
export const jsonOut = (text) => (text === null || text === undefined ? undefined : JSON.parse(text));

/** A date as text a raw `timestamp` column takes as it is (UTC, as Prisma stores them): use as `$n::text::timestamp`. */
export const dateParam = (date) => date.toISOString();

/** Whether this is the error PostgreSQL gives when a unique value is already taken (by Prisma's API or by raw SQL). */
export const isUniqueViolation = (error) => Boolean(error) && (error.code === 'P2002' || /duplicate key value violates unique constraint/.test(String(error.message)));

// ------------------------------------------------------------------------------------------------------ casting

const typeName = (value) => (value === null ? 'null' : (typeof value === 'object' ? (value.constructor?.name || 'Object') : typeof value));

/** Mongoose's message for a value it cannot turn into the type of a field. */
export function castFailureMessage(type, path, value) {
  let shown = inspect(value);
  shown = shown.replace(/^'|'$/g, '"');
  if (shown.charAt(0) !== '"') shown = `"${shown}"`;
  return `Cast to ${type} failed for value ${shown} (type ${typeName(value)}) at path "${path}"`;
}

/** Mongoose's String cast: text stays, numbers/booleans/dates/ids become text, plain objects and lists cannot. Returns { value } or { problem }. */
export function castString(value, path) {
  if (value === undefined || value === null || typeof value === 'string') return { value };
  if (['number', 'boolean', 'bigint'].includes(typeof value)) return { value: String(value) };
  if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString && !Array.isArray(value)) return { value: value.toString() };
  return { problem: castFailureMessage('string', path, value) };
}

/** Mongoose's Number cast. */
export function castNumber(value, path) {
  if (value === undefined || value === null) return { value };
  if (typeof value === 'number') return Number.isNaN(value) ? { problem: castFailureMessage('Number', path, value) } : { value };
  if (typeof value === 'boolean') return { value: value ? 1 : 0 };
  if (typeof value === 'string') {
    if (value.trim() === '') return { value: null };
    const number = Number(value);
    return Number.isNaN(number) ? { problem: castFailureMessage('Number', path, value) } : { value: number };
  }
  return { problem: castFailureMessage('Number', path, value) };
}

/** Mongoose's Boolean cast. */
export function castBoolean(value, path) {
  if (value === undefined || value === null || typeof value === 'boolean') return { value };
  if (['true', '1', 1, 'yes'].includes(value)) return { value: true };
  if (['false', '0', 0, 'no'].includes(value)) return { value: false };
  return { problem: `${castFailureMessage('Boolean', path, value)} because of "CastError"` };
}

/** An id for a document field (an ObjectId reference): the id text, or { problem } as Mongoose words it. */
export function castIdField(value, path) {
  if (value === undefined || value === null) return { value };
  const text = typeof value === 'string' ? value : (typeof value.toString === 'function' ? String(value) : '');
  if (/^[0-9a-fA-F]{24}$/.test(text)) return { value: text.toLowerCase() };
  return { problem: `${castFailureMessage('ObjectId', path, value)} because of "BSONError"` }; // the wording Mongoose uses when it saves a record
}

/** Whether two plain JSON values are equal, whatever the order of the keys inside objects. */
export function sameJson(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  const keys = Object.keys(a).filter((k) => a[k] !== undefined);
  const others = Object.keys(b).filter((k) => b[k] !== undefined);
  return keys.length === others.length && keys.every((k) => sameJson(a[k], b[k]));
}
