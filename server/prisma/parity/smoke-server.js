/**
 * Runs the REAL server on PostgreSQL and makes real requests to it.
 *
 *   npm run smoke:postgres
 *
 * What it does, all on its own scratch database (ownerstalent_smoke, made and removed by this script; your dev database is
 * never touched):
 *   1. copies your real MongoDB data into the scratch PostgreSQL (read-only on MongoDB);
 *   2. adds a login for itself (smoke@example.com);
 *   3. starts the server (index.js) with DB_PROVIDER=postgres on port 5055, with its own queue name so it cannot take jobs
 *      from, or give jobs to, an app you have running;
 *   4. signs in and calls the real endpoints (lists, details, and a few safe changes), checking each answer;
 *   5. stops the server and removes the scratch database.
 * It never calls an AI, sends an email or uploads a file.
 */
import '../../config/env.js';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import prismaPkg from '@prisma/client';

const { PrismaClient } = prismaPkg;
const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..', '..');
const SMOKE_DB = 'ownerstalent_smoke';
const PORT = 5055;
const PASSWORD = 'Smoke-Test-123!';

const devUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(devUrl.hostname)) throw new Error('The smoke test only runs against a local Postgres.');
const smokeUrl = new URL(devUrl.toString()); smokeUrl.pathname = `/${SMOKE_DB}`;
const env = { ...process.env, DATABASE_URL: smokeUrl.toString(), DB_PROVIDER: 'postgres', PORT: String(PORT), BULLMQ_PREFIX: 'smoketest' };

