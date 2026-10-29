/**
 * Copies the data from MongoDB into PostgreSQL.
 *
 *   npm run migrate:postgres                 copies into EMPTY tables (refuses if a table already has rows)
 *   npm run migrate:postgres -- --reset      first empties every table (only allowed on a local database)
 *
 * MongoDB is only READ, never changed. Every record gets a new number as its id (1, 2, 3, ... in the order the records were
 * created); the old MongoDB id of each record is paired with its new number while the copy runs, and every link between
 * records (a candidate id inside an application, a user id inside an audit entry or a score) is rewritten to the new
 * number. A link to a record that does not exist is emptied and counted in the report. A skipped record leaves a gap in
 * the numbers, which is harmless. Values a Mongoose model would have filled in when loading
 * (defaults) are filled in. Anything that cannot be copied is NOT copied silently: the row is skipped and listed in the
 * report (logs/migration-report.json) with the reason. A row whose parent was skipped or does not exist is skipped too
 * (it would otherwise be an orphan), except a job's department, which is set to empty and reported.
 *
 * Set MIGRATE_MONGO_URI to read from a different MongoDB than MONGODB_URI (for example a copy of production).
 */
import '../../config/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { MODELS, PrismaClient, countOldIds, idText, numberIds, transform, translateLinks } from './shared.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const reset = process.argv.includes('--reset');
const mongoUri = process.env.MIGRATE_MONGO_URI || process.env.MONGODB_URI;
const BATCH = 500;
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
const isLocal = (url) => ['localhost', '127.0.0.1', '::1'].includes(hostOf(url));

if (!mongoUri) throw new Error('No MongoDB address: set MONGODB_URI (or MIGRATE_MONGO_URI).');
if (!process.env.DATABASE_URL) throw new Error('No Postgres address: set DATABASE_URL.');
if (reset && !isLocal(process.env.DATABASE_URL)) throw new Error('--reset is only allowed on a local Postgres (DATABASE_URL must point at localhost).');

const prisma = new PrismaClient();
await mongoose.connect(mongoUri);
const mongo = mongoose.connection.db;
const started = Date.now();

console.log(`Reading from MongoDB "${mongoose.connection.name}" (${hostOf(mongoUri) || 'unknown host'}), writing to Postgres (${hostOf(process.env.DATABASE_URL)}).`);

