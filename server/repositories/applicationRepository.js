import mongoose from 'mongoose';
import Application from '../models/Application.js';
import '../models/Candidate.js'; // registers the Candidate model, which the queries below fill in on each application
import { plain } from './plain.js';
import { track, saveEntity } from './entity.js';

/**
 * Everything the app needs from the database about job applications: one candidate applying to one job opening,
 * with its stage progress, scores, decision and screening state. Only this file (and the models) knows where they live.
 */

const full = (value) => track(plain(value));
const toObjectIds = (ids) => ids.map((id) => new mongoose.Types.ObjectId(String(id)));

/**
 * One application, or null when there is none with that id. It comes back as a tracked record: change it in memory,
 * then call `save(application)` (see `entity.js`).
 */
export async function findById(id) {
  return full(await Application.findById(id));
}

/** Like `findById`, with the candidate filled in on `candidateId` (just the fields named in `select`, like `'name email'`; all of them when left out). */
export async function findByIdWithCandidate(id, select) {
  return full(await Application.findById(id).populate('candidateId', select));
}

/** The application of this candidate to this job opening, or null. */
export async function findByCandidateAndRequisition(candidateId, requisitionId) {
  return full(await Application.findOne({ candidateId, requisitionId }));
}

/** For each of these candidates, every application with just the fields a list needs (job, stage, disposition). */
export async function listSummariesForCandidates(candidateIds) {
  return plain(await Application.find({ candidateId: { $in: candidateIds } })
    .select('candidateId requisitionId currentStageKey disposition')
    .lean());
}

/** The ids of every candidate who has applied to this job opening. */
export async function listCandidateIdsForRequisition(requisitionId) {
  return plain(await Application.distinct('candidateId', { requisitionId }));
}

/** The ids of every job opening that has at least one application. */
export async function listRequisitionIdsWithApplications() {
  return plain(await Application.distinct('requisitionId'));
}

/** Of these candidates, the ids of those already attached to this job opening. */
export async function listAttachedCandidateIds(candidateIds, requisitionId) {
  const applications = await Application.find({ candidateId: { $in: candidateIds }, requisitionId }).select('candidateId').lean();
  return plain(applications.map((application) => application.candidateId));
}

/** The id and offer-letter file (if any) of every application of one candidate. */
export async function listOfferLettersForCandidate(candidateId) {
  return plain(await Application.find({ candidateId }).select('_id offerLetterPublicId').lean());
}

/** The id and offer-letter file (if any) of every application to one job opening. */
export async function listOfferLettersForRequisition(requisitionId) {
  return plain(await Application.find({ requisitionId }).select('_id offerLetterPublicId').lean());
}

/** How many applications each of these job openings has, split by disposition: `[{ requisitionId, disposition, count }]`. */
export async function countByRequisitionAndDisposition(requisitionIds) {
  const counts = await Application.aggregate([
    { $match: { requisitionId: { $in: toObjectIds(requisitionIds) } } },
    { $group: { _id: { requisitionId: '$requisitionId', disposition: '$disposition' }, count: { $sum: 1 } } },
  ]);
  return counts.map(({ _id, count }) => ({ requisitionId: String(_id.requisitionId), disposition: _id.disposition, count }));
}

/** How many applications one job opening has for each disposition: `[{ disposition, count }]`. */
export async function countByDisposition(requisitionId) {
  const counts = await Application.aggregate([
    { $match: { requisitionId: new mongoose.Types.ObjectId(String(requisitionId)) } },
    { $group: { _id: '$disposition', count: { $sum: 1 } } },
  ]);
  return counts.map(({ _id, count }) => ({ disposition: _id, count }));
}

/**
 * One page of a job opening's applications, ranked ones first (by rank, then score, then newest), each with the
 * candidate's name, email and phone filled in on `candidateId`.
 *
 * All filters are optional:
 * - `candidateIds`: only applications of these candidates (an empty list matches nothing);
 * - `stageKey`: only applications currently at this stage;
 * - `disposition` / `finalDecision`: `{ values, includeUnset }`, meaning "one of these values", plus "none set yet"
 *   when `includeUnset` is true;
 * - `matchNothing`: return nothing at all.
 *
 * The requested `page` is brought back into range, so asking for page 99 of 3 returns page 3.
 * @returns {Promise<{applications: object[], total: number, page: number, totalPages: number}>}
 */
