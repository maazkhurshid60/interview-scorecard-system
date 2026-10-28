/**
 * Proves the copy is exact: compares EVERY field of EVERY record between MongoDB and PostgreSQL.
 *
 *   npm run verify:postgres
 *
 * It does not reuse the migration's own rules. What each value should be is worked out from the Mongoose models
 * (types, defaults), so a mistake in the migration cannot hide itself here. Rows the migration reported as skipped
 * (logs/migration-report.json) must be absent from Postgres; every other record must be present and identical.
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

const isObjectId = (v) => v && typeof v === 'object' && (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID');
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

const prisma = new PrismaClient();
await mongoose.connect(mongoUri);
const mongo = mongoose.connection.db;
const reportPath = path.join(serverDir, 'logs', 'migration-report.json');
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { models: {} };

const problems = []; let fieldChecks = 0; let recordChecks = 0;
const summary = [];
const addProblem = (model, id, field, expected, actual) => problems.push({ model, id, field, expected, actual });

for (const [modelName, delegate] of Object.entries(MODEL_TO_DELEGATE)) {
  const Model = (await import(pathToFileURL(path.join(serverDir, 'models', `${modelName}.js`)).href)).default;
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
  const skippedIds = new Set(((report.models[delegate] || {}).skipped || []).map((s) => s.id));
  const repairedFields = new Set(((report.models[delegate] || {}).repaired || []).map((r) => `${r.id}:${r.field}`)); // changes the migration announced
  let compared = 0;

  const mongoIds = new Set();
  for (const doc of docs) {
    const id = isObjectId(doc._id) ? doc._id.toHexString() : String(doc._id); mongoIds.add(id);
    const row = rowById.get(id);
    if (skippedIds.has(id)) { recordChecks += 1; if (row) addProblem(modelName, id, '(record)', 'skipped by the migration, so absent', 'present in Postgres'); continue; }
    recordChecks += 1;
    if (!row) { addProblem(modelName, id, '(record)', 'present in Postgres', 'missing'); continue; }
    compared += 1;

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
      let expected;
      if (repairedFields.has(`${id}:${target}`)) expected = null; // reported as repaired (emptied) by the migration
      else if (raw === undefined || raw === null) {
        let def = info.options && info.options.default;
        if (typeof def === 'function') def = def === Date.now ? '<any date>' : undefined;
        if (raw === undefined && info.instance === 'Array') expected = [];
        else if (raw === undefined && def !== undefined && def !== null) expected = def;
        else expected = null;
      } else expected = raw;
      if (group && expected && typeof expected === 'object' && !Array.isArray(expected) && Object.keys(expected).length === 0) expected = null; // an empty nested object is stored as empty

      if (expected === '<any date>') { if (!(actual instanceof Date)) addProblem(modelName, id, target, 'a date', actual); continue; }
      let ok;
      if (isJson) ok = (expected === null ? (actual === null || actual === undefined) : same(expected, actual));
      else if (expected === null) ok = actual === null || actual === undefined;
      else if (info.instance === 'Date') ok = actual instanceof Date && actual.getTime() === new Date(expected).getTime();
      else if (info.instance === 'ObjectId') ok = actual === (isObjectId(expected) ? expected.toHexString() : String(expected));
      else if (info.instance === 'Number') ok = typeof actual === 'number' && actual === Number(expected);
      else if (info.instance === 'Boolean') ok = actual === (expected === 'true' ? true : expected === 'false' ? false : expected);
      else ok = actual === (typeof expected === 'string' ? expected : String(expected)); // String and enums
      if (!ok) addProblem(modelName, id, target, canon(expected), actual instanceof Date ? actual.toISOString() : actual);
    }
  }
  // rows in Postgres that are not in MongoDB at all
  for (const row of rows) { recordChecks += 1; if (!mongoIds.has(row.id)) addProblem(modelName, row.id, '(record)', 'not in MongoDB, so not in Postgres', 'present'); }
  summary.push({ modelName, mongo: docs.length, postgres: rows.length, skipped: skippedIds.size, compared });
}

console.log('\n  model              in MongoDB   in Postgres   skipped   compared field by field');
for (const s of summary) console.log(`  ${s.modelName.padEnd(18)} ${String(s.mongo).padStart(10)}   ${String(s.postgres).padStart(11)}   ${String(s.skipped).padStart(7)}   ${String(s.compared).padStart(8)}`);
console.log(`\nrecord checks: ${recordChecks}   field comparisons: ${fieldChecks}`);
if (problems.length) {
  console.log(`\nDIFFERENCES (${problems.length}):`);
  problems.slice(0, 40).forEach((p) => console.log(`  X ${p.model} ${p.id}  ${p.field}\n      MongoDB says : ${JSON.stringify(p.expected)?.slice(0, 160)}\n      Postgres has : ${JSON.stringify(p.actual)?.slice(0, 160)}`));
  if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
} else console.log('\nPASS: every record and every field in Postgres is identical to MongoDB.');

await prisma.$disconnect(); await mongoose.disconnect();
process.exit(problems.length ? 1 : 0);