// ---- target must be empty (or be reset)
const counts = {};
for (const spec of MODELS) counts[spec.delegate] = await prisma[spec.delegate].count();
const filled = Object.entries(counts).filter(([, c]) => c > 0);
if (filled.length && !reset) {
  console.error(`Postgres already has data (${filled.map(([t, c]) => `${t}: ${c}`).join(', ')}). Nothing was changed. Run again with --reset to empty it first.`);
  await prisma.$disconnect(); await mongoose.disconnect(); process.exit(1);
}
if (reset) {
  const tables = (await prisma.$queryRawUnsafe(`select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations'`)).map((r) => `"${r.tablename}"`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  console.log('Postgres tables emptied (--reset).');
}

// ---- number every record first, so a link to a record that is copied later can already be translated
const newIds = {}; // delegate -> Map(old id -> new number)
for (const spec of MODELS) {
  const found = await mongo.collection(spec.collection).find({}, { projection: { _id: 1 } }).toArray();
  newIds[spec.delegate] = numberIds(found.map((doc) => idText(doc._id)));
}

const allOldIds = new Set(Object.values(newIds).flatMap((numbers) => [...numbers.keys()]));

// ---- copy, parents before children
const written = {}; // delegate -> Set of OLD ids written (links in a document still hold old ids when they are checked)
/** The new number of a record: only if it was copied (a table not copied yet, for a link that points forward, is checked afterwards). */
const numberOf = (target, oldId) => (written[target] && !written[target].has(oldId) ? undefined : newIds[target].get(oldId));
const report = { startedAt: new Date(started).toISOString(), mongo: mongoose.connection.name, models: {} };
let anySkipped = false;

for (const spec of MODELS) {
  const docs = await mongo.collection(spec.collection).find({}).toArray();
  const rows = []; const oldIds = []; const skipped = []; const repaired = []; const notes = {};
  for (const doc of docs) {
    const { row, notes: rowNotes, blocking } = transform(spec, doc);
    for (const field of spec.fields) {
      if (!field.parent && !field.softParent) continue;
      const parentSet = written[MODELS.find((m) => m.delegate === (field.parent || field.softParent)).delegate] || new Set();
      if (field.parent && row[field.name] !== undefined && !parentSet.has(row[field.name])) blocking.push(`${field.name}: points at ${field.parent} ${row[field.name]}, which does not exist (or was skipped)`);
      if (field.softParent && row[field.name] && !parentSet.has(row[field.name])) { repaired.push({ id: row.id, field: field.name, was: row[field.name], change: `${field.name} pointed at a ${field.softParent} that does not exist (${row[field.name]}); set to empty` }); delete row[field.name]; }
    }
    if (blocking.length) { skipped.push({ id: row.id, reasons: blocking }); continue; }
    translateLinks(spec, row, numberOf, rowNotes);
    for (const field of spec.fields) { // record ids inside other JSON values are not translated: they are counted, never silent
      const left = field.type === 'j' && row[field.name] !== undefined ? countOldIds(row[field.name], allOldIds) : 0;
      if (left) rowNotes.push(`${field.name}: ${left} record id(s) inside the JSON were left as the old text (not translated)`);
    }
    if (spec.publicToken) row.publicToken = randomUUID(); // the database default does not apply to rows written like this
    rowNotes.forEach((n) => { notes[n] = (notes[n] || 0) + 1; });
    oldIds.push(row.id);
    if (spec.legacyId) row.legacyId = row.id; // keep the old id, so links already shared (/apply/<old id>) can still find this record
    row.id = newIds[spec.delegate].get(row.id); // the transform gave the old id; from here on the row has its new number
    rows.push(row);
  }
  rows.sort((a, b) => a.id - b.id);
  // Written as JSON text straight to Postgres, not through Prisma's createMany: Prisma rounds any number that needs 17 digits
  // (1/6 = 0.16666666666666666 would become 0.1666666666666667), and this copy must be exact.
  for (let i = 0; i < rows.length; i += BATCH) {
    await prisma.$executeRawUnsafe(`INSERT INTO "${spec.table}" SELECT * FROM jsonb_populate_recordset(null::"${spec.table}", $1::jsonb)`, JSON.stringify(rows.slice(i, i + BATCH)));
  }
  // the numbers were given by this script, so the table's counter must continue after the highest one
  await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"${spec.table}"', 'id'), COALESCE((SELECT max(id) FROM "${spec.table}"), 1), (SELECT max(id) FROM "${spec.table}") IS NOT NULL)`);
  written[spec.delegate] = new Set(oldIds);
  if (skipped.length) anySkipped = true;
  report.models[spec.delegate] = { collection: spec.collection, read: docs.length, written: rows.length, skipped, repaired, notes, highestNumber: rows.length ? rows[rows.length - 1].id : 0 };
  const flag = skipped.length ? `  SKIPPED ${skipped.length}` : '';
  console.log(`  ${spec.collection.padEnd(20)} read ${String(docs.length).padStart(6)}   written ${String(rows.length).padStart(6)}${flag}${repaired.length ? `   repaired ${repaired.length}` : ''}`);
}

// ---- links that point forward (a job opening's scorecard) or that the database does not enforce: if the record they name was
// not copied, the link is emptied (it cannot point at nothing) and counted
for (const spec of MODELS) {
  for (const field of spec.fields) {
    if (!field.ref || field.parent || field.softParent) continue;
    const target = MODELS.find((m) => m.delegate === field.ref);
    const emptied = await prisma.$executeRawUnsafe(`UPDATE "${spec.table}" SET "${field.name}" = NULL WHERE "${field.name}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${target.table}" t WHERE t.id = "${spec.table}"."${field.name}")`);
    if (emptied) report.models[spec.delegate].notes[`${field.name}: pointed at a ${field.ref} that was not copied; set to empty`] = emptied;
  }
}

// ---- check what Postgres now holds
let mismatch = false;
for (const spec of MODELS) {
  const inDb = Number((await prisma.$queryRawUnsafe(`select count(*)::int as n from "${spec.table}"`))[0].n);
  if (inDb !== report.models[spec.delegate].written) { mismatch = true; console.error(`  COUNT MISMATCH in ${spec.delegate}: wrote ${report.models[spec.delegate].written}, table has ${inDb}`); }
}

report.finishedAt = new Date().toISOString();
const reportPath = process.env.MIGRATE_REPORT_PATH || path.join(here, '..', '..', 'logs', 'migration-report.json'); // the test run keeps its own report
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

const totals = Object.values(report.models).reduce((a, m) => ({ read: a.read + m.read, written: a.written + m.written, skipped: a.skipped + m.skipped.length, repaired: a.repaired + m.repaired.length }), { read: 0, written: 0, skipped: 0, repaired: 0 });
console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s: ${totals.read} read, ${totals.written} written, ${totals.skipped} skipped, ${totals.repaired} repaired.`);
if (anySkipped) {
  console.log('\nSKIPPED ROWS (not copied):');
  for (const [name, m] of Object.entries(report.models)) m.skipped.slice(0, 20).forEach((s) => console.log(`  ${name} ${s.id}: ${s.reasons.join('; ')}`));
}
for (const [name, m] of Object.entries(report.models)) m.repaired.slice(0, 20).forEach((r) => console.log(`  REPAIRED ${name} ${r.id}: ${r.change}`));
for (const [name, m] of Object.entries(report.models)) for (const [note, count] of Object.entries(m.notes)) console.log(`  note ${name}: ${note} (${count} rows)`);
console.log(`Full report: ${path.relative(process.cwd(), reportPath)}`);

await prisma.$disconnect();
await mongoose.disconnect();
process.exit(mismatch ? 1 : (anySkipped ? 2 : 0));
