import prismaPkg from '@prisma/client';

/**
 * What the MongoDB -> PostgreSQL copy needs to know about each model: which Mongo collection, which Prisma table, and
 * every column with its type, whether it is required, its default, and where the value comes from in the Mongo document.
 *
 * It mirrors server/prisma/schema.prisma. The verification script (verify.js) does NOT use this list: it works out what
 * every value should be from the Mongoose models themselves, so a mistake here cannot hide itself.
 */

const { PrismaClient, ...generated } = prismaPkg;
export { PrismaClient };

/** The allowed values of a Postgres enum, from the generated Prisma client. */
export const enumValues = (name) => Object.values(generated[name] || {});

const f = (name, type, options = {}) => ({ name, type, ...options });
const s = (name, o) => f(name, 's', o); // text
const n = (name, o) => f(name, 'n', o); // number (double precision)
const b = (name, o) => f(name, 'b', o); // boolean
const d = (name, o) => f(name, 'd', o); // date and time
const j = (name, o) => f(name, 'j', o); // JSON
const e = (name, enumName, o) => f(name, 'e', { enumName, ...o }); // enum

const REQ = { req: true };

// A column that holds the id of another record is written s('name', { ref: 'user' }) (or, when the database enforces the link,
// { parent: ... } / { softParent: ... }, which also name the record pointed at). The copy reads the old MongoDB id as text and
// translates it to the new number. 'jsonRefs' lists the places inside a JSON column that hold such an id.

