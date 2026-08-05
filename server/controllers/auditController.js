const AuditLog = require('../models/AuditLog');
const { asyncHandler } = require('../utils/helpers');

/**
 * GET /api/audit
 * Filterable, paginated audit log. Query params: requisitionId,
 * applicationId, userId, action, dateFrom, dateTo, page, limit.
 */
const list = asyncHandler(async (req, res) => {
  const { requisitionId, applicationId, userId, action, dateFrom, dateTo } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 50);

  const filter = {};
  if (requisitionId) filter.requisitionId = requisitionId;
  if (applicationId) filter.applicationId = applicationId;
  if (userId) filter.userId = userId;
  if (action) filter.action = action;
  if (dateFrom || dateTo) {
    filter.timestamp = {};
    if (dateFrom) filter.timestamp.$gte = new Date(dateFrom);
    if (dateTo) filter.timestamp.$lte = new Date(dateTo);
  }

  const [entries, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'name email'),
    AuditLog.countDocuments(filter),
  ]);

  res.json({ entries, total, page, limit });
});

module.exports = { list };
