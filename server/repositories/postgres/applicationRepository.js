import { REVIEW_WAITING } from '../../utils/constants.js';
import { prisma } from './client.js';
import { castDate, castId, castNumber, idOut, parseId } from './helpers.js';
import { assign, buildDoc, findDoc, insertDoc, nullsExpr, pick, selectDocs, selectNames, writeChanges } from './records.js';
import { Application, Candidate } from './schemas.js';
import { saveEntity, track } from './entity.js';

/**
 * Everything the app needs from the database about job applications, on PostgreSQL: one candidate applying to one job
 * opening, with its stage progress, scores, decision and screening state. It offers exactly the functions of
 * ../mongo/applicationRepository.js and answers the same way.
 */


const full = (doc) => (doc ? track(doc) : doc);

/** An id as lower-case text (the error it gives for a bad one is not a CastError, as before). */
function objectId(value) {
  const id = parseId(value);
  if (id === undefined) throw Object.assign(new Error('An id must be a UUID'), { name: 'BSONError' });
  return id;
}

const ids = (list, path) => list.map((id) => castId(id, path));

/** Puts the candidate (just the fields in `select`, or all of them) in place of the id on `candidateId`; null when it no longer exists. */
async function fillInCandidates(applications, select) {
  const names = selectNames(select);
  const wanted = [...new Set(applications.map((a) => a.candidateId).filter((id) => typeof id === 'string'))];
  const candidates = wanted.length ? await selectDocs(Candidate, 'WHERE id = ANY($1::uuid[])', [wanted]) : [];
  const byId = new Map(candidates.map((candidate) => [candidate._id, names.length ? pick(candidate, names) : candidate]));
  for (const application of applications) {
    if (typeof application.candidateId === 'string') application.candidateId = byId.get(application.candidateId) || null;
  }
  return applications;
}

/**
 * One application, or null when there is none with that id. It comes back as a tracked record: change it in memory,
 * then call `save(application)` (see `entity.js`).
 */
export async function findById(id) {
  return full(await findDoc(Application, castId(id, '_id')));
}

/** Like `findById`, with the candidate filled in on `candidateId` (just the fields named in `select`, like `'name email'`; all of them when left out). */
export async function findByIdWithCandidate(id, select) {
  const application = await findDoc(Application, castId(id, '_id'));
  if (!application) return null;
  await fillInCandidates([application], select);
  return full(application);
}

/** The application of this candidate to this job opening, or null. */
export async function findByCandidateAndRequisition(candidateId, requisitionId) {
  const [doc] = await selectDocs(Application, 'WHERE "candidateId" = $1::uuid AND "requisitionId" = $2::uuid ORDER BY id ASC LIMIT 1', [castId(candidateId, 'candidateId'), castId(requisitionId, 'requisitionId')]);
  return full(doc || null);
}

/** For each of these candidates, every application with just the fields a list needs (job, stage, disposition). */
export async function listSummariesForCandidates(candidateIds) {
  const docs = await selectDocs(Application, 'WHERE "candidateId" = ANY($1::uuid[]) ORDER BY id ASC', [ids(candidateIds, 'candidateId')]);
  return docs.map((doc) => pick(doc, ['candidateId', 'requisitionId', 'currentStageKey', 'disposition']));
}

/** The ids of every candidate who has applied to this job opening. */
export async function listCandidateIdsForRequisition(requisitionId) {
  const rows = await prisma.$queryRawUnsafe('SELECT DISTINCT "candidateId" FROM applications WHERE "requisitionId" = $1::uuid ORDER BY "candidateId" ASC', castId(requisitionId, 'requisitionId'));
  return rows.map((row) => idOut(row.candidateId));
}

/** The ids of every job opening that has at least one application. */
export async function listRequisitionIdsWithApplications() {
  const rows = await prisma.$queryRawUnsafe('SELECT DISTINCT "requisitionId" FROM applications ORDER BY "requisitionId" ASC');
  return rows.map((row) => idOut(row.requisitionId));
}

