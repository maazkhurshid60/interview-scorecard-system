import Candidate from '../models/Candidate.js';
import { plain } from './plain.js';

/**
 * Everything the app needs from the database about candidates (the people who apply). Only this file (and the
 * model) knows where they live.
 */

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  const query = {};
  const text = String(search || '').trim();
  if (text) {
    const pattern = new RegExp(escapeRegex(text), 'i');
    query.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }];
  }
  if (ids) query._id = { $in: ids };

  const total = await Candidate.countDocuments(query);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, totalPages);
  const candidates = await Candidate.find(query)
    .sort(oldestFirst ? { createdAt: 1 } : { createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  return { candidates: plain(candidates), total, page, totalPages };
}

/** One candidate, or null when there is none with that id. */
export async function findById(id) {
  return plain(await Candidate.findById(id));
}

/** The candidate with this (already lower-cased) email, or null. Pass `exceptId` to leave one candidate out. */
export async function findByEmail(email, { exceptId } = {}) {
  return plain(await Candidate.findOne({ email, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }));
}

/** Just the `_id` and `name` of each of these candidates that exists. */
export async function findNamesByIds(ids) {
  return plain(await Candidate.find({ _id: { $in: ids } }).select('_id name').lean());
}

/** The ids of every candidate whose name or email contains this text (ignoring case). */
export async function findIdsBySearch(search) {
  const pattern = new RegExp(escapeRegex(search), 'i');
  const matches = await Candidate.find({ $or: [{ name: pattern }, { email: pattern }] }).select('_id').lean();
  return matches.map((candidate) => String(candidate._id));
}

/** The email of every candidate that has one, as an array of strings. */
export async function listEmails() {
  const candidates = await Candidate.find({ email: { $exists: true, $ne: '' } }).select('email').lean();
  return candidates.map((candidate) => candidate.email);
}

/** True when some candidate's profile still uses the stored résumé file with this public id. */
export async function isResumeFileInUse(publicId) {
  return !!(await Candidate.exists({ resumeFilePublicId: publicId }));
}

/** The stored résumé file fields of one candidate (url, public id, name, size, type), or null. */
export async function findResumeFile(id) {
  return plain(await Candidate.findById(id).select('resumeFileUrl resumeFilePublicId resumeFileName resumeFileSize resumeFileMimeType'));
}

/** Creates a candidate and returns it. */
export async function create(data) {
  return plain(await Candidate.create(data));
}

/** Creates several candidates at once and returns them. */
export async function createMany(rows) {
  return plain(await Candidate.insertMany(rows));
}

/**
 * Changes the given fields of a candidate (name, email, phone, notes and the résumé file fields; fields left out stay
 * as they are) and returns the saved candidate, or null when there is none with that id.
 */
export async function update(id, changes) {
  const candidate = await Candidate.findById(id);
  if (!candidate) return null;
  for (const field of ['name', 'email', 'phone', 'notes', 'resumeFileUrl', 'resumeFilePublicId', 'resumeFileName', 'resumeFileSize', 'resumeFileMimeType']) {
    if (changes[field] !== undefined) candidate[field] = changes[field];
  }
  await candidate.save();
  return plain(candidate);
}

/** Deletes a candidate. */
export async function remove(id) {
  await Candidate.findByIdAndDelete(id);
}
