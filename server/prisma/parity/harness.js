/**
 * Parity harness: proves a PostgreSQL repository behaves exactly like its MongoDB twin.
 *
 * It runs the same list of repository calls on both versions, each against its own freshly seeded copy of the same data,
 * and compares every result, every error and the data left behind. It only ever touches two scratch databases (both
 * named "ownerstalent_parity", never your real ones): a MongoDB database on the same server as MONGODB_URI, and a
 * PostgreSQL database next to the one in DATABASE_URL (created and migrated automatically). A local Postgres is required.
 *
 * The two databases name records differently: MongoDB by a 24-character id, PostgreSQL by a number. The scenarios are written
 * with the 24-character ids (`hex(n)`); this file translates for the PostgreSQL side so that both can be compared:
 *   - seeding: record `hex(n)` is stored as number n (links too, as the data copy does it);
 *   - calls: every id handed to a PostgreSQL repository is turned into its number;
 *   - answers: every id coming back (a field named _id, ...Id, ...Ids, createdBy ...) is turned back into `hex(n)`;
 *   - the `publicToken` that only PostgreSQL records have is left out of the comparison (it is random).
 */
import '../../config/env.js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { MODELS, PrismaClient, transform, translateLinks } from '../migrate/shared.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..', '..');
const PARITY_DB = 'ownerstalent_parity';
const ID_PATTERN = /^[0-9a-f]{24}$/;

export const oid = (hex) => new mongoose.Types.ObjectId(hex);

// ------------------------------------------------------------------------------------------- ids: hex on one side, numbers on the other

const HEX24 = /^[0-9a-fA-F]{24}$/;
const DIGITS = /^[1-9][0-9]{0,9}$/;
const MAX_ID = 2147483647;
/** The number that stands for a 24-character id: `hex(n)` is n. An id that is not of that kind gets a number no record has. */
export const numberOf = (hex) => {
  const n = parseInt(hex, 16);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_ID ? n : 2000000000 + (parseInt(hex.slice(-6), 16) % 100000000);
};
/** The 24-character id a number stands for (the other way round). */
export const hexOf = (number) => Number(number).toString(16).padStart(24, '0');
/** Keys whose value is the id of a record (a number on the PostgreSQL side). */
const isIdKey = (key) => key === 'id' || key === '_id' || key === 'ids' || /(Id|Ids|By)$/.test(String(key)) && key !== 'attributeId' && key !== 'targetId' && key !== 'conferenceId' && key !== 'calendarEventId' && key !== 'familyId';

/** PostgreSQL answer -> the form the scenarios compare: ids as 24-character text, the random public token left out. A copy. */
export function toHexForm(value, key) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return isIdKey(key) && DIGITS.test(value) ? hexOf(value) : value;
  if (typeof value === 'number') return isIdKey(key) && Number.isInteger(value) && value >= 1 ? hexOf(value) : value; // rows read straight from the table hold numbers
  if (typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map((item) => toHexForm(item, key));
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'publicToken' && k !== 'legacyId').map(([k, v]) => [k, toHexForm(v, k)]));
}

const ORIGINAL = Symbol('original');
/**
 * A live view of a PostgreSQL answer that shows ids as 24-character text and writes them back as numbers. It must be a view, not a
 * copy: a record handed back by `findById` is changed by the scenario and given to `save`, which needs the very same object.
 */
function viewOf(value, key) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return isIdKey(key) && DIGITS.test(value) ? hexOf(value) : value;
  if (typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
  return new Proxy(value, {
    get(target, prop) {
      if (prop === ORIGINAL) return target;
      const found = Reflect.get(target, prop, target);
      if (typeof prop === 'symbol' || typeof found === 'function') return found; // a method runs on the view, so what it hands out is a view too
      if (prop === 'publicToken' || prop === 'legacyId') return undefined;
      return viewOf(found, Array.isArray(target) ? key : prop);
    },
    ownKeys: (target) => Reflect.ownKeys(target).filter((k) => k !== 'publicToken' && k !== 'legacyId'),
    set(target, prop, newValue) { Reflect.set(target, prop, toArg(newValue, prop, 1)); return true; },
  });
}

