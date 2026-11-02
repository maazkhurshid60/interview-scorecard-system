/**
 * Proves the copy is exact: compares EVERY field of EVERY record between MongoDB and PostgreSQL, and follows every link.
 *
 *   npm run verify:postgres
 *
 * It does not reuse the migration's own rules. What each value should be is worked out from the Mongoose models
 * (types, defaults), so a mistake in the migration cannot hide itself here. Rows the migration reported as skipped
 * (logs/migration-report.json) must be absent from Postgres; every other record must be present and identical.
 *
 * Ids: every record must have the UUID its old id maps to (worked out here, on its own, from the 24 characters of the old id: its
 * time in milliseconds, then its other 8 bytes; see prisma/migrate/uuid.js for the layout). Every link between records (a candidate
 * id inside an application, a user id inside an audit entry, a score's `overriddenBy` inside JSON) must hold the UUID of the record
 * it pointed at, or be empty when that record does not exist or was not copied. Job openings and interviews must keep their old id
 * in `legacyId`, and every one of them must have its own `publicToken`.
 *
 * Set MIGRATE_MONGO_URI to compare against a different MongoDB than MONGODB_URI. Exit code 1 if anything differs.
 */
import '../../config/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { PrismaClient } from './shared.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..', '..');
const mongoUri = process.env.MIGRATE_MONGO_URI || process.env.MONGODB_URI;

// Mongoose model -> Prisma delegate, and where a few Mongoose fields live in Postgres (the design decisions)
const MODEL_TO_DELEGATE = { User: 'user', RefreshToken: 'refreshToken', Setting: 'setting', AuditLog: 'auditLog', Department: 'department', PipelineTemplate: 'pipelineTemplate', Candidate: 'candidate', Requisition: 'requisition', Scorecard: 'scorecard', Application: 'application', Interview: 'interview' };
const TABLE_OF = { user: 'users', refreshToken: 'refresh_tokens', setting: 'settings', auditLog: 'audit_logs', department: 'departments', pipelineTemplate: 'pipeline_templates', candidate: 'candidates', requisition: 'requisitions', scorecard: 'scorecards', application: 'applications', interview: 'interviews' };
const RENAMES = {
  Application: { 'screeningJob.status': 'screeningStatus', 'screeningJob.attempts': 'screeningAttempts', 'screeningJob.lockedAt': 'screeningLockedAt', 'screeningJob.completedAt': 'screeningCompletedAt', 'screeningJob.lastError': 'screeningLastError', 'screeningJob.confirmationEmailSentAt': 'screeningConfirmationEmailSentAt' },
  Interview: { 'aiTokensUsed.input': 'aiInputTokens', 'aiTokensUsed.output': 'aiOutputTokens' },
};
const JSON_GROUPS = { Application: ['candidateAvailability', 'initialScreening'], Interview: ['candidateAvailability'] };
// Ids kept inside a JSON column (the Mongoose models name them as ObjectIds): they must be UUIDs in Postgres.
const JSON_LINKS = { Interview: { field: 'scores', each: true, key: 'overriddenBy', target: 'User' }, Application: { field: 'initialScreening', each: false, key: 'overriddenBy', target: 'User' } };
const KEEPS_OLD_ID = new Set(['Requisition', 'Interview']); // have `legacyId` and `publicToken`

const isObjectId = (v) => v && typeof v === 'object' && (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID');
const idText = (v) => (isObjectId(v) ? v.toHexString() : String(v));
const getPath = (doc, p) => p.split('.').reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), doc);

/** One comparable form of any value: ObjectId -> text, Date -> ISO text, object keys sorted, undefined removed. */
function canon(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (isObjectId(v)) return v.toHexString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : canon(x)));
  if (typeof v === 'object') {
    if (v._bsontype) return Number(v.toString());
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]).filter(([, x]) => x !== undefined));
  }
  return v;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
/** The value without any NUL character in its text or its keys: PostgreSQL cannot store them, so the copy takes them out (and reports it). */
function noNul(value) {
  const NUL = String.fromCharCode(0);
  if (typeof value === 'string') return value.split(NUL).join('');
  if (Array.isArray(value)) return value.map(noNul);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.split(NUL).join(''), noNul(v)]));
  return value;
}

