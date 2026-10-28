import { isDeepStrictEqual } from 'node:util';
import { prisma } from './client.js';
import { castBoolean, castDate, castFailureMessage, castIdField, castNumber, castString, jsonParam, newId, sameJson, translateError, validationError } from './helpers.js';

/**
 * The shared engine of the PostgreSQL repositories that handle whole records (candidates, applications, interviews, job
 * openings, scorecards). It does what Mongoose did for the MongoDB versions, from a short description of each model:
 *
 *   - turns a stored row into the record the app has always seen (nested objects, lists, defaults, dates), and back;
 *   - checks and converts the values the app hands over, with Mongoose's own wording for what is wrong;
 *   - works out which stored columns really changed, so nothing is written (and `updatedAt` stays) when nothing did.
 *
 * Rows are read as text (`to_jsonb(row)::text`) and written with `jsonb_populate_record`, because Prisma's own reading
 * and writing rounds numbers that need 17 digits; this way every number comes back exactly as it went in.
 *
 * Describing a model (see `F` below):
 *   fields: { name: F.string({ required: true, col: 'name' }), ... }
 * A field is stored in one column (`col`). A nested group (`F.nested`) either keeps each of its fields in a column of its
 * own, or is kept whole in one JSON column (`json: true`). Lists and sub-records (`F.array`, `F.subdoc`) are JSON.
 */

// ------------------------------------------------------------------------------------------------- describing a model

const field = (kind, options = {}) => ({ kind, ...options });
export const F = {
  string: (o) => field('string', o),
  number: (o) => field('number', o),
  boolean: (o) => field('boolean', o),
  date: (o) => field('date', o),
  id: (o) => field('id', o),
  mixed: (o) => field('mixed', o),
  /** A group of fields: each leaf has its own `col`, or give the group `col` and `json: true` to keep it whole. */
  nested: (fields, o) => field('nested', { fields, ...o }),
  /** One sub-record kept as JSON in `col`. */
  subdoc: (fields, o) => field('subdoc', { fields, ...o }),
  /** A list of sub-records kept as JSON in `col`; `ids: true` gives each an `_id`, as Mongoose does unless told not to. */
  array: (fields, o) => field('array', { fields, ...o }),
};

const hasValue = (value) => value !== null && value !== undefined;
/** Remembers which keys the caller gave (even as undefined): Mongoose reports problems in an order that depends on it. */
const PROVIDED = Symbol('provided');
/** Marks a changed record whose update time must move even if no stored value differs (Mongoose counts replacing a nested group as a change). */
const FORCE = Symbol('force');
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Prepares a model description: finds every stored column and the path of the field in it. */
export function defineModel({ name, table, fields, timestamps = 'both' }) {
  const columns = [];
  const walk = (specs, prefix) => {
    for (const [key, spec] of Object.entries(specs)) {
      const path = [...prefix, key];
      if (spec.kind === 'nested' && !spec.json) walk(spec.fields, path);
      else columns.push({ path, col: spec.col || key, spec });
    }
  };
  walk(fields, []);
  return { name, table, fields, timestamps, columns };
}

// -------------------------------------------------------------------------------------------------- small path helpers

const getPath = (object, path) => path.reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), object);
function setPath(object, path, value) {
  let at = object;
  for (const key of path.slice(0, -1)) { if (!isPlainObject(at[key])) at[key] = {}; at = at[key]; }
  at[path[path.length - 1]] = value;
}
const specAt = (model, path) => {
  let specs = model.fields; let spec;
  for (const key of path) {
    spec = specs && specs[key];
    if (!spec) return undefined;
    specs = spec.fields;
  }
  return spec;
};

// ---------------------------------------------------------------------------------------------- reading a stored row

/** Turns the text of a stored date (UTC, no zone mark) into a date. */
const toDate = (text) => new Date(`${text}Z`);

/** A JSON value stored for `spec`, with the dates inside it turned back into dates. */
function revive(spec, value) {
  if (value === null || value === undefined) return value;
  if (spec.kind === 'date') return typeof value === 'string' ? new Date(value) : value;
  if (spec.kind === 'array') return Array.isArray(value) ? value.map((item) => revive({ kind: 'subdoc', fields: spec.fields }, item)) : value;
  if (spec.kind === 'subdoc' || spec.kind === 'nested') {
    if (!isPlainObject(value)) return value;
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = spec.fields[key] ? revive(spec.fields[key], inner) : inner;
    return out;
  }
  return value;
}

/** The default of a field when nothing is stored (a function default is not run when reading). */
const defaultOf = (spec) => (spec.default === undefined || typeof spec.default === 'function' ? undefined : (Array.isArray(spec.default) ? [] : spec.default));

