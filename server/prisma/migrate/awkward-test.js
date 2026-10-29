/**
 * Tries the data copy and its verifier on deliberately awkward data.
 *
 *   npm run test:migrate
 *
 * It builds a scratch MongoDB (ownerstalent_awkward) full of records that real data can contain but a clean test would not:
 * a value outside an enum, a missing required value, a number stored as text, links to records that do not exist or that
 * the copy has to skip, record ids inside JSON. It copies them into a scratch PostgreSQL (ownerstalent_awkward), runs the
 * verifier, and checks what happened to each record. Your real databases are never touched: both scratch databases are made
 * and removed here, and the script only runs against a local MongoDB and a local PostgreSQL.
 */
import '../../config/env.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { PrismaClient } from './shared.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..', '..');
const SCRATCH = 'ownerstalent_awkward';
const LOCAL = ['localhost', '127.0.0.1', '::1'];

const devUrl = new URL(process.env.DATABASE_URL);
const mongoReal = new URL(process.env.MONGODB_URI);
if (!LOCAL.includes(devUrl.hostname) || !LOCAL.includes(mongoReal.hostname)) throw new Error('This test only runs against a local PostgreSQL and a local MongoDB.');
const pgUrl = new URL(devUrl.toString()); pgUrl.pathname = `/${SCRATCH}`;
const mongoUrl = new URL(mongoReal.toString()); mongoUrl.pathname = `/${SCRATCH}`;
const reportPath = path.join(os.tmpdir(), `awkward-migration-report-${process.pid}.json`);
const env = { ...process.env, DATABASE_URL: pgUrl.toString(), MIGRATE_MONGO_URI: mongoUrl.toString(), MIGRATE_REPORT_PATH: reportPath };

const admin = new PrismaClient({ datasourceUrl: devUrl.toString() });
const prisma = new PrismaClient({ datasourceUrl: pgUrl.toString() });
const run = (script, args = []) => {
  try { return { code: 0, out: execFileSync(process.execPath, [path.join(serverDir, script), ...args], { cwd: serverDir, env, stdio: 'pipe' }).toString() }; }
  catch (error) { return { code: error.status, out: `${error.stdout || ''}\n${error.stderr || ''}` }; }
};
const q = (sql) => prisma.$queryRawUnsafe(sql);

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed += 1; console.log(`  ${ok ? 'ok      ' : 'FAILED  '} ${name}${ok ? '' : `   -> ${detail}`}`); };

// ---- the awkward data. Ids are made in the order records were "created", so a record's number is its place in its list.
const { ObjectId } = mongoose.Types;
const make = (count) => Array.from({ length: count }, () => new ObjectId());
const [U1, U2, U3, U4, U5] = make(5); const [D1, D2, D3] = make(3); const [P1] = make(1); const [S1, S2, S3] = make(3);
const [C1, C2, C3, C4, C5] = make(5); const [R1, R2, R3, R4] = make(4); const [SC1, SC2, SC3] = make(3); const [A1, A2, A3, A4, A5] = make(5);
const [I1, I2, I3, I4] = make(4); const [T1, T2, T3, T4] = make(4); const [L1, L2, L3, L4, L5, L6] = make(6);
const ghost = () => new ObjectId(); // an id that belongs to no record
const when = new Date('2026-03-01T10:00:00.000Z');
const stamps = { createdAt: when, updatedAt: when };