/** Of these candidates, the ids of those already attached to this job opening. */
export async function listAttachedCandidateIds(candidateIds, requisitionId) {
  const rows = await prisma.$queryRawUnsafe('SELECT "candidateId" FROM applications WHERE "candidateId" = ANY($1::uuid[]) AND "requisitionId" = $2::uuid ORDER BY id ASC', ids(candidateIds, 'candidateId'), castId(requisitionId, 'requisitionId'));
  return rows.map((row) => idOut(row.candidateId));
}

/** The id and offer-letter file (if any) of every application of one candidate. */
export async function listOfferLettersForCandidate(candidateId) {
  const docs = await selectDocs(Application, 'WHERE "candidateId" = $1::uuid ORDER BY id ASC', [castId(candidateId, 'candidateId')]);
  return docs.map((doc) => pick(doc, ['offerLetterPublicId']));
}

/** The id and offer-letter file (if any) of every application to one job opening. */
export async function listOfferLettersForRequisition(requisitionId) {
  const docs = await selectDocs(Application, 'WHERE "requisitionId" = $1::uuid ORDER BY id ASC', [castId(requisitionId, 'requisitionId')]);
  return docs.map((doc) => pick(doc, ['offerLetterPublicId']));
}

/** How many applications each of these job openings has, split by disposition: `[{ requisitionId, disposition, count }]`. */
export async function countByRequisitionAndDisposition(requisitionIds) {
  const wanted = requisitionIds.map(objectId);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "requisitionId", disposition::text AS disposition, count(*)::int AS count FROM applications WHERE "requisitionId" = ANY($1::uuid[]) GROUP BY "requisitionId", disposition ORDER BY "requisitionId", disposition NULLS FIRST`, wanted);
  return rows.map((row) => ({ requisitionId: idOut(row.requisitionId), disposition: row.disposition, count: row.count }));
}

/** How many applications one job opening has for each disposition: `[{ disposition, count }]`. */
export async function countByDisposition(requisitionId) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT disposition::text AS disposition, count(*)::int AS count FROM applications WHERE "requisitionId" = $1::uuid GROUP BY disposition ORDER BY disposition NULLS FIRST', objectId(requisitionId));
  return rows.map((row) => ({ disposition: row.disposition, count: row.count }));
}

/** How many applications of one job opening are waiting for a person, by review status: `[{ status, count }]`. One with a final decision is not waiting. */
export async function countAwaitingReview(requisitionId) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT "reviewStatus"::text AS status, count(*)::int AS count FROM applications WHERE "requisitionId" = $1::uuid AND "reviewStatus"::text = ANY($2::text[]) AND "finalDecision" IS NULL GROUP BY "reviewStatus" ORDER BY "reviewStatus"', objectId(requisitionId), REVIEW_WAITING);
  return rows.map((row) => ({ status: row.status, count: row.count }));
}

/**
 * One page of a job opening's applications, ranked ones first (by rank, then score, then the AI's screening score, then
 * newest), each with the candidate's name, email and phone filled in on `candidateId`.
 *
 * All filters are optional:
 * - `candidateIds`: only applications of these candidates (an empty list matches nothing);
 * - `stageKey`: only applications currently at this stage;
 * - `disposition` / `finalDecision`: `{ values, includeUnset }`, meaning "one of these values", plus "none set yet"
 *   when `includeUnset` is true;
 * - `reviewStatus`: only applications waiting for a person at this review status (one with a final decision is not waiting);
 * - `matchNothing`: return nothing at all.
 *
 * The requested `page` is brought back into range, so asking for page 99 of 3 returns page 3.
 * @returns {Promise<{applications: object[], total: number, page: number, totalPages: number}>}
 */
export async function pageForRequisition({ requisitionId, candidateIds, stageKey, disposition, finalDecision, reviewStatus, matchNothing, page: requestedPage, limit }) {
  const params = [objectId(requisitionId)];
  const conditions = ['"requisitionId" = $1::uuid'];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  if (matchNothing) conditions.push('false');
  for (const [column, filter] of [['disposition', disposition], ['finalDecision', finalDecision]]) {
    if (!filter) continue;
    const unset = `"${column}" IS NULL`;
    const listed = () => `"${column}"::text = ANY(${add(filter.values)}::text[])`;
    if (filter.includeUnset && filter.values.length) conditions.push(`(${unset} OR ${listed()})`);
    else if (filter.includeUnset) conditions.push(unset);
    else conditions.push(listed());
  }
  if (candidateIds) conditions.push(`"candidateId" = ANY(${add(candidateIds.map(objectId))}::uuid[])`);
  if (stageKey) conditions.push(`"currentStageKey" = ${add(stageKey)}`);
  if (reviewStatus) conditions.push(`"reviewStatus"::text = ${add(reviewStatus)}`, '"finalDecision" IS NULL');
  const where = `WHERE ${conditions.join(' AND ')}`;

  const [{ total }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS total FROM applications ${where}`, ...params);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, totalPages);
  // ranked applications first; then by rank, by score and by the AI's screening score (best first, none last) and newest
  const applications = await selectDocs(Application, `${where} ORDER BY (rank IS NULL), rank ASC, "weightedTotal" DESC NULLS LAST, "reviewAiScore" DESC NULLS LAST, "createdAt" DESC, id DESC LIMIT ${Math.floor(limit)} OFFSET ${Math.floor((page - 1) * limit)}`, params);
  await fillInCandidates(applications, 'name email phone');
  return { applications, total, page, totalPages };
}