const admin = new PrismaClient({ datasourceUrl: devUrl.toString() });
const run = (script, args) => {
  try { return execFileSync(process.execPath, [path.join(serverDir, script), ...args], { cwd: serverDir, env, stdio: 'pipe' }).toString(); }
  catch (error) {
    const lines = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message}`.split('\n').filter((l) => l.trim() && !/MONGOOSE|trace-warnings/.test(l));
    throw new Error(`${path.basename(script)} failed:\n${lines.slice(-12).join('\n')}`);
  }
};

let server; const serverLog = [];
async function cleanup() {
  if (server && !server.killed) { server.kill('SIGINT'); await new Promise((r) => setTimeout(r, 1500)); if (!server.killed) server.kill(); }
  try { await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SMOKE_DB}" WITH (FORCE)`); } catch { /* left behind: harmless */ }
  await admin.$disconnect();
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? 'ok      ' : 'FAILED  '} ${name}${ok ? '' : `   -> ${detail}`}`); };

try {
  console.log('Preparing the scratch PostgreSQL database...');
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SMOKE_DB}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${SMOKE_DB}"`);
  run(path.join('node_modules', 'prisma', 'build', 'index.js'), ['migrate', 'deploy']);
  let copy; // the copy exits with a warning code when it skipped rows (here: tokens of deleted users), which is fine
  try { copy = run(path.join('prisma', 'migrate', 'migrate.js'), ['--reset']); } catch (error) { if (!/Done in/.test(error.message)) throw error; copy = error.message; }
  console.log(`  ${copy.split('\n').find((l) => l.includes('read,')) || 'data copied'}`);

  process.env.DATABASE_URL = smokeUrl.toString(); // for the repositories used below
  const users = await import(pathToFileURL(path.join(serverDir, 'repositories', 'postgres', 'userRepository.js')).href);
  await users.create({ name: 'Smoke Test', email: 'smoke@example.com', passwordHash: await bcrypt.hash(PASSWORD, 10), role: 'owner', active: true });
  const { disconnect } = await import(pathToFileURL(path.join(serverDir, 'repositories', 'postgres', 'client.js')).href);
  await disconnect();

  console.log('Starting the server on PostgreSQL...');
  server = spawn(process.execPath, ['index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => serverLog.push(...String(chunk).split('\n').filter(Boolean)));
  const base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
    if (i === 59) throw new Error(`The server did not start. Last log lines:\n${serverLog.slice(-15).join('\n')}`);
  }
  console.log(`  ${serverLog.find((l) => /Connected to PostgreSQL|Mixed mode|All repositories/.test(l)) || ''}`);

  const origin = (process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
  let cookies = {};
  const call = async (method, url, body) => {
    const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    const response = await fetch(`${base}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const line of response.headers.getSetCookie?.() || []) {
      const [pair] = line.split(';'); const at = pair.indexOf('=');
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(line)) delete cookies[pair.slice(0, at)]; else cookies[pair.slice(0, at)] = pair.slice(at + 1);
    }
    let data = null; try { data = await response.json(); } catch { /* no body */ }
    return { status: response.status, data };
  };
  const expect = async (name, method, url, body, test = () => true, status = 200) => {
    try {
      const { status: got, data } = await call(method, url, body);
      const ok = got === status && test(data);
      check(name, ok, `HTTP ${got} ${JSON.stringify(data)?.slice(0, 200)}`);
      return data;
    } catch (error) { check(name, false, error.message); return null; }
  };

  console.log('\nSigning in and calling the real endpoints:');
  await expect('health', 'GET', '/api/health');
  await expect('login with a wrong password is refused', 'POST', '/api/auth/login', { email: 'smoke@example.com', password: 'nope' }, () => true, 401);
  await expect('login', 'POST', '/api/auth/login', { email: 'smoke@example.com', password: PASSWORD }, (d) => d.user && d.user.email === 'smoke@example.com' && !d.user.passwordHash);
  await expect('who am I', 'GET', '/api/auth/me', undefined, (d) => d.user && d.user.role === 'owner');
  await expect('refresh the session', 'POST', '/api/auth/refresh', undefined, (d) => d.user);
  await expect('who am I, after refreshing', 'GET', '/api/auth/me');

  const first = await call('GET', '/api/requisitions');
  const REQUISITION_ID = ((first.data && first.data.requisitions) || [])[0]?._id || '';
  const lists = {};
  for (const [name, url, pick] of [
    ['departments', '/api/departments', (d) => d.departments], ['job openings', '/api/requisitions', (d) => d.requisitions], ['candidates', '/api/candidates?limit=50', (d) => d.candidates],
    ['interviews', `/api/interviews?requisitionId=${REQUISITION_ID}`, (d) => d.interviews], ['hiring process templates', '/api/pipelines', (d) => d.templates || d.pipelines], ['settings', '/api/settings', (d) => d.settings],
    ['audit log', '/api/audit', (d) => d.entries || d.logs || d.audit], ['users', '/api/users', (d) => d.users],
  ]) {
    const data = await expect(`list ${name}`, 'GET', url, undefined, (d) => Array.isArray(pick(d)) && pick(d).length >= 0);
    lists[name] = data ? pick(data) || [] : [];
  }

  const requisition = lists['job openings'][0];
  if (requisition) {
    await expect('one job opening', 'GET', `/api/requisitions/${requisition._id}`, undefined, (d) => (d.requisition || d)._id === requisition._id);
    await expect('its scorecard', 'GET', `/api/requisitions/${requisition._id}/scorecard`);
    await expect('its ranking', 'GET', `/api/requisitions/${requisition._id}/ranking`);
    await expect('its public view', 'GET', `/api/requisitions/${requisition._id}/public`);
  }
  const candidate = lists.candidates[0];
  if (candidate) await expect('one candidate', 'GET', `/api/candidates/${candidate._id}`);
  const interview = lists.interviews[0];
  if (interview) await expect('one interview', 'GET', `/api/interviews/${interview._id}`);

  // a few changes (on the scratch copy only)
  const department = await expect('create a department', 'POST', '/api/departments', { name: 'Smoke Department', description: 'temporary' }, (d) => (d.department || d)._id, 201);
  const departmentId = department && (department.department || department)._id;
  if (departmentId) {
    await expect('rename it', 'PATCH', `/api/departments/${departmentId}`, { name: 'Smoke Department 2' });
    await expect('a duplicate name is refused', 'POST', '/api/departments', { name: 'smoke department 2' }, () => true, 400);
    await expect('delete it', 'DELETE', `/api/departments/${departmentId}`);
  }
  const created = await expect('create a candidate', 'POST', '/api/candidates', { name: 'Smoke Candidate', email: 'smoke.candidate@example.com', phone: '03001112233' }, (d) => (d.candidate || d)._id, 201);
  const candidateId = created && (created.candidate || created)._id;
  if (candidateId) {
    await expect('update the candidate', 'PATCH', `/api/candidates/${candidateId}`, { notes: 'smoke note' });
    await expect('delete the candidate', 'DELETE', `/api/candidates/${candidateId}`);
  }
  const mail = `smoke.user.${Date.now()}@example.com`;
  const person = await expect('create a user', 'POST', '/api/users', { name: 'Smoke Person', email: mail, password: 'Another-Pass-123!', role: 'recruiter' }, (d) => (d.user || d)._id, 201);
  const personId = person && (person.user || person)._id;
  if (personId) {
    await expect('change the user role', 'PATCH', `/api/users/${personId}`, { role: 'interviewer' });
    await expect('delete the user', 'DELETE', `/api/users/${personId}`);
  }
  const application = requisition && (await call('GET', `/api/requisitions/${requisition._id}/ranking`)).data;
  const rankedList = application && (application.applications || application.ranking || []);
  if (rankedList && rankedList[0]) await expect('recompute an application score', 'POST', `/api/scoring/application/${rankedList[0]._id || rankedList[0].applicationId}/recompute`);
  await expect('read the audit log again (new entries exist)', 'GET', '/api/audit', undefined, (d) => (d.entries || d.logs || d.audit || []).length >= 1);
  await expect('log out', 'POST', '/api/auth/logout');
  await expect('after logging out, who am I is refused', 'GET', '/api/auth/me', undefined, () => true, 401);

  const problems = serverLog.filter((line) => /\b(error|ERROR)\b|Unhandled|TypeError|Prisma/.test(line) && !/Redis|ECONNREFUSED/.test(line));
  console.log(`\nServer log: ${problems.length ? `${problems.length} line(s) mention errors:` : 'no errors logged.'}`);
  for (const line of problems.slice(0, 12)) console.log(`   ${line.slice(0, 220)}`);
} catch (error) {
  console.log(`\nStopped: ${error.message}`);
  results.push({ name: 'run', ok: false, detail: error.message });
} finally {
  await cleanup();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? `${failed} CHECK(S) FAILED` : 'PASS: the real server works on PostgreSQL'} (${results.length - failed} of ${results.length} checks ok).`);
process.exit(failed ? 1 : 0);