const prisma = new PrismaClient();
// This script only READS MongoDB. Loading the models below would otherwise make Mongoose create their indexes (and any missing
// collection) on the database it is connected to, which must never happen on a live database.
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
await mongoose.connect(mongoUri);
const mongo = mongoose.connection.db;
const reportPath = process.env.MIGRATE_REPORT_PATH || path.join(serverDir, 'logs', 'migration-report.json');
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { models: {} };

const problems = []; let fieldChecks = 0; let recordChecks = 0;
const summary = [];
const addProblem = (model, id, field, expected, actual) => problems.push({ model, id, field, expected, actual });

// ---- the UUID every old id must have, worked out from the old id alone (its own implementation, not the copy's: the 128 bits are
// built as one big number)
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function expectedUuid(oldId) {
  const hex = String(oldId).toLowerCase();
  if (!/^[0-9a-f]{24}$/.test(hex)) return undefined; // an id that is not a MongoDB id cannot become a UUID: the copy skips such a record
  const milliseconds = BigInt(`0x${hex.slice(0, 8)}`) * 1000n;
  const tail = BigInt(`0x${hex.slice(8)}`); // the 64 bits after the time
  const value = (milliseconds << 80n) | (7n << 76n) | ((tail >> 52n) << 64n) | (0x8n << 60n) | ((tail & ((1n << 52n) - 1n)) << 8n);
  const flat = value.toString(16).padStart(32, '0');
  return `${flat.slice(0, 8)}-${flat.slice(8, 12)}-${flat.slice(12, 16)}-${flat.slice(16, 20)}-${flat.slice(20)}`;
}
const models = {};
for (const modelName of Object.keys(MODEL_TO_DELEGATE)) {
  const Model = (await import(pathToFileURL(path.join(serverDir, 'models', `${modelName}.js`)).href)).default;
  const ids = (await mongo.collection(Model.collection.name).find({}, { projection: { _id: 1 } }).toArray()).map((d) => idText(d._id)).sort();
  models[modelName] = { Model, numbers: new Map(ids.filter((id) => expectedUuid(id)).map((id) => [id, expectedUuid(id)])), skipped: new Set(((report.models[MODEL_TO_DELEGATE[modelName]] || {}).skipped || []).map((s) => s.id)) };
}

/** The UUID a link to this record must hold, or null when the record does not exist in MongoDB or was not copied. */
function linkNumber(targetModel, raw) {
  const target = models[targetModel];
  if (!target) throw new Error(`The link points at "${targetModel}", which this verifier does not know.`);
  const old = idText(raw);
  const number = target.numbers.get(old);
  return number === undefined || target.skipped.has(old) ? null : number;
}

/** The JSON value a column must hold: the same as in MongoDB, with the ids inside it replaced by UUIDs. */
function expectedJson(modelName, field, raw) {
  const link = JSON_LINKS[modelName];
  const value = noNul(canon(raw));
  if (!link || link.field !== field || value === null || value === undefined) return value;
  for (const item of link.each ? (Array.isArray(value) ? value : []) : [value]) {
    if (!item || typeof item !== 'object' || item[link.key] === undefined || item[link.key] === null) continue;
    const number = linkNumber(link.target, item[link.key]);
    if (number === null) delete item[link.key]; else item[link.key] = number;
  }
  return value;
}