const data = {
  users: [
    { _id: U1, name: 'Owner', email: 'owner@x.com', passwordHash: 'h', role: 'owner', active: true, ...stamps },
    { _id: U2, name: 'Recruiter', email: 'rec@x.com', passwordHash: 'h', role: 'recruiter', active: true, ...stamps },
    { _id: U3, name: 'Wizard', email: 'wiz@x.com', passwordHash: 'h', role: 'wizard', active: true, ...stamps }, // role not allowed -> skipped
    { _id: U4, name: 'NoHash', email: 'nohash@x.com', role: 'recruiter', active: true, ...stamps }, // required value missing -> skipped
    { _id: U5, name: 'Late', email: 'late@x.com', passwordHash: 'h', role: 'interviewer', active: true, ...stamps }, // after two skipped: must get number 5
  ],
  departments: [
    { _id: D1, name: 'Engineering', createdBy: U1, ...stamps },
    { _id: D2, name: 'Operations', createdBy: ghost(), ...stamps }, // creator does not exist
    { _id: D3, name: 'Finance', createdBy: U3, ...stamps }, // creator was skipped
  ],
  pipelinetemplates: [{ _id: P1, name: 'Standard', stages: [], ...stamps }],
  settings: [
    { _id: S1, key: 'retention', value: 5, updatedAt: when },
    { _id: S2, key: 'owner', value: { ownerId: U1.toHexString() }, updatedAt: when }, // a record id inside JSON: cannot be translated, must be reported
    { _id: S3, key: 'nul', value: { key: 'x\u0000y', list: ['p\u0000q'] }, updatedAt: when }, // NUL characters inside JSON text (MongoDB itself refuses a NUL in a key): PostgreSQL cannot store them
  ],
  candidates: [
    { _id: C1, name: 'Ann', email: 'ann@x.com', ...stamps },
    { _id: C2, name: 'NoMail', ...stamps }, // email missing -> skipped
    { _id: C3, name: 'Bob', email: 'bob@x.com', resumeFileSize: '123', ...stamps }, // number stored as text -> converted
    { _id: C4, name: 'Cy', email: 'cy@x.com', resumeFileSize: 'abc', ...stamps }, // not a number -> skipped
    { _id: C5, name: 'Nul', email: 'nul@x.com', notes: 'a\u0000b\u0000', ...stamps }, // NUL characters in text: PostgreSQL cannot store them
  ],
  requisitions: [
    { _id: R1, title: 'Senior Engineer', jobDescription: 'd', departmentId: D1, pipelineTemplateId: P1, scorecardId: SC1, createdBy: U1, ...stamps },
    { _id: R2, title: 'Junior Engineer', jobDescription: 'd', departmentId: ghost(), scorecardId: ghost(), createdBy: U3, ...stamps }, // department, scorecard missing; creator skipped
    { _id: R3, title: 'Archived Role', jobDescription: 'd', status: 'archived', ...stamps }, // status not allowed -> skipped
    { _id: R4, title: 'No Description', ...stamps }, // required value missing -> skipped
  ],
  scorecards: [
    { _id: SC1, requisitionId: R1, stages: [], ...stamps },
    { _id: SC2, requisitionId: R3, stages: [], ...stamps }, // its job opening was skipped -> skipped
    { _id: SC3, requisitionId: ghost(), stages: [], ...stamps }, // its job opening does not exist -> skipped
  ],
  applications: [
    { _id: A1, candidateId: C1, requisitionId: R1, finalDecisionBy: U1, initialScreening: { aiScore: 3, overriddenBy: U2 }, ...stamps },
    { _id: A2, candidateId: C2, requisitionId: R1, ...stamps }, // candidate was skipped -> skipped
    { _id: A3, candidateId: C1, requisitionId: R3, ...stamps }, // job opening was skipped -> skipped
    { _id: A4, candidateId: ghost(), requisitionId: R1, ...stamps }, // candidate does not exist -> skipped
    { _id: A5, candidateId: C3, requisitionId: R2, finalDecisionBy: U3, initialScreening: { aiScore: 2, overriddenBy: ghost() }, ...stamps }, // decider skipped; overrider missing
  ],
  interviews: [
    { _id: I1, applicationId: A1, requisitionId: R1, stageKey: 'hr', designatedScorerId: U2, scores: [{ attributeId: 'a', overriddenBy: U1 }, { attributeId: 'b', overriddenBy: ghost() }], ...stamps },
    { _id: I2, applicationId: A2, requisitionId: R1, stageKey: 'hr', ...stamps }, // application was skipped -> skipped
    { _id: I3, applicationId: A1, requisitionId: R1, stageKey: 'tech', status: 'weird', ...stamps }, // status not allowed -> skipped
    { _id: I4, applicationId: A1, requisitionId: R1, ...stamps }, // stageKey missing -> skipped
  ],
  refreshtokens: [
    { _id: T1, userId: U1, tokenHash: 't1', familyId: 'f1', familyStartedAt: when, expiresAt: when, createdAt: when },
    { _id: T2, userId: ghost(), tokenHash: 't2', familyId: 'f2', familyStartedAt: when, expiresAt: when, createdAt: when }, // user does not exist -> skipped
    { _id: T3, userId: U3, tokenHash: 't3', familyId: 'f3', familyStartedAt: when, expiresAt: when, createdAt: when }, // user was skipped -> skipped
    { _id: T4, userId: U2, tokenHash: 't4', familyId: 'f4', familyStartedAt: when, expiresAt: when, usedAt: null, createdAt: when },
  ],
  auditlogs: [
    { _id: L1, action: 'candidate_update', userId: U1, requisitionId: R1, applicationId: A1, timestamp: when },
    { _id: L2, action: 'candidate_update', userId: ghost(), timestamp: when }, // user does not exist -> link emptied
    { _id: L3, action: 'candidate_update', requisitionId: R3, timestamp: when }, // job opening was skipped -> link emptied
    { _id: L4, action: 'candidate_update', applicationId: A2, timestamp: when }, // application was skipped -> link emptied
    { _id: L5, action: 'explode', timestamp: when }, // action not allowed -> skipped
    { _id: L6, action: 'candidate_update', newValue: { application: A1.toHexString() }, timestamp: when }, // a record id inside JSON
  ],
};

