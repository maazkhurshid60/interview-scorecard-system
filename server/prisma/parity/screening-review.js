/**
 * The human review of public applications, end to end: the AI may only recommend, a person decides.
 *
 *   npm run test:screening
 *
 * What it does, all on its own scratch database (ownerstalent_review, made and removed by this script; your dev database is never
 * touched) and only against a LOCAL PostgreSQL:
 *   1. the rules in code: the fixed requirement checks, the AI's recommendation, and a reviewer's decision counting over a score gate;
 *   2. the background worker on applications it has to leave alone: it approves nothing, moves nobody and rejects nobody;
 *   3. the real server (index.js): who may review, what is refused, advancing and rejecting with and against the AI, changing a decision.
 * It never calls an AI, sends an email, posts to Slack, uses a queue or uploads a file: the keys are blanked, the "scored" state the
 * AI would leave is written straight into the scratch database, and no MongoDB is used at all.
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
const DB = 'ownerstalent_review';
const PORT = 5058;
const PASSWORD = 'Review-Test-123!';

const devUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(devUrl.hostname)) throw new Error('This test only runs against a local Postgres.');
const dbUrl = new URL(devUrl.toString()); dbUrl.pathname = `/${DB}`;

// nothing that could reach the outside world, in this process and in the server it starts
const env = {
  ...process.env, DATABASE_URL: dbUrl.toString(), DB_PROVIDER: 'postgres', PORT: String(PORT), BULLMQ_PREFIX: 'reviewtest', MONGODB_URI: '',
  REDIS_URL: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', SLACK_WEBHOOK_URL: '', ANTHROPIC_API_KEY: '',
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REFRESH_TOKEN: '', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '',
  CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', S3_BUCKET: '',
};
Object.assign(process.env, env);

const admin = new PrismaClient({ datasourceUrl: devUrl.toString() });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  ${ok ? 'ok      ' : 'FAILED  '} ${name}${ok ? '' : `   -> ${String(detail).slice(0, 300)}`}`); };
const throws = (work) => { try { work(); return null; } catch (error) { return error; } };

let server;
async function cleanup(repositories) {
  if (server && !server.killed) { server.kill('SIGINT'); await new Promise((r) => setTimeout(r, 1500)); if (!server.killed) server.kill(); }
  await repositories?.disconnect().catch(() => {});
  try { await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`); } catch { /* left behind: harmless */ }
  await admin.$disconnect();
}

const STAGES = [
  { key: 'resume_screen', label: 'Résumé Screen', stageType: 'resume_screen', inputType: 'artifact', enabled: true, order: 1, weight: 0.25, passThreshold: 3 },
  { key: 'hr_screen', label: 'Initial Screening', stageType: 'hr_screen', inputType: 'artifact', enabled: true, order: 2, weight: 0.25, passThreshold: 3 },
  { key: 'hr_interview', label: 'HR Interview', stageType: 'hr_interview', inputType: 'transcript', enabled: true, order: 3, weight: 0.5, passThreshold: 3 },
];
const CRITERIA = [
  { criteria: 'Education', minimumValue: "Bachelor's degree", maximumValue: 'PhD', relevantField: 'Computing', requirement: '' },
  { criteria: 'Experience', minimumValue: '3', maximumValue: '5', requirement: '' },
];
const LONG_TEXT = 'word '.repeat(60);

