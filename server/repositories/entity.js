import { isDeepStrictEqual } from 'node:util';
import { plain } from './plain.js';

/**
 * Support for the records that business code loads, changes in memory and then saves (applications, interviews,
 * job openings, scorecards).
 *
 * A repository hands these out as plain objects with a hidden snapshot of what they looked like when loaded
 * (`track`). Calling the repository's `save(entity)` then writes only the fields that changed since that snapshot,
 * which is how a Mongoose document behaves too, so two people changing different fields of the same record do not
 * overwrite each other. After saving, the object you passed is brought up to date with what was stored, so it can
 * keep being used (and sent to a client) afterwards.
 */

const SNAPSHOT = Symbol('snapshot');
/** Fields a save never writes: the id, and the dates Mongoose manages itself. */
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
 * @param {import('mongoose').Model} Model
 * @param {object} entity a record loaded through a repository
 * @returns {Promise<object>} the same object, now matching what was stored
 */
export async function saveEntity(Model, entity) {
  const document = await Model.findById(entity._id);
  if (!document) throw new Error(`${Model.modelName} ${entity._id} no longer exists, so it cannot be saved.`);

  // What to compare against: how the record looked when it was loaded. (A record that was not loaded through a
  // repository has no snapshot, so it is compared with what is stored now.)
  const before = entity[SNAPSHOT] || plain(document);
  for (const [key, value] of Object.entries(entity)) {
    if (NEVER_WRITTEN.has(key)) continue;
    if (!isDeepStrictEqual(value, before[key])) document.set(key, value);
  }
  await document.save();

  const saved = plain(document);
  for (const key of Object.keys(entity)) {
    if (!(key in saved) && !NEVER_WRITTEN.has(key)) delete entity[key]; // a field that is no longer stored (or never was)
  }
  for (const [key, value] of Object.entries(saved)) {
    if (!isFilledIn(entity[key], value)) entity[key] = value; // keep a filled-in related record as it is
  }
  return track(entity);
}