/** Every application of one job opening, each with the candidate's name and email filled in on `candidateId`. */
export async function listWithCandidates(requisitionId) {
  const applications = await selectDocs(Application, 'WHERE "requisitionId" = $1::uuid ORDER BY id ASC', [castId(requisitionId, 'requisitionId')]);
  return fillInCandidates(applications, 'name email');
}

/** The stored offer-letter file fields of one application (url, public id, name, size, type), or null. */
export async function findOfferLetterFile(id) {
  const doc = await findDoc(Application, castId(id, '_id'));
  return doc ? pick(doc, ['offerLetterUrl', 'offerLetterPublicId', 'offerLetterFileName', 'offerLetterFileSize', 'offerLetterFileMimeType']) : null;
}

/** Creates an application and returns it. */
export async function create(data = {}) {
  return full(await insertDoc(Application, buildDoc(Application, data)));
}

/** Creates several applications at once and returns them. Nothing is created when one of them is not valid. */
export async function createMany(rows) {
  const docs = rows.map((row) => buildDoc(Application, row));
  const created = [];
  await prisma.$transaction(async (tx) => { for (const doc of docs) created.push(await insertDoc(Application, doc, { client: tx })); });
  return created;
}

/**
 * Changes the given fields of an application and returns the saved application, or null when there is none with
 * that id. Fields may be nested (`initialScreening`) or whole lists (`stageProgress`, replaced as given).
 */
export async function update(id, changes = {}) {
  const current = await findDoc(Application, castId(id, '_id'));
  if (!current) return null;
  return writeChanges(Application, current, assign(Application, current, changes));
}

/** Deletes one application. */
export async function remove(id) {
  await prisma.application.deleteMany({ where: { id: castId(id, '_id') } });
}

/** Deletes these applications and returns how many were deleted. */
export async function removeMany(idList) {
  return (await prisma.application.deleteMany({ where: { id: { in: ids(idList, '_id') } } })).count;
}

/** Deletes every application to one job opening and returns how many were deleted. */
export async function removeForRequisition(requisitionId) {
  return (await prisma.application.deleteMany({ where: { requisitionId: castId(requisitionId, 'requisitionId') } })).count;
}

/** Marks the onboarding form as waiting to be sent. Returns false when there is no such application. */
export async function markOnboardingFormPending(id) {
  return !!(await update(id, { onboardingFormDeliveryStatus: 'pending', onboardingFormSentAt: null }));
}