/** The leaf defaults of a nested group kept whole in one JSON column, or undefined when it has none. */
function groupDefaults(spec) {
  const out = {};
  for (const [key, inner] of Object.entries(spec.fields)) { const value = defaultOf(inner); if (value !== undefined) out[key] = value; }
  return Object.keys(out).length ? out : undefined;
}

/** The record the app sees for one stored row (parsed from `to_jsonb(row)`), with the defaults Mongoose fills in on loading. */
export function rowToDoc(model, row) {
  const doc = { _id: row.id };
  for (const { path, col, spec } of model.columns) {
    const stored = row[col];
    let value;
    if (stored === null || stored === undefined) value = spec.kind === 'nested' ? groupDefaults(spec) : defaultOf(spec);
    else if (spec.kind === 'date') value = toDate(stored);
    else value = spec.kind === 'nested' ? { ...groupDefaults(spec), ...revive(spec, stored) } : revive(spec, stored);
    if (value !== undefined) setPath(doc, path, value);
  }
  for (const [key, spec] of Object.entries(model.fields)) { // lists always exist, as Mongoose gives an empty list
    if (spec.kind === 'array' && doc[key] === undefined) doc[key] = [];
  }
  if (['both', 'createdOnly'].includes(model.timestamps)) doc.createdAt = toDate(row.createdAt);
  if (model.timestamps === 'both') doc.updatedAt = toDate(row.updatedAt);
  return doc;
}

/** Reads rows with SQL of your own over the table (named `t`), as records. */
export async function selectDocs(model, sql, params = []) {
  const rows = await prisma.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS j FROM "${model.table}" t ${sql}`, ...params);
  return rows.map((r) => rowToDoc(model, JSON.parse(r.j)));
}

/** Keeps only the named top-level fields (and `_id`), as a Mongoose `select` does. */
export function pick(doc, names) {
  const out = { _id: doc._id };
  for (const name of names) if (doc[name] !== undefined) out[name] = doc[name];
  return out;
}

export const selectNames = (select) => String(select || '').split(/\s+/).filter(Boolean);

// ------------------------------------------------------------------------------------- converting what the app hands over

/** Casts one value to what the field holds. Problems are added to `problems` as `{ path, message }` (casting problems come first). */
function castValue(spec, value, path, problems) {
  const here = path.join('.');
  const leaf = path[path.length - 1];
  const note = (message) => problems.cast.push({ path: here, message });
  switch (spec.kind) {
    case 'string': {
      const done = castString(value, leaf);
      if (done.problem) { note(done.problem); return undefined; }
      return spec.trim && typeof done.value === 'string' ? done.value.trim() : done.value;
    }
    case 'number': { const done = castNumber(value, leaf); if (done.problem) { note(done.problem); return undefined; } return done.value; }
    case 'boolean': { const done = castBoolean(value, leaf); if (done.problem) { note(done.problem); return undefined; } return done.value; }
    case 'date': { const done = castDate(value, leaf); if (done.problem) { note(done.problem); return undefined; } return done.value; }
    case 'id': { const done = castIdField(value, leaf); if (done.problem) { note(done.problem); return undefined; } return done.value; }
    case 'mixed': return value;
    case 'subdoc': case 'nested': {
      if (value === undefined || value === null) return value;
      if (!isPlainObject(value)) { note(`Cast to Embedded failed for value ${JSON.stringify(value)} (type ${typeof value}) at path "${leaf}"`); return undefined; }
      return castObject(spec, value, path, problems);
    }
    case 'array': {
      if (value === undefined || value === null) return value;
      const list = Array.isArray(value) ? value : [value];
      return list.map((item, i) => {
        if (!isPlainObject(item)) { problems.cast.push({ path: `${here}.${i}`, message: `Cast to Embedded failed for value ${JSON.stringify(item)} (type ${typeof item}) at path "${leaf}"` }); return undefined; }
        const out = castObject({ fields: spec.fields }, item, [...path, i], problems);
        if (spec.ids) out._id = hasValue(item._id) ? (castIdField(item._id, '_id').value || newId()) : newId();
        return out;
      });
    }
    default: return value;
  }
}

/** Casts the fields of an object (a sub-record or a group), fills in defaults, and drops what the model does not know. */
function castObject(spec, input, path, problems) {
  const out = {};
  Object.defineProperty(out, PROVIDED, { value: Object.keys(input), enumerable: false });
  for (const [key, inner] of Object.entries(spec.fields)) {
    let value = castValue(inner, input[key], [...path, key], problems);
    if (value === undefined && inner.kind === 'nested') { // a group shows its leaf defaults even when nothing was given (Mongoose does the same)
      const defaults = castObject(inner, {}, [...path, key], problems);
      if (Object.keys(defaults).length) value = defaults;
    }
    if (value === undefined && inner.default !== undefined) value = typeof inner.default === 'function' ? inner.default() : (Array.isArray(inner.default) ? [] : inner.default);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The checks a model puts on a (cast) value: required, allowed values, limits. Problems go to `problems.check`. */
function checkValue(spec, value, path, problems, { inSubdoc }) {
  const here = path.join('.');
  const leaf = path[path.length - 1];
  const add = (message) => problems.check.push({ path: here, message });
  if (spec.kind === 'subdoc' || spec.kind === 'nested') {
    if (hasValue(value)) checkFields(spec.fields, value, path, problems, { inSubdoc: spec.kind === 'subdoc' || inSubdoc });
    return;
  }
  if (spec.kind === 'array') {
    (value || []).forEach((item, i) => item && checkFields(spec.fields, item, [...path, i], problems, { inSubdoc: true }));
    return;
  }
  if (spec.required && (!hasValue(value) || value === '')) { add(`Path \`${leaf}\` is required.`); return; }
  if (!hasValue(value)) return;
  if (spec.enum && !spec.enum.includes(value)) add(`\`${value}\` is not a valid enum value for path \`${leaf}\`.`);
  else if (spec.min !== undefined && value < spec.min) add(`Path \`${leaf}\` (${value}) is less than minimum allowed value (${spec.min}).`);
  else if (spec.max !== undefined && value > spec.max) add(`Path \`${leaf}\` (${value}) is more than maximum allowed value (${spec.max}).`);
  else if (spec.minlength !== undefined && String(value).length < spec.minlength) add(`Path \`${leaf}\` (\`${value}\`) is shorter than the minimum allowed length (${spec.minlength}).`);
  else if (spec.validate && !spec.validate(value)) add(spec.message || `Validator failed for path \`${leaf}\` with value \`${value}\``);
}

