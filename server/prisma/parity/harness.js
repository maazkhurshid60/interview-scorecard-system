/**
 * Parity harness: proves a PostgreSQL repository behaves exactly like its MongoDB twin.
 *
 * It runs the same list of repository calls on both versions, each against its own freshly seeded copy of the same data,
 * and compares every result, every error and the data left behind. It only ever touches two scratch databases (both
 * named "ownerstalent_parity", never your real ones): a MongoDB database on the same server as MONGODB_URI, and a
 * PostgreSQL database next to the one in DATABASE_URL (created and migrated automatically). A local Postgres is required.
 */
import '../../config/env.js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { MODELS, PrismaClient, transform } from '../migrate/shared.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..', '..');
const PARITY_DB = 'ownerstalent_parity';
const ID_PATTERN = /^[0-9a-f]{24}$/;

export const oid = (hex) => new mongoose.Types.ObjectId(hex);

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
  for (const spec of MODELS) {
    const docs = documents[spec.collection] || [];
    if (!docs.length) continue;
    await mongoose.connection.db.collection(spec.collection).insertMany(docs.map((d) => ({ ...d })));
    const rows = docs.map((doc) => {
      const { row, blocking } = transform(spec, doc);
      if (blocking.length) throw new Error(`Seed document ${String(doc._id)} in ${spec.collection} cannot be stored: ${blocking.join('; ')}`);
      seededIds.add(row.id);
      return row;
    });
    await prisma.$executeRawUnsafe(`INSERT INTO "${spec.table}" SELECT * FROM jsonb_populate_recordset(null::"${spec.table}", $1::jsonb)`, JSON.stringify(rows));
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
      return clean(row);
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
function describeError(error) {
  const base = { name: error.name };
  if (error.name === 'CastError') return { ...base, path: error.path };
  if (error.code === 11000) return { ...base, code: 11000, fields: Object.keys(error.keyPattern || {}) };
  if (error.name === 'ValidationError') return { ...base, fields: Object.keys(error.errors || {}), message: error.message };
  return { ...base, code: error.code, message: String(error.message).slice(0, 200) };
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
  const postgresRun = await runSide('postgres', repos.postgres, scenario, handles);
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