for (const [modelName, delegate] of Object.entries(MODEL_TO_DELEGATE)) {
  const { Model, numbers, skipped: skippedIds } = models[modelName];
  const schemaPaths = Model.schema.paths; const ts = Model.schema.options.timestamps;
  const docs = await mongo.collection(Model.collection.name).find({}).toArray();
  // Every row is read back as exact JSON text straight from Postgres (not through Prisma, which rounds numbers that need 17 digits).
  const dateColumns = new Set();
  for (const [p, info] of Object.entries(schemaPaths)) if (info.instance === 'Date') dateColumns.add((RENAMES[modelName] && RENAMES[modelName][p]) || p);
  if (ts === true || (ts && ts.createdAt)) dateColumns.add('createdAt'); if (ts === true || (ts && ts.updatedAt)) dateColumns.add('updatedAt');
  const rows = (await prisma.$queryRawUnsafe(`select to_jsonb(t)::text as j from "${TABLE_OF[delegate]}" t`)).map((r) => {
    const row = JSON.parse(r.j);
    for (const c of dateColumns) if (typeof row[c] === 'string') row[c] = new Date(row[c] + 'Z'); // timestamps are stored as UTC without a zone mark
    return row;
  });
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const repairedFields = new Set(((report.models[delegate] || {}).repaired || []).map((r) => `${r.id}:${r.field}`)); // changes the migration announced
  let compared = 0;
  const expectedIds = new Set();

  for (const doc of docs) {
    const id = idText(doc._id); // the old id, used to name the record in the messages
    const uuid = numbers.get(id);
    if (skippedIds.has(id)) { recordChecks += 1; if (uuid && rowById.has(uuid)) addProblem(modelName, id, '(record)', 'skipped by the migration, so absent', 'present in Postgres'); continue; }
    recordChecks += 1;
    if (!uuid) { addProblem(modelName, id, '(record)', 'skipped (its id is not a 24-character MongoDB id, so it cannot become a UUID)', 'not reported as skipped'); continue; }
    expectedIds.add(uuid);
    const row = rowById.get(uuid);
    if (!row) { addProblem(modelName, id, '(record)', `present in Postgres with the id ${uuid}`, 'missing'); continue; }
    compared += 1;

    // the old id kept for public links, and the token for new ones
    if (KEEPS_OLD_ID.has(modelName)) {
      fieldChecks += 1; if (row.legacyId !== id) addProblem(modelName, id, 'legacyId', id, row.legacyId);
      fieldChecks += 1; if (typeof row.publicToken !== 'string' || row.publicToken.length < 20) addProblem(modelName, id, 'publicToken', 'a random token', row.publicToken);
    }

    // timestamps
    const created = doc.createdAt instanceof Date ? doc.createdAt : (isObjectId(doc._id) ? doc._id.getTimestamp() : null);
    if (ts === true || (ts && ts.createdAt)) { fieldChecks += 1; if (!(row.createdAt instanceof Date) || row.createdAt.getTime() !== created.getTime()) addProblem(modelName, id, 'createdAt', created, row.createdAt); }
    if (ts === true || (ts && ts.updatedAt)) { fieldChecks += 1; const u = doc.updatedAt instanceof Date ? doc.updatedAt : created; if (!(row.updatedAt instanceof Date) || row.updatedAt.getTime() !== u.getTime()) addProblem(modelName, id, 'updatedAt', u, row.updatedAt); }

    const groupSeen = {};
    for (const [p, info] of Object.entries(schemaPaths)) {
      if (['_id', '__v'].includes(p)) continue;
      if (['createdAt', 'updatedAt'].includes(p) && ts !== undefined) continue;
      let target = (RENAMES[modelName] && RENAMES[modelName][p]) || p; let group = false;
      const g = (JSON_GROUPS[modelName] || []).find((x) => p.startsWith(x + '.'));
      if (g && !(RENAMES[modelName] && RENAMES[modelName][p])) { target = g; group = true; }
      if (group) { if (groupSeen[target]) continue; groupSeen[target] = true; }
      fieldChecks += 1;

      const raw = group ? doc[target] : getPath(doc, p);
      const actual = row[target];
      const isJson = group || ['Mixed', 'Array', 'Embedded'].includes(info.instance);
      const isLink = info.instance === 'ObjectId' && !group;
      if (isLink && !(info.options && info.options.ref)) throw new Error(`${modelName}.${p} is an ObjectId without a "ref", so the verifier cannot tell which record it points at.`);
      let expected;
      if (repairedFields.has(`${id}:${target}`)) expected = null; // reported as repaired (emptied) by the migration
      else if (raw === undefined || raw === null) {
        let def = info.options && info.options.default;
        if (typeof def === 'function') def = def === Date.now ? '<any date>' : undefined;
        if (raw === undefined && info.instance === 'Array') expected = [];
        else if (raw === undefined && def !== undefined && def !== null) expected = def;
        else expected = null;
      } else if (isLink) expected = linkNumber(info.options.ref, raw); // the number of the record pointed at, or null
      else if (isJson) expected = expectedJson(modelName, target, raw);
      else expected = typeof raw === 'string' ? noNul(raw) : raw;
      if (group && expected && typeof expected === 'object' && !Array.isArray(expected) && Object.keys(expected).length === 0) expected = null; // an empty nested object is stored as empty

      if (expected === '<any date>') { if (!(actual instanceof Date)) addProblem(modelName, id, target, 'a date', actual); continue; }
      let ok;
      if (isJson) ok = (expected === null ? (actual === null || actual === undefined) : same(expected, actual));
      else if (expected === null) ok = actual === null || actual === undefined;
      else if (info.instance === 'Date') ok = actual instanceof Date && actual.getTime() === new Date(expected).getTime();
      else if (isLink) ok = actual === expected;
      else if (info.instance === 'Number') ok = typeof actual === 'number' && actual === Number(expected);
      else if (info.instance === 'Boolean') ok = actual === (expected === 'true' ? true : expected === 'false' ? false : expected);
      else ok = actual === (typeof expected === 'string' ? expected : String(expected)); // String and enums
      if (!ok) addProblem(modelName, id, target, canon(expected), actual instanceof Date ? actual.toISOString() : actual);
      // a field stored as an explicit null must be recorded as one (unless its Mongoose default is null), and nothing else may be
      const shouldBeRecorded = raw === null && !repairedFields.has(`${id}:${target}`) && !(info.options && info.options.default === null);
      const nullPath = group ? target : p;
      const isRecorded = Array.isArray(row.nullFields) && row.nullFields.includes(nullPath);
      if (shouldBeRecorded !== isRecorded) addProblem(modelName, id, `${nullPath} (explicit null)`, shouldBeRecorded ? 'recorded' : 'not recorded', isRecorded ? 'recorded' : 'not recorded');
    }
  }
  // rows in Postgres that do not belong to any MongoDB record
  for (const row of rows) { recordChecks += 1; if (!expectedIds.has(row.id)) addProblem(modelName, `id ${row.id}`, '(record)', 'no such record in MongoDB (or skipped), so not in Postgres', 'present'); }

  // every id must be a UUID version 7, the kind the app makes for new records (a new record must sort after every copied one)
  recordChecks += 1;
  const notV7 = rows.filter((r) => !UUID_V7.test(r.id));
  if (notV7.length) addProblem(modelName, '(table)', 'ids', 'all UUID version 7', `${notV7.length} are not, for example ${notV7[0].id}`);

  // every public token must be different
  if (KEEPS_OLD_ID.has(modelName)) { recordChecks += 1; const tokens = new Set(rows.map((r) => r.publicToken)); if (tokens.size !== rows.length) addProblem(modelName, '(table)', 'publicToken', 'all different', `${tokens.size} different of ${rows.length}`); }
  summary.push({ modelName, mongo: docs.length, postgres: rows.length, skipped: skippedIds.size, compared });
}

console.log('\n  model              in MongoDB   in Postgres   skipped   compared field by field');
for (const s of summary) console.log(`  ${s.modelName.padEnd(18)} ${String(s.mongo).padStart(10)}   ${String(s.postgres).padStart(11)}   ${String(s.skipped).padStart(7)}   ${String(s.compared).padStart(8)}`);
console.log(`\nrecord checks: ${recordChecks}   field comparisons: ${fieldChecks}`);
if (problems.length) {
  console.log(`\nDIFFERENCES (${problems.length}):`);
  problems.slice(0, 40).forEach((p) => console.log(`  X ${p.model} ${p.id}  ${p.field}\n      MongoDB says : ${JSON.stringify(p.expected)?.slice(0, 160)}\n      Postgres has : ${JSON.stringify(p.actual)?.slice(0, 160)}`));
  if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
} else console.log('\nPASS: every record, every field and every link in Postgres is identical to MongoDB.');

await prisma.$disconnect(); await mongoose.disconnect();
process.exit(problems.length ? 1 : 0);
