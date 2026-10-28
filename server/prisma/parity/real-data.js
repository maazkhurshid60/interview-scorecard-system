/**
 * Reads your REAL data through both versions of every repository and compares the answers.
 *
 *   npm run parity:real
 *
 * It only reads: it never creates, changes or deletes anything, in either database. MongoDB is the one in MONGODB_URI and
 * PostgreSQL the one in DATABASE_URL (your normal ones, after `npm run migrate:postgres`). Every read function is tried
 * with every real id and name it can use, so the odd records the test data did not have are covered.
 */
import '../../config/env.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositories = path.join(here, '..', '..', 'repositories');
const load = async (folder, name) => import(pathToFileURL(path.join(repositories, folder, `${name}.js`)).href);

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
const docs = async (collection) => db.collection(collection).find().toArray();
const hex = (value) => String(value);

const users = await docs('users'); const departments = await docs('departments'); const templates = await docs('pipelinetemplates');
const settings = await docs('settings'); const candidates = await docs('candidates'); const requisitions = await docs('requisitions');
const scorecards = await docs('scorecards'); const applications = await docs('applications'); const interviews = await docs('interviews');
const tokens = await docs('refreshtokens'); const audits = await docs('auditlogs');

// the tokens of users that no longer exist were not copied (PostgreSQL does not allow them), so they are left out here
const userIds = new Set(users.map((u) => hex(u._id)));
const liveTokens = tokens.filter((t) => userIds.has(hex(t.userId)));
const skippedTokens = tokens.length - liveTokens.length;

const ids = (list) => list.map((d) => hex(d._id));
const uniq = (list) => [...new Set(list.filter((v) => v !== undefined && v !== null && v !== ''))];
const now = new Date();

/** `each('fn', [[args], ...])`: one call per argument list. `unordered` lists are compared after sorting. */
const each = (fn, argLists, options = {}) => ({ fn, argLists, ...options });

