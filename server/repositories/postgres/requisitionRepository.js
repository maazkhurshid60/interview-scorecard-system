import { prisma } from './client.js';
import { castDate, castId, castIdField, compareBytes, compareIds, escapeLike, idOut } from './helpers.js';
import { buildDoc, findDoc, findDocByPublicRef, insertDoc, nullsExpr, pick, selectDocs, selectNames } from './records.js';
import { saveEntity, track } from './entity.js';
import { Requisition } from './schemas.js';

/**
 * Everything the app needs from the database about job openings (requisitions), on PostgreSQL: the role, its hiring
 * stages and thresholds, screening criteria and status. It offers exactly the functions of
 * ../mongo/requisitionRepository.js and answers the same way. A job opening comes back as a tracked record: change it in
 * memory, then call `save(requisition)`.
 */

const full = (doc) => (doc ? track(doc) : doc);
const queryIds = (ids, path = '_id') => ids.map((id) => castId(id, path));

/** Puts the department (just the fields in `select`) in place of the id on `departmentId`; null when it no longer exists. */
async function fillInDepartments(requisitions, select) {
  const names = selectNames(select);
  const wanted = [...new Set(requisitions.map((r) => r.departmentId).filter((id) => typeof id === 'string'))];
  const rows = wanted.length ? await prisma.department.findMany({ where: { id: { in: wanted } } }) : [];
  const byId = new Map(rows.map((row) => [idOut(row.id), pick({ _id: idOut(row.id), name: row.name, description: row.description }, names)]));
  for (const requisition of requisitions) {
    if (typeof requisition.departmentId === 'string') {
      const department = byId.get(requisition.departmentId);
      requisition.departmentId = department || null;
    }
  }
  return requisitions;
}

/** One job opening, or null when there is none with that id. */
export async function findById(id) {
  return full(await findDoc(Requisition, castId(id, '_id')));
}

/** One job opening with its department's name and description filled in on `departmentId`, or null. */
export async function findByIdWithDepartment(id) {
  const requisition = await findDoc(Requisition, castId(id, '_id'));
  if (!requisition) return null;
  await fillInDepartments([requisition], 'name description');
  return full(requisition);
}

/** Just the given fields (a space-separated list, like `'title status'`) of one job opening, or null. */
export async function findFields(id, fields) {
  const requisition = await findDoc(Requisition, castId(id, '_id'));
  return requisition ? full(pick(requisition, selectNames(fields))) : null;
}

const PUBLIC_FIELDS = 'title employmentType fullTimeDetails partTimeDetails contractDetails internshipDetails temporaryDetails location workplaceType officeLocation remoteRegion jobDescription initialScreeningCriteria questionnaire applicationDeadline aiScreeningEnabled status createdAt interviewAvailability';

/**
 * The public view of the job opening a public link points at (a random token, or the old id of a link shared before the
 * move): the fields a candidate may see on the application page, or null.
 */
export async function findPublicView(ref) {
  const requisition = await findDocByPublicRef(Requisition, ref);
  return requisition ? pick(requisition, selectNames(PUBLIC_FIELDS)) : null;
}

/** The job opening a public link points at (see `findPublicView`), as a tracked record like `findById`, or null. */
export async function findByPublicRef(ref) {
  return full(await findDocByPublicRef(Requisition, ref));
}

/** The title and status of each of these job openings (those that exist). */
export async function listTitlesAndStatuses(ids) {
  const docs = await selectDocs(Requisition, 'WHERE id = ANY($1::uuid[]) ORDER BY id ASC', [queryIds(ids)]);
  return docs.map((doc) => pick(doc, ['title', 'status']));
}

/** The title of each of these job openings (those that exist), sorted by title. */
export async function listTitles(ids) {
  const docs = await selectDocs(Requisition, 'WHERE id = ANY($1::uuid[])', [queryIds(ids)]);
  return docs.sort((a, b) => compareBytes(a.title, b.title) || compareIds(a._id, b._id)).map((doc) => pick(doc, ['title']));
}

/** The title and hiring stages of each of these job openings (those that exist). */
export async function findTitlesAndStages(ids) {
  const docs = await selectDocs(Requisition, 'WHERE id = ANY($1::uuid[]) ORDER BY id ASC', [queryIds(ids)]);
  return docs.map((doc) => pick(doc, ['title', 'stages']));
}

/**
 * An open job opening with the same title (ignoring upper/lower case), as `{ _id, title }`, or null. Pass `exceptId`
 * to leave one job opening out, for example the one being edited.
 */
export async function findOpenByTitle(title, { exceptId } = {}) {
  const params = [escapeLike(title)];
  if (exceptId) params.push(castId(exceptId, '_id'));
  const [doc] = await selectDocs(Requisition, `WHERE title ILIKE $1 ESCAPE '\\' AND status = 'open'${exceptId ? ' AND id <> $2::uuid' : ''} ORDER BY id ASC LIMIT 1`, params);
  return doc ? pick(doc, ['title']) : null;
}

/**
 * Every job opening, newest first, each with its department's name filled in on `departmentId`. Narrow it by
 * `status` (asking for 'paused' also returns the legacy 'on_hold' ones) and/or `departmentId`.
 */
export async function list({ status, departmentId } = {}) {
  const conditions = []; const params = [];
  if (status) { params.push(status === 'paused' ? ['paused', 'on_hold'] : [status]); conditions.push(`status::text = ANY($${params.length}::text[])`); }
  if (departmentId) { params.push(castId(departmentId, 'departmentId')); conditions.push(`"departmentId" = $${params.length}::uuid`); }
  const requisitions = await selectDocs(Requisition, `${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY "createdAt" DESC, id DESC`, params);
  return fillInDepartments(requisitions, 'name');
}

/** Every closed job opening that was closed on or before this date. */
export async function listClosedBefore(cutoff) {
  const done = castDate(cutoff, 'closedAt');
  if (done.problem) throw Object.assign(new Error(done.problem), { name: 'CastError', kind: 'date', path: 'closedAt', value: cutoff });
  const docs = await selectDocs(Requisition, `WHERE status = 'closed' AND "closedAt" <= $1::text::timestamp ORDER BY id ASC`, [done.value.toISOString()]);
  return full(docs);
}

/** Creates a job opening and returns it. */
export async function create(data = {}) {
  return full(await insertDoc(Requisition, buildDoc(Requisition, data)));
}

/** Saves the changes made to a job opening that was loaded through this repository (see `entity.js`). */
export async function save(requisition) {
  return saveEntity(Requisition, requisition);
}

/** Points a job opening at its scorecard. */
export async function setScorecard(id, scorecardId) {
  const requisitionId = castId(id, '_id');
  const target = castIdField(scorecardId, 'scorecardId');
  if (target.problem) throw Object.assign(new Error(target.problem), { name: 'CastError', kind: 'Number', path: 'scorecardId', value: scorecardId });
  const empty = target.value === null || target.value === undefined;
  await prisma.$executeRawUnsafe(`UPDATE requisitions SET "scorecardId" = $2::uuid, "updatedAt" = $3::text::timestamp, "nullFields" = ${nullsExpr(empty ? { add: ['scorecardId'] } : { remove: ['scorecardId'] })} WHERE id = $1::uuid`, requisitionId, empty ? null : target.value, new Date().toISOString());
}

/** Deletes one job opening (and, with it, its applications, interviews and scorecards, which PostgreSQL removes by itself). */
export async function remove(id) {
  await prisma.requisition.deleteMany({ where: { id: castId(id, '_id') } });
}
