/**
 * A whole working day on the real server running on PostgreSQL, with your data copied in: what is already there must be intact, and
 * everything new (new jobs, candidates, applications, interviews, scores, decisions, links, settings, users) must work on top of it.
 *
 *   npm run journey:postgres
 *
 * What it does, all on its own scratch database (ownerstalent_journey, made and removed by this script; your dev database is never
 * touched) and only ever against a LOCAL MongoDB and a LOCAL PostgreSQL:
 *   1. copies the MongoDB data into the scratch PostgreSQL (read only on MongoDB) and signs in as a user made for the test;
 *   2. starts the real server (index.js) on PostgreSQL and checks what was copied through the API (counts, names, details, old links);
 *   3. does the new work through the API: a new job (from scratch, and duplicated), a department, candidates, applications, interviews,
 *      scoring and approval, decisions, public links, availability, settings, hiring templates, users, deleting;
 *   4. stops the server and starts it again on the same database: everything is still there and new records carry on counting;
 *   5. checks the database itself: no record points at nothing, every public token is different, every counter is past its highest id.
 * What an AI would do (scoring a transcript, generating a scorecard) is stood in for by writing the "scored" state straight into the
 * scratch database, and the approving, overriding and everything after it is the real code.
 * It never calls an AI, sends an email, posts to Slack, uses a queue or uploads a file: the server is started WITHOUT Redis, mail,
 * Slack, AI, Google, file storage and captcha keys, and the secrets stored in the copied settings are deleted from the scratch database.
 */
import '../../config/env.js';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import prismaPkg from '@prisma/client';

const { PrismaClient } = prismaPkg;
const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..', '..');
const DB = 'ownerstalent_journey';
const PORT = 5057;
const PASSWORD = 'Journey-Test-123!';
const LOCAL = ['localhost', '127.0.0.1', '::1'];

const sourceUri = process.env.MIGRATE_MONGO_URI || process.env.MONGODB_URI;
if (!LOCAL.includes(new URL(sourceUri).hostname)) throw new Error('The journey test only copies from a local MongoDB (check MONGODB_URI in .env); a live database is never used for tests.');
const devUrl = new URL(process.env.DATABASE_URL);
if (!LOCAL.includes(devUrl.hostname)) throw new Error('The journey test only runs against a local Postgres.');
const dbUrl = new URL(devUrl.toString()); dbUrl.pathname = `/${DB}`;

// nothing that could reach the outside world: no queue (Redis), no mail, no Slack, no AI, no Google, no file storage, no captcha service
const SECRET_SETTINGS = ['anthropicApiKey', 'googleClientId', 'googleClientSecret', 'googleRefreshToken', 'slackWebhookUrl', 'gmailUser', 'gmailAppPassword'];
const env = {
  ...process.env, DATABASE_URL: dbUrl.toString(), DB_PROVIDER: 'postgres', PORT: String(PORT), BULLMQ_PREFIX: 'journeytest', MIGRATE_MONGO_URI: sourceUri,
  REDIS_URL: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', SLACK_WEBHOOK_URL: '', ANTHROPIC_API_KEY: '',
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REFRESH_TOKEN: '', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '',
  CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', S3_BUCKET: '',
};

