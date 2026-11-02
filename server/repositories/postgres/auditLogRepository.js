import { prisma } from './client.js';
import { castId, castIdField, castString, dateParam, idOut, jsonOut, jsonParam, newId, nullSet, validationError } from './helpers.js';

/**
 * Everything the app needs from the database about the audit log, on PostgreSQL. It offers exactly the functions of
 * ../mongo/auditLogRepository.js and answers the same way. The old and new values are JSON, so they are written with
 * raw SQL as text (Prisma would round numbers that need 17 digits) and read back as text.
 */

const COLUMNS = `id, action::text AS action, "userId", "requisitionId", "applicationId", "targetType", "targetId", "oldValue"::text AS "oldValueText", "newValue"::text AS "newValueText", reason, "timestamp", "nullFields"`;
const ACTIONS = ['score_override', 'score_approve', 'question_edit', 'stage_toggle', 'weight_change', 'disposition_change', 'final_decision',
  'provider_change', 'key_change', 'transcript_upload', 'consent_capture', 'retention_purge', 'requisition_status_change', 'candidate_update',
  'requisition_duplicated', 'offer_letter_sent', 'requisition_deleted'];

const has = (value) => value !== null && value !== undefined;

/** An audit row as the app has always seen it. An empty optional value is left out, as MongoDB left it out. */
const toEntry = (row) => {
  const nulls = nullSet(row);
  const empty = (field) => (nulls.has(field) ? null : undefined); // a field saved as an explicit null reads as null
  const stored = (text, field) => { const value = jsonOut(text); return value === undefined ? empty(field) : value; };
  const oldValue = stored(row.oldValueText, 'oldValue');
  const newValue = stored(row.newValueText, 'newValue');
  const text = (field, out = (v) => v) => (has(row[field]) ? { [field]: out(row[field]) } : (nulls.has(field) ? { [field]: null } : {}));
  return {
    _id: idOut(row.id),
    action: row.action,
    ...text('userId', idOut),
    ...text('requisitionId', idOut),
    ...text('applicationId', idOut),
    ...text('targetType'),
    ...text('targetId'),
    ...(oldValue !== undefined ? { oldValue } : {}),
    ...(newValue !== undefined ? { newValue } : {}),
    ...text('reason'),
    timestamp: row.timestamp,
  };
};

/**
 * Records one audit entry.
 * @param {{action: string, userId?: string|number, requisitionId?: string|number, applicationId?: string|number, targetType?: string,
 *   targetId?: string, oldValue?: any, newValue?: any, reason?: string}} entry
 */
export async function record(entry = {}) {
  const problems = {};
  const take = (cast, field) => {
    const result = cast(entry[field], field);
    if (result.problem) problems[field] = result.problem;
    return result.value;
  };
  // Mongoose reports values it cannot read first, then what is missing or not allowed
  const action = take(castString, 'action');
  const userId = take(castIdField, 'userId');
  const requisitionId = take(castIdField, 'requisitionId');
  const applicationId = take(castIdField, 'applicationId');
  const targetType = take(castString, 'targetType');
  const targetId = take(castString, 'targetId');
  const reason = take(castString, 'reason');
  let when = entry.timestamp === undefined ? new Date() : (entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp));
  if (Number.isNaN(when.getTime())) { problems.timestamp = `Cast to date failed for value "Invalid Date" (type Date) at path "timestamp"`; when = new Date(); }
  if (!problems.action) {
    if (!has(action) || action === '') problems.action = 'Path `action` is required.';
    else if (!ACTIONS.includes(action)) problems.action = `\`${action}\` is not a valid enum value for path \`action\`.`;
  }
  if (Object.keys(problems).length) throw validationError('AuditLog', problems);

  const nulled = ['userId', 'requisitionId', 'applicationId', 'targetType', 'targetId', 'reason', 'oldValue', 'newValue'].filter((field) => entry[field] === null).sort();
  const [{ id }] = await prisma.$queryRawUnsafe(
    `INSERT INTO audit_logs (id, action, "userId", "requisitionId", "applicationId", "targetType", "targetId", "oldValue", "newValue", reason, "timestamp", "nullFields")
     VALUES ($1::uuid, $2::"AuditAction", $3::uuid, $4::uuid, $5::uuid, $6, $7, $8::jsonb, $9::jsonb, $10, $11::text::timestamp, $12::jsonb) RETURNING id`,
    newId(), action, userId ?? null, requisitionId ?? null, applicationId ?? null, targetType ?? null, targetId ?? null,
    entry.oldValue === null ? null : jsonParam(entry.oldValue), entry.newValue === null ? null : jsonParam(entry.newValue), reason ?? null, dateParam(when), nulled.length ? JSON.stringify(nulled) : null,
  );
  const [row] = await prisma.$queryRawUnsafe(`SELECT ${COLUMNS} FROM audit_logs WHERE id = $1::uuid`, id);
  return toEntry(row);
}