/** What a scenario hands to a PostgreSQL repository: 24-character ids become numbers (a view of an answer becomes the real answer). */
export function toArg(value, key, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return HEX24.test(value) && (depth === 0 || (isIdKey(key) && !(key === '_id' && depth > 1))) ? String(numberOf(value)) : value;
  if (typeof value !== 'object') return value;
  if (value[ORIGINAL]) return value[ORIGINAL];
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (value._bsontype === 'ObjectId') return String(numberOf(value.toHexString()));
  if (Array.isArray(value)) return value.map((item) => toArg(item, key, depth === 0 ? 0 : depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toArg(v, k, depth + 1)]));
}

/** The PostgreSQL repository as the scenarios see it: arguments translated on the way in, answers viewed with 24-character ids. */
function wrapPostgres(repo) {
  const PUBLIC_LINK = new Set(['findPublicView', 'findByPublicRef']);
  const ID_LISTS = new Set(['listCandidateIdsForRequisition', 'listRequisitionIdsWithApplications', 'listAttachedCandidateIds', 'findIdsBySearch', 'listPendingScreeningIds']);
  return new Proxy(repo, {
    get(target, name) {
      const found = target[name];
      if (typeof found !== 'function') return found;
      // a public link is not an id: it is handed over as it is (the old 24-character id of a seeded record is its `legacyId`)
      const translate = PUBLIC_LINK.has(name) ? (a) => a : (a) => toArg(a, undefined, 0);
      return async (...args) => viewOf(await found(...args.map(translate)), ID_LISTS.has(name) ? 'ids' : undefined);
    },
  });
}

// ------------------------------------------------------------------------------------------------------------ setup

let adminPrisma; let prisma;

/** Creates and migrates the scratch Postgres database, connects the scratch MongoDB, and points the app at them. */
export async function setup() {
  if (!process.env.DATABASE_URL || !process.env.MONGODB_URI) throw new Error('DATABASE_URL and MONGODB_URI must both be set.');
  const devUrl = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '::1'].includes(devUrl.hostname)) throw new Error('The parity tests only run against a local Postgres.');
  const parityUrl = new URL(devUrl.toString()); parityUrl.pathname = `/${PARITY_DB}`;

  adminPrisma = new PrismaClient({ datasourceUrl: devUrl.toString() });
  const exists = await adminPrisma.$queryRawUnsafe(`select 1 from pg_database where datname = '${PARITY_DB}'`);
  if (!exists.length) await adminPrisma.$executeRawUnsafe(`CREATE DATABASE "${PARITY_DB}"`);
  execFileSync(process.execPath, [path.join(serverDir, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], {
    cwd: serverDir, env: { ...process.env, DATABASE_URL: parityUrl.toString() }, stdio: 'pipe',
  });
  process.env.DATABASE_URL = parityUrl.toString(); // must happen before any Postgres repository is imported
  prisma = new PrismaClient({ datasourceUrl: parityUrl.toString() });

  const mongoUrl = new URL(process.env.MONGODB_URI); mongoUrl.pathname = `/${PARITY_DB}`;
  await mongoose.connect(mongoUrl.toString());
  if (mongoose.connection.name !== PARITY_DB) throw new Error('Refusing to run: the MongoDB database is not the scratch one.');
  return { prisma, mongo: mongoose.connection.db };
}

export async function teardown() {
  await mongoose.disconnect();
  if (prisma) await prisma.$disconnect();
  if (adminPrisma) await adminPrisma.$disconnect();
}

/** Loads one repository from both folders. */
export async function loadRepositories(name) {
  const load = (folder) => import(pathToFileURL(path.join(serverDir, 'repositories', folder, `${name}.js`)).href);
  return { mongo: await load('mongo'), postgres: await load('postgres') };
}

// ------------------------------------------------------------------------------------------------------- seeding

