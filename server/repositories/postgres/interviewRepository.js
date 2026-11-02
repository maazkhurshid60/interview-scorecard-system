import { prisma } from './client.js';
import { castId, idOut } from './helpers.js';
import { buildDoc, findDoc, findDocByPublicRef, insertDoc, pick, selectDocs } from './records.js';
import { saveEntity, track } from './entity.js';
import { Interview } from './schemas.js';

/**
 * Everything the app needs from the database about interviews, on PostgreSQL: one stage of one application, with its
 * meeting, transcript or artifact file, scores and status. It offers exactly the functions of
 * ../mongo/interviewRepository.js and answers the same way. A full interview comes back as a tracked record: change it
 * in memory, then call `save(interview)`.
 */

const full = (doc) => (doc ? track(doc) : doc);
const ids = (list, path) => list.map((id) => castId(id, path));

/** One interview, or null when there is none with that id. */
export async function findById(id) {
  return full(await findDoc(Interview, castId(id, '_id')));
}

/**
 * The interview a public availability link points at (a random token, or the old id of a link shared before the move), or
 * null. It comes back as a tracked record, like `findById`.
 */
export async function findByPublicRef(ref) {
  return full(await findDocByPublicRef(Interview, ref));
}

/** The interview of this application for this stage, or null. */
export async function findByApplicationAndStage(applicationId, stageKey) {
  const [doc] = await selectDocs(Interview, 'WHERE "applicationId" = $1::uuid AND "stageKey" = $2 ORDER BY id ASC LIMIT 1', [castId(applicationId, 'applicationId'), String(stageKey)]);
  return full(doc || null);
}

/** Every interview of one application. */
export async function listByApplication(applicationId) {
  return full(await selectDocs(Interview, 'WHERE "applicationId" = $1::uuid ORDER BY id ASC', [castId(applicationId, 'applicationId')]));
}

/** The interviews of one application for these stages. */
export async function listByApplicationAndStages(applicationId, stageKeys) {
  return full(await selectDocs(Interview, 'WHERE "applicationId" = $1::uuid AND "stageKey" = ANY($2::text[]) ORDER BY id ASC', [castId(applicationId, 'applicationId'), stageKeys.map(String)]));
}

/** Every interview of one job opening. */
export async function listByRequisition(requisitionId) {
  return full(await selectDocs(Interview, 'WHERE "requisitionId" = $1::uuid ORDER BY id ASC', [castId(requisitionId, 'requisitionId')]));
}

/**
 * Interviews as short summaries (`_id`, application, stage, status, stage average), narrowed by any of: one
 * application, several applications, one job opening.
 */
export async function listSummaries({ applicationId, applicationIds, requisitionId } = {}) {
  const conditions = []; const params = [];
  if (applicationId && !applicationIds) { params.push(castId(applicationId, 'applicationId')); conditions.push(`"applicationId" = $${params.length}::uuid`); }
  if (requisitionId) { params.push(castId(requisitionId, 'requisitionId')); conditions.push(`"requisitionId" = $${params.length}::uuid`); }
  if (applicationIds) { params.push(ids(applicationIds, 'applicationId')); conditions.push(`"applicationId" = ANY($${params.length}::uuid[])`); }
  const docs = await selectDocs(Interview, `${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY id ASC`, params);
  return docs.map((doc) => pick(doc, ['applicationId', 'stageKey', 'status', 'stageAverage']));
}

/** Just the stored artifact file id, meeting event id and provider of each interview of one application. */
export async function listFileAndMeetingInfo(applicationId) {
  const docs = await selectDocs(Interview, 'WHERE "applicationId" = $1::uuid ORDER BY id ASC', [castId(applicationId, 'applicationId')]);
  return docs.map((doc) => pick(doc, ['artifactFilePublicId', 'calendarEventId', 'provider']));
}