const plan = {
  userRepository: [
    each('findById', ids(users).map((id) => [id])),
    each('findByEmail', users.map((u) => [u.email])), each('findByEmail', users.map((u) => [u.email, { exceptId: hex(u._id) }])),
    each('findActiveByEmail', users.map((u) => [u.email])), each('listActiveBrief', [[]]), each('listAll', [[]]), each('hasOwner', [[]]),
    each('countOwnersExcept', users.flatMap((u) => [[hex(u._id)], [hex(u._id), { activeOnly: true }]])),
    each('findByResetToken', uniq(users.map((u) => u.passwordResetTokenHash)).map((h) => [h])),
  ],
  refreshTokenRepository: [
    each('findById', ids(liveTokens).map((id) => [id])), each('findByHash', liveTokens.map((t) => [t.tokenHash])),
  ],
  settingRepository: [
    each('listAll', [[]]), each('findByKey', settings.map((s) => [s.key])), each('getValue', settings.map((s) => [s.key, 'FALLBACK'])),
    each('getValues', [[settings.map((s) => s.key)]]),
  ],
  auditLogRepository: [
    each('search', [
      [{ page: 1, limit: 500 }],
      ...uniq(audits.map((a) => a.action)).map((action) => [{ action, page: 1, limit: 500 }]),
      ...uniq(audits.map((a) => a.userId && hex(a.userId))).map((userId) => [{ userId, page: 1, limit: 500 }]),
      ...uniq(audits.map((a) => a.requisitionId && hex(a.requisitionId))).map((requisitionId) => [{ requisitionId, page: 1, limit: 500 }]),
      ...uniq(audits.map((a) => a.applicationId && hex(a.applicationId))).map((applicationId) => [{ applicationId, page: 1, limit: 500 }]),
      [{ dateFrom: '2000-01-01', dateTo: now.toISOString(), page: 1, limit: 500 }],
    ], { ties: true }),
  ],
  departmentRepository: [
    each('listWithJobCounts', [[]]), each('findById', ids(departments).map((id) => [id])), each('findByName', departments.map((d) => [d.name])),
    each('countJobs', ids(departments).map((id) => [id])),
  ],
  pipelineTemplateRepository: [
    each('listAll', [[]]), each('findById', ids(templates).map((id) => [id])), each('findDefault', [[]]),
  ],
  candidateRepository: [
    each('listPage', [[{ limit: 50, page: 1 }], [{ limit: 50, page: 1, oldestFirst: true }], [{ limit: 50, page: 1, ids: ids(candidates).slice(0, 4) }],
      ...uniq(candidates.map((c) => String(c.name).split(' ')[0])).map((search) => [{ search, limit: 50, page: 1 }])], { ties: true }),
    each('findById', ids(candidates).map((id) => [id])), each('findByEmail', candidates.map((c) => [c.email])),
    each('findNamesByIds', [[ids(candidates)]], { unordered: true }), each('findIdsBySearch', ['a', 'e', '@', ...uniq(candidates.map((c) => c.email))].map((s) => [s]), { unordered: true }),
    each('listEmails', [[]]), each('isResumeFileInUse', uniq(candidates.map((c) => c.resumeFilePublicId)).map((p) => [p])),
    each('findResumeFile', ids(candidates).map((id) => [id])),
  ],
  requisitionRepository: [
    each('findById', ids(requisitions).map((id) => [id])), each('findByIdWithDepartment', ids(requisitions).map((id) => [id])),
    each('findFields', ids(requisitions).map((id) => [id, 'title employmentType location status scorecardId'])), each('findPublicView', ids(requisitions).map((id) => [id])),
    each('listTitlesAndStatuses', [[ids(requisitions)]], { unordered: true }), each('listTitles', [[ids(requisitions)]]), each('findTitlesAndStages', [[ids(requisitions)]], { unordered: true }),
    each('findOpenByTitle', requisitions.flatMap((r) => [[r.title], [String(r.title).toUpperCase(), { exceptId: hex(r._id) }]])),
    each('list', [[{}], [{ status: 'open' }], [{ status: 'paused' }], [{ status: 'closed' }], [{ status: 'draft' }], ...ids(departments).map((departmentId) => [{ departmentId }])], { ties: true }),
    each('listClosedBefore', [[now]]),
  ],
  scorecardRepository: [
    each('findById', ids(scorecards).map((id) => [id])), each('findByRequisition', ids(requisitions).map((id) => [id])),
  ],
  applicationRepository: [
    each('findById', ids(applications).map((id) => [id])), each('findByIdWithCandidate', ids(applications).flatMap((id) => [[id, 'name email'], [id]])),
    each('findByCandidateAndRequisition', applications.map((a) => [hex(a.candidateId), hex(a.requisitionId)])),
    each('listSummariesForCandidates', [[ids(candidates)]], { unordered: true }),
    each('listCandidateIdsForRequisition', ids(requisitions).map((id) => [id]), { unordered: true }), each('listRequisitionIdsWithApplications', [[]], { unordered: true }),
    each('listAttachedCandidateIds', ids(requisitions).map((id) => [ids(candidates), id]), { unordered: true }),
    each('listOfferLettersForCandidate', ids(candidates).map((id) => [id]), { unordered: true }), each('listOfferLettersForRequisition', ids(requisitions).map((id) => [id]), { unordered: true }),
    each('countByRequisitionAndDisposition', [[ids(requisitions)]], { unordered: true }), each('countByDisposition', ids(requisitions).map((id) => [id]), { unordered: true }),
    each('pageForRequisition', ids(requisitions).flatMap((requisitionId) => [
      [{ requisitionId, page: 1, limit: 100 }],
      [{ requisitionId, page: 1, limit: 100, disposition: { values: ['HIRE', 'MAYBE'], includeUnset: true } }], [{ requisitionId, page: 1, limit: 100, finalDecision: { values: ['hired'], includeUnset: true } }],
      ...uniq(applications.map((a) => a.currentStageKey)).map((stageKey) => [{ requisitionId, stageKey, page: 1, limit: 100 }]),
    ]), { ties: true }),
    each('listWithCandidates', ids(requisitions).map((id) => [id]), { unordered: true }), each('findOfferLetterFile', ids(applications).map((id) => [id])),
    each('listForRanking', ids(requisitions).map((id) => [id]), { unordered: true }), each('listPendingScreeningIds', [[100]]),
  ],
  interviewRepository: [
    each('findById', ids(interviews).map((id) => [id])), each('findByApplicationAndStage', interviews.map((i) => [hex(i.applicationId), i.stageKey])),
    each('listByApplication', ids(applications).map((id) => [id])), each('listByApplicationAndStages', ids(applications).map((id) => [id, uniq(interviews.map((i) => i.stageKey))])),
    each('listByRequisition', ids(requisitions).map((id) => [id])),
    each('listSummaries', [[{}], ...ids(applications).map((applicationId) => [{ applicationId }]), [{ applicationIds: ids(applications) }], ...ids(requisitions).map((requisitionId) => [{ requisitionId }])], { unordered: true }),
    each('listFileAndMeetingInfo', ids(applications).map((id) => [id])), each('listArtifactFileIds', [[ids(applications)]], { unordered: true }),
    each('isArtifactFileInUse', uniq(interviews.map((i) => i.artifactFilePublicId)).map((p) => [p])), each('findArtifactFile', ids(interviews).map((id) => [id])),
    each('summarizeAiCost', [[]], { unordered: true }),
  ],
};

