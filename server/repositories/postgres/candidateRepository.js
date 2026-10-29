import { prisma } from './client.js';
import { castError, castId, compareBytes, escapeLike, idOut } from './helpers.js';
import { assign, buildDoc, findDoc, insertDoc, pick, rowToDoc, selectDocs, writeChanges } from './records.js';
import { Candidate } from './schemas.js';

/**
 * Everything the app needs from the database about candidates (the people who apply), on PostgreSQL. It offers exactly
 * the functions of ../mongo/candidateRepository.js and answers the same way.
 */


const EDITABLE = ['name', 'email', 'phone', 'notes', 'resumeFileUrl', 'resumeFilePublicId', 'resumeFileName', 'resumeFileSize', 'resumeFileMimeType'];

/** Ids for a query, or the error MongoDB gives for one it cannot read. */
const queryIds = (ids, path = '_id') => ids.map((id) => castId(id, path));

/** SQL that matches `text` anywhere in these columns, ignoring case (`%` and `_` in the text are just characters). */
const containing = (columns, parameter) => `(${columns.map((c) => `"${c}" ILIKE '%' || ${parameter} || '%' ESCAPE '\\'`).join(' OR ')})`;

/**
 * One page of candidates, newest first (or oldest first), optionally narrowed by a search text (matched anywhere in
 * name, email or phone, ignoring case) and/or to a list of ids.
 *
 * The requested page is brought back into range, so asking for page 99 of 3 returns page 3.
 * @param {{search?: string, ids?: string[], limit: number, page: number, oldestFirst?: boolean}} options
 *   `ids` of undefined means every candidate; an empty list means none.
 * @returns {Promise<{candidates: object[], total: number, page: number, totalPages: number}>}
 */
export async function listPage({ search, ids, limit, page: requestedPage, oldestFirst = false }) {
  const conditions = []; const params = [];
  const text = String(search || '').trim();
  if (text) { params.push(escapeLike(text)); conditions.push(containing(['name', 'email', 'phone'], `$${params.length}`)); }
  if (ids) { params.push(queryIds(ids)); conditions.push(`id = ANY($${params.length}::int[])`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [{ total }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS total FROM candidates ${where}`, ...params);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, totalPages);
  const candidates = await selectDocs(Candidate, `${where} ORDER BY "createdAt" ${oldestFirst ? 'ASC' : 'DESC'}, id ${oldestFirst ? 'ASC' : 'DESC'} LIMIT ${Math.floor(limit)} OFFSET ${Math.floor((page - 1) * limit)}`, params);
  return { candidates, total, page, totalPages };
}

/** One candidate, or null when there is none with that id. */
export async function findById(id) {
  return findDoc(Candidate, castId(id, '_id'));
}

/** The candidate with this (already lower-cased) email, or null. Pass `exceptId` to leave one candidate out. */
export async function findByEmail(email, { exceptId } = {}) {
  const params = [String(email)];
  if (exceptId) params.push(castId(exceptId, '_id'));
  const [doc] = await selectDocs(Candidate, `WHERE email = $1${exceptId ? ' AND id <> $2::int' : ''} ORDER BY id ASC LIMIT 1`, params);
  return doc || null;
}

/** Just the `_id` and `name` of each of these candidates that exists. */
export async function findNamesByIds(ids) {
  const docs = await selectDocs(Candidate, 'WHERE id = ANY($1::int[]) ORDER BY id ASC', [queryIds(ids)]);
  return docs.map((doc) => pick(doc, ['name']));
}

/** The ids of every candidate whose name or email contains this text (ignoring case). */
export async function findIdsBySearch(search) {
  const rows = await prisma.$queryRawUnsafe(`SELECT id FROM candidates WHERE ${containing(['name', 'email'], '$1')} ORDER BY id ASC`, escapeLike(search));
  return rows.map((row) => idOut(row.id));
}

/** The email of every candidate that has one, as an array of strings. */
export async function listEmails() {
  const rows = await prisma.$queryRawUnsafe(`SELECT email FROM candidates WHERE email IS NOT NULL AND email <> '' ORDER BY email COLLATE "C" ASC, id ASC`);
  return rows.map((row) => row.email);
}

/** True when some candidate's profile still uses the stored résumé file with this public id. */
export async function isResumeFileInUse(publicId) {
  return (await prisma.candidate.count({ where: { resumeFilePublicId: String(publicId) } })) > 0;
}

/** The stored résumé file fields of one candidate (url, public id, name, size, type), or null. */
export async function findResumeFile(id) {
  const doc = await findDoc(Candidate, castId(id, '_id'));
  return doc ? pick(doc, ['resumeFileUrl', 'resumeFilePublicId', 'resumeFileName', 'resumeFileSize', 'resumeFileMimeType']) : null;
}

/** Creates a candidate and returns it. */
export async function create(data = {}) {
  return insertDoc(Candidate, buildDoc(Candidate, data));
}

/** Creates several candidates at once and returns them. Nothing is created when one of them is not valid. */
export async function createMany(rows) {
  const docs = rows.map((row) => buildDoc(Candidate, row));
  const created = [];
  await prisma.$transaction(async (tx) => { for (const doc of docs) created.push(await insertDoc(Candidate, doc, { client: tx })); });
  return created;
}

/**
 * Changes the given fields of a candidate (name, email, phone, notes and the résumé file fields; fields left out stay
 * as they are) and returns the saved candidate, or null when there is none with that id.
 */
export async function update(id, changes = {}) {
  const current = await findDoc(Candidate, castId(id, '_id'));
  if (!current) return null;
  const given = Object.fromEntries(EDITABLE.filter((field) => changes[field] !== undefined).map((field) => [field, changes[field]]));
  const next = assign(Candidate, current, given);
  return writeChanges(Candidate, current, next);
}

/** Deletes a candidate (and, with them, their applications, which PostgreSQL removes by itself). */
export async function remove(id) {
  await prisma.candidate.deleteMany({ where: { id: castId(id, '_id') } });
}

void castError; void compareBytes; void rowToDoc;
