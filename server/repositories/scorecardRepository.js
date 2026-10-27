import Scorecard from '../models/Scorecard.js';
import { plain } from './plain.js';
import { track, saveEntity } from './entity.js';

/**
 * Everything the app needs from the database about scorecards: the rubric (stages and the attributes scored in
 * each) of one job opening. Only this file (and the model) knows where they live.
 *
 * A scorecard comes back as a tracked record: change it in memory, then call `save(scorecard)`.
 */

const full = (value) => track(plain(value));

/** One scorecard, or null when there is none with that id. */
export async function findById(id) {
  return full(await Scorecard.findById(id));
}

/** The scorecard of one job opening, or null. */
export async function findByRequisition(requisitionId) {
  return full(await Scorecard.findOne({ requisitionId }));
}

/** Creates a scorecard and returns it. */
export async function create(data) {
  return full(await Scorecard.create(data));
}

/** Saves the changes made to a scorecard that was loaded through this repository (see `entity.js`). */
export async function save(scorecard) {
  return saveEntity(Scorecard, scorecard);
}

/** Deletes one scorecard. */
export async function remove(id) {
  await Scorecard.findByIdAndDelete(id);
}

/** Deletes every scorecard of one job opening. */
export async function removeByRequisition(requisitionId) {
  await Scorecard.deleteMany({ requisitionId });
}