// ------------------------------------------------------------------------------------------------------- comparing

const canon = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value._bsontype === 'ObjectId') return value.toHexString();
  if (Array.isArray(value)) return value.map(canon);
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canon(value[k])]).filter(([, v]) => v !== undefined));
  return value;
};
const settle = async (call) => { try { return { ok: true, value: canon(await call()) }; } catch (error) { return { ok: false, error: `${error.name}: ${String(error.message).slice(0, 160)}` }; } };
const sortList = (value) => (Array.isArray(value) ? [...value].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : value);
const sortDeep = (value) => (Array.isArray(value) ? sortList(value.map(sortDeep)) : (value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sortDeep(v)])) : value));

/** The places where two answers differ, as `path: mongo -> postgres` (list positions are written as [] so like cases group together). */
function differences(a, b, where = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== b.length) return [`${where}: ${a.length} items in MongoDB, ${b.length} in Postgres`];
    const keys = Array.isArray(a) ? a.map((_, i) => i) : [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.flatMap((key) => differences(a[key], b[key], `${where}${Array.isArray(a) ? '[]' : `.${key}`}`));
  }
  return [`${where}: ${JSON.stringify(a)?.slice(0, 50)} -> ${JSON.stringify(b)?.slice(0, 50)}`];
}

let checked = 0; const problems = []; const noted = new Map(); const kinds = new Map();
for (const [name, calls] of Object.entries(plan)) {
  const mongo = await load('mongo', name); const postgres = await load('postgres', name);
  for (const { fn, argLists, unordered, ties } of calls) {
    for (const args of argLists) {
      const [a, b] = [await settle(() => mongo[fn](...args)), await settle(() => postgres[fn](...args))];
      const norm = (r) => (ties && r.ok ? { ...r, value: sortDeep(r.value) } : (unordered && r.ok ? { ...r, value: sortList(r.value) } : r));
      checked += 1;
      if (JSON.stringify(norm(a)) !== JSON.stringify(norm(b))) {
        const key = `${name}.${fn}`;
        noted.set(key, (noted.get(key) || 0) + 1);
        const leaf = a.ok && b.ok ? differences(norm(a).value, norm(b).value) : [`error: ${a.error || 'none'} -> ${b.error || 'none'}`];
        for (const d of new Set(leaf)) kinds.set(`${key}  ${d}`, (kinds.get(`${key}  ${d}`) || 0) + 1);
        if (problems.filter((p) => p.key === key).length < 2) problems.push({ key, args: JSON.stringify(args).slice(0, 160), mongo: JSON.stringify(norm(a)).slice(0, 600), postgres: JSON.stringify(norm(b)).slice(0, 600) });
      }
    }
  }
}

console.log(`\nChecked ${checked} reads of your real data (${users.length} users, ${candidates.length} candidates, ${requisitions.length} job openings, ${applications.length} applications, ${interviews.length} interviews, ${settings.length} settings, ${audits.length} audit entries, ${liveTokens.length} login tokens${skippedTokens ? `; ${skippedTokens} tokens of deleted users left out` : ''}).`);
if (!problems.length) console.log('\nPASS: every read gives the same answer from PostgreSQL as from MongoDB.');
else {
  console.log(`\n${[...noted.values()].reduce((x, y) => x + y, 0)} DIFFERENCE(S) in ${noted.size} function(s):`);
  console.log('\nWhat differs (function, field, MongoDB -> Postgres), with how many reads show it:');
  for (const [kind, count] of [...kinds.entries()].sort((x, y) => y[1] - x[1]).slice(0, 60)) console.log(`  ${String(count).padStart(3)}x  ${kind}`);
}
await mongoose.disconnect();
process.exit(problems.length ? 1 : 0);
