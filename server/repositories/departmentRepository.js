import Department from '../models/Department.js';
import Requisition from '../models/Requisition.js';
import { plain } from './plain.js';

/**
 * Everything the app needs from the database about departments. This file (and the models it uses) is the only
 * place that knows departments live in MongoDB; controllers call these functions and get plain objects back.
 *
 * A "department with counts" is a department plus `totalJobs` and `openJobs`: the number of job openings that use
 * it and how many of those are open.
 */

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** All departments, sorted by name, each with its job counts. */
export async function listWithJobCounts() {
  const departments = await Department.find().sort({ name: 1 }).lean();

  const counts = await Requisition.aggregate([
    { $match: { departmentId: { $ne: null } } },
    {
      $group: {
        _id: '$departmentId',
        totalJobs: { $sum: 1 },
        openJobs: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
      },
    },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), { totalJobs: c.totalJobs, openJobs: c.openJobs }]));

  return plain(departments.map((department) => ({
    ...department,
    ...(countMap.get(String(department._id)) || { totalJobs: 0, openJobs: 0 }),
  })));
}

/** One department, or null when there is none with that id. */
export async function findById(id) {
  return plain(await Department.findById(id).lean());
}

/**
 * A department whose name matches exactly, ignoring upper/lower case (or null). Pass `exceptId` to leave one
 * department out, for example the one being renamed.
 */
export async function findByName(name, { exceptId } = {}) {
  return plain(await Department.findOne({
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
  }).lean());
}

/** Creates a department and returns it. */
export async function create({ name, description, createdBy }) {
  return plain(await Department.create({ name, description, createdBy }));
}

/** Changes the name and/or description (only the fields given) and returns the department, or null if it does not exist. */
export async function update(id, { name, description }) {
  const department = await Department.findById(id);
  if (!department) return null;
  if (name !== undefined) department.name = name;
  if (description !== undefined) department.description = description;
  await department.save();
  return plain(department);
}

/** How many job openings use this department, and how many of them are open. */
export async function countJobs(id) {
  const [totalJobs, openJobs] = await Promise.all([
    Requisition.countDocuments({ departmentId: id }),
    Requisition.countDocuments({ departmentId: id, status: 'open' }),
  ]);
  return { totalJobs, openJobs };
}

/**
 * Deletes a department and takes it off every job opening that used it, as one operation.
 * @returns {Promise<{name: string, unlinkedJobs: number} | null>} null when there is no such department.
 */
export async function removeAndUnlinkJobs(id) {
  const department = await Department.findById(id);
  if (!department) return null;
  const unlinked = await Requisition.updateMany({ departmentId: department._id }, { $unset: { departmentId: 1 } });
  await department.deleteOne();
  return { name: department.name, unlinkedJobs: unlinked.modifiedCount };
}
