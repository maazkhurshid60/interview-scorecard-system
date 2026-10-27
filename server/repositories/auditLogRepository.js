import AuditLog from '../models/AuditLog.js';
import { plain } from './plain.js';

/**
 * Everything the app needs from the database about the audit log: recording what happened, searching it, and
 * removing the entries that belong to something that is being deleted.
 */

/**
 * Records one audit entry.
 * @param {{action: string, userId?: string, requisitionId?: string, applicationId?: string, targetType?: string,
 *   targetId?: string, oldValue?: any, newValue?: any, reason?: string}} entry
 */
export async function record(entry) {
  return plain(await AuditLog.create(entry));
}

/**
 * A page of entries, newest first, each with the acting user's name and email filled in on `userId`.
 * Every filter is optional.
 * @returns {Promise<{entries: object[], total: number}>} the page, and how many entries match in total.
 */
export async function search({ requisitionId, applicationId, userId, action, dateFrom, dateTo, page, limit }) {
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
      .populate('userId', 'name email')
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  return { entries: plain(entries), total };
}

/** Deletes every entry about one job application. */
export async function removeForApplication(applicationId) {
  await AuditLog.deleteMany({ applicationId });
}

/** Deletes every entry about any of these job applications. */
export async function removeForApplications(applicationIds) {
  await AuditLog.deleteMany({ applicationId: { $in: applicationIds } });
}

/** Deletes every entry about one job opening. */
export async function removeForRequisition(requisitionId) {
  await AuditLog.deleteMany({ requisitionId });
}
