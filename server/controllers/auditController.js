import * as auditLog from '../repositories/auditLogRepository.js';
import { asyncHandler } from '../utils/helpers.js';

/**
 * GET /api/audit
 * Filterable, paginated audit log. Query params: requisitionId,
 * applicationId, userId, action, dateFrom, dateTo, page, limit.
 */
const list = asyncHandler(async (req, res) => {
  const { requisitionId, applicationId, userId, action, dateFrom, dateTo } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 50);

  const { entries, total } = await auditLog.search({ requisitionId, applicationId, userId, action, dateFrom, dateTo, page, limit });

  res.json({ entries, total, page, limit });
});

export { list };