function checkFields(fields, object, path, problems, options) {
  // Mongoose reports first what is missing and was not given (starting with the last field of the model), then each field
  // the caller gave, in the order they were given
  const given = object[PROVIDED] || Object.keys(fields);
  const missing = Object.keys(fields).filter((key) => !given.includes(key) && fields[key].required && (!hasValue(object[key]) || object[key] === ''));
  for (const key of missing.reverse()) problems.check.push({ path: [...path, key].join('.'), message: `Path \`${key}\` is required.` });
  for (const key of given) if (fields[key]) checkValue(fields[key], object[key], [...path, key], problems, options);
}

function raise(model, problems) {
  const cast = new Set(problems.cast.map((p) => p.path));
  const all = [...problems.cast, ...problems.check.filter((p) => !cast.has(p.path))]; // a value that could not be read is not also reported as missing
  if (!all.length) return;
  throw validationError(model.name, Object.fromEntries(all.map((p) => [p.path, p.message])));
}

/**
 * Builds a new record from what the app hands over: unknown fields dropped, values converted, defaults filled in, and the
 * model's checks applied. Throws the ValidationError Mongoose would throw.
 */
export function buildDoc(model, input = {}) {
  const problems = { cast: [], check: [] };
  const doc = castObject({ fields: model.fields }, input, [], problems);
  for (const [key, spec] of Object.entries(model.fields)) {
    if (spec.kind === 'array' && doc[key] === undefined) doc[key] = [];
    if (spec.kind === 'nested' && !spec.json) continue;
  }
  checkFields(model.fields, doc, [], problems, { inSubdoc: false });
  raise(model, problems);
  return doc;
}

/**
 * Applies changes (`{ field: value }`, a whole nested group replaces the old one) to a copy of a record, as Mongoose's
 * `set` does, and checks what was changed. Returns the changed record. Throws the ValidationError Mongoose would throw.
 */
export function assign(model, doc, changes) {
  const problems = { cast: [], check: [] };
  const next = structuredClone(doc);
  const touched = [];
  let forced = false;
  for (const [key, value] of Object.entries(changes)) {
    const path = key.split('.');
    const spec = specAt(model, path);
    if (!spec) continue; // not in the model: ignored, as Mongoose ignores it
    let cast;
    if (spec.kind === 'nested' || spec.kind === 'subdoc') {
      cast = castValue(spec, value, path, problems);
      if (spec.kind === 'nested' && isPlainObject(cast)) { // a replaced group: what is not given is gone
        removeGroup(model, next, path, spec);
        forced = true;
      }
    } else cast = castValue(spec, value, path, problems);
    if (cast === undefined && spec.default !== undefined && value === undefined) cast = typeof spec.default === 'function' ? spec.default() : spec.default;
    if (cast === null && getPath(doc, path) === undefined) forced = true; // saving an empty value where there was none still counts as a change
    if (cast === undefined) removePath(next, path); else setPath(next, path, cast);
    touched.push({ path, spec, value: cast });
  }
  const untouched = Object.keys(model.fields).filter((key) => model.fields[key].required && !touched.some((t) => t.path[0] === key)); // what must always be there, changed or not
  for (const key of untouched.reverse()) checkValue(model.fields[key], next[key], [key], problems, { inSubdoc: false });
  for (const { path, spec, value } of touched) checkValue(spec, value, path, problems, { inSubdoc: false });
  for (const [key, spec] of Object.entries(model.fields)) { // stored lists and sub-records are checked again on every save, as Mongoose does
    if ((spec.kind === 'array' || spec.kind === 'subdoc') && !touched.some((t) => t.path[0] === key)) checkValue(spec, next[key], [key], problems, { inSubdoc: false });
  }
  raise(model, problems);
  if (forced) Object.defineProperty(next, FORCE, { value: true, enumerable: false });
  return next;
}