export async function pageForRequisition({ requisitionId, candidateIds, stageKey, disposition, finalDecision, matchNothing, page: requestedPage, limit }) {
  const query = { requisitionId: new mongoose.Types.ObjectId(String(requisitionId)) };
  if (matchNothing) query._id = { $in: [] };
  for (const [field, filter] of [['disposition', disposition], ['finalDecision', finalDecision]]) {
    if (!filter) continue;
    if (filter.includeUnset && filter.values.length) query[field] = { $in: [null, ...filter.values] };
    else if (filter.includeUnset) query[field] = null;
    else query[field] = { $in: filter.values };
  }
  // An aggregation (below) does not turn string ids into ObjectIds for us, so they are converted here.
  if (candidateIds) query.candidateId = { $in: toObjectIds(candidateIds) };
  if (stageKey) query.currentStageKey = stageKey;

  const total = await Application.countDocuments(query);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * limit;
  // Put ranked applications first. A normal MongoDB ascending sort places null/missing ranks before rank 1, which
  // is not the ranking shown in the UI.
  const applications = await Application.aggregate([
    { $match: query },
    { $addFields: { _rankSort: { $cond: [{ $ne: [{ $ifNull: ['$rank', null] }, null] }, 0, 1] } } },
    { $sort: { _rankSort: 1, rank: 1, weightedTotal: -1, createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    { $project: { _rankSort: 0 } },
  ]);
  await Application.populate(applications, { path: 'candidateId', select: 'name email phone' });
  return { applications: plain(applications), total, page, totalPages };
}

/** Every application of one job opening, each with the candidate's name and email filled in on `candidateId`. */
export async function listWithCandidates(requisitionId) {
  return plain(await Application.find({ requisitionId }).populate('candidateId', 'name email'));
}

/** The stored offer-letter file fields of one application (url, public id, name, size, type), or null. */
export async function findOfferLetterFile(id) {
  return plain(await Application.findById(id).select('offerLetterUrl offerLetterPublicId offerLetterFileName offerLetterFileSize offerLetterFileMimeType'));
}

/** Creates an application and returns it. */
export async function create(data) {
  return full(await Application.create(data));
}

/** Creates several applications at once and returns them. */
export async function createMany(rows) {
  return plain(await Application.insertMany(rows));
}

/**
 * Changes the given fields of an application and returns the saved application, or null when there is none with
 * that id. Fields may be nested (`initialScreening`) or whole lists (`stageProgress`, replaced as given).
 */
export async function update(id, changes) {
  const application = await Application.findById(id);
  if (!application) return null;
  application.set(changes);
  await application.save();
  return plain(application);
}

/** Deletes one application. */
export async function remove(id) {
  await Application.findByIdAndDelete(id);
}

/** Deletes these applications and returns how many were deleted. */
export async function removeMany(ids) {
  return (await Application.deleteMany({ _id: { $in: ids } })).deletedCount;
}

/** Deletes every application to one job opening and returns how many were deleted. */
export async function removeForRequisition(requisitionId) {
  return (await Application.deleteMany({ requisitionId })).deletedCount;
}

/** Marks the onboarding form as waiting to be sent. Returns false when there is no such application. */
export async function markOnboardingFormPending(id) {
  return !!(await update(id, { onboardingFormDeliveryStatus: 'pending', onboardingFormSentAt: null }));
}

/** Records that the offer letter email was really delivered. */
export async function markOfferLetterSent(id, at) {
  await Application.updateOne({ _id: id }, { offerLetterDeliveryStatus: 'sent', offerLetterSentAt: at });
}

/** Records that the onboarding form email was really delivered. */
export async function markOnboardingFormSent(id, at) {
  await Application.updateOne({ _id: id }, { onboardingFormDeliveryStatus: 'sent', onboardingFormSentAt: at });
}

/** Records that the application confirmation email was really delivered. */
export async function markConfirmationEmailSent(id, at) {
  await Application.updateOne({ _id: id }, { 'screeningJob.confirmationEmailSentAt': at });
}

/** Saves the changes made to an application that was loaded through this repository (see `entity.js`). */
export async function save(application) {
  return saveEntity(Application, application);
}

/** The id, weighted total and rank of every application to one job opening: what re-ranking needs. */
export async function listForRanking(requisitionId) {
  return plain(await Application.find({ requisitionId }).select('_id weightedTotal rank'));
}

/** Sets the rank of one application (null when it has none). */
export async function setRank(id, rank) {
  await Application.updateOne({ _id: id }, { rank });
}

// ---- background screening of public applications (see services/applicationProcessor.js) ----

/**
 * Takes an application whose screening is waiting (or was left half-done by a crash): marks it as processing, counts
 * the attempt and returns it. Null when it is already completed or failed, or no longer exists.
 */
export async function claimForScreening(id) {
  return full(await Application.findOneAndUpdate(
    { _id: id, 'screeningJob.status': { $in: ['pending', 'processing'] } },
    { $set: { 'screeningJob.status': 'processing', 'screeningJob.lockedAt': new Date() }, $inc: { 'screeningJob.attempts': 1 } },
    { new: true },
  ));
}

/** Records how a screening attempt ended: the new status and the last error (if any). A finished one also gets a completion time. */
export async function finishScreening(id, { status, lastError }) {
  await Application.updateOne({ _id: id }, {
    $set: {
      'screeningJob.status': status,
      'screeningJob.lastError': lastError || null,
      ...(status === 'pending' ? {} : { 'screeningJob.completedAt': new Date() }),
    },
    $unset: { 'screeningJob.lockedAt': 1 },
  });
}

/**
 * Deals with screenings left "processing" since before `staleBefore` (a crash): ones that have used up their attempts
 * are marked failed, the others go back to waiting.
 */
export async function releaseStaleScreenings({ staleBefore, maxAttempts }) {
  const left = { 'screeningJob.status': 'processing', 'screeningJob.lockedAt': { $lt: staleBefore } };
  await Application.updateMany({ ...left, 'screeningJob.attempts': { $gte: maxAttempts } }, {
    $set: { 'screeningJob.status': 'failed', 'screeningJob.completedAt': new Date(), 'screeningJob.lastError': 'Stopped: processing kept being interrupted.' },
    $unset: { 'screeningJob.lockedAt': 1 },
  });
  await Application.updateMany({ ...left, 'screeningJob.attempts': { $lt: maxAttempts } }, {
    $set: { 'screeningJob.status': 'pending' },
    $unset: { 'screeningJob.lockedAt': 1 },
  });
}

/** The ids of the oldest applications whose screening is waiting, up to `limit`. */
export async function listPendingScreeningIds(limit) {
  const pending = await Application.find({ 'screeningJob.status': 'pending' }).sort({ createdAt: 1 }).limit(limit).select('_id').lean();
  return pending.map((application) => String(application._id));
}

