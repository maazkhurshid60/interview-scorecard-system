import { prisma } from './client.js';
import { compareBytes, dateParam, idOut, jsonOut, jsonParam, newId, nullSet } from './helpers.js';
import { nullsExpr } from './records.js';

/**
 * Everything the app needs from the database about settings, on PostgreSQL. It offers exactly the functions of
 * ../mongo/settingRepository.js and answers the same way. A setting's value is JSON, so it is written with raw SQL as
 * text (Prisma would round numbers that need 17 digits) and read back as text.
 */

const COLUMNS = `id, "key", "value"::text AS "valueText", description, "updatedAt", "nullFields"`;

/** A settings row as the app has always seen it. An empty value or description is left out, as MongoDB left it out. */
const toSetting = (row) => {
  const nulls = nullSet(row);
  const stored = jsonOut(row.valueText);
  const value = stored === undefined && nulls.has('value') ? null : stored;
  return {
    _id: idOut(row.id),
    key: row.key,
    ...(value !== undefined ? { value } : {}),
    ...(row.description !== null && row.description !== undefined ? { description: row.description } : (nulls.has('description') ? { description: null } : {})),
    updatedAt: row.updatedAt,
  };
};

/** Every setting, sorted by key (byte order, as MongoDB sorts). */
export async function listAll() {
  const rows = await prisma.$queryRawUnsafe(`SELECT ${COLUMNS} FROM settings`);
  return rows.sort((a, b) => compareBytes(a.key, b.key)).map(toSetting);
}

/** One setting by key, or null. */
export async function findByKey(key) {
  const rows = await prisma.$queryRawUnsafe(`SELECT ${COLUMNS} FROM settings WHERE "key" = $1`, String(key));
  return rows.length ? toSetting(rows[0]) : null;
}

/** The value stored under `key`, or `fallback` when there is no such setting (or its value is empty). */
export async function getValue(key, fallback) {
  const setting = await findByKey(key);
  return setting?.value ?? fallback;
}

/** The values of several settings in one round trip, as `{ key: value }`. Keys that do not exist are left out. */
export async function getValues(keys) {
  const rows = await prisma.$queryRawUnsafe(`SELECT ${COLUMNS} FROM settings WHERE "key" = ANY($1::text[])`, keys.map(String));
  const values = {};
  rows.forEach((row) => { values[row.key] = toSetting(row).value; });
  return values;
}

/**
 * Sets the value of an existing setting.
 * @returns {Promise<{oldValue: any, setting: object} | null>} the previous value and the updated setting, or null
 *   when there is no setting with that key.
 */
export async function updateValue(key, value) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe(`SELECT ${COLUMNS} FROM settings WHERE "key" = $1 FOR UPDATE`, String(key));
    if (!rows.length) return null;
    const oldValue = toSetting(rows[0]).value;
    await tx.$executeRawUnsafe(`UPDATE settings SET "value" = $2::jsonb, "updatedAt" = $3::text::timestamp, "nullFields" = ${nullsExpr(value === null ? { add: ['value'] } : { remove: ['value'] })} WHERE id = $1::uuid`, rows[0].id, value === null ? null : jsonParam(value), dateParam(new Date()));
    const [updated] = await tx.$queryRawUnsafe(`SELECT ${COLUMNS} FROM settings WHERE id = $1::uuid`, rows[0].id);
    return { oldValue, setting: toSetting(updated) };
  });
}

/** Creates the setting if it does not exist yet; an existing one is left untouched. */
export async function createIfMissing(key, value, description) {
  // the WHERE NOT EXISTS leaves an existing setting alone (the seed runs at every start); ON CONFLICT covers two callers at once
  await prisma.$executeRawUnsafe(
    `INSERT INTO settings (id, "key", "value", description, "updatedAt", "nullFields") SELECT $1::uuid, $2::text, $3::jsonb, $4::text, $5::text::timestamp, $6::jsonb WHERE NOT EXISTS (SELECT 1 FROM settings WHERE "key" = $2::text) ON CONFLICT ("key") DO NOTHING`,
    newId(), String(key), value === null ? null : jsonParam(value), description === undefined || description === null ? null : description, dateParam(new Date()),
    (value === null || description === null) ? JSON.stringify([...(description === null ? ['description'] : []), ...(value === null ? ['value'] : [])].sort()) : null,
  );
  return findByKey(key);
}

/**
 * Runs `change` on the current value of a setting while no one else can change it, creating the setting (with an empty
 * value) first if it is missing. `change` returns the new value, or throws, in which case nothing is written.
 */
async function changeLocked(key, change) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`INSERT INTO settings (id, "key", "updatedAt") SELECT $1::uuid, $2::text, $3::text::timestamp WHERE NOT EXISTS (SELECT 1 FROM settings WHERE "key" = $2::text) ON CONFLICT ("key") DO NOTHING`, newId(), String(key), dateParam(new Date()));
    const [row] = await tx.$queryRawUnsafe(`SELECT ${COLUMNS} FROM settings WHERE "key" = $1 FOR UPDATE`, String(key));
    const next = change(jsonOut(row.valueText), row.id);
    await tx.$executeRawUnsafe(`UPDATE settings SET "value" = $2::jsonb, "updatedAt" = $3::text::timestamp, "nullFields" = ${nullsExpr({ remove: ['value'] })} WHERE id = $1::uuid`, row.id, jsonParam(next), dateParam(new Date()));
  });
}

/** The error MongoDB gives when an update does not fit what is stored. */
const mongoError = (message, code) => Object.assign(new Error(`Plan executor error during findAndModify :: caused by :: ${message}`), { name: 'MongoServerError', code });

/** A value as MongoDB prints it inside an error message. */
const shown = (value) => {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(Number(value.toPrecision(15)));
  if (Array.isArray(value)) return value.length ? `[ ${value.map(shown).join(', ')} ]` : '[]';
  if (typeof value === 'object') { const keys = Object.keys(value); return keys.length ? `{ ${keys.map((k) => `${k}: ${shown(value[k])}`).join(', ')} }` : '{}'; }
  return String(value);
};

const bsonType = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'bool'
  : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'double') : 'object');

/** Adds `item` to the list stored under `key` unless it is already there (creating the setting if needed). */
export async function addToList(key, item) {
  await changeLocked(key, (current) => {
    if (current === undefined) return [item];
    if (!Array.isArray(current)) throw mongoError(`Cannot apply $addToSet to non-array field. Field named 'value' has non-array type ${bsonType(current)}`, 2);
    return current.some((existing) => JSON.stringify(existing) === JSON.stringify(item)) ? current : [...current, item];
  });
}

/** Atomically adds `amount` to one entry of the object stored under `key` (creating the setting and entry if needed). */
export async function incrementEntry(key, entry, amount) {
  const add = Number(amount);
  await changeLocked(key, (current, rowId) => {
    if (current === undefined) return { [entry]: add };
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      throw mongoError(`Cannot create field '${entry}' in element {value: ${shown(current)}}`, 28);
    }
    if (current[entry] === undefined) return { ...current, [entry]: add };
    if (typeof current[entry] !== 'number') throw mongoError(`Cannot apply $inc to a value of non-numeric type. {_id: ${rowId}} has the field '${entry}' of non-numeric type ${bsonType(current[entry])}`, 14);
    return { ...current, [entry]: current[entry] + add }; // added here, as doubles, so the sum is the one MongoDB would have stored
  });
}