const admin = new PrismaClient({ datasourceUrl: devUrl.toString() });
const db = new PrismaClient({ datasourceUrl: dbUrl.toString() });
const run = (script, args) => {
  try { return execFileSync(process.execPath, [path.join(serverDir, script), ...args], { cwd: serverDir, env, stdio: 'pipe' }).toString(); } catch (error) {
    const lines = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message}`.split('\n').filter((l) => l.trim() && !/MONGOOSE|trace-warnings/.test(l));
    throw new Error(`${path.basename(script)} failed:\n${lines.slice(-12).join('\n')}`);
  }
};

let server; let serverLog = [];
async function startServer() {
  serverLog = [];
  server = spawn(process.execPath, ['index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => serverLog.push(...String(chunk).split('\n').filter(Boolean)));
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`The server did not start. Last log lines:\n${serverLog.slice(-15).join('\n')}`);
}
async function stopServer() {
  if (server && !server.killed) { server.kill('SIGINT'); await new Promise((r) => setTimeout(r, 1500)); if (!server.killed) server.kill(); }
}
async function cleanup() {
  await stopServer();
  await db.$disconnect().catch(() => {});
  try { await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`); } catch { /* left behind: harmless */ }
  await admin.$disconnect();
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  ${ok ? 'ok      ' : 'FAILED  '} ${name}${ok ? '' : `   -> ${String(detail).slice(0, 300)}`}`); };
const sql = (text, ...params) => db.$queryRawUnsafe(text, ...params);

try {
  console.log('Preparing the scratch PostgreSQL database...');
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${DB}"`);
  run(path.join('node_modules', 'prisma', 'build', 'index.js'), ['migrate', 'deploy']);
  let copy; try { copy = run(path.join('prisma', 'migrate', 'migrate.js'), ['--reset']); } catch (error) { if (!/Done in/.test(error.message)) throw error; copy = error.message; }
  console.log(`  ${copy.split('\n').find((l) => l.includes('read,')) || 'data copied'}`);
  await db.$executeRawUnsafe('DELETE FROM settings WHERE "key" = ANY($1::text[])', SECRET_SETTINGS); // a copied credential must not be usable

  // what MongoDB holds, read only, to compare with what the server says
  await mongoose.connect(sourceUri);
  const mongoDb = mongoose.connection.db;
  const fromMongo = async (collection) => mongoDb.collection(collection).find({}).toArray();
  const mongo = { users: await fromMongo('users'), departments: await fromMongo('departments'), templates: await fromMongo('pipelinetemplates'), settings: await fromMongo('settings'),
    candidates: await fromMongo('candidates'), requisitions: await fromMongo('requisitions'), applications: await fromMongo('applications'), interviews: await fromMongo('interviews'), audits: await fromMongo('auditlogs') };
  await mongoose.disconnect();
  const maxIds = {};
  for (const table of ['users', 'candidates', 'requisitions', 'applications', 'interviews', 'departments', 'audit_logs']) maxIds[table] = Number((await sql(`SELECT COALESCE(max(id), 0)::int AS m FROM "${table}"`))[0].m);

  process.env.DATABASE_URL = dbUrl.toString();
  const users = await import(pathToFileURL(path.join(serverDir, 'repositories', 'postgres', 'userRepository.js')).href);
  await users.create({ name: 'Journey Test', email: 'journey@example.com', passwordHash: await bcrypt.hash(PASSWORD, 10), role: 'owner', active: true });
  const { disconnect } = await import(pathToFileURL(path.join(serverDir, 'repositories', 'postgres', 'client.js')).href);
  await disconnect();

  console.log('Starting the server on PostgreSQL...');
  await startServer();
  const base = `http://127.0.0.1:${PORT}`;
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
  const anon = async (method, url, body) => { const saved = cookies; cookies = {}; try { return await call(method, url, body); } finally { cookies = saved; } };
  /** One call, one check: the answer must have the given status (200 unless told) and pass `test`. Returns the answer's data. */
  const step = async (name, method, url, body, test = () => true, status = 200) => {
    try { const { status: got, data } = await call(method, url, body); check(name, got === status && Boolean(test(data)), `HTTP ${got} ${JSON.stringify(data)?.slice(0, 260)}`); return data; } catch (error) { check(name, false, error.message); return null; }
  };
  const isText = (value) => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
  const idOf = (data, key) => (data && (data[key] || data))._id;

  console.log('\n=== 1. What was copied is all there, through the API');
  await step('sign in', 'POST', '/api/auth/login', { email: 'journey@example.com', password: PASSWORD }, (d) => d.user && isText(d.user._id));
  const apiDepartments = (await call('GET', '/api/departments')).data.departments;
  const apiRequisitions = (await call('GET', '/api/requisitions')).data.requisitions;
  const apiTemplates = (await call('GET', '/api/pipelines')).data;
  const apiUsers = (await call('GET', '/api/users')).data.users;
  const apiCandidates = (await call('GET', '/api/candidates?limit=1000')).data;
  const apiSettings = (await call('GET', '/api/settings')).data;
  check(`${mongo.departments.length} departments`, apiDepartments.length === mongo.departments.length && apiDepartments.every((d) => isText(d._id)), apiDepartments.length);
  check(`${mongo.requisitions.length} job openings, with the same titles`, apiRequisitions.length === mongo.requisitions.length && JSON.stringify(apiRequisitions.map((r) => r.title).sort()) === JSON.stringify(mongo.requisitions.map((r) => r.title).sort()), apiRequisitions.length);
  check(`${mongo.templates.length} hiring templates`, (apiTemplates.templates || apiTemplates.pipelines || []).length === mongo.templates.length);
  check(`${mongo.users.length} users (plus the test user), with the same emails`, apiUsers.length === mongo.users.length + 1 && JSON.stringify(apiUsers.map((u) => u.email).filter((e) => e !== 'journey@example.com').sort()) === JSON.stringify(mongo.users.map((u) => u.email).sort()), apiUsers.length);
  check(`${mongo.candidates.length} candidates, with the same emails`, (apiCandidates.total ?? apiCandidates.candidates.length) === mongo.candidates.length && JSON.stringify(apiCandidates.candidates.map((c) => c.email).sort()) === JSON.stringify(mongo.candidates.map((c) => c.email).sort()), apiCandidates.total);
  const keptSettings = mongo.settings.filter((s) => !SECRET_SETTINGS.includes(s.key)); // the stored secrets were deleted from the scratch database on purpose