async function resetBoth() {
  if (mongoose.connection.name !== PARITY_DB) throw new Error('Refusing to reset a database that is not the scratch one.');
  await mongoose.connection.dropDatabase();
  for (const spec of MODELS) { // the unique indexes the models declare must exist again after the drop
    const model = (await import(pathToFileURL(path.join(serverDir, 'models', `${spec.delegate[0].toUpperCase()}${spec.delegate.slice(1)}.js`)).href)).default;
    try { await model.createIndexes(); } catch (error) {
      if (error.code !== 86) throw error; // Department declares two indexes on `name` with the same name; the unique one is created first
    }
  }
  const tables = (await prisma.$queryRawUnsafe(`select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations'`)).map((r) => `"${r.tablename}"`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}

/** Empties both scratch databases and fills them with the same documents (used by the hands-on try scripts). */
export async function resetAndSeed(documents) {
  await resetBoth();
  return seedBoth(documents);
}

/** Writes the same documents (in MongoDB shape) into both scratch databases. Returns the ids seeded, to tell them from new ones. */
async function seedBoth(documents) {
  const seededIds = new Set();
  const seededByDelegate = {}; // delegate -> the 24-character ids that exist, so a link to a record that does not exist is dropped as the data copy drops it
  for (const spec of MODELS) seededByDelegate[spec.delegate] = new Set((documents[spec.collection] || []).map((d) => String(d._id)));
  for (const spec of MODELS) {
    const docs = documents[spec.collection] || [];
    if (!docs.length) continue;
    await mongoose.connection.db.collection(spec.collection).insertMany(docs.map((d) => ({ ...d })));
    const rows = docs.map((doc) => {
      const { row, notes, blocking } = transform(spec, doc);
      if (blocking.length) throw new Error(`Seed document ${String(doc._id)} in ${spec.collection} cannot be stored: ${blocking.join('; ')}`);
      seededIds.add(row.id);
      // a link the database does not enforce (an audit entry's job opening) may name a record that no longer exists, as in MongoDB:
      // the data copy has to empty such a link, but here it keeps a number that belongs to no record, so the scenarios can still use it
      const loose = spec.fields.filter((f) => f.ref && !f.parent && !f.softParent && row[f.name] !== undefined && row[f.name] !== null).map((f) => [f.name, String(row[f.name])]);
      // (an id inside a JSON value, such as the user who overrode a score, may also name a user that no longer exists)
      translateLinks(spec, row, (target, old, inJson) => (inJson || (seededByDelegate[target] && seededByDelegate[target].has(old)) ? numberOf(old) : undefined), notes);
      for (const [name, old] of loose) if (row[name] === undefined) row[name] = numberOf(old);
      if (spec.legacyId) row.legacyId = row.id;
      if (spec.publicToken) row.publicToken = randomUUID();
      row.id = numberOf(row.id);
      return row;
    });
    await prisma.$executeRawUnsafe(`INSERT INTO "${spec.table}" SELECT * FROM jsonb_populate_recordset(null::"${spec.table}", $1::jsonb)`, JSON.stringify(rows));
    await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"${spec.table}"', 'id'), 1000000)`); // new records get numbers far away from the seeded ones, so their 24-character form cannot be mistaken for an id the scenarios seed inside a record
  }
  return seededIds;
}

// ------------------------------------------------------------------------------------------------ what is left behind

/**
 * The data a table holds after a scenario, in a form that can be compared between the two databases without using the
 * repositories: the MongoDB documents go through the same conversion the data copy uses, the PostgreSQL rows are read
 * as they are. Empty values are left out on both sides.
 */
export function tableState(delegate) {
  const spec = MODELS.find((m) => m.delegate === delegate);
  const dateFields = new Set([...spec.fields.filter((f) => f.type === 'd').map((f) => f.name), 'createdAt', 'updatedAt']);
  const clean = (row) => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, v]));
  const byId = (a, b) => String(a.id).localeCompare(String(b.id));
  return {
    mongo: async ({ mongo }) => (await mongo.collection(spec.collection).find().toArray()).map((doc) => clean(transform(spec, doc).row)).sort(byId),
    postgres: async ({ prisma }) => (await prisma.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS j FROM "${spec.table}" t`)).map((r) => {
      const row = JSON.parse(r.j);
      for (const name of dateFields) if (typeof row[name] === 'string') row[name] = new Date(`${row[name]}Z`);
      return clean(toHexForm(row));
    }).sort(byId),
  };
}

// --------------------------------------------------------------------------------------------------- comparing

const isoRecent = (date) => Math.abs(Date.now() - date.getTime()) < 30 * 60 * 1000;

/** A form of any value that can be compared between the two runs: ids that were not seeded are numbered in order of appearance. */
function makeCanon(seededIds) {
  const labels = new Map();
  const canon = (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (value instanceof Date) return isoRecent(value) ? '<now>' : value.toISOString();
    if (typeof value === 'string') {
      return value.replace(/\b[0-9a-f]{24}\b/g, (m) => (seededIds.has(m) ? m : (labels.has(m) ? labels.get(m) : (labels.set(m, `<new id ${labels.size + 1}>`), labels.get(m)))));
    }
    if (Array.isArray(value)) return value.map(canon);
    if (typeof value === 'object') {
      if (value._bsontype === 'ObjectId') return canon(value.toHexString());
      return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canon(value[k])]).filter(([, v]) => v !== undefined));
    }
    return value;
  };
  return canon;
}

/** What matters about an error: the parts the app reads (middleware/errorHandler.js), not the wording of the driver. */
/** The wording of an error with what differs by design taken out: how a bad id is described, and the number of a record in a message. */
const plainMessage = (message) => String(message)
  .replace(/Cast to (ObjectId|Number) failed for value (.*?) \(type (\w+)\) at path "(\w+)"( because of "BSONError")?/g, 'Cast to <id> failed for value $2 (type $3) at path "$4"')
  .replace(/input must be a 24 character hex string, 12 byte Uint8Array, or an integer|An id must be a whole number from 1 up, as a number or as digits/g, '<not an id>')
  .replace(/^(\w+) (\d{1,10}) no longer exists/, (m, name, n) => `${name} ${hexOf(n)} no longer exists`)
  .replace(/\{_id: ObjectId\('([0-9a-f]{24})'\)\}/g, '{_id: $1}')
  .replace(/\{_id: (\d{1,10})\}/g, (m, n) => `{_id: ${hexOf(n)}}`);
function describeError(error) {
  const base = { name: error.name };
  if (error.name === 'CastError') return { ...base, path: error.path };
  if (error.code === 11000) return { ...base, code: 11000, fields: Object.keys(error.keyPattern || {}) };
  if (error.name === 'ValidationError') return { ...base, fields: Object.keys(error.errors || {}), message: plainMessage(error.message) };
  return { ...base, code: error.code, message: plainMessage(error.message).slice(0, 200) };
}

async function runSide(side, repo, scenario, handles) {
  await resetBoth();
  const seededIds = await seedBoth(scenario.seed());
  const canon = makeCanon(seededIds);
  const results = [];
  for (const step of scenario.steps) {
    try { results.push({ step: step.name, ok: true, value: canon(await step.run(repo)) }); }
    catch (error) { results.push({ step: step.name, ok: false, error: canon(describeError(error)) }); }
  }
  const state = canon(await scenario.state[side](handles));
  return { results, state };
}

/** Runs one scenario on both versions and compares everything. Returns the list of differences. */
export async function runScenario(scenario, handles) {
  const repos = await loadRepositories(scenario.repository);
  const mongoRun = await runSide('mongo', repos.mongo, scenario, handles);
  const postgresRun = await runSide('postgres', wrapPostgres(repos.postgres), scenario, handles);
  const differences = []; const lines = [];
  scenario.steps.forEach((step, i) => {
    const a = mongoRun.results[i]; const b = postgresRun.results[i];
    const same = JSON.stringify(a) === JSON.stringify(b);
    lines.push({ name: step.name, same, error: !a.ok });
    if (!same) differences.push({ where: `step ${i + 1}: ${step.name}`, mongo: a.ok ? a.value : { ERROR: a.error }, postgres: b.ok ? b.value : { ERROR: b.error } });
  });
  const stateSame = JSON.stringify(mongoRun.state) === JSON.stringify(postgresRun.state);
  if (!stateSame) differences.push({ where: 'the data left behind', mongo: mongoRun.state, postgres: postgresRun.state });
  return { lines, differences, stateSame };
}