/** Just the stored artifact file id of each interview of these applications. */
export async function listArtifactFileIds(applicationIds) {
  const docs = await selectDocs(Interview, 'WHERE "applicationId" = ANY($1::uuid[]) ORDER BY id ASC', [ids(applicationIds, 'applicationId')]);
  return docs.map((doc) => pick(doc, ['artifactFilePublicId']));
}

/** True when some interview still uses the stored file with this public id. */
export async function isArtifactFileInUse(publicId) {
  return (await prisma.interview.count({ where: { artifactFilePublicId: String(publicId) } })) > 0;
}

/** The stored artifact file fields of one interview (url, public id, name, size, type), or null. */
export async function findArtifactFile(id) {
  const doc = await findDoc(Interview, castId(id, '_id'));
  return doc ? pick(doc, ['artifactFileUrl', 'artifactFilePublicId', 'artifactFileName', 'artifactFileSize', 'artifactFileMimeType']) : null;
}

/**
 * Adds up numbers the way MongoDB's `$sum` does: exactly, then rounded once (not one addition at a time, which can drift
 * in the last digit). This is Shewchuk's exact summation.
 */
function exactSum(values) {
  const partials = [];
  for (let x of values) {
    let i = 0;
    for (let j = 0; j < partials.length; j += 1) {
      let y = partials[j];
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const high = x + y;
      const low = y - (high - x);
      if (low) partials[i++] = low;
      x = high;
    }
    partials.length = i;
    partials.push(x);
  }
  let total = 0;
  for (let i = partials.length - 1; i >= 0; i -= 1) total += partials[i];
  return total;
}

/** What the AI scoring cost, grouped by job opening, stage and month: `[{ _id: { requisitionId, stageKey, month }, ... }]`. */
export async function summarizeAiCost() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "requisitionId", "stageKey", to_char("updatedAt", 'YYYY-MM') AS month, "aiCostUsd"::text AS cost, "aiInputTokens"::text AS input, "aiOutputTokens"::text AS output
     FROM interviews WHERE "aiCostUsd" IS NOT NULL ORDER BY id ASC`);
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.requisitionId}|${row.stageKey}|${row.month}`;
    if (!groups.has(key)) groups.set(key, { _id: { requisitionId: idOut(row.requisitionId), stageKey: row.stageKey, month: row.month }, costs: [], inputs: [], outputs: [], count: 0 });
    const group = groups.get(key);
    group.costs.push(Number(row.cost));
    if (row.input !== null) group.inputs.push(Number(row.input));
    if (row.output !== null) group.outputs.push(Number(row.output));
    group.count += 1;
  }
  return [...groups.values()]
    .map((g) => ({ _id: g._id, totalCostUsd: exactSum(g.costs), totalInputTokens: exactSum(g.inputs), totalOutputTokens: exactSum(g.outputs), interviewCount: g.count }))
    .sort((a, b) => (a._id.month < b._id.month ? 1 : a._id.month > b._id.month ? -1 : 0));
}

/** Creates an interview and returns it. */
export async function create(data = {}) {
  return full(await insertDoc(Interview, buildDoc(Interview, data)));
}

/** Saves the changes made to an interview that was loaded through this repository (see `entity.js`). */
export async function save(interview) {
  return saveEntity(Interview, interview);
}

/** Deletes every interview of one application and returns how many were deleted. */
export async function removeByApplication(applicationId) {
  return (await prisma.interview.deleteMany({ where: { applicationId: castId(applicationId, 'applicationId') } })).count;
}

/** Deletes every interview of these applications and returns how many were deleted. */
export async function removeByApplications(applicationIds) {
  return (await prisma.interview.deleteMany({ where: { applicationId: { in: ids(applicationIds, 'applicationId') } } })).count;
}

/** Deletes every interview of one job opening and returns how many were deleted. */
export async function removeByRequisition(requisitionId) {
  return (await prisma.interview.deleteMany({ where: { requisitionId: castId(requisitionId, 'requisitionId') } })).count;
}