/** A date for a direct update, or the error MongoDB gives for one it cannot read. */
function dateFor(value, path) {
  const done = castDate(value, path);
  if (done.problem) throw Object.assign(new Error(done.problem), { name: 'CastError', kind: 'date', path, value });
  return done.value ? done.value.toISOString() : null;
}

/** Runs one direct update (`sets` is SQL, `params` start at $2) on one application, also stamping its update time. */
async function updateOne(id, sets, params) {
  await prisma.$executeRawUnsafe(`UPDATE applications SET ${sets}, "updatedAt" = $${params.length + 2}::text::timestamp WHERE id = $1::uuid`, castId(id, '_id'), ...params, new Date().toISOString());
}

/** Records that the offer letter email was really delivered. */
export async function markOfferLetterSent(id, at) {
  const when = dateFor(at, 'offerLetterSentAt');
  await updateOne(id, `"offerLetterDeliveryStatus" = 'sent', "offerLetterSentAt" = $2::text::timestamp, "nullFields" = ${nullsExpr(when === null ? { add: ['offerLetterSentAt'], remove: ['offerLetterDeliveryStatus'] } : { remove: ['offerLetterDeliveryStatus', 'offerLetterSentAt'] })}`, [when]);
}

/** Records that the onboarding form email was really delivered. */
export async function markOnboardingFormSent(id, at) {
  const when = dateFor(at, 'onboardingFormSentAt');
  await updateOne(id, `"onboardingFormDeliveryStatus" = 'sent', "onboardingFormSentAt" = $2::text::timestamp, "nullFields" = ${nullsExpr(when === null ? { add: ['onboardingFormSentAt'], remove: ['onboardingFormDeliveryStatus'] } : { remove: ['onboardingFormDeliveryStatus', 'onboardingFormSentAt'] })}`, [when]);
}

/** Records that the application confirmation email was really delivered. */
export async function markConfirmationEmailSent(id, at) {
  const when = dateFor(at, 'screeningJob.confirmationEmailSentAt');
  await updateOne(id, `"screeningConfirmationEmailSentAt" = $2::text::timestamp, "nullFields" = ${nullsExpr(when === null ? { add: ['screeningJob.confirmationEmailSentAt'] } : { remove: ['screeningJob.confirmationEmailSentAt'] })}`, [when]);
}

/** Saves the changes made to an application that was loaded through this repository (see `entity.js`). */
export async function save(application) {
  return saveEntity(Application, application);
}

/** The id, weighted total and rank of every application to one job opening: what re-ranking needs. */
export async function listForRanking(requisitionId) {
  const docs = await selectDocs(Application, 'WHERE "requisitionId" = $1::uuid ORDER BY id ASC', [castId(requisitionId, 'requisitionId')]);
  return docs.map((doc) => pick(doc, ['weightedTotal', 'rank']));
}

/** Sets the rank of one application (null when it has none). */
export async function setRank(id, rank) {
  const done = castNumber(rank, 'rank');
  if (done.problem) throw Object.assign(new Error(done.problem), { name: 'CastError', kind: 'Number', path: 'rank', value: rank });
  const empty = done.value === null || done.value === undefined;
  await updateOne(id, `"rank" = $2::text::double precision, "nullFields" = ${nullsExpr(empty ? { add: ['rank'] } : { remove: ['rank'] })}`, [empty ? null : String(done.value)]);
}

// ---- background screening of public applications (see services/applicationProcessor.js) ----

/**
 * Takes an application whose screening is waiting (or was left half-done by a crash): marks it as processing, counts
 * the attempt and returns it. Null when it is already completed or failed, or no longer exists.
 */
