import { oid, tableState } from './harness.js';

/** Parity scenario for interviewRepository. */

const hex = (n) => n.toString(16).padStart(24, '0');
const at = (iso) => new Date(iso);
export const ID = {
  user: hex(1), c1: hex(11), c2: hex(12), r1: hex(21), r2: hex(22), a1: hex(31), a2: hex(32), a3: hex(33),
  i1: hex(71), i2: hex(72), i3: hex(73), i4: hex(74), i5: hex(75), i6: hex(76), unknown: hex(99),
};

const cand = (id, name, email) => ({ _id: oid(id), name, email, createdAt: at('2026-01-01T00:00:00Z'), updatedAt: at('2026-01-01T00:00:00Z') });
const req = (id, title) => ({ _id: oid(id), title, jobDescription: 'Describe', status: 'open', createdAt: at('2026-01-01T00:00:00Z'), updatedAt: at('2026-01-01T00:00:00Z') });
const app = (id, c, r) => ({ _id: oid(id), candidateId: oid(c), requisitionId: oid(r), source: 'manual', screeningJob: { attempts: 0 }, stageProgress: [], initialScreening: { overridden: false }, disposition: null, finalDecision: null, createdAt: at('2026-02-01T00:00:00Z'), updatedAt: at('2026-02-01T00:00:00Z') });
// an interview as the app stores it: with every default Mongoose fills in
const iv = (id, applicationId, requisitionId, stageKey, updated, extra = {}) => ({
  _id: oid(id), applicationId: oid(applicationId), requisitionId: oid(requisitionId), stageKey, meetingMode: 'online', provider: 'google_meet', consentObtained: false, transcriptStatus: 'none', scores: [], status: 'pending',
  createdAt: at('2026-03-01T00:00:00Z'), updatedAt: at(updated), ...extra,
});
const sortById = (list) => [...list].sort((a, b) => JSON.stringify(a._id).localeCompare(JSON.stringify(b._id)));

