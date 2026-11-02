import crypto from 'node:crypto';
import { inspect } from 'node:util';
import prismaPkg from '@prisma/client';

const { Prisma } = prismaPkg;

/**
 * Small pieces every PostgreSQL repository needs, so that it behaves like its MongoDB twin: ids that are checked the same way
 * (a bad id is a CastError), and errors with the same shape, because middleware/errorHandler.js (and so every API answer)
 * is written around those shapes.
 */

// ------------------------------------------------------------------------------------------------------------- ids

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let lastMs = 0;
let sequence = 0;

/**
 * The id of a new table row: a UUID version 7. Its first 48 bits are the time in milliseconds, then comes a 12-bit counter, then
 * random bits, so ids sort in creation order (`ORDER BY id` means "oldest first", as it did with MongoDB's ObjectIds) and, inside
 * one server process, every id is larger than the one before it, even within the same millisecond or when the clock steps back.
 * Every insert passes the id it makes here; the database does not make one.
 * @param {number} [now] the time in milliseconds (a test can give it)
 * @returns {string} for example `019a4f3c-2b7e-7c01-8f2d-6a1b9c0d4e5f`
 */
export function newId(now = Date.now()) {
  const ms = Math.floor(now);
  if (ms > lastMs) { lastMs = ms; sequence = crypto.randomInt(0, 0x800); } // starts low, so there is room to count up inside the millisecond
  else { sequence += 1; if (sequence > 0xfff) { lastMs += 1; sequence = crypto.randomInt(0, 0x800); } } // same millisecond (or the clock went back): count on
  const random = crypto.randomBytes(8);
  random[0] = (random[0] & 0x3f) | 0x80; // the variant bits of a UUID (10xx)
  const hex = lastMs.toString(16).padStart(12, '0') + '7' + sequence.toString(16).padStart(3, '0') + random.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let counter = crypto.randomBytes(3).readUIntBE(0, 3);
const processBytes = crypto.randomBytes(5);

/**
 * An id for an item inside a JSON list (for example a stage's progress entry), which is not a table row: the same shape as a
 * MongoDB ObjectId (24 hex characters: 4 bytes of time, 5 bytes unique to this process, 3 bytes of counter).
 */
export function newSubdocId(seconds = Math.floor(Date.now() / 1000)) {
  counter = (counter + 1) % 0x1000000;
  const buffer = Buffer.alloc(12);
  buffer.writeUInt32BE(seconds >>> 0, 0);
  processBytes.copy(buffer, 4);
  buffer.writeUIntBE(counter, 9, 3);
  return buffer.toString('hex');
}

/** The id of an item inside a JSON list as text (24 hex characters, lower case), or undefined when it is not one. */
export function castSubdocId(value) {
  const text = typeof value === 'string' ? value : '';
  return /^[0-9a-fA-F]{24}$/.test(text) ? text.toLowerCase() : undefined;
}

/**
 * What the last part of a public link is. A new link holds a random token (a UUID); a link shared before the move holds the
 * old 24-character MongoDB id, which is kept in `legacyId`. The plain number is NOT accepted in a public link (it could be guessed).
 * @returns {{kind: 'token'|'legacy', value: string} | null} null when it is neither
 */
export function parsePublicRef(value) {
  if (typeof value !== 'string') return null;
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) return { kind: 'token', value: value.toLowerCase() };
  if (/^[0-9a-fA-F]{24}$/.test(value)) return { kind: 'legacy', value: value.toLowerCase() };
  return null;
}

/**
 * An id as the app sees it: lower-case text (a UUID), as ids have always been text to the controllers, the services and the
 * client. An empty value (no link) stays empty. Use it on every id a repository hands out.
 */
export const idOut = (value) => (value === null || value === undefined ? value : String(value).toLowerCase());

/**
 * The id as lower-case text, or undefined when it is not one: a UUID, in any letter case. An old 24-character MongoDB id, a number,
 * " 019a...", a UUID with a character too many or too few, and anything else is not an id.
 */
export function parseId(value) {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : undefined;
}

/** Two ids in creation order, for `Array.sort` (the same order `ORDER BY id` gives in the database). */
export const compareIds = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

/**
 * Turns an id from a URL or form into the id stored in the database, or throws the error MongoDB would have for a bad id:
 * a CastError, which the API answers with a 400.
 * @param {*} value
 * @param {string} path the field name, for the error ("_id" for a record's own id)
 */
export function castId(value, path = '_id') {
  const id = parseId(value);
  if (id === undefined) throw castError(path, value);
  return id;
}

// ----------------------------------------------------------------------------------------------------------- errors

/** The error (a Mongoose-style CastError) for an id that cannot be read. */
export function castError(path, value) {
  const error = new Error(`Cast to UUID failed for value "${value}" (type ${typeof value}) at path "${path}"`);
  error.name = 'CastError';
  error.kind = 'UUID';
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

/** An id held in a field of a record (a link to another record): the id as lower-case text, or { problem } worded as Mongoose words a failed cast. */
export function castIdField(value, path) {
  if (value === undefined || value === null) return { value };
  const id = parseId(value);
  if (id === undefined) return { problem: castFailureMessage('UUID', path, value) };
  return { value: id };
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

/** Mongoose's Date cast: dates, numbers and date text become a date; empty text becomes null; anything else cannot. */
export function castDate(value, path) {
  if (value === undefined || value === null) return { value };
  if (value === '') return { value: null };
  let date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'number') date = new Date(value);
  else if (typeof value === 'string') date = new Date(!Number.isNaN(Number(value)) && (Number(value) >= 275761 || Number(value) < 0) ? Number(value) : value);
  else date = new Date(NaN);
  return Number.isNaN(date.getTime()) ? { problem: castFailureMessage('date', path, value) } : { value: date };
}

// ---------------------------------------------------------------------------------------------- explicit nulls

/**
 * MongoDB told a field saved as an explicit `null` from one that was never set; an empty column cannot. Each table has a
 * `nullFields` column listing the paths saved as an explicit null.
 */
export const nullSet = (row) => new Set(Array.isArray(row && row.nullFields) ? row.nullFields : []);

/** The new `nullFields` value for a Prisma write: the current list plus the paths in `add`, minus those in `remove`. */
export function nextNulls(current, { add = [], remove = [] } = {}) {
  const list = [...new Set([...(Array.isArray(current) ? current : []), ...add])].filter((path) => add.includes(path) || !remove.includes(path)).sort();
  return list.length ? list : Prisma.DbNull;
}