export const MODELS = [
  { delegate: 'user', collection: 'users', timestamps: 'both', fields: [
    s('name', REQ), s('email', REQ), s('passwordHash', REQ), s('passwordResetTokenHash'), d('passwordResetExpiresAt'), d('passwordChangedAt'),
    e('role', 'UserRole', { def: 'recruiter' }), b('active', { def: true }),
  ] },
  { delegate: 'department', collection: 'departments', timestamps: 'both', fields: [
    s('name', REQ), s('description', { def: '' }), s('createdBy', { ref: 'user' }),
  ] },
  { delegate: 'pipelineTemplate', collection: 'pipelinetemplates', timestamps: 'both', fields: [
    s('name', REQ), s('description'), b('isDefault', { def: false }), b('autoWeights', { def: true }), j('stages', { def: [] }),
  ] },
  { delegate: 'setting', collection: 'settings', timestamps: 'updatedOnly', fields: [
    s('key', REQ), j('value'), s('description'),
  ] },
  { delegate: 'candidate', collection: 'candidates', timestamps: 'both', fields: [
    s('name', REQ), s('email', REQ), s('phone'), s('resumeFileUrl'), s('resumeFilePublicId'), s('resumeFileName'), n('resumeFileSize'), s('resumeFileMimeType'), s('notes'),
  ] },
  { delegate: 'requisition', collection: 'requisitions', timestamps: 'both', legacyId: true, publicToken: true, fields: [
    s('title', REQ), e('employmentType', 'EmploymentType', { def: 'full_time' }),
    j('fullTimeDetails'), j('partTimeDetails'), j('contractDetails'), j('internshipDetails'), j('temporaryDetails'),
    s('location', { def: 'Remote' }), e('workplaceType', 'WorkplaceType', { def: 'remote' }), s('officeLocation', { def: '' }), s('remoteRegion', { def: '' }),
    s('jobDescription', REQ), e('status', 'RequisitionStatus', { def: 'open' }),
    s('departmentId', { softParent: 'department' }), s('pipelineTemplateId', { ref: 'pipelineTemplate' }), s('pipelineTemplateName'), j('stages', { def: [] }), s('scorecardId', { ref: 'scorecard' }),
    n('hireThreshold', { def: 3.5 }), n('maybeThreshold', { def: 3 }), j('initialScreeningCriteria', { def: [] }), j('questionnaire', { def: [] }),
    j('interviewAvailability'), d('applicationDeadline', { defNull: true }), b('aiScreeningEnabled', { def: true }), d('closedAt'), s('createdBy', { ref: 'user' }),
  ] },
  { delegate: 'scorecard', collection: 'scorecards', timestamps: 'both', fields: [
    s('requisitionId', { ...REQ, parent: 'requisition' }), b('generatedByAI', { def: true }), j('stages', { def: [] }),
  ] },
  { delegate: 'application', collection: 'applications', timestamps: 'both', fields: [
    s('candidateId', { ...REQ, parent: 'candidate' }), s('requisitionId', { ...REQ, parent: 'requisition' }), s('currentStageKey'),
    e('source', 'ApplicationSource', { def: 'manual' }), s('opportunityDuration'), j('questionnaireAnswers'), j('candidateAvailability'),
    e('screeningStatus', 'ScreeningStatus', { from: 'screeningJob.status' }), n('screeningAttempts', { from: 'screeningJob.attempts', def: 0 }),
    d('screeningLockedAt', { from: 'screeningJob.lockedAt' }), d('screeningCompletedAt', { from: 'screeningJob.completedAt' }),
    s('screeningLastError', { from: 'screeningJob.lastError' }), d('screeningConfirmationEmailSentAt', { from: 'screeningJob.confirmationEmailSentAt' }),
    j('stageProgress', { def: [] }), j('initialScreening'),
    n('weightedTotal'), b('allGatesPassed'), e('disposition', 'Disposition', { defNull: true }), n('rank'), e('finalDecision', 'FinalDecision', { defNull: true }), s('finalDecisionBy', { ref: 'user' }), s('rejectionReason'),
    s('offerLetterUrl'), s('offerLetterPublicId'), s('offerLetterFileName'), n('offerLetterFileSize'), s('offerLetterFileMimeType'), d('offerLetterUploadedAt'),
    s('offerLetterTemplateKey'), j('offerLetterFields'), e('offerLetterDeliveryStatus', 'DeliveryStatus'), d('offerLetterSentAt'),
    e('onboardingFormDeliveryStatus', 'DeliveryStatus'), d('onboardingFormSentAt'),
  ], jsonRefs: [{ field: 'initialScreening', key: 'overriddenBy', target: 'user' }] },
  { delegate: 'interview', collection: 'interviews', timestamps: 'both', legacyId: true, publicToken: true, fields: [
    s('applicationId', { ...REQ, parent: 'application' }), s('requisitionId', { ...REQ, parent: 'requisition' }), s('stageKey', REQ),
    e('meetingMode', 'MeetingMode', { def: 'online' }), e('provider', 'TranscriptProvider', { def: 'google_meet' }),
    s('meetingUri'), s('calendarEventId'), d('meetingStart'), d('meetingEnd'), s('conferenceId'), s('designatedScorerId', { ref: 'user' }),
    j('candidateAvailability'), b('consentObtained', { def: false }), s('transcriptText'), e('transcriptStatus', 'TranscriptStatus', { def: 'none' }),
    s('artifactFileUrl'), s('artifactFilePublicId'), s('artifactFileName'), n('artifactFileSize'), s('artifactFileMimeType'),
    j('scores', { def: [] }), n('stageAverage'), e('status', 'InterviewStatus', { def: 'pending' }),
    n('aiInputTokens', { from: 'aiTokensUsed.input' }), n('aiOutputTokens', { from: 'aiTokensUsed.output' }), n('aiCostUsd'),
  ], jsonRefs: [{ field: 'scores', each: true, key: 'overriddenBy', target: 'user' }] },
  { delegate: 'refreshToken', collection: 'refreshtokens', timestamps: 'createdOnly', fields: [
    s('userId', { ...REQ, parent: 'user' }), s('tokenHash', REQ), s('familyId', REQ), d('familyStartedAt', REQ), d('expiresAt', REQ),
    d('usedAt', { defNull: true }), d('revokedAt', { defNull: true }), s('userAgent'), s('ip'),
  ] },
  { delegate: 'auditLog', collection: 'auditlogs', timestamps: 'none', fields: [
    e('action', 'AuditAction', REQ), s('userId', { ref: 'user' }), s('requisitionId', { ref: 'requisition' }), s('applicationId', { ref: 'application' }), s('targetType'), s('targetId'), j('oldValue'), j('newValue'), s('reason'),
    d('timestamp', { def: 'now' }),
  ] },
];

/** The Postgres table of each model (the @@map names in schema.prisma). */
const TABLES = { user: 'users', department: 'departments', pipelineTemplate: 'pipeline_templates', setting: 'settings', candidate: 'candidates', requisition: 'requisitions', scorecard: 'scorecards', application: 'applications', interview: 'interviews', refreshToken: 'refresh_tokens', auditLog: 'audit_logs' };
MODELS.forEach((m) => { m.table = TABLES[m.delegate]; });

// ---------------------------------------------------------------------------------------------------- value helpers