let dbRepositories;
try {
  console.log('Preparing the scratch PostgreSQL database...');
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${DB}"`);
  execFileSync(process.execPath, [path.join(serverDir, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], { cwd: serverDir, env, stdio: 'pipe' });

  const load = (file) => import(pathToFileURL(path.join(serverDir, file)).href);
  const engine = await load('services/scoringEngine.js');
  const review = await load('services/screeningReview.js');
  const { processApplication } = await load('services/applicationProcessor.js');
  const applications = await load('repositories/applicationRepository.js');
  const interviews = await load('repositories/interviewRepository.js');
  const requisitions = await load('repositories/requisitionRepository.js');
  const scorecards = await load('repositories/scorecardRepository.js');
  const candidates = await load('repositories/candidateRepository.js');
  const users = await load('repositories/userRepository.js');
  const auditLog = await load('repositories/auditLogRepository.js');
  dbRepositories = await load('repositories/postgres/client.js');

  console.log('\n=== 1. The rules in code');
  const job = { initialScreeningCriteria: CRITERIA };
  const met = review.checkRequirements(job, { education: 'PhD', experienceYears: '4' });
  check('meeting both requirements is met', met.checks.length === 2 && met.checks.every((c) => c.met), JSON.stringify(met));
  check('a lower education level is not met', !review.checkRequirements(job, { education: 'Undergraduate (currently studying)', experienceYears: '4' }).checks[0].met);
  check('"None of these" is not met, and is a valid answer', !review.checkRequirements(job, { education: review.NO_LISTED_EDUCATION, experienceYears: '4' }).checks[0].met);
  check('too little experience is not met', review.hasUnmetRequirement(review.checkRequirements(job, { education: 'PhD', experienceYears: '2' })));
  check('more experience than the maximum is NOT held against anyone', !review.hasUnmetRequirement(review.checkRequirements(job, { education: 'PhD', experienceYears: '10+' })));
  check('an answer that is not a listed choice is refused', throws(() => review.checkRequirements(job, { education: 'Wizard', experienceYears: '4' }))?.statusCode === 400);
  check('a missing answer is refused', throws(() => review.checkRequirements(job, { education: 'PhD' }))?.statusCode === 400);
  check('a job with no minimums asks nothing', review.checkRequirements({ initialScreeningCriteria: [] }, {}) === null);
  check('a minimum of 0 years asks nothing', !review.requirementsToAsk({ initialScreeningCriteria: [{ criteria: 'Experience', minimumValue: '0' }] }).experience);

  const scored = (aiScore, approvedScore) => ({ scores: [{ attributeId: 'a', aiScore, approvedScore }], status: 'approved' });
  const recommendation = (a, b) => engine.computeScreeningRecommendation([{ interview: scored(a), passThreshold: 3 }, { interview: scored(b), passThreshold: 3 }]);
  check('the AI recommends advancing when both stages reach their gate', recommendation(4, 3).aiRecommendation === 'advance' && recommendation(4, 3).aiScore === 3.5);
  check('the AI recommends rejecting when one stage does not', recommendation(4, 2).aiRecommendation === 'reject');
  check('the recommendation reads only the AI\'s scores', engine.computeScreeningRecommendation([{ interview: scored(2, 5), passThreshold: 3 }]).aiRecommendation === 'reject');
  check('no recommendation without AI scores', engine.computeScreeningRecommendation([{ interview: { scores: [] }, passThreshold: 3 }]).aiRecommendation === null);

  const result = (resume, stageGates) => engine.computeApplicationResult({
    stages: STAGES, hireThreshold: 3.5, maybeThreshold: 3, stageGates,
    interviewsByStageKey: new Map([['resume_screen', scored(resume, resume)], ['hr_screen', scored(4, 4)], ['hr_interview', scored(4, 4)]]),
  });
  check('without a reviewer, a score below the gate fails', result(2).disposition === 'NO_HIRE');
  check('a reviewer who advances counts over the gate', result(2, { resume_screen: true }).allGatesPassed === true && result(2, { resume_screen: true }).disposition !== 'NO_HIRE');
  check('a reviewer who rejects counts over a high score', result(5, { resume_screen: false }).disposition === 'NO_HIRE');
  check('the weighted total still uses the real score', result(2, { resume_screen: true }).weightedTotal === 3.5, result(2, { resume_screen: true }).weightedTotal);

  console.log('\n=== 2. The background worker leaves the decision to a person');
  const owner = await users.create({ name: 'Olivia Owner', email: 'owner@example.com', passwordHash: await bcrypt.hash(PASSWORD, 10), role: 'owner', active: true });
  const recruiter = await users.create({ name: 'Rafi Recruiter', email: 'recruiter@example.com', passwordHash: await bcrypt.hash(PASSWORD, 10), role: 'recruiter', active: true });
  await users.create({ name: 'Ina Interviewer', email: 'interviewer@example.com', passwordHash: await bcrypt.hash(PASSWORD, 10), role: 'interviewer', active: true });

  const requisition = await requisitions.create({ title: 'Review test job', jobDescription: 'Describe the job', status: 'open', stages: STAGES, hireThreshold: 3.5, maybeThreshold: 3, initialScreeningCriteria: CRITERIA });
  const attribute = (attributeId, question) => ({ attributeId, name: attributeId, question, anchor5: 'Great', redFlags: 'Poor' });
  const scorecard = await scorecards.create({ requisitionId: requisition._id, generatedByAI: true, stages: [{ stageKey: 'resume_screen', attributes: [attribute('r1', 'Does the CV fit?')] }, { stageKey: 'hr_screen', attributes: [] }] });
  await requisitions.setScorecard(requisition._id, scorecard._id);

  let emails = 0;
  /** A public application as the apply form and the AI leave it: `resume` and `hr` are AI scores (null: not scored yet). */
  async function applicant(name, resume, hr, extra = {}) {
    emails += 1;
    const candidate = await candidates.create({ name, email: `applicant${emails}@example.com`, phone: '03001234567' });
    const application = await applications.create({
      candidateId: candidate._id, requisitionId: requisition._id, currentStageKey: 'resume_screen', source: 'public_link', questionnaireAnswers: { 'Why us?': 'Because' },
      screeningJob: { status: 'pending' }, stageProgress: STAGES.map((s) => ({ stageKey: s.key, status: 'scheduled' })), ...extra,
    });
    const stage = (stageKey, score) => interviews.create({
      applicationId: application._id, requisitionId: requisition._id, stageKey, transcriptText: LONG_TEXT, transcriptStatus: 'ready', status: score === null ? 'pending' : 'scored',
      scores: score === null ? [] : [{ attributeId: stageKey === 'hr_screen' ? 'h1' : 'r1', aiScore: score, aiJustification: `The AI gave ${score}` }],
    });
    return { application, resume: await stage('resume_screen', resume), hr: await stage('hr_screen', hr) };
  }
  const run = (application) => processApplication({ data: { applicationId: application._id } });
  const fresh = (application) => applications.findById(application._id);
  const stageStatus = (application, key) => application.stageProgress.find((p) => p.stageKey === key);
  const moved = (application) => application.stageProgress.some((p) => p.status === 'passed' || p.status === 'failed' || typeof p.passed === 'boolean');

  const strong = await applicant('Strong Applicant', 4, 4);
  const weak = await applicant('Weak Applicant', 2, 2);
  await run(strong.application);
  await run(weak.application);
  const afterStrong = await fresh(strong.application);
  const afterWeak = await fresh(weak.application);
  check('a strong application waits for a person', afterStrong.screeningReview?.status === 'needs_review' && afterStrong.screeningReview.aiRecommendation === 'advance' && afterStrong.screeningReview.aiScore === 4, JSON.stringify(afterStrong.screeningReview));
  check('a weak application waits for a person too, and is NOT rejected', afterWeak.screeningReview?.status === 'needs_review' && afterWeak.screeningReview.aiRecommendation === 'reject' && !afterWeak.disposition && !afterWeak.finalDecision, JSON.stringify(afterWeak.screeningReview));
  check('the screening job finished', afterStrong.screeningJob.status === 'completed' && afterWeak.screeningJob.status === 'completed');
  for (const [label, entry, after] of [['strong', strong, afterStrong], ['weak', weak, afterWeak]]) {
    const stored = await interviews.listByApplication(entry.application._id);
    check(`${label}: no AI score was approved`, stored.length === 2 && stored.every((i) => i.status === 'scored' && i.scores.every((s) => s.approvedScore === undefined)), JSON.stringify(stored.map((i) => i.status)));
    check(`${label}: the candidate has not moved`, after.currentStageKey === 'resume_screen' && !moved(after) && after.disposition === null, JSON.stringify(after.stageProgress));
  }

  const unmet = review.checkRequirements(job, { education: 'PhD', experienceYears: '1' });
  const belowRequirements = await applicant('Below Requirements', null, null, { requirements: unmet, screeningReview: { status: 'requirements_not_met' } });
  await run(belowRequirements.application);
  const afterBelow = await fresh(belowRequirements.application);
  check('a candidate below the fixed requirements skips the AI and waits for a person', afterBelow.screeningReview.status === 'requirements_not_met' && afterBelow.screeningJob.status === 'completed' && (await interviews.listByApplication(afterBelow._id)).every((i) => i.status === 'pending' && !i.aiCostUsd), JSON.stringify(afterBelow.screeningReview));

  const resumeOnly = await requisitions.create({ title: 'Résumé only job', jobDescription: 'Describe the job', status: 'open', stages: [{ ...STAGES[0], weight: 1 }] });
  const resumeOnlyCard = await scorecards.create({ requisitionId: resumeOnly._id, generatedByAI: true, stages: [{ stageKey: 'resume_screen', attributes: [attribute('r1', 'Does the CV fit?')] }] });
  await requisitions.setScorecard(resumeOnly._id, resumeOnlyCard._id);
  const person = await candidates.create({ name: 'Scanned Resume', email: 'scanned@example.com' });
  const scanned = await applications.create({ candidateId: person._id, requisitionId: resumeOnly._id, currentStageKey: 'resume_screen', source: 'public_link', screeningJob: { status: 'pending' }, stageProgress: [{ stageKey: 'resume_screen', status: 'scheduled' }] });
  await interviews.create({ applicationId: scanned._id, requisitionId: resumeOnly._id, stageKey: 'resume_screen', transcriptText: 'too short' });
  for (let attempt = 0; attempt < 3; attempt += 1) await run(scanned).catch(() => {});
  const afterScanned = await fresh(scanned);
  check('a résumé the AI cannot read shows up as needing manual scoring, not silently stuck', afterScanned.screeningJob.status === 'failed' && !afterScanned.screeningReview?.status && !afterScanned.disposition, JSON.stringify(afterScanned.screeningJob));

  console.log('\n=== 3. On the real server');
  server = spawn(process.execPath, ['index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => log.push(...String(chunk).split('\n').filter(Boolean)));
  const base = `http://127.0.0.1:${PORT}`;
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    try { up = (await fetch(`${base}/api/health`)).ok; } catch { /* not up yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error(`The server did not start. Last log lines:\n${log.slice(-15).join('\n')}`);

  const origin = (process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
  async function signIn(email) {
    const cookies = {};
    const call = async (method, url, body) => {
      const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
      const response = await fetch(`${base}/api${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const line of response.headers.getSetCookie?.() || []) { const [pair] = line.split(';'); const at = pair.indexOf('='); cookies[pair.slice(0, at)] = pair.slice(at + 1); }
      let data = null; try { data = await response.json(); } catch { /* no body */ }
      return { status: response.status, data };
    };
    const { status } = await call('POST', '/auth/login', { email, password: PASSWORD });
    if (status !== 200) throw new Error(`Could not sign in as ${email}: HTTP ${status}`);
    return call;
  }
  const asOwner = await signIn('owner@example.com');
  const asRecruiter = await signIn('recruiter@example.com');
  const asInterviewer = await signIn('interviewer@example.com');
  const reviewUrl = (entry) => `/scoring/application/${entry.application._id}/screening-review`;
  const expect = (name, answer, status, test = () => true) => check(name, answer.status === status && Boolean(test(answer.data)), `HTTP ${answer.status} ${JSON.stringify(answer.data)?.slice(0, 240)}`);

  const queue = await asRecruiter('GET', `/requisitions/${requisition._id}?review=needs_review`);
  expect('the review queue lists who is waiting, highest AI score first', queue, 200, (d) => d.applications.map((a) => a.candidateId?.name).join() === 'Strong Applicant,Weak Applicant');
  expect('the job page counts who is waiting', queue, 200, (d) => d.applicationStats.NEEDS_REVIEW === 2 && d.applicationStats.REQUIREMENTS_NOT_MET === 1);
  expect('the "requirements not met" group is its own list', await asRecruiter('GET', `/requisitions/${requisition._id}?review=requirements_not_met`), 200, (d) => d.applications.map((a) => a.candidateId?.name).join() === 'Below Requirements');

  expect('an interviewer cannot open a review card', await asInterviewer('GET', reviewUrl(strong)), 403);
  expect('an interviewer cannot decide', await asInterviewer('PATCH', reviewUrl(strong), { decision: 'advance' }), 403);
  expect('a recruiter sees the whole card', await asRecruiter('GET', reviewUrl(strong)), 200, (d) => d.stages.length === 2 && d.stages[0].attributes[0].question === 'Does the CV fit?' && d.stages[0].interview.scores[0].aiJustification === 'The AI gave 4' && d.application.candidateId.name === 'Strong Applicant' && d.reviewerName === null);
  expect('a stage cannot be approved past the review card', await asOwner('PATCH', `/scoring/interview/${strong.resume._id}/approve`), 409);
  expect('a stage cannot be re-scored while waiting', await asOwner('POST', `/interviews/${strong.resume._id}/score`), 409);
  expect('a decision that is not advance or reject is refused', await asRecruiter('PATCH', reviewUrl(strong), { decision: 'maybe' }), 400);

  const advanced = await asRecruiter('PATCH', reviewUrl(strong), { decision: 'advance' });
  expect('a recruiter can advance a candidate the AI recommended, with no reason', advanced, 200, (d) => d.nextInterviewId && d.application.currentStageKey === 'hr_interview');
  const doneStrong = await fresh(strong.application);
  check('the reviewer and the time are recorded', doneStrong.screeningReview.status === 'reviewed' && doneStrong.screeningReview.decision === 'advance' && doneStrong.screeningReview.reviewedBy === recruiter._id && doneStrong.screeningReview.reviewedAt instanceof Date, JSON.stringify(doneStrong.screeningReview));
  check('both screening stages passed', stageStatus(doneStrong, 'resume_screen').passed === true && stageStatus(doneStrong, 'hr_screen').passed === true && doneStrong.disposition === null, JSON.stringify(doneStrong.stageProgress));
  check('the scores were approved by that decision', (await interviews.listByApplicationAndStages(doneStrong._id, ['resume_screen', 'hr_screen'])).every((i) => i.status === 'approved' && i.stageAverage === 4 && i.scores[0].approvedScore === 4));
  expect('reviewing again by accident is refused', await asOwner('PATCH', reviewUrl(strong), { decision: 'reject', reason: 'Stale screen, wrong person' }), 409);

  expect('advancing against the AI needs a reason', await asRecruiter('PATCH', reviewUrl(weak), { decision: 'advance' }), 400);
  expect('a few characters are not a reason', await asRecruiter('PATCH', reviewUrl(weak), { decision: 'advance', reason: 'ok' }), 400);
  expect('a person can advance a candidate the AI would not', await asRecruiter('PATCH', reviewUrl(weak), { decision: 'advance', reason: 'Strong portfolio outside the CV' }), 200, (d) => d.application.currentStageKey === 'hr_interview');
  const doneWeak = await fresh(weak.application);
  check('their decision counts over the score gate', stageStatus(doneWeak, 'resume_screen').passed === true && stageStatus(doneWeak, 'resume_screen').stageAverage === 2 && doneWeak.disposition === null, JSON.stringify(doneWeak.stageProgress));
  expect('recomputing the results keeps the decision', await asOwner('POST', `/scoring/application/${weak.application._id}/recompute`), 200, (d) => d.application.disposition === null && d.stageResults[0].passed === true);
  expect('re-approving the stage keeps the decision', await asOwner('PATCH', `/scoring/interview/${weak.resume._id}/approve`), 200, (d) => d.passed === true && d.application.disposition === null);

  const rejectable = await applicant('Rejected By A Person', 5, 5);
  await run(rejectable.application);
  expect('rejecting always needs a reason, even with the AI', await asRecruiter('PATCH', reviewUrl(rejectable), { decision: 'reject' }), 400);
  expect('a person can reject a candidate the AI recommended', await asRecruiter('PATCH', reviewUrl(rejectable), { decision: 'reject', reason: 'References did not check out' }), 200, (d) => d.application.finalDecision === 'rejected' && d.application.disposition === 'NO_HIRE' && d.application.currentStageKey === null && d.application.rejectionReason === 'References did not check out');
  const undone = await asOwner('PATCH', reviewUrl(rejectable), { decision: 'advance', changeDecision: true });
  expect('a rejection can be changed', undone, 200, (d) => d.application.finalDecision === null && d.application.disposition === null && d.application.currentStageKey === 'hr_interview' && !d.application.rejectionReason);

  const nextStage = await interviews.findById(advanced.data.nextInterviewId);
  nextStage.meetingUri = 'https://meet.example.com/abc';
  await interviews.save(nextStage);
  expect('once a later stage has started the review cannot be changed', await asOwner('PATCH', reviewUrl(strong), { decision: 'reject', reason: 'Changed my mind about this', changeDecision: true }), 409);
  expect('the card says so', await asRecruiter('GET', reviewUrl(strong)), 200, (d) => d.laterStageStarted === true && d.reviewerName === 'Rafi Recruiter');

  expect('below requirements: cannot advance without scores', await asRecruiter('PATCH', reviewUrl(belowRequirements), { decision: 'advance', reason: 'They have the experience' }), 409);
  expect('below requirements: sending on needs a reason', await asRecruiter('PATCH', `${reviewUrl(belowRequirements)}/continue`, {}), 400);
  expect('below requirements: a person can send them on to screening', await asRecruiter('PATCH', `${reviewUrl(belowRequirements)}/continue`, { reason: 'Their CV shows five years of work' }), 200);
  const requeued = await fresh(belowRequirements.application);
  check('they are back in the screening queue', requeued.screeningJob.status === 'pending' && requeued.screeningJob.attempts === 0 && !requeued.screeningReview?.status, JSON.stringify(requeued.screeningJob));
  expect('sending on twice is refused', await asRecruiter('PATCH', `${reviewUrl(belowRequirements)}/continue`, { reason: 'Their CV shows five years of work' }), 409);

  const belowAgain = await applicant('Rejected Below Requirements', null, null, { requirements: unmet, screeningReview: { status: 'requirements_not_met' } });
  await run(belowAgain.application);
  expect('below requirements: a person can reject without any AI scores', await asRecruiter('PATCH', reviewUrl(belowAgain), { decision: 'reject', reason: 'Did not meet the minimum experience' }), 200, (d) => d.application.finalDecision === 'rejected' && d.application.disposition === 'NO_HIRE');

  const withdrawn = await applicant('Withdrew While Waiting', 4, 4);
  await run(withdrawn.application);
  await asRecruiter('PATCH', `/scoring/application/${withdrawn.application._id}/decision`, { decision: 'withdrawn' });
  expect('someone with a final decision leaves the queue', await asRecruiter('GET', `/requisitions/${requisition._id}?review=needs_review`), 200, (d) => d.applications.length === 0 && d.applicationStats.NEEDS_REVIEW === 0);

  const paused = await applicant('Waiting On A Paused Job', 4, 4);
  await run(paused.application);
  const toPause = await requisitions.findById(requisition._id);
  toPause.status = 'paused';
  await requisitions.save(toPause);
  expect('a paused job cannot advance anyone', await asRecruiter('PATCH', reviewUrl(paused), { decision: 'advance' }), 409);
  expect('a paused job can still reject', await asRecruiter('PATCH', reviewUrl(paused), { decision: 'reject', reason: 'Position will not be reopened' }), 200);

  const { entries } = await auditLog.search({ action: 'screening_review', page: 1, limit: 100 });
  const about = (entry) => entries.filter((row) => String(row.applicationId) === String(entry.application._id));
  check('every decision is in the audit log with the AI\'s recommendation', about(weak).length === 1 && about(weak)[0].newValue.aiRecommendation === 'reject' && about(weak)[0].newValue.decision === 'advance' && about(weak)[0].reason === 'Strong portfolio outside the CV' && about(weak)[0].userId?._id === recruiter._id, JSON.stringify(about(weak)));
  check('a change of decision is in the audit log too', about(rejectable).length === 2 && about(rejectable).some((row) => row.userId?._id === owner._id), JSON.stringify(about(rejectable)));
} catch (error) {
  check('the test ran to the end', false, error.stack || error.message);
}

await cleanup(dbRepositories);
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? `FAILED: ${failed.length} of ${results.length} checks` : `PASS: all ${results.length} checks`}`);
process.exit(failed.length ? 1 : 0);