function removePath(object, path) {
  const parent = getPath(object, path.slice(0, -1));
  if (parent && typeof parent === 'object') delete parent[path[path.length - 1]];
}
function removeGroup(model, object, path, spec) {
  void model; void spec;
  removePath(object, path);
}

// ------------------------------------------------------------------------------------------------ writing a stored row

/** The stored form of a field's value: dates as text, JSON as it is. */
const columnValue = (spec, value) => {
  if (!hasValue(value)) return null;
  if (spec.kind === 'date') return value instanceof Date ? value.toISOString() : value;
  return JSON.parse(JSON.stringify(value));
};

/** Every column of a record, as it would be stored. */
export function docToColumns(model, doc) {
  const out = {};
  for (const { path, col, spec } of model.columns) out[col] = columnValue(spec, getPath(doc, path));
  return out;
}

const sameColumn = (a, b) => sameJson(a, b);

/** Adds a new record to its table and returns it as the app sees it. */
export async function insertDoc(model, doc, { id = newId(), now = new Date(), client = prisma } = {}) {
  const row = { id, ...docToColumns(model, doc) };
  if (['both', 'createdOnly'].includes(model.timestamps)) row.createdAt = now.toISOString();
  if (model.timestamps === 'both') row.updatedAt = now.toISOString();
  try {
    await client.$executeRawUnsafe(`INSERT INTO "${model.table}" SELECT * FROM jsonb_populate_record(null::"${model.table}", $1::jsonb)`, JSON.stringify(row));
  } catch (error) {
    throw translateError(error, {}, uniqueFields(model));
  }
  return { ...doc, _id: id, ...(row.createdAt ? { createdAt: now } : {}), ...(row.updatedAt ? { updatedAt: now } : {}) };
}

/** The unique fields of a table, for naming them in a duplicate error (set `unique` on a model's description to use). */
const uniqueFields = (model) => model.unique;

/**
 * Writes the difference between a stored record and its changed version, if there is one (and bumps `updatedAt` then).
 * @returns {Promise<object>} the record as stored now
 */
export async function writeChanges(model, before, after, { now = new Date() } = {}) {
  const was = docToColumns(model, before); const is = docToColumns(model, after);
  const changed = Object.keys(is).filter((col) => !sameColumn(was[col], is[col]));
  if (!changed.length && !after[FORCE]) return after;
  const row = Object.fromEntries(changed.map((col) => [col, is[col]]));
  const sets = changed.map((col) => `"${col}" = r."${col}"`);
  if (!sets.length && model.timestamps !== 'both') return after;
  if (model.timestamps === 'both') { row.updatedAt = now.toISOString(); sets.push(`"updatedAt" = r."updatedAt"`); }
  try {
    await prisma.$executeRawUnsafe(`UPDATE "${model.table}" t SET ${sets.join(', ')} FROM jsonb_populate_record(null::"${model.table}", $2::jsonb) r WHERE t.id = $1`, before._id, JSON.stringify(row));
  } catch (error) {
    throw translateError(error, {}, uniqueFields(model));
  }
  return { ...after, ...(model.timestamps === 'both' ? { updatedAt: now } : {}) };
}

/** The record with this id, or null. */
export async function findDoc(model, id) {
  const [doc] = await selectDocs(model, 'WHERE t.id = $1', [id]);
  return doc || null;
}

/** Writes raw column changes straight to rows (for the atomic updates a repository does in one statement). `sets` is SQL with `$n` numbers from `first`. */
export async function rawUpdate(model, sets, where, params) {
  const bump = model.timestamps === 'both' ? `, "updatedAt" = $${params.length + 1}::text::timestamp` : '';
  return prisma.$executeRawUnsafe(`UPDATE "${model.table}" t SET ${sets}${bump} WHERE ${where}`, ...params, ...(bump ? [new Date().toISOString()] : []));
}

export { jsonParam, castFailureMessage, isDeepStrictEqual };
