import { prisma } from './client.js';
import { castId } from './helpers.js';
import { buildDoc, findDoc, insertDoc, selectDocs } from './records.js';
import { saveEntity, track } from './entity.js';
import { Scorecard } from './schemas.js';

/**
 * Everything the app needs from the database about scorecards, on PostgreSQL: the rubric (stages and the attributes
 * scored in each) of one job opening. It offers exactly the functions of ../mongo/scorecardRepository.js and answers the
 * same way. A scorecard comes back as a tracked record: change it in memory, then call `save(scorecard)`.
 */

/** One scorecard, or null when there is none with that id. */
export async function findById(id) {
  return track(await findDoc(Scorecard, castId(id, '_id')));
}

/** The scorecard of one job opening, or null. */
export async function findByRequisition(requisitionId) {
  const [doc] = await selectDocs(Scorecard, 'WHERE "requisitionId" = $1 ORDER BY id ASC LIMIT 1', [castId(requisitionId, 'requisitionId')]);
  return track(doc || null);
}

/** Creates a scorecard and returns it. */
export async function create(data = {}) {
  return track(await insertDoc(Scorecard, buildDoc(Scorecard, data)));
}

/** Saves the changes made to a scorecard that was loaded through this repository (see `entity.js`). */
export async function save(scorecard) {
  return saveEntity(Scorecard, scorecard);
}

/** Deletes one scorecard. */
export async function remove(id) {
  await prisma.scorecard.deleteMany({ where: { id: castId(id, '_id') } });
}

/** Deletes every scorecard of one job opening. */
export async function removeByRequisition(requisitionId) {
  await prisma.scorecard.deleteMany({ where: { requisitionId: castId(requisitionId, 'requisitionId') } });
}