const isObjectId = (v) => v && typeof v === 'object' && (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID');

/** The text of an id (an ObjectId, or something already text). */
export const idText = (v) => (isObjectId(v) ? v.toHexString() : String(v));

/**
 * Gives every old id a new number: 1, 2, 3, ... in the order the records were created (an ObjectId starts with the time it
 * was made, so sorting the ids as text puts them in creation order).
 * @param {string[]} oldIds the ids of one collection, as text
 * @returns {Map<string, number>} old id -> new number
 */
export function numberIds(oldIds) {
  const sorted = [...oldIds].sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
  const numbers = new Map(sorted.map((id, i) => [id, i + 1]));
  if (numbers.size !== oldIds.length) throw new Error('Two records have the same id; they cannot be numbered.');
  return numbers;
}

/**
 * Replaces, in one row, every old id that points at another record with that record's new number.
 * - A link column ({ ref } / { parent } / { softParent }) holds the old id as text; it becomes the new number.
 * - 'jsonRefs' name the ids kept inside a JSON column (for example a score's `overriddenBy`); they become numbers too.
 * A link to a record that does not exist (or was not copied) cannot be a number: it is removed and a note is added, so it is
 * counted in the report and never silent.
 * @param {object} spec the model description
 * @param {object} row the row being built (changed in place)
 * @param {(target: string, oldId: string, inJson?: boolean) => (number|undefined)} numberOf the new number of a record, or undefined if there is none
 *   (`inJson` is true for an id kept inside a JSON column)
 * @param {string[]} notes receives one note per link that had to be removed
 */
export function translateLinks(spec, row, numberOf, notes) {
  for (const field of spec.fields) {
    const target = field.ref || field.parent || field.softParent;
    if (!target || row[field.name] === undefined || row[field.name] === null) continue;
    const number = numberOf(target, String(row[field.name]));
    if (number === undefined) { delete row[field.name]; notes.push(`${field.name}: pointed at a ${target} that does not exist; set to empty`); } else row[field.name] = number;
  }
  for (const link of spec.jsonRefs || []) {
    const holder = row[link.field];
    if (holder === undefined || holder === null) continue;
    for (const item of link.each ? (Array.isArray(holder) ? holder : []) : [holder]) {
      if (!item || typeof item !== 'object' || item[link.key] === undefined || item[link.key] === null) continue;
      const number = numberOf(link.target, String(item[link.key]), true);
      if (number === undefined) { delete item[link.key]; notes.push(`${link.field}.${link.key}: pointed at a ${link.target} that does not exist; removed`); } else item[link.key] = number;
    }
  }
}

/** How many strings inside a JSON value are the old id of a record (an id that was not translated). */
export function countOldIds(value, oldIds) {
  if (typeof value === 'string') return oldIds.has(value) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countOldIds(item, oldIds), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce((sum, item) => sum + countOldIds(item, oldIds), 0);
  return 0;
}

/** The value at a dotted path (`screeningJob.status`) of a document, or undefined. */
export const getPath = (doc, path) => path.split('.').reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), doc);

/**
 * Text without its NUL characters (U+0000). PostgreSQL cannot store a NUL in text or JSON at all (it refuses the whole row), and a
 * NUL is an invisible control character that only ever gets into text by accident (for example from a PDF). `counter.removed`
 * counts how many were taken out, so the copy can report it.
 */
export function withoutNul(text, counter) {
  if (typeof text !== 'string' || !text.includes('\u0000')) return text;
  const parts = text.split('\u0000');
  if (counter) counter.removed += parts.length - 1;
  return parts.join('');
}

/** Turns what MongoDB stores into plain JSON: ObjectIds become text, dates become ISO text, NUL characters are taken out. Absent keys stay absent. */
export function toJson(value, counter) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') return withoutNul(value, counter);
  if (isObjectId(value)) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((x) => (x === undefined ? null : toJson(x, counter)));
  if (value && typeof value === 'object') {
    if (value._bsontype === 'Decimal128' || value._bsontype === 'Long' || value._bsontype === 'Int32' || value._bsontype === 'Double') return Number(value.toString());
    if (Buffer.isBuffer(value)) return value.toString('base64');
    const out = {};
    for (const [k, v] of Object.entries(value)) { const x = toJson(v, counter); if (x !== undefined) out[withoutNul(k, counter)] = x; }
    return out;
  }
  return value;
}

/**
 * Turns one Mongo document into one Postgres row, or says why it cannot be.
 * @returns {{row: object, notes: string[], blocking: string[]}} `blocking` lists problems that stop this row being written.
 */
