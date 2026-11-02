import { oid, tableState } from './harness.js';

/** Parity scenario for auditLogRepository. */

const hex = (n) => n.toString(16).padStart(24, '0');
const at = (iso) => new Date(iso);
export const ID = { alice: hex(1), bob: hex(2), ghost: hex(3), req1: hex(20), req2: hex(21), app1: hex(30), app2: hex(31), app3: hex(32), unknown: hex(99) };

const log = (n, action, when, extra = {}) => ({ _id: oid(hex(1000 + n)), action, timestamp: at(when), ...extra });
const id = (value) => (value ? oid(value) : undefined);
const entry = (n, action, when, { user, req, app, ...rest } = {}) => log(n, action, when, {
  ...(user ? { userId: id(user) } : {}), ...(req ? { requisitionId: id(req) } : {}), ...(app ? { applicationId: id(app) } : {}), ...rest,
});

const sorted = (list) => list.sort((a, b) => String(a._id).localeCompare(String(b._id)));

export default {
  repository: 'auditLogRepository',

  seed: () => ({
    users: [
      { _id: oid(ID.alice), name: 'Alice Owner', email: 'alice@example.com', passwordHash: 'x', role: 'owner', active: true, createdAt: at('2026-01-01T00:00:00Z'), updatedAt: at('2026-01-01T00:00:00Z') },
      { _id: oid(ID.bob), name: 'Bob Recruiter', email: 'bob@example.com', passwordHash: 'x', role: 'recruiter', active: true, createdAt: at('2026-01-01T00:00:00Z'), updatedAt: at('2026-01-01T00:00:00Z') },
    ],
    auditlogs: [
      entry(1, 'score_override', '2026-03-01T10:00:00.001Z', { user: ID.alice, req: ID.req1, app: ID.app1, targetType: 'score', targetId: 'abc', oldValue: { score: 3 }, newValue: { score: 4.5 }, reason: 'Recalibrated' }),
      entry(2, 'score_approve', '2026-03-02T10:00:00.002Z', { user: ID.bob, req: ID.req1, app: ID.app2, targetType: 'scorecard' }),
      entry(3, 'weight_change', '2026-03-03T10:00:00.003Z', { user: ID.alice, req: ID.req2, targetType: 'pipelineTemplate', targetId: 'tpl', oldValue: { a: 0.5, b: 0.5 }, newValue: { a: 0.30000000000000004, b: 0.7 } }),
      entry(4, 'candidate_update', '2026-03-04T10:00:00.004Z', { user: ID.ghost, app: ID.app1, oldValue: 'text before', newValue: ['list', 1] }),
      entry(5, 'key_change', '2026-03-05T10:00:00.005Z', { targetType: 'setting', targetId: 'anthropicApiKey' }),
      entry(6, 'retention_purge', '2026-03-06T10:00:00.006Z', { user: ID.alice, req: ID.req2, app: ID.app3 }),
      entry(7, 'score_override', '2026-03-07T10:00:00.007Z', { user: ID.bob, req: ID.req1, app: ID.app1, oldValue: 1, newValue: 0 }),
      entry(8, 'stage_toggle', '2026-03-08T10:00:00.008Z', { user: ID.alice, req: ID.req1, newValue: false }),
      entry(9, 'final_decision', '2026-03-09T10:00:00.009Z', { user: ID.bob, req: ID.req2, app: ID.app2, reason: '100% sure_' }),
      entry(10, 'offer_letter_sent', '2026-03-10T10:00:00.010Z', { user: ID.alice, app: ID.app3 }),
      log(11, 'key_change', '2026-03-11T10:00:00.011Z', { userId: null, oldValue: null, newValue: 5, reason: null, targetId: null }),
      log(12, 'key_change', '2026-03-12T10:00:00.012Z', { requisitionId: oid(ID.req1), oldValue: 'x', newValue: null }),
    ],
  }),

  steps: [
    { name: 'search: everything, first page of 4', run: (r) => r.search({ page: 1, limit: 4 }) },
    { name: 'search: second page of 4', run: (r) => r.search({ page: 2, limit: 4 }) },
    { name: 'search: third page of 4', run: (r) => r.search({ page: 3, limit: 4 }) },
    { name: 'search: page beyond the end', run: (r) => r.search({ page: 9, limit: 4 }) },
    { name: 'search: everything on one page', run: (r) => r.search({ page: 1, limit: 100 }) },
    { name: 'search: by job opening', run: (r) => r.search({ requisitionId: ID.req1, page: 1, limit: 50 }) },
    { name: 'search: by application', run: (r) => r.search({ applicationId: ID.app1, page: 1, limit: 50 }) },
    { name: 'search: by user', run: (r) => r.search({ userId: ID.alice, page: 1, limit: 50 }) },
    { name: 'search: by user who no longer exists', run: (r) => r.search({ userId: ID.ghost, page: 1, limit: 50 }) },
    { name: 'search: by action', run: (r) => r.search({ action: 'score_override', page: 1, limit: 50 }) },
    { name: 'search: by action nobody used', run: (r) => r.search({ action: 'no_such_action', page: 1, limit: 50 }) },
    { name: 'search: by action with % (no wildcard)', run: (r) => r.search({ action: 'score%', page: 1, limit: 50 }) },
    { name: 'search: filters together', run: (r) => r.search({ requisitionId: ID.req1, userId: ID.bob, action: 'score_override', page: 1, limit: 50 }) },
    { name: 'search: from a date', run: (r) => r.search({ dateFrom: '2026-03-08T00:00:00Z', page: 1, limit: 50 }) },
    { name: 'search: up to a date', run: (r) => r.search({ dateTo: '2026-03-03T10:00:00.003Z', page: 1, limit: 50 }) },
    { name: 'search: between two dates', run: (r) => r.search({ dateFrom: '2026-03-04', dateTo: '2026-03-06', page: 1, limit: 50 }) },
    { name: 'search: day only (date text)', run: (r) => r.search({ dateFrom: '2026-03-09', page: 1, limit: 50 }) },
    { name: 'search: nothing matches', run: (r) => r.search({ requisitionId: ID.unknown, page: 1, limit: 50 }) },
    { name: 'search: invalid job opening id', run: (r) => r.search({ requisitionId: 'nope', page: 1, limit: 50 }) },
    { name: 'search: invalid application id', run: (r) => r.search({ applicationId: 'nope', page: 1, limit: 50 }) },
    { name: 'search: invalid user id', run: (r) => r.search({ userId: 'nope', page: 1, limit: 50 }) },
    { name: 'search: invalid date', run: (r) => r.search({ dateFrom: 'not a date', page: 1, limit: 50 }) },
    { name: 'search: invalid end date', run: (r) => r.search({ dateTo: 'not a date', page: 1, limit: 50 }) },
    { name: 'search: ids in capital letters', run: (r) => r.search({ requisitionId: ID.req1.toUpperCase(), page: 1, limit: 50 }) },
    { name: 'record: full entry', run: (r) => r.record({ action: 'score_override', userId: ID.alice, requisitionId: ID.req1, applicationId: ID.app1, targetType: 'score', targetId: 'xyz', oldValue: { weights: { a: 0.1 + 0.2 } }, newValue: { n: 1e-7, list: [1, 'two', null] }, reason: 'Because' }) },
    { name: 'record: only the action', run: (r) => r.record({ action: 'key_change' }) },
    { name: 'record: values that are false, zero, empty text', run: (r) => r.record({ action: 'stage_toggle', oldValue: false, newValue: 0, reason: '' }) },
    { name: 'record: text and list values', run: (r) => r.record({ action: 'stage_toggle', oldValue: 'text', newValue: [1, 2] }) },
    { name: 'record: ids as capital letters', run: (r) => r.record({ action: 'stage_toggle', userId: ID.bob.toUpperCase() }) },
    { name: 'record: a number as target id', run: (r) => r.record({ action: 'stage_toggle', targetId: 42 }) },
    { name: 'record: explicit nulls', run: (r) => r.record({ action: 'key_change', userId: null, requisitionId: null, applicationId: null, targetType: null, targetId: null, oldValue: null, newValue: null, reason: null }) },
    { name: 'record: some explicit nulls', run: (r) => r.record({ action: 'key_change', oldValue: null, newValue: 1, userId: ID.alice, reason: null }) },
    { name: 'record: no action', run: (r) => r.record({ userId: ID.alice }) },
    { name: 'record: empty action', run: (r) => r.record({ action: '' }) },
    { name: 'record: action not allowed', run: (r) => r.record({ action: 'made_up' }) },
    { name: 'record: invalid user id', run: (r) => r.record({ action: 'key_change', userId: 'nope' }) },
    { name: 'record: invalid user id and action not allowed', run: (r) => r.record({ action: 'made_up', userId: 'nope' }) },
    { name: 'record: invalid ids everywhere', run: (r) => r.record({ action: 'key_change', applicationId: 'x', requisitionId: 'y', userId: 'z' }) },
    { name: 'record: target type that cannot be text', run: (r) => r.record({ action: 'key_change', targetType: { a: 1 } }) },
    { name: 'record: nothing at all', run: (r) => r.record({}) },
    { name: 'search for the new entries', run: (r) => r.search({ requisitionId: ID.req1, page: 1, limit: 50 }) },
    { name: 'remove for application', run: (r) => r.removeForApplication(ID.app1) },
    { name: 'remove for application: none left', run: (r) => r.removeForApplication(ID.unknown) },
    { name: 'remove for application: invalid id', run: (r) => r.removeForApplication('nope') },
    { name: 'remove for applications', run: (r) => r.removeForApplications([ID.app2, ID.app3]) },
    { name: 'remove for applications: empty list', run: (r) => r.removeForApplications([]) },
    { name: 'remove for applications: one invalid id', run: (r) => r.removeForApplications([ID.app2, 'nope']) },
    { name: 'remove for requisition', run: (r) => r.removeForRequisition(ID.req2) },
    { name: 'remove for requisition: invalid id', run: (r) => r.removeForRequisition('nope') },
    { name: 'search at the end', run: (r) => r.search({ page: 1, limit: 100 }) },
  ],

  state: tableState('auditLog'),
  oldState: {
    mongo: async ({ mongo }) => sorted((await mongo.collection('auditlogs').find().toArray()).map((a) => ({ _id: a._id, action: a.action, userId: a.userId, requisitionId: a.requisitionId, applicationId: a.applicationId, targetType: a.targetType, targetId: a.targetId, oldValue: a.oldValue, newValue: a.newValue, reason: a.reason, timestamp: a.timestamp }))),
    postgres: async ({ prisma }) => sorted((await prisma.$queryRawUnsafe(`SELECT id, action::text AS action, "userId", "requisitionId", "applicationId", "targetType", "targetId", "oldValue"::text AS o, "newValue"::text AS n, reason, "timestamp" FROM audit_logs`)).map((a) => ({ _id: a.id, action: a.action, userId: a.userId ?? undefined, requisitionId: a.requisitionId ?? undefined, applicationId: a.applicationId ?? undefined, targetType: a.targetType ?? undefined, targetId: a.targetId ?? undefined, oldValue: a.o === null ? undefined : JSON.parse(a.o), newValue: a.n === null ? undefined : JSON.parse(a.n), reason: a.reason ?? undefined, timestamp: a.timestamp }))),
  },
};