check(`${keptSettings.length} settings (the ${mongo.settings.length - keptSettings.length} stored secrets were removed for the test), with the same keys`, JSON.stringify((apiSettings.settings || []).map((s) => s.key).sort()) === JSON.stringify(keptSettings.map((s) => s.key).sort()), JSON.stringify((apiSettings.settings || []).map((s) => s.key).sort()));
  // every application and interview, counted through the job openings the API shows
  let applicationCount = 0; let interviewCount = 0; let totalsOk = true; const oldRequisition = apiRequisitions[0];
  for (const requisition of apiRequisitions) {
    const detail = (await call('GET', `/api/requisitions/${requisition._id}?limit=1000`)).data;
    applicationCount += detail.applications.length;
    interviewCount += ((await call('GET', `/api/interviews?requisitionId=${requisition._id}`)).data.interviews || []).length;
    const wanted = mongo.applications.filter((a) => String(a.requisitionId) === String(mongo.requisitions.find((r) => r.title === requisition.title)._id)).length;
    if (detail.applications.length !== wanted) totalsOk = false;
  }
  check(`${mongo.applications.length} applications, each job opening showing its own`, applicationCount === mongo.applications.length && totalsOk, `${applicationCount}`);
  check(`${mongo.interviews.length} interviews`, interviewCount === mongo.interviews.length, `${interviewCount}`);
  const audit = (await call('GET', '/api/audit?limit=1000')).data;
  check('the audit log (with the acting users filled in)', (audit.total ?? (audit.entries || []).length) >= mongo.audits.length, audit.total);

  console.log('\n=== 2. Links shared before the move still work');
  const [job] = await sql('SELECT "publicToken" AS token, "legacyId" AS legacy FROM requisitions ORDER BY id LIMIT 1');
  const [meeting] = await sql('SELECT id, "publicToken" AS token, "legacyId" AS legacy FROM interviews ORDER BY id LIMIT 1');
  await db.$executeRawUnsafe('UPDATE requisitions SET status = \'open\', "applicationDeadline" = NULL WHERE "legacyId" = $1', job.legacy);
  check('the old apply link opens the job', (await anon('GET', `/api/requisitions/${job.legacy}/public`)).status === 200);
  check('the new apply link (token) opens the same job', (await anon('GET', `/api/requisitions/${job.token}/public`)).data?.requisition?.title === (await anon('GET', `/api/requisitions/${job.legacy}/public`)).data?.requisition?.title);
  check('the old availability link opens', (await anon('GET', `/api/interviews/${meeting.legacy}/availability/public`)).status === 200);
  check('a plain number is not a link', (await anon('GET', `/api/requisitions/${oldRequisition._id}/public`)).status === 404 && (await anon('GET', `/api/interviews/${meeting.id}/availability/public`)).status === 404);

  console.log('\n=== 3. New work on top of the copied data');
  // a department and a job opening, from scratch (the details of the existing job are reused, they are what the form would send)
  const department = await step('create a department', 'POST', '/api/departments', { name: 'Journey Department', description: 'new' }, (d) => isText(idOf(d, 'department')), 201);
  const departmentId = idOf(department, 'department');
  const existing = (await call('GET', `/api/requisitions/${oldRequisition._id}?limit=1`)).data.requisition;
  const template = (apiTemplates.templates || apiTemplates.pipelines || []).find((t) => t.isDefault) || (apiTemplates.templates || apiTemplates.pipelines)[0];
  const newJobBody = {
    title: 'Journey Test Engineer', employmentType: existing.employmentType, fullTimeDetails: existing.fullTimeDetails, partTimeDetails: existing.partTimeDetails, contractDetails: existing.contractDetails,
    internshipDetails: existing.internshipDetails, workplaceType: existing.workplaceType, officeLocation: existing.officeLocation, remoteRegion: existing.remoteRegion, jobDescription: '<p>Build things for the journey test.</p>',
    pipelineTemplateId: template._id, hireThreshold: 3.5, maybeThreshold: 3, initialScreeningCriteria: existing.initialScreeningCriteria, questionnaire: existing.questionnaire,
    applicationDeadline: new Date(Date.now() + 30 * 86400e3).toISOString(), aiScreeningEnabled: false, status: 'open', departmentId,
  };
  const created = await step('create a job opening', 'POST', '/api/requisitions', newJobBody, (d) => isText(d.requisition._id) && /^[0-9a-f-]{36}$/.test(d.requisition.publicToken) && d.requisition.departmentId === departmentId && d.requisition.createdBy, 201);
  const newJob = created && created.requisition; const newJobId = newJob && newJob._id;
  check('its id is after every copied one', Number(newJobId) > maxIds.requisitions, `${newJobId} <= ${maxIds.requisitions}`);
  await step('the new apply link (its token) opens it', 'GET', `/api/requisitions/${newJob && newJob.publicToken}/public`, undefined, (d) => d.requisition.title === 'Journey Test Engineer');
  check('and the plain number does not', (await anon('GET', `/api/requisitions/${newJobId}/public`)).status === 404);
  const opened = await step('read it back, with its department filled in', 'GET', `/api/requisitions/${newJobId}`, undefined, (d) => d.requisition.title === 'Journey Test Engineer' && d.requisition.departmentId && d.requisition.departmentId._id === departmentId);
  const stages = (opened && opened.requisition.stages || []).filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  await step('pause it, then open it again', 'PATCH', `/api/requisitions/${newJobId}`, { status: 'paused' }, (d) => d.requisition.status === 'paused');
  await step('reopen it', 'PATCH', `/api/requisitions/${newJobId}`, { status: 'open' }, (d) => d.requisition.status === 'open');
  await step('rename it', 'PATCH', `/api/requisitions/${newJobId}`, { title: 'Journey Test Engineer II' }, (d) => d.requisition.title === 'Journey Test Engineer II');
  const duplicate = await step('duplicate a copied job opening', 'POST', `/api/requisitions/${oldRequisition._id}/duplicate`, {}, (d) => isText(idOf(d, 'requisition')) && idOf(d, 'requisition') !== oldRequisition._id, 201);
  const copied = await step('clone the scorecard of a copied job opening onto the new one', 'POST', `/api/requisitions/${newJobId}/clone-scorecard`, { sourceRequisitionId: oldRequisition._id }, (d) => d);
  void copied;
  const scorecard = (await call('GET', `/api/requisitions/${newJobId}/scorecard`)).data;
  check('the new job opening has a scorecard of its own', Boolean(scorecard && (scorecard.scorecard || scorecard.stages)), JSON.stringify(scorecard)?.slice(0, 160));

  // candidates, applications
  const candidate = await step('create a candidate', 'POST', '/api/candidates', { name: 'Journey Candidate', email: 'journey.candidate@example.com', phone: '03001234567' }, (d) => isText(idOf(d, 'candidate')), 201);
  const candidateId = idOf(candidate, 'candidate');
  check('its id is after every copied one', Number(candidateId) > maxIds.candidates, `${candidateId} <= ${maxIds.candidates}`);
  await step('the same email again is refused', 'POST', '/api/candidates', { name: 'Again', email: 'journey.candidate@example.com', phone: '03001234567' }, () => true, 400);
  const application = await step('attach the candidate to the new job opening', 'POST', `/api/candidates/${candidateId}/apply`, { requisitionId: newJobId }, (d) => isText(d.application._id) && d.application.candidateId === candidateId && d.application.requisitionId === newJobId && d.application.stageProgress.length === stages.length, 201);
  const applicationId = application && application.application._id;
  await step('attaching again is refused (409) and names the application', 'POST', `/api/candidates/${candidateId}/apply`, { requisitionId: newJobId }, (d) => d.applicationId === applicationId, 409);
  const oldCandidate = apiCandidates.candidates[0];
  const second = await step('attach a copied candidate to the new job opening too', 'POST', `/api/candidates/${oldCandidate._id}/apply`, { requisitionId: newJobId }, (d) => isText(d.application._id), 201);
  await step('the job opening lists both applications, with the candidates filled in', 'GET', `/api/requisitions/${newJobId}?limit=100`, undefined, (d) => d.applications.length === 2 && d.applications.every((a) => a.candidateId && a.candidateId.name) && d.applications.some((a) => a.candidateId._id === candidateId));
  await step('the candidate\'s own page shows the application', 'GET', `/api/candidates/${candidateId}`, undefined, (d) => JSON.stringify(d).includes(applicationId));
  await step('edit the candidate', 'PATCH', `/api/candidates/${candidateId}`, { notes: 'journey note' }, (d) => (d.candidate || d).notes === 'journey note');
  await step('edit a copied candidate (and put it back)', 'PATCH', `/api/candidates/${oldCandidate._id}`, { notes: 'journey note' }, (d) => (d.candidate || d).notes === 'journey note');
  await step('put the copied candidate\'s note back', 'PATCH', `/api/candidates/${oldCandidate._id}`, { notes: oldCandidate.notes || '' }, (d) => Boolean(d));

  // interviews and scoring
  const first = stages[0];
  const interview = await step(`start the first stage (${first && first.key}) for the candidate`, 'POST', '/api/interviews', { applicationId, stageKey: first && first.key }, (d) => isText(d.interview._id) && d.interview.applicationId === applicationId && /^[0-9a-f-]{36}$/.test(d.interview.publicToken), 201);
  const interviewId = interview && interview.interview._id;
  check('its id is after every copied one', Number(interviewId) > maxIds.interviews, `${interviewId} <= ${maxIds.interviews}`);
  await step('the same stage again is refused (409)', 'POST', '/api/interviews', { applicationId, stageKey: first.key }, (d) => d.interviewId === interviewId, 409);
  await step('the application now says that stage is scheduled', 'GET', `/api/requisitions/${newJobId}?limit=100`, undefined, (d) => d.applications.find((a) => a._id === applicationId).stageProgress.find((p) => p.stageKey === first.key).status === 'scheduled');
  const requested = await step('request availability: the link carries the token, nothing is queued', 'POST', `/api/interviews/${interviewId}/request-availability`, {}, (d) => d.availabilityUrl.includes(interview.interview.publicToken) && d.queued === false);
  const ref = requested && requested.availabilityUrl.split('/interview/')[1].split('/availability')[0];
  check('the candidate opens that link and sends their availability', (await anon('GET', `/api/interviews/${ref}/availability/public`)).status === 200 && (await anon('POST', `/api/interviews/${ref}/availability/public`, { preferredDate: '2027-01-05', startTime: '10:00', notes: 'journey' })).status === 200);
  check('the availability was saved on the interview', (await sql('SELECT "candidateAvailability" AS a FROM interviews WHERE id = $1::int', Number(interviewId)))[0].a.notes === 'journey');

  // stand in for the AI: the stage has been "scored" (rows written straight into the scratch database), then the real approve / override / decision code runs
  const stageAttributes = ((scorecard && (scorecard.scorecard || scorecard).stages) || []).find((s) => s.stageKey === first.key);
  const attributeIds = (stageAttributes ? stageAttributes.attributes : []).map((a) => a.attributeId);
  if (first.inputType === 'status_only' || !attributeIds.length) {
    check(`(the first stage "${first.key}" has no rubric here, so the interview is approved as a status)`, true);
  } else {
    const scores = attributeIds.map((attributeId) => ({ attributeId, aiScore: 4, aiJustification: 'journey' }));
    await db.$executeRawUnsafe('UPDATE interviews SET scores = $2::jsonb, status = \'scored\', "stageAverage" = 4 WHERE id = $1::int', Number(interviewId), JSON.stringify(scores));
  }
  const user = (await call('GET', '/api/auth/me')).data.user;
  if (attributeIds.length) {
    await step('override one score (the user who did it is recorded as text)', 'PATCH', `/api/scoring/interview/${interviewId}/override`, { overrides: [{ attributeId: attributeIds[0], approvedScore: 5, reason: 'journey override reason' }] }, (d) => JSON.stringify(d).includes(user._id));
    check('inside the stored score the user is a number, as the data copy writes it', Number((await sql('SELECT scores FROM interviews WHERE id = $1::int', Number(interviewId)))[0].scores.find((s) => s.attributeId === attributeIds[0]).overriddenBy) === Number(user._id));
  }
  const approved = await step('approve the stage', 'PATCH', `/api/scoring/interview/${interviewId}/approve`, {}, (d) => d.interview.status === 'approved' && d.application && isText(d.application._id));
  check('the next stage was started for the candidate', Boolean(approved && (approved.nextInterviewId || stages.length === 1)), JSON.stringify(approved && approved.nextInterviewId));
  await step('recompute the application score', 'POST', `/api/scoring/application/${applicationId}/recompute`, {}, (d) => Boolean(d));
  await step('the ranking lists both applications', 'GET', `/api/requisitions/${newJobId}/ranking`, undefined, (d) => (d.applications || d.ranking || []).length >= 1);
  await step('record the final decision', 'PATCH', `/api/scoring/application/${applicationId}/decision`, { decision: 'withdrawn', reason: 'journey' }, (d) => d.application.finalDecision === 'withdrawn' && d.application.finalDecisionBy === user._id);
  check('the decider is a number in the table', Number((await sql('SELECT "finalDecisionBy" AS u FROM applications WHERE id = $1::int', Number(applicationId)))[0].u) === Number(user._id));
  const trail = await call('GET', '/api/audit?limit=50');
  const entries = trail.data.entries || [];
  check('the audit log recorded the new work, with the acting user filled in', entries.some((e) => e.action === 'final_decision' && e.userId && e.userId._id === user._id) && entries.some((e) => e.applicationId === applicationId), JSON.stringify(entries.slice(0, 2)).slice(0, 200));

  // settings, templates, users
  const setting = apiSettings.settings.find((s) => typeof s.value === 'number') || apiSettings.settings[0];
  await step(`change a setting (${setting.key})`, 'PUT', `/api/settings/${setting.key}`, { value: setting.value }, (d) => Boolean(d));
  const newTemplate = await step('create a hiring template', 'POST', '/api/pipelines', { name: 'Journey Template', stages: template.stages.map((s) => ({ key: s.key, label: s.label, stageType: s.stageType, inputType: s.inputType, enabled: s.enabled, order: s.order, weight: s.weight, passThreshold: s.passThreshold })) }, (d) => isText(idOf(d, 'template')), 201);
  const newTemplateId = idOf(newTemplate, 'template');
  await step('rename the template', 'PATCH', `/api/pipelines/${newTemplateId}`, { name: 'Journey Template 2' }, (d) => (d.template || d).name === 'Journey Template 2');
  await step('delete the template', 'DELETE', `/api/pipelines/${newTemplateId}`, undefined, () => true);
  const person = await step('create a user', 'POST', '/api/users', { name: 'Journey Person', email: 'journey.person@example.com', password: 'Another-Pass-123!', role: 'recruiter' }, (d) => isText(idOf(d, 'user')), 201);
  const personId = idOf(person, 'user');
  check('its id is after every copied one', Number(personId) > maxIds.users, `${personId} <= ${maxIds.users}`);
  const personSession = await anon('POST', '/api/auth/login', { email: 'journey.person@example.com', password: 'Another-Pass-123!' });
  check('the new user can sign in', personSession.status === 200 && personSession.data.user.role === 'recruiter');
  await step('change the user\'s role', 'PATCH', `/api/users/${personId}`, { role: 'interviewer' }, (d) => (d.user || d).role === 'interviewer');

  console.log('\n=== 4. Stop the server, start it again: nothing is lost');
  const before = { jobs: (await call('GET', '/api/requisitions')).data.requisitions.length, candidates: (await call('GET', '/api/candidates?limit=1000')).data.total };
  await stopServer();
  await startServer();
  cookies = {};
  await step('sign in again after the restart', 'POST', '/api/auth/login', { email: 'journey@example.com', password: PASSWORD }, (d) => d.user);
  check('the job openings and candidates are all still there', (await call('GET', '/api/requisitions')).data.requisitions.length === before.jobs && (await call('GET', '/api/candidates?limit=1000')).data.total === before.candidates);
  await step('the new application and its decision survived', 'GET', `/api/requisitions/${newJobId}?limit=100`, undefined, (d) => d.applications.find((a) => a._id === applicationId).finalDecision === 'withdrawn');
  const another = await step('new records carry on counting after the restart', 'POST', '/api/candidates', { name: 'After Restart', email: 'after.restart@example.com', phone: '03001234568' }, (d) => Number(idOf(d, 'candidate')) === Number(candidateId) + 1, 201);
  const anotherId = idOf(another, 'candidate');

  console.log('\n=== 5. Deleting, and what the database says at the end');
  await step('take the candidate off the job opening', 'DELETE', `/api/candidates/${candidateId}/requisitions/${newJobId}`, undefined, () => true);
  check('their application and interviews went with it', (await sql('SELECT (SELECT count(*) FROM applications WHERE "candidateId" = $1::int)::int AS a, (SELECT count(*) FROM interviews WHERE "applicationId" = $2::int)::int AS i', Number(candidateId), Number(applicationId)))[0].a === 0);
  await step('delete the candidates made here', 'DELETE', `/api/candidates/${candidateId}`, undefined, () => true);
  await step('and the other', 'DELETE', `/api/candidates/${anotherId}`, undefined, () => true);
  await step('delete the user made here', 'DELETE', `/api/users/${personId}`, undefined, () => true);
  await step('delete the new job opening', 'DELETE', `/api/requisitions/${newJobId}`, undefined, () => true);
  if (duplicate) await step('delete the duplicated job opening', 'DELETE', `/api/requisitions/${idOf(duplicate, 'requisition')}`, undefined, () => true);
  check('the new job opening took its scorecard, applications and interviews with it', (await sql('SELECT (SELECT count(*) FROM scorecards WHERE "requisitionId" = $1::int)::int + (SELECT count(*) FROM applications WHERE "requisitionId" = $1::int)::int + (SELECT count(*) FROM interviews WHERE "requisitionId" = $1::int)::int AS n', Number(newJobId)))[0].n === 0);
  await step('delete the department made here', 'DELETE', `/api/departments/${departmentId}`, undefined, () => true);
  void second;
  check('the copied data is exactly as it was: same counts of every table', (await sql('SELECT (SELECT count(*) FROM requisitions)::int r, (SELECT count(*) FROM candidates)::int c, (SELECT count(*) FROM applications)::int a, (SELECT count(*) FROM interviews)::int i, (SELECT count(*) FROM users)::int u, (SELECT count(*) FROM departments)::int d')).every((row) => row.r === mongo.requisitions.length && row.c === mongo.candidates.length && row.a === mongo.applications.length && row.i === mongo.interviews.length && row.u === mongo.users.length + 1 && row.d === mongo.departments.length));
  const [integrity] = await sql(`SELECT
    (SELECT count(*) FROM applications a WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.id = a."candidateId") OR NOT EXISTS (SELECT 1 FROM requisitions r WHERE r.id = a."requisitionId"))::int AS bad_applications,
    (SELECT count(*) FROM interviews i WHERE NOT EXISTS (SELECT 1 FROM applications a WHERE a.id = i."applicationId") OR NOT EXISTS (SELECT 1 FROM requisitions r WHERE r.id = i."requisitionId"))::int AS bad_interviews,
    (SELECT count(*) FROM scorecards s WHERE NOT EXISTS (SELECT 1 FROM requisitions r WHERE r.id = s."requisitionId"))::int AS bad_scorecards,
    (SELECT count(*) FROM refresh_tokens t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t."userId"))::int AS bad_tokens,
    (SELECT count(*) FROM requisitions WHERE "publicToken" IS NULL)::int + (SELECT count(*) FROM interviews WHERE "publicToken" IS NULL)::int AS no_token,
    (SELECT count(DISTINCT "publicToken") FROM requisitions)::int - (SELECT count(*) FROM requisitions)::int AS repeated_job_tokens,
    (SELECT count(DISTINCT "publicToken") FROM interviews)::int - (SELECT count(*) FROM interviews)::int AS repeated_interview_tokens`);
  check('no record points at nothing, every public token is there and different', Object.values(integrity).every((v) => Number(v) === 0), JSON.stringify(integrity));
  let countersOk = true; const counterNotes = [];
  for (const table of ['users', 'departments', 'pipeline_templates', 'settings', 'candidates', 'requisitions', 'scorecards', 'applications', 'interviews', 'refresh_tokens', 'audit_logs']) {
    const highest = Number((await sql(`SELECT COALESCE(max(id), 0)::int AS m FROM "${table}"`))[0].m); const counter = Number((await sql(`SELECT last_value::int AS v FROM "${table}_id_seq"`))[0].v);
    if (counter < highest) { countersOk = false; counterNotes.push(`${table}: counter ${counter} < ${highest}`); }
  }
  check('every table\'s counter is past its highest id (the next record cannot clash)', countersOk, counterNotes.join('; '));
  const problems = serverLog.filter((line) => /\b(error|ERROR)\b|Unhandled|TypeError|Prisma/.test(line) && !/Redis|ECONNREFUSED|ValidationError|VALIDATION|Authentication failed/.test(line));
  console.log(`\nServer log (after the restart): ${problems.length ? `${problems.length} line(s) mention errors:` : 'no errors logged.'}`);
  for (const line of problems.slice(0, 12)) console.log(`   ${line.slice(0, 220)}`);
  if (problems.length) check('no unexpected errors in the server log', false, problems[0]);
} catch (error) {
  console.log(`\nStopped: ${error.message}`);
  results.push({ name: 'run', ok: false });
} finally {
  await cleanup();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? `${failed} CHECK(S) FAILED` : 'PASS: a whole working day on PostgreSQL, on top of the copied data, works'} (${results.length - failed} of ${results.length} checks ok).`);
process.exit(failed ? 1 : 0);