/** A date from a filter, or the error MongoDB gives for one it cannot read. */
function dateFilter(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error('Cast to date failed for value "Invalid Date" (type Date) at path "timestamp"');
    error.name = 'CastError'; error.kind = 'date'; error.path = 'timestamp'; error.value = date;
    throw error;
  }
  return dateParam(date);
}

/**
 * A page of entries, newest first, each with the acting user's name and email filled in on `userId`.
 * Every filter is optional.
 * @returns {Promise<{entries: object[], total: number}>} the page, and how many entries match in total.
 */
export async function search({ requisitionId, applicationId, userId, action, dateFrom, dateTo, page, limit }) {
  const conditions = []; const params = [];
  const add = (sql, value) => { params.push(value); conditions.push(sql.replace('?', `$${params.length}`)); };
  if (requisitionId) add(`"requisitionId" = ?::uuid`, castId(requisitionId, 'requisitionId'));
  if (applicationId) add(`"applicationId" = ?::uuid`, castId(applicationId, 'applicationId'));
  if (userId) add(`"userId" = ?::uuid`, castId(userId, 'userId'));
  if (action) add(`action::text = ?`, String(action));
  if (dateFrom) add(`"timestamp" >= ?::text::timestamp`, dateFilter(dateFrom));
  if (dateTo) add(`"timestamp" <= ?::text::timestamp`, dateFilter(dateTo));
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const skip = (page - 1) * limit;
  const paging = limit > 0 ? ` LIMIT ${Math.floor(limit)} OFFSET ${Math.max(0, Math.floor(skip))}` : (skip > 0 ? ` OFFSET ${Math.floor(skip)}` : '');
  const [rows, [{ total }]] = await Promise.all([
    prisma.$queryRawUnsafe(`SELECT ${COLUMNS} FROM audit_logs ${where} ORDER BY "timestamp" DESC, id DESC${paging}`, ...params),
    prisma.$queryRawUnsafe(`SELECT count(*)::int AS total FROM audit_logs ${where}`, ...params),
  ]);

  const userIds = [...new Set(rows.map((row) => row.userId).filter(has))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const byId = new Map(users.map((user) => [user.id, { _id: idOut(user.id), name: user.name, email: user.email }]));
  const entries = rows.map((row) => {
    const entry = toEntry(row);
    if (has(row.userId)) entry.userId = byId.get(row.userId) || null; // a user who no longer exists shows as null, as with MongoDB
    return entry;
  });
  return { entries, total };
}

/** Deletes every entry about one job application. */
export async function removeForApplication(applicationId) {
  await prisma.auditLog.deleteMany({ where: { applicationId: castId(applicationId, 'applicationId') } });
}

/** Deletes every entry about any of these job applications. */
export async function removeForApplications(applicationIds) {
  await prisma.auditLog.deleteMany({ where: { applicationId: { in: applicationIds.map((id) => castId(id, 'applicationId')) } } });
}

/** Deletes every entry about one job opening. */
export async function removeForRequisition(requisitionId) {
  await prisma.auditLog.deleteMany({ where: { requisitionId: castId(requisitionId, 'requisitionId') } });
}