export async function claimForScreening(id) {
  const now = new Date().toISOString();
  const claimed = await prisma.$queryRawUnsafe(
    `UPDATE applications SET "screeningStatus" = 'processing', "screeningLockedAt" = $2::text::timestamp, "screeningAttempts" = "screeningAttempts" + 1, "updatedAt" = $2::text::timestamp,
       "nullFields" = ${nullsExpr({ remove: ['screeningJob.status', 'screeningJob.lockedAt'] })}
     WHERE id = $1::uuid AND "screeningStatus" IN ('pending', 'processing') RETURNING id`, castId(id, '_id'), now);
  return claimed.length ? full(await findDoc(Application, claimed[0].id)) : null;
}

/** Records how a screening attempt ended: the new status and the last error (if any). A finished one also gets a completion time. */
export async function finishScreening(id, { status, lastError }) {
  const now = new Date().toISOString();
  await prisma.$executeRawUnsafe(
    `UPDATE applications SET "screeningStatus" = $2::"ScreeningStatus", "screeningLastError" = $3,
       "screeningCompletedAt" = CASE WHEN $2::"ScreeningStatus" = 'pending' THEN "screeningCompletedAt" ELSE $4::text::timestamp END,
       "screeningLockedAt" = NULL, "updatedAt" = $4::text::timestamp,
       "nullFields" = ${nullsExpr({ add: lastError ? [] : ['screeningJob.lastError'], remove: ['screeningJob.status', 'screeningJob.lockedAt', ...(lastError ? ['screeningJob.lastError'] : []), ...(status === 'pending' ? [] : ['screeningJob.completedAt'])] })} WHERE id = $1::uuid`, castId(id, '_id'), status, lastError || null, now);
}

/**
 * Deals with screenings left "processing" since before `staleBefore` (a crash): ones that have used up their attempts
 * are marked failed, the others go back to waiting.
 */
export async function releaseStaleScreenings({ staleBefore, maxAttempts }) {
  const before = castDate(staleBefore, 'screeningJob.lockedAt').value.toISOString();
  const now = new Date().toISOString();
  await prisma.$transaction([
    prisma.$executeRawUnsafe(
      `UPDATE applications SET "screeningStatus" = 'failed', "screeningCompletedAt" = $3::text::timestamp, "screeningLastError" = 'Stopped: processing kept being interrupted.', "screeningLockedAt" = NULL, "updatedAt" = $3::text::timestamp,
         "nullFields" = ${nullsExpr({ remove: ['screeningJob.status', 'screeningJob.completedAt', 'screeningJob.lastError', 'screeningJob.lockedAt'] })}
       WHERE "screeningStatus" = 'processing' AND "screeningLockedAt" < $1::text::timestamp AND "screeningAttempts" >= $2`, before, maxAttempts, now),
    prisma.$executeRawUnsafe(
      `UPDATE applications SET "screeningStatus" = 'pending', "screeningLockedAt" = NULL, "updatedAt" = $3::text::timestamp,
         "nullFields" = ${nullsExpr({ remove: ['screeningJob.status', 'screeningJob.lockedAt'] })}
       WHERE "screeningStatus" = 'processing' AND "screeningLockedAt" < $1::text::timestamp AND "screeningAttempts" < $2`, before, maxAttempts, now),
  ]);
}

/** Sends an application to the AI screening from the start: its review goes back to "not ready yet". */
export async function requeueScreening(id) {
  await updateOne(id, `"screeningStatus" = 'pending', "screeningAttempts" = 0, "screeningLockedAt" = NULL, "screeningCompletedAt" = NULL, "screeningLastError" = NULL, "reviewStatus" = NULL,
    "nullFields" = ${nullsExpr({ remove: ['screeningJob.status', 'screeningJob.lockedAt', 'screeningJob.completedAt', 'screeningJob.lastError', 'screeningReview.status'] })}`, []);
}

/** The ids of the oldest applications whose screening is waiting, up to `limit`. */
export async function listPendingScreeningIds(limit) {
  const rows = await prisma.$queryRawUnsafe(`SELECT id FROM applications WHERE "screeningStatus" = 'pending' ORDER BY "createdAt" ASC, id ASC${limit > 0 ? ` LIMIT ${Math.floor(limit)}` : ''}`);
  return rows.map((row) => idOut(row.id));
}