export default {
  repository: 'interviewRepository',

  seed: () => ({
    candidates: [cand(ID.c1, 'Alice', 'alice@example.com'), cand(ID.c2, 'Bob', 'bob@example.com')],
    requisitions: [req(ID.r1, 'Job number one'), req(ID.r2, 'Job number two')],
    applications: [app(ID.a1, ID.c1, ID.r1), app(ID.a2, ID.c2, ID.r1), app(ID.a3, ID.c1, ID.r2)],
    interviews: [
      iv(ID.i1, ID.a1, ID.r1, 'technical', '2026-03-10T10:00:00.100Z', {
        meetingMode: 'in_person', provider: 'zoom', meetingUri: 'https://zoom/1', calendarEventId: 'evt-1', meetingStart: at('2026-03-09T09:00:00.250Z'), meetingEnd: at('2026-03-09T10:00:00.750Z'), conferenceId: 'conf-1', designatedScorerId: oid(ID.user),
        candidateAvailability: { preferredDate: '2026-03-09', startTime: '09:00', endTime: '10:00', notes: 'ok', submittedAt: at('2026-03-01T08:00:00.500Z') },
        consentObtained: true, transcriptText: 'Hello there', transcriptStatus: 'ready',
        artifactFileUrl: 'https://x/a.pdf', artifactFilePublicId: 'art-1', artifactFileName: 'a.pdf', artifactFileSize: 4096, artifactFileMimeType: 'application/pdf',
        scores: [{ attributeId: 'attr-1', aiScore: 4, aiJustification: 'Good', approvedScore: 4.5, overridden: true, overriddenBy: oid(ID.user), overrideReason: 'Better' }, { attributeId: 'attr-2', aiScore: 3.3333333333333335, overridden: false }],
        stageAverage: 3.9166666666666665, status: 'scored', aiTokensUsed: { input: 1200, output: 300 }, aiCostUsd: 0.1,
      }),
      iv(ID.i2, ID.a1, ID.r1, 'hr_screen', '2026-03-11T10:00:00.200Z', { aiTokensUsed: { input: 100, output: 50 }, aiCostUsd: 0.2 }),
      iv(ID.i3, ID.a2, ID.r1, 'technical', '2026-03-12T10:00:00.300Z', { aiTokensUsed: { input: 10, output: 5 }, aiCostUsd: 0.30000000000000004 }),
      iv(ID.i4, ID.a2, ID.r1, 'hr_screen', '2026-04-01T00:00:00.400Z', { aiCostUsd: 1e-7 }),
      iv(ID.i5, ID.a3, ID.r2, 'technical', '2026-03-31T23:59:59.999Z', { artifactFilePublicId: 'art-1', aiCostUsd: 2.5, aiTokensUsed: { input: 7 } }),
      iv(ID.i6, ID.a3, ID.r2, 'final', '2026-03-15T10:00:00.600Z', { status: 'approved', stageAverage: 4 }),
    ],
  }),

  steps: [
    { name: 'find by id: everything stored', run: (r) => r.findById(ID.i1) },
    { name: 'find by id: only the basics', run: (r) => r.findById(ID.i6) },
    { name: 'find by id: capital letters', run: (r) => r.findById(ID.i1.toUpperCase()) },
    { name: 'find by id: unknown', run: (r) => r.findById(ID.unknown) },
    { name: 'find by id: invalid', run: (r) => r.findById('nope') },
    { name: 'find by application and stage', run: (r) => r.findByApplicationAndStage(ID.a1, 'hr_screen') },
    { name: 'find by application and stage: none', run: (r) => r.findByApplicationAndStage(ID.a1, 'final') },
    { name: 'find by application and stage: invalid', run: (r) => r.findByApplicationAndStage('nope', 'final') },
    { name: 'list by application', run: (r) => r.listByApplication(ID.a1) },
    { name: 'list by application: none', run: (r) => r.listByApplication(ID.unknown) },
    { name: 'list by application: invalid', run: (r) => r.listByApplication('nope') },
    { name: 'list by application and stages', run: (r) => r.listByApplicationAndStages(ID.a2, ['technical', 'final']) },
    { name: 'list by application and no stages', run: (r) => r.listByApplicationAndStages(ID.a2, []) },
    { name: 'list by job opening', run: (r) => r.listByRequisition(ID.r2) },
    { name: 'list by job opening: invalid', run: (r) => r.listByRequisition('nope') },
    { name: 'summaries: one application', run: (r) => r.listSummaries({ applicationId: ID.a1 }) },
    { name: 'summaries: several applications', run: (r) => r.listSummaries({ applicationIds: [ID.a1, ID.a3] }) },
    { name: 'summaries: one job opening', run: (r) => r.listSummaries({ requisitionId: ID.r2 }) },
    { name: 'summaries: application and job opening', run: (r) => r.listSummaries({ applicationId: ID.a1, requisitionId: ID.r2 }) },
    { name: 'summaries: several applications win over one', run: (r) => r.listSummaries({ applicationId: ID.a1, applicationIds: [ID.a3] }) },
    { name: 'summaries: no applications', run: (r) => r.listSummaries({ applicationIds: [] }) },
    { name: 'summaries: no filter', run: (r) => r.listSummaries({}) },
    { name: 'summaries: invalid id', run: (r) => r.listSummaries({ applicationIds: ['nope'] }) },
    { name: 'file and meeting info', run: (r) => r.listFileAndMeetingInfo(ID.a1) },
    { name: 'file and meeting info: invalid', run: (r) => r.listFileAndMeetingInfo('nope') },
    { name: 'artifact file ids', run: (r) => r.listArtifactFileIds([ID.a1, ID.a3]) },
    { name: 'artifact file in use', run: (r) => r.isArtifactFileInUse('art-1') },
    { name: 'artifact file in use: no', run: (r) => r.isArtifactFileInUse('nope') },
    { name: 'find artifact file', run: (r) => r.findArtifactFile(ID.i1) },
    { name: 'find artifact file: none stored', run: (r) => r.findArtifactFile(ID.i6) },
    { name: 'find artifact file: unknown', run: (r) => r.findArtifactFile(ID.unknown) },
    { name: 'find artifact file: invalid', run: (r) => r.findArtifactFile('nope') },
    { name: 'ai cost summary (exact sums, months newest first)', run: async (r) => (await r.summarizeAiCost()).sort((a, b) => JSON.stringify(a._id).localeCompare(JSON.stringify(b._id))) },
    { name: 'ai cost summary: months are in order', run: async (r) => (await r.summarizeAiCost()).map((g) => g._id.month) },
    { name: 'create: only the required values (defaults fill in)', run: (r) => r.create({ applicationId: ID.a1, requisitionId: ID.r1, stageKey: 'final' }) },
    { name: 'create: a lot given', run: (r) => r.create({ applicationId: ID.a2, requisitionId: ID.r1, stageKey: 'client', meetingMode: 'in_person', provider: 'manual', meetingUri: 'u', calendarEventId: 'e', meetingStart: '2026-05-01T09:00:00.123Z', meetingEnd: new Date('2026-05-01T10:00:00Z'), conferenceId: 'c', designatedScorerId: ID.user, candidateAvailability: { preferredDate: '2026-05-01', submittedAt: '2026-04-01T00:00:00Z' }, consentObtained: 'true', transcriptText: 't', transcriptStatus: 'pending', artifactFileSize: '2048', scores: [{ attributeId: 'a', aiScore: 0.1 + 0.2 }, { attributeId: 'b', overridden: true }], stageAverage: 2.5, status: 'scheduled', aiTokensUsed: { input: 5, output: 6 }, aiCostUsd: 0.05 }) },
    { name: 'create: only the input tokens', run: (r) => r.create({ applicationId: ID.a3, requisitionId: ID.r2, stageKey: 'x', aiTokensUsed: { input: 3 } }) },
    { name: 'create: empty token group', run: (r) => r.create({ applicationId: ID.a3, requisitionId: ID.r2, stageKey: 'y', aiTokensUsed: {} }) },
    { name: 'create: unknown fields dropped', run: (r) => r.create({ applicationId: ID.a3, requisitionId: ID.r2, stageKey: 'z', surprise: 1, scores: [{ attributeId: 'a', extra: 2 }] }) },
    { name: 'create: nothing', run: (r) => r.create({}) },
    { name: 'create: invalid ids', run: (r) => r.create({ applicationId: 'x', requisitionId: 'y', stageKey: 's' }) },
    { name: 'create: values not allowed', run: (r) => r.create({ applicationId: ID.a1, requisitionId: ID.r1, stageKey: 's', meetingMode: 'teleport', provider: 'skype', transcriptStatus: 'maybe', status: 'done' }) },
    { name: 'create: score without an attribute', run: (r) => r.create({ applicationId: ID.a1, requisitionId: ID.r1, stageKey: 's', scores: [{ aiScore: 3 }, {}] }) },
    { name: 'create: bad number and date', run: (r) => r.create({ applicationId: ID.a1, requisitionId: ID.r1, stageKey: 's', stageAverage: 'high', meetingStart: 'not a date' }) },
    { name: 'save: change a score in place', run: async (r) => { const i = await r.findById(ID.i1); i.scores[1].approvedScore = 3; i.scores[0].overridden = false; i.stageAverage = 3.5; i.status = 'approved'; await r.save(i); return i; } },
    { name: 'save: nothing changed (nothing to write)', run: async (r) => { const i = await r.findById(ID.i1); await r.save(i); return i; } },
    { name: 'save: scores added', run: async (r) => { const i = await r.findById(ID.i6); i.scores.push({ attributeId: 'new', aiScore: 4 }); i.transcriptStatus = 'ready'; await r.save(i); return i; } },
    { name: 'save: availability replaced', run: async (r) => { const i = await r.findById(ID.i2); i.candidateAvailability = { preferredDate: '2026-06-01', notes: 'n' }; i.meetingStart = new Date('2026-06-01T09:00:00.500Z'); await r.save(i); return i; } },
    { name: 'save: tokens changed', run: async (r) => { const i = await r.findById(ID.i2); i.aiTokensUsed = { input: 111, output: 222 }; i.aiCostUsd = 0.7; await r.save(i); return i; } },
    { name: 'save: invalid score', run: async (r) => { const i = await r.findById(ID.i3); i.scores = [{ aiScore: 1 }]; await r.save(i); return i; } },
    { name: 'save: invalid status', run: async (r) => { const i = await r.findById(ID.i3); i.status = 'zzz'; await r.save(i); return i; } },
    { name: 'save: read afterwards', run: async (r) => [await r.findById(ID.i1), await r.findById(ID.i2), await r.findById(ID.i6)] },
    { name: 'save: deleted meanwhile', run: async (r) => { const i = await r.findById(ID.i4); await r.removeByApplication(ID.a2); i.status = 'scored'; await r.save(i); return i; } },
    { name: 'remove by application', run: (r) => r.removeByApplication(ID.a1) },
    { name: 'remove by application: none left', run: (r) => r.removeByApplication(ID.a1) },
    { name: 'remove by application: invalid', run: (r) => r.removeByApplication('nope') },
    { name: 'remove by applications', run: (r) => r.removeByApplications([ID.a3, ID.unknown]) },
    { name: 'remove by applications: invalid', run: (r) => r.removeByApplications(['nope']) },
    { name: 'remove by job opening', run: (r) => r.removeByRequisition(ID.r1) },
    { name: 'remove by job opening: invalid', run: (r) => r.removeByRequisition('nope') },
    { name: 'ai cost summary at the end', run: (r) => r.summarizeAiCost() },
  ],

  state: tableState('interview'),
};