async function cleanup() {
  try { await mongoose.connection.dropDatabase(); } catch { /* not connected */ }
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  try { await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH}" WITH (FORCE)`); } catch { /* left behind: harmless */ }
  await admin.$disconnect();
  fs.rmSync(reportPath, { force: true });
}

try {
  console.log('Preparing the scratch MongoDB and PostgreSQL...');
  await mongoose.connect(mongoUrl.toString());
  await mongoose.connection.dropDatabase();
  for (const [collection, docs] of Object.entries(data)) await mongoose.connection.db.collection(collection).insertMany(docs);
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH}"`);
  const deploy = run(path.join('node_modules', 'prisma', 'build', 'index.js'), ['migrate', 'deploy']);
  if (deploy.code !== 0) throw new Error(`Could not build the tables:\n${deploy.out.slice(-600)}`);

  console.log('\nCopying:');
  const copy = run(path.join('prisma', 'migrate', 'migrate.js'), ['--reset']);
  check('the copy finishes and reports that it skipped records (exit code 2)', copy.code === 2, `exit ${copy.code}\n${copy.out.slice(-500)}`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const skippedOf = (delegate) => report.models[delegate].skipped.map((s) => s.id).sort();
  const ids = (...list) => list.map((id) => id.toHexString()).sort();

  console.log('\nWhat was skipped:');
  const expectSkipped = { user: [U3, U4], candidate: [C2, C4], requisition: [R3, R4], scorecard: [SC2, SC3], application: [A2, A3, A4], interview: [I2, I3, I4], refreshToken: [T2, T3], auditLog: [L5], department: [], pipelineTemplate: [], setting: [] };
  for (const [delegate, list] of Object.entries(expectSkipped)) check(`${delegate}: ${list.length} skipped`, JSON.stringify(skippedOf(delegate)) === JSON.stringify(ids(...list)), `got ${JSON.stringify(skippedOf(delegate))}`);

  console.log('\nWhat the rows look like (the number is the place in the original list, counting skipped records):');
  const one = async (sql) => (await q(sql))[0];
  const idsOf = async (table) => (await q(`SELECT id FROM "${table}" ORDER BY id`)).map((r) => r.id);
  check('users keep their places: 1, 2 and 5 (3 and 4 were skipped)', JSON.stringify(await idsOf('users')) === '[1,2,5]');
  check('a new user gets number 6, after the highest', (await one(`SELECT nextval('"users_id_seq"')::int n`)).n === 6);
  const dep = await q('SELECT id, "createdBy" c FROM departments ORDER BY id');
  check('department: creator that exists becomes its number (1); a missing or skipped creator is emptied', dep[0].c === 1 && dep[1].c === null && dep[2].c === null, JSON.stringify(dep));
  check('a record id inside JSON is left as the old text, and reported', (await one(`SELECT value->>'ownerId' v FROM settings WHERE key='owner'`)).v === U1.toHexString() && Object.keys(report.models.setting.notes).some((n) => /not translated/.test(n)));
  check('candidates: Ann, Bob and Nul copied; Bob\'s size "123" became the number 123', JSON.stringify(await idsOf('candidates')) === '[1,3,5]' && Number((await one(`SELECT "resumeFileSize" s FROM candidates WHERE id=3`)).s) === 123);
  const nulNotes = (await one('SELECT notes FROM candidates WHERE id = 5')).notes;
  check('NUL characters in text are taken out (the note "a<NUL>b<NUL>" becomes "ab") and reported', nulNotes === 'ab' && Object.keys(report.models.candidate.notes).some((n) => /NUL character/.test(n)), JSON.stringify(nulNotes));
  const nulValue = (await one(`SELECT "value" v FROM settings WHERE key = 'nul'`)).v;
  check('NUL characters inside JSON text are taken out as well and reported', JSON.stringify(nulValue) === '{"key":"xy","list":["pq"]}' && Object.keys(report.models.setting.notes).some((n) => /NUL character/.test(n)), JSON.stringify(nulValue));
  const req = await q('SELECT id, "legacyId" l, "departmentId" d, "pipelineTemplateId" p, "scorecardId" s, "createdBy" c FROM requisitions ORDER BY id');
  check('job opening 1: department, template, scorecard and creator become their numbers', req[0].id === 1 && req[0].d === 1 && req[0].p === 1 && req[0].s === 1 && req[0].c === 1, JSON.stringify(req[0]));
  check('job opening 2: missing department, missing scorecard and skipped creator are all emptied', req[1].id === 2 && req[1].d === null && req[1].s === null && req[1].c === null, JSON.stringify(req[1]));
  check('job openings keep their old ids in legacyId', req[0].l === R1.toHexString() && req[1].l === R2.toHexString());
  check('the emptied department was announced as "repaired" in the report', report.models.requisition.repaired.some((r) => r.field === 'departmentId'));
  check('scorecard: only the one with a copied job opening is there', JSON.stringify(await q('SELECT id, "requisitionId" r FROM scorecards')) === '[{"id":1,"r":1}]');
  const apps = await q(`SELECT id, "candidateId" c, "requisitionId" r, "finalDecisionBy" f, "initialScreening" i FROM applications ORDER BY id`);
  check('applications: only 1 and 5 are copied', JSON.stringify(apps.map((a) => a.id)) === '[1,5]');
  check('application 1: candidate, job opening, decider and screening overrider become numbers', apps[0].c === 1 && apps[0].r === 1 && apps[0].f === 1 && apps[0].i.overriddenBy === 2, JSON.stringify(apps[0]));
  check('application 5: skipped decider and missing overrider are emptied (key removed from the JSON)', apps[1].c === 3 && apps[1].r === 2 && apps[1].f === null && !('overriddenBy' in apps[1].i), JSON.stringify(apps[1]));
  const ivs = await q(`SELECT id, "applicationId" a, "requisitionId" r, "designatedScorerId" d, scores, "legacyId" l FROM interviews ORDER BY id`);
  check('interview: only the first is copied, with its application, job opening and scorer as numbers', ivs.length === 1 && ivs[0].a === 1 && ivs[0].r === 1 && ivs[0].d === 2 && ivs[0].l === I1.toHexString(), JSON.stringify(ivs));
  check('interview scores: the overrider that exists is a number, the missing one is removed', ivs[0].scores[0].overriddenBy === 1 && !('overriddenBy' in ivs[0].scores[1]), JSON.stringify(ivs[0].scores));
  check('login tokens: only the two with a copied user', JSON.stringify((await q('SELECT id, "userId" u FROM refresh_tokens ORDER BY id'))) === '[{"id":1,"u":1},{"id":4,"u":2}]');
  const logs = await q(`SELECT id, "userId" u, "requisitionId" r, "applicationId" a FROM audit_logs ORDER BY id`);
  check('audit entries: 1 keeps all three links; 2, 3 and 4 have the broken link emptied; 5 was skipped; 6 is copied', JSON.stringify(logs) === JSON.stringify([{ id: 1, u: 1, r: 1, a: 1 }, { id: 2, u: null, r: null, a: null }, { id: 3, u: null, r: null, a: null }, { id: 4, u: null, r: null, a: null }, { id: 6, u: null, r: null, a: null }]), JSON.stringify(logs));
  check('an application id inside an audit entry\'s JSON is left as text, and reported', (await one(`SELECT "newValue"->>'application' v FROM audit_logs WHERE id=6`)).v === A1.toHexString() && Object.keys(report.models.auditLog.notes).some((n) => /not translated/.test(n)));
  const tokens = await q(`SELECT count(DISTINCT "publicToken")::int d, count(*)::int n FROM (SELECT "publicToken" FROM requisitions UNION ALL SELECT "publicToken" FROM interviews) t`);
  check('every job opening and interview has its own token', tokens[0].d === tokens[0].n && tokens[0].n === 3, JSON.stringify(tokens));

  console.log('\nThe verifier, on the same copy:');
  const verify = run(path.join('prisma', 'migrate', 'verify.js'));
  check('it passes: every record, field and link matches MongoDB, and every skipped record is absent', verify.code === 0, verify.out.split('\n').filter((l) => /X |DIFF/.test(l)).slice(0, 6).join('\n'));
  console.log(`  (${verify.out.split('\n').find((l) => /record checks/.test(l)) || ''})`);
} catch (error) {
  failed += 1;
  console.log(`\nStopped: ${error.message}`);
} finally {
  await cleanup();
  console.log('scratch databases removed');
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nPASS: the copy and the verifier handle awkward data correctly.');
process.exit(failed ? 1 : 0);