export function transform(spec, doc, now = new Date()) {
  const row = { id: idText(doc._id) };
  const notes = []; const blocking = [];
  const nulls = []; // paths of the fields stored as an explicit null (MongoDB tells that from "not set"; an empty column cannot)

  for (const field of spec.fields) {
    const raw = getPath(doc, field.from || field.name);
    let value;

    if (raw === undefined) {
      if (field.def !== undefined) value = field.def === 'now' ? now : (Array.isArray(field.def) ? [] : field.def); // what Mongoose fills in when loading
      else value = undefined;
    } else if (raw === null) {
      value = null;
      if (!field.defNull) nulls.push(field.from || field.name); // a field whose default is null is not recorded: it reads as null anyway
    } else {
      switch (field.type) {
        case 's':
          if (typeof raw === 'string') { const counter = { removed: 0 }; value = withoutNul(raw, counter); if (counter.removed) notes.push(`${field.name}: ${counter.removed} NUL character(s) removed (PostgreSQL cannot store them)`); }
          else if (isObjectId(raw)) value = raw.toHexString();
          else if (typeof raw === 'number' || typeof raw === 'boolean') { value = String(raw); notes.push(`${field.name}: ${typeof raw} stored where text is expected; converted to text`); }
          else { blocking.push(`${field.name}: cannot use a ${typeof raw} as text`); }
          break;
        case 'n':
          if (typeof raw === 'number' && Number.isFinite(raw)) value = raw;
          else if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) { value = Number(raw); notes.push(`${field.name}: text stored where a number is expected; converted`); }
          else if (raw && typeof raw === 'object' && raw._bsontype && Number.isFinite(Number(raw.toString()))) value = Number(raw.toString());
          else blocking.push(`${field.name}: "${String(raw).slice(0, 40)}" is not a number`);
          break;
        case 'b':
          if (typeof raw === 'boolean') value = raw;
          else if (raw === 'true' || raw === 'false') { value = raw === 'true'; notes.push(`${field.name}: text stored where a boolean is expected; converted`); }
          else blocking.push(`${field.name}: "${String(raw).slice(0, 40)}" is not true or false`);
          break;
        case 'd':
          if (raw instanceof Date && !Number.isNaN(raw.getTime())) value = raw;
          else if ((typeof raw === 'string' || typeof raw === 'number') && !Number.isNaN(new Date(raw).getTime())) { value = new Date(raw); notes.push(`${field.name}: ${typeof raw} stored where a date is expected; converted`); }
          else blocking.push(`${field.name}: "${String(raw).slice(0, 40)}" is not a date`);
          break;
        case 'e':
          if (enumValues(field.enumName).includes(raw)) value = raw;
          else blocking.push(`${field.name}: "${String(raw).slice(0, 40)}" is not one of [${enumValues(field.enumName).join(', ')}]`);
          break;
        case 'j': {
          const counter = { removed: 0 };
          value = toJson(raw, counter);
          if (counter.removed) notes.push(`${field.name}: ${counter.removed} NUL character(s) removed (PostgreSQL cannot store them)`);
          break;
        }
        default:
          blocking.push(`${field.name}: unknown column type ${field.type}`);
      }
    }

    if (value === undefined && field.req) blocking.push(`${field.name}: required but missing`);
    if (value === null && (field.req || field.def !== undefined)) blocking.push(`${field.name}: null stored in a column that cannot be empty`);
    if (value !== undefined) row[field.name] = value; // JSON columns: null is left out, so the column is simply empty
    if (field.type === 'j' && value === null) delete row[field.name];
  }

  // The nested objects Mongoose splits or keeps whole: a candidateAvailability / initialScreening object is kept as JSON
  // above; an empty one (nothing in it) is left out, as MongoDB's own save would have done.
  for (const name of ['candidateAvailability', 'initialScreening']) {
    if (row[name] && typeof row[name] === 'object' && Object.keys(row[name]).length === 0) delete row[name];
  }

  if (nulls.length) row.nullFields = nulls.sort();

  // dates Mongoose manages
  const created = doc.createdAt instanceof Date ? doc.createdAt : null;
  const updated = doc.updatedAt instanceof Date ? doc.updatedAt : null;
  const fromId = isObjectId(doc._id) ? doc._id.getTimestamp() : now;
  if (spec.timestamps === 'both') {
    row.createdAt = created || fromId; if (!created) notes.push(doc.createdAt === undefined ? 'createdAt missing; taken from the id' : 'createdAt is not a date; taken from the id');
    row.updatedAt = updated || row.createdAt; if (!updated) notes.push(doc.updatedAt === undefined ? 'updatedAt missing; set to createdAt' : 'updatedAt is not a date; set to createdAt');
  } else if (spec.timestamps === 'createdOnly') {
    row.createdAt = created || fromId; if (!created) notes.push('createdAt missing; taken from the id');
  } else if (spec.timestamps === 'updatedOnly') {
    // Setting.updatedAt is an ordinary field with a default of "now"
    row.updatedAt = updated || now; if (!updated) notes.push('updatedAt missing; set to now');
  }
  return { row, notes, blocking };
}
