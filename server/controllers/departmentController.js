import * as departments from '../repositories/departmentRepository.js';
import { asyncHandler } from '../utils/helpers.js';
import { ValidationError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * GET /api/departments
 * Returns all departments sorted by name, along with counts of associated job openings.
 */
const list = asyncHandler(async (req, res) => {
  res.json({ departments: await departments.listWithJobCounts() });
});

/**
 * POST /api/departments
 * Creates a new department.
 */
const create = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  const cleanName = String(name || '').trim();

  if (!cleanName) {
    throw new ValidationError(['name'], 'Department name is required.');
  }

  const existing = await departments.findByName(cleanName);
  if (existing) {
    throw new ValidationError(['name'], `A department named "${existing.name}" already exists.`);
  }

  const department = await departments.create({
    name: cleanName,
    description: String(description || '').trim(),
    createdBy: req.user?._id,
  });

  logger.info(`[Department] Created department "${department.name}" (${department._id}) by user=${req.user?._id}`);

  res.status(201).json({
    department: {
      ...department,
      totalJobs: 0,
      openJobs: 0,
    },
    message: 'Department created successfully.',
  });
});

/**
 * PATCH /api/departments/:id
 * Updates an existing department.
 */
const update = asyncHandler(async (req, res) => {
  const current = await departments.findById(req.params.id);
  if (!current) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Department not found.' });
  }

  const { name, description } = req.body;
  const changes = {};

  if (name !== undefined) {
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      throw new ValidationError(['name'], 'Department name cannot be empty.');
    }

    const existing = await departments.findByName(cleanName, { exceptId: current._id });
    if (existing) {
      throw new ValidationError(['name'], `Another department named "${existing.name}" already exists.`);
    }

    changes.name = cleanName;
  }

  if (description !== undefined) {
    changes.description = String(description || '').trim();
  }

  const department = await departments.update(current._id, changes);
  logger.info(`[Department] Updated department "${department.name}" (${department._id}) by user=${req.user?._id}`);

  const { totalJobs, openJobs } = await departments.countJobs(department._id);

  res.json({
    department: {
      ...department,
      totalJobs,
      openJobs,
    },
    message: 'Department updated successfully.',
  });
});

/**
 * DELETE /api/departments/:id
 * Deletes a department and unsets the departmentId from all associated requisitions.
 */
const remove = asyncHandler(async (req, res) => {
  const removed = await departments.removeAndUnlinkJobs(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Department not found.' });
  }

  logger.info(`[Department] Deleted department "${removed.name}" (${req.params.id}); unlinked ${removed.unlinkedJobs} requisitions by user=${req.user?._id}`);

  res.json({
    message: `Department "${removed.name}" deleted successfully.`,
    unassignedJobs: removed.unlinkedJobs,
  });
});

export { list, create, update, remove };
