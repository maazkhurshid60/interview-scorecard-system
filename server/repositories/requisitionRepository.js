import Requisition from '../models/Requisition.js';
import { plain } from './plain.js';
import { track, saveEntity } from './entity.js';

/**
 * Everything the app needs from the database about job openings (requisitions): the role, its hiring stages and
 * thresholds, screening criteria and status. Only this file (and the model) knows where they live.
 *
 * A job opening comes back as a tracked record: change it in memory, then call `save(requisition)`.
 */

const full = (value) => track(plain(value));
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One job opening, or null when there is none with that id. */
export async function findById(id) {
  return full(await Requisition.findById(id));
}

/** One job opening with its department's name and description filled in on `departmentId`, or null. */
export async function findByIdWithDepartment(id) {
  return full(await Requisition.findById(id).populate('departmentId', 'name description'));
}

/** Just the given fields (a space-separated list, like `'title status'`) of one job opening, or null. */
export async function findFields(id, fields) {
  return full(await Requisition.findById(id).select(fields));
}

/** The public view of one job opening, the fields a candidate may see on the application page, or null. */
export async function findPublicView(id) {
  return plain(await Requisition.findById(id)
    .select('title employmentType fullTimeDetails partTimeDetails contractDetails internshipDetails temporaryDetails location workplaceType officeLocation remoteRegion jobDescription initialScreeningCriteria questionnaire applicationDeadline aiScreeningEnabled status createdAt interviewAvailability')
    .lean());
}

/** The title and status of each of these job openings (those that exist). */
export async function listTitlesAndStatuses(ids) {
  return plain(await Requisition.find({ _id: { $in: ids } }).select('title status').lean());
}

/** The title of each of these job openings (those that exist), sorted by title. */
export async function listTitles(ids) {
  return plain(await Requisition.find({ _id: { $in: ids } }).select('title').sort({ title: 1 }).lean());
}

/** The title and hiring stages of each of these job openings (those that exist). */
export async function findTitlesAndStages(ids) {
  return plain(await Requisition.find({ _id: { $in: ids } }, 'title stages'));
}

/**
 * An open job opening with the same title (ignoring upper/lower case), as `{ _id, title }`, or null. Pass `exceptId`
 * to leave one job opening out, for example the one being edited.
 */
export async function findOpenByTitle(title, { exceptId } = {}) {
  return plain(await Requisition.findOne({
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    title: { $regex: `^${escapeRegex(title)}$`, $options: 'i' },
    status: 'open',
  }).select('_id title').lean());
}

/**
 * Every job opening, newest first, each with its department's name filled in on `departmentId`. Narrow it by
 * `status` (asking for 'paused' also returns the legacy 'on_hold' ones) and/or `departmentId`.
 */
export async function list({ status, departmentId } = {}) {
  const filter = {};
  if (status) filter.status = status === 'paused' ? { $in: ['paused', 'on_hold'] } : status;
  if (departmentId) filter.departmentId = departmentId;
  return plain(await Requisition.find(filter).populate('departmentId', 'name').sort({ createdAt: -1 }).lean());
}

/** Every closed job opening that was closed on or before this date. */
export async function listClosedBefore(cutoff) {
  return full(await Requisition.find({ status: 'closed', closedAt: { $lte: cutoff } }));
}

/** Creates a job opening and returns it. */
export async function create(data) {
  return full(await Requisition.create(data));
}

/** Saves the changes made to a job opening that was loaded through this repository (see `entity.js`). */
export async function save(requisition) {
  return saveEntity(Requisition, requisition);
}

/** Points a job opening at its scorecard. */
export async function setScorecard(id, scorecardId) {
  await Requisition.updateOne({ _id: id }, { scorecardId });
}

/** Deletes one job opening. */
export async function remove(id) {
  await Requisition.findByIdAndDelete(id);
}
