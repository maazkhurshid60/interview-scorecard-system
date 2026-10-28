import { prisma } from './client.js';
import { castId, compareBytes, escapeLike, newId, requiredMessage, translateError, validationError } from './helpers.js';

/**
 * Everything the app needs from the database about departments, on PostgreSQL. It offers exactly the functions of
 * ../mongo/departmentRepository.js and answers exactly the same way: plain objects with `_id` as text, the same
 * errors, and the same ordering (see helpers.js).
 */

/** A department row as the app has always seen it. An empty optional value is left out, as MongoDB left it out. */
const toDepartment = (row) => ({
  _id: row.id,
  name: row.name,
  description: row.description,
  ...(row.createdBy !== null && row.createdBy !== undefined ? { createdBy: row.createdBy } : {}),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** All departments, sorted by name (byte order, as MongoDB sorts), each with `totalJobs` and `openJobs`. */
export async function listWithJobCounts() {
  const [rows, totals, opens] = await Promise.all([
    prisma.department.findMany(),
    prisma.requisition.groupBy({ by: ['departmentId'], where: { departmentId: { not: null } }, _count: { _all: true } }),
    prisma.requisition.groupBy({ by: ['departmentId'], where: { departmentId: { not: null }, status: 'open' }, _count: { _all: true } }),
  ]);
  const totalById = new Map(totals.map((t) => [t.departmentId, t._count._all]));
  const openById = new Map(opens.map((t) => [t.departmentId, t._count._all]));
  return rows
    .sort((a, b) => compareBytes(a.name, b.name))
    .map((row) => ({ ...toDepartment(row), totalJobs: totalById.get(row.id) || 0, openJobs: openById.get(row.id) || 0 }));
}

/** One department, or null when there is none with that id. */
export async function findById(id) {
  const row = await prisma.department.findUnique({ where: { id: castId(id, '_id') } });
  return row ? toDepartment(row) : null;
}

/**
 * A department whose name matches exactly, ignoring upper/lower case (or null). Pass `exceptId` to leave one
 * department out, for example the one being renamed.
 */
export async function findByName(name, { exceptId } = {}) {
  const row = await prisma.department.findFirst({
    where: {
      name: { equals: escapeLike(name), mode: 'insensitive' },
      ...(exceptId ? { id: { not: castId(exceptId, '_id') } } : {}),
    },
  });
  return row ? toDepartment(row) : null;
}

/** Creates a department and returns it. Names and descriptions are trimmed, as the Mongoose model did. */
export async function create({ name, description, createdBy }) {
  const cleanName = typeof name === 'string' ? name.trim() : name;
  if (cleanName === undefined || cleanName === null || cleanName === '') throw validationError('Department', { name: requiredMessage('name') });
  try {
    const row = await prisma.department.create({
      data: {
        id: newId(),
        name: cleanName,
        ...(description !== undefined && description !== null ? { description: String(description).trim() } : {}),
        ...(createdBy !== undefined && createdBy !== null ? { createdBy: castId(createdBy, 'createdBy') } : {}),
      },
    });
    return toDepartment(row);
  } catch (error) {
    throw translateError(error, { name: cleanName });
  }
}

/** Changes the name and/or description (only the fields given) and returns the department, or null if it does not exist. */
export async function update(id, { name, description }) {
  const current = await prisma.department.findUnique({ where: { id: castId(id, '_id') } });
  if (!current) return null;

  const changes = {};
  if (name !== undefined) {
    const cleanName = typeof name === 'string' ? name.trim() : name;
    if (cleanName === null || cleanName === '') throw validationError('Department', { name: requiredMessage('name') });
    if (cleanName !== current.name) changes.name = cleanName;
  }
  if (description !== undefined) {
    const cleanDescription = description === null ? '' : String(description).trim();
    if (cleanDescription !== current.description) changes.description = cleanDescription;
  }
  if (Object.keys(changes).length === 0) return toDepartment(current); // nothing changed, so nothing is written (and updatedAt stays)

  try {
    return toDepartment(await prisma.department.update({ where: { id: current.id }, data: changes }));
  } catch (error) {
    throw translateError(error, { name: changes.name });
  }
}

/** How many job openings use this department, and how many of them are open. */
export async function countJobs(id) {
  const departmentId = castId(id, 'departmentId');
  const [totalJobs, openJobs] = await Promise.all([
    prisma.requisition.count({ where: { departmentId } }),
    prisma.requisition.count({ where: { departmentId, status: 'open' } }),
  ]);
  return { totalJobs, openJobs };
}

/**
 * Deletes a department and takes it off every job opening that used it, as one operation (a transaction here).
 * @returns {Promise<{name: string, unlinkedJobs: number} | null>} null when there is no such department.
 */
export async function removeAndUnlinkJobs(id) {
  const departmentId = castId(id, '_id');
  return prisma.$transaction(async (tx) => {
    const department = await tx.department.findUnique({ where: { id: departmentId } });
    if (!department) return null;
    const unlinked = await tx.requisition.updateMany({ where: { departmentId: department.id }, data: { departmentId: null } });
    await tx.department.delete({ where: { id: department.id } });
    return { name: department.name, unlinkedJobs: unlinked.count };
  });
}
