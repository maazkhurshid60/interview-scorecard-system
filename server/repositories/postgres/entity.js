import { isDeepStrictEqual } from 'node:util';
import { assign, findDoc, writeChanges } from './records.js';

/**
 * The PostgreSQL side of ../mongo/entity.js: records that business code loads, changes in memory and then saves
 * (applications, interviews, job openings, scorecards). A repository hands them out with a hidden snapshot of how they
 * looked when loaded (`track`); `saveEntity` writes only the fields that changed since, and brings the object up to date.
 */

const SNAPSHOT = Symbol('snapshot');
/** Fields a save never writes: the id, and the dates the database manages itself. */
const NEVER_WRITTEN = new Set(['_id', '__v', 'createdAt', 'updatedAt']);

/** Remembers how a record looked when it was loaded. Works on one record or a list of them; null passes through. */
export function track(value) {
  if (Array.isArray(value)) {
    value.forEach(track);
    return value;
  }
  if (value && typeof value === 'object') {
    Object.defineProperty(value, SNAPSHOT, { value: structuredClone(value), writable: true, enumerable: false, configurable: true });
  }
  return value;
}

/** A filled-in related record (for example an application's `candidateId` loaded as `{ _id, name }`), as opposed to a plain id. */
const isFilledIn = (before, after) => before && typeof before === 'object' && !(before instanceof Date) && typeof after === 'string';

/**
 * Saves the changes made to a tracked record and brings it up to date.
 * @param {object} model the model description (see records.js)
 * @param {object} entity a record loaded through a repository
 * @returns {Promise<object>} the same object, now matching what was stored
 */
export async function saveEntity(model, entity) {
  const current = await findDoc(model, entity._id);
  if (!current) throw new Error(`${model.name} ${entity._id} no longer exists, so it cannot be saved.`);

  // What to compare against: how the record looked when it was loaded (a record not loaded through a repository has no
  // snapshot, so it is compared with what is stored now).
  const before = entity[SNAPSHOT] || current;
  const changes = {};
  for (const [key, value] of Object.entries(entity)) {
    if (NEVER_WRITTEN.has(key)) continue;
    if (!isDeepStrictEqual(value, before[key])) changes[key] = value;
  }
  const saved = Object.keys(changes).length ? await writeChanges(model, current, assign(model, current, changes)) : current;

  for (const key of Object.keys(entity)) {
    if (!(key in saved) && !NEVER_WRITTEN.has(key)) delete entity[key]; // a field that is no longer stored (or never was)
  }
  for (const [key, value] of Object.entries(saved)) {
    if (!isFilledIn(entity[key], value)) entity[key] = value; // keep a filled-in related record as it is
  }
  return track(entity);
}
