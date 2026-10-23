const Department = require('../models/Department');
const Requisition = require('../models/Requisition');
const { asyncHandler } = require('../utils/helpers');
const { ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * GET /api/departments
 * Returns all departments sorted by name, along with counts of associated job openings.
 */
const list = asyncHandler(async (req, res) => {
  const departments = await Department.find()
    .sort({ name: 1 })
    .lean();

  // Aggregate job counts for all departments
  const counts = await Requisition.aggregate([
    { $match: { departmentId: { $ne: null } } },
    {
      $group: {
        _id: '$departmentId',
        totalJobs: { $sum: 1 },
        openJobs: {
          $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] },
        },
      },
    },
  ]);

  const countMap = new Map();
  counts.forEach((c) => {
    countMap.set(String(c._id), { totalJobs: c.totalJobs, openJobs: c.openJobs });
  });

  const enriched = departments.map((dept) => {
    const stats = countMap.get(String(dept._id)) || { totalJobs: 0, openJobs: 0 };
    return {
      ...dept,
      totalJobs: stats.totalJobs,
      openJobs: stats.openJobs,
    };
  });

  res.json({ departments: enriched });
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

  const existing = await Department.findOne({
    name: { $regex: `^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
  });

  if (existing) {
    throw new ValidationError(['name'], `A department named "${existing.name}" already exists.`);
  }

  const department = await Department.create({
    name: cleanName,
    description: String(description || '').trim(),
    createdBy: req.user?._id,
  });

  logger.info(`[Department] Created department "${department.name}" (${department._id}) by user=${req.user?._id}`);

  res.status(201).json({
    department: {
      ...department.toObject(),
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
  const department = await Department.findById(req.params.id);
  if (!department) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Department not found.' });
  }

  const { name, description } = req.body;

  if (name !== undefined) {
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      throw new ValidationError(['name'], 'Department name cannot be empty.');
    }

    const existing = await Department.findOne({
      _id: { $ne: department._id },
      name: { $regex: `^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    });

    if (existing) {
      throw new ValidationError(['name'], `Another department named "${existing.name}" already exists.`);
    }

    department.name = cleanName;
  }

  if (description !== undefined) {
    department.description = String(description || '').trim();
  }

  await department.save();
  logger.info(`[Department] Updated department "${department.name}" (${department._id}) by user=${req.user?._id}`);

  // Fetch current job stats
  const [totalJobs, openJobs] = await Promise.all([
    Requisition.countDocuments({ departmentId: department._id }),
    Requisition.countDocuments({ departmentId: department._id, status: 'open' }),
  ]);

  res.json({
    department: {
      ...department.toObject(),
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
  const department = await Department.findById(req.params.id);
  if (!department) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Department not found.' });
  }

  const deptName = department.name;

  // Unassign from any requisitions that used this department
  const unassignResult = await Requisition.updateMany(
    { departmentId: department._id },
    { $unset: { departmentId: 1 } }
  );

  await department.deleteOne();
  logger.info(`[Department] Deleted department "${deptName}" (${department._id}); unlinked ${unassignResult.modifiedCount} requisitions by user=${req.user?._id}`);

  res.json({
    message: `Department "${deptName}" deleted successfully.`,
    unassignedJobs: unassignResult.modifiedCount,
  });
});

module.exports = { list, create, update, remove };
