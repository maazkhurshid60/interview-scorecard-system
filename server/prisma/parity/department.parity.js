import { oid } from './harness.js';

/**
 * Parity scenario for departmentRepository: the same calls on the MongoDB and the PostgreSQL version must give the same
 * results, the same errors and leave the same data behind.
 */

const T = new Date('2026-01-01T09:30:00.123Z');
const T2 = new Date('2026-01-02T10:45:30.456Z');
const hex = (n) => n.toString(16).padStart(24, '0');
export const ID = { user: hex(1), eng: hex(10), sales: hex(11), zeta: hex(12), alpha: hex(13), beta: hex(14), rd: hex(15), pct: hex(16), under: hex(17), emile: hex(18), support: hex(19), unknown: hex(99) };

const dept = (id, name, extra = {}) => ({ _id: oid(id), name, createdAt: T, updatedAt: T2, ...extra });
const job = (n, title, status, departmentId) => ({ _id: oid(hex(100 + n)), title, status, jobDescription: 'x', ...(departmentId ? { departmentId: oid(departmentId) } : {}), createdAt: T, updatedAt: T2 });

export default {
  repository: 'departmentRepository',

  seed: () => ({
    users: [{ _id: oid(ID.user), name: 'Owner', email: 'owner@example.com', passwordHash: 'x', role: 'owner', active: true, createdAt: T, updatedAt: T }],
    departments: [
      dept(ID.eng, 'Engineering', { description: 'Builds things', createdBy: oid(ID.user) }),
      dept(ID.sales, 'Sales', { description: 'Closes deals', createdBy: oid(ID.user) }),
      dept(ID.zeta, 'Zeta', { description: '' }),
      dept(ID.alpha, 'alpha', { description: '' }),
      dept(ID.beta, 'Beta', { description: '' }),
      dept(ID.rd, 'R&D (Labs) [beta]', { description: 'regex characters' }),
      dept(ID.pct, '100%_sales', { description: 'percent and underscore' }),
      dept(ID.under, 'a_b', { description: '' }),
      dept(ID.emile, 'Émile', { description: 'accented' }),
      dept(ID.support, 'Support', { description: '' }), // no creator stored
    ],
    requisitions: [
      job(1, 'Open Job One', 'open', ID.eng), job(2, 'Open Job Two', 'open', ID.eng), job(3, 'Closed Job', 'closed', ID.eng),
      job(4, 'Paused Job', 'paused', ID.eng), job(5, 'Sales Job', 'open', ID.sales), job(6, 'No Department', 'open', null),
      job(7, 'Zeta Job', 'open', ID.zeta), job(8, 'Draft Job', 'draft', ID.zeta),
    ],
  }),

  steps: [
    { name: 'list with job counts (byte order: Zeta before alpha)', run: (r) => r.listWithJobCounts() },
    { name: 'find by id', run: (r) => r.findById(ID.eng) },
    { name: 'find by id: no creator stored', run: (r) => r.findById(ID.support) },
    { name: 'find by id, capital letters in the id', run: (r) => r.findById(ID.eng.toUpperCase().replace(/0/g, '0')) },
    { name: 'find by id: unknown', run: (r) => r.findById(ID.unknown) },
    { name: 'find by id: invalid text', run: (r) => r.findById('not-an-id') },
    { name: 'find by id: empty text', run: (r) => r.findById('') },
    { name: 'find by id: 12 characters', run: (r) => r.findById('abcdefghijkl') },
    { name: 'find by name: other case', run: (r) => r.findByName('engineering') },
    { name: 'find by name: ALL CAPS', run: (r) => r.findByName('ENGINEERING') },
    { name: 'find by name, leaving out its own id', run: (r) => r.findByName('ENGINEERING', { exceptId: ID.eng }) },
    { name: 'find by name, leaving out another id', run: (r) => r.findByName('Sales', { exceptId: ID.eng }) },
    { name: 'find by name: regex characters', run: (r) => r.findByName('r&d (labs) [BETA]') },
    { name: 'find by name: percent and underscore', run: (r) => r.findByName('100%_SALES') },
    { name: 'find by name: a percent must not act as a wildcard', run: (r) => r.findByName('100%') },
    { name: 'find by name: an underscore must not act as a wildcard', run: (r) => r.findByName('AXB') },
    { name: 'find by name: underscore name', run: (r) => r.findByName('A_B') },
    { name: 'find by name: accented letters in other case', run: (r) => r.findByName('éMILE') },
    { name: 'find by name: nothing', run: (r) => r.findByName('Nothing') },
    { name: 'find by name: invalid exceptId', run: (r) => r.findByName('Sales', { exceptId: 'nope' }) },
    { name: 'create: spaces around name and description', run: (r) => r.create({ name: '  Marketing  ', description: '  Grows the brand  ', createdBy: ID.user }) },
    { name: 'create: same name again', run: (r) => r.create({ name: 'Marketing', description: '', createdBy: ID.user }) },
    { name: 'create: same name in another case (allowed)', run: (r) => r.create({ name: 'marketing', description: '', createdBy: ID.user }) },
    { name: 'create: no description, no creator', run: (r) => r.create({ name: 'Finance' }) },
    { name: 'create: only spaces as name', run: (r) => r.create({ name: '   ', description: '' }) },
    { name: 'create: no name', run: (r) => r.create({}) },
    { name: 'update: name', run: (r) => r.update(ID.eng, { name: 'Platform' }) },
    { name: 'update: same name again (nothing to change)', run: (r) => r.update(ID.eng, { name: 'Platform' }) },
    { name: 'update: description with spaces', run: (r) => r.update(ID.sales, { description: '  Closes more deals  ' }) },
    { name: 'update: nothing at all', run: (r) => r.update(ID.beta, {}) },
    { name: 'update: name taken by another', run: (r) => r.update(ID.beta, { name: 'Sales' }) },
    { name: 'update: name to only spaces', run: (r) => r.update(ID.beta, { name: '   ' }) },
    { name: 'update: name and description together', run: (r) => r.update(ID.beta, { name: 'Beta Two', description: 'both' }) },
    { name: 'update: unknown id', run: (r) => r.update(ID.unknown, { name: 'Ghost' }) },
    { name: 'update: invalid id', run: (r) => r.update('not-an-id', { name: 'Ghost' }) },
    { name: 'count jobs', run: (r) => r.countJobs(ID.eng) },
    { name: 'count jobs: department with none', run: (r) => r.countJobs(ID.alpha) },
    { name: 'count jobs: unknown id', run: (r) => r.countJobs(ID.unknown) },
    { name: 'count jobs: invalid id', run: (r) => r.countJobs('not-an-id') },
    { name: 'delete: department with 4 jobs', run: (r) => r.removeAndUnlinkJobs(ID.eng) },
    { name: 'delete: department with no jobs', run: (r) => r.removeAndUnlinkJobs(ID.alpha) },
    { name: 'delete: unknown id', run: (r) => r.removeAndUnlinkJobs(ID.unknown) },
    { name: 'delete: invalid id', run: (r) => r.removeAndUnlinkJobs('not-an-id') },
    { name: 'count jobs of the deleted department', run: (r) => r.countJobs(ID.eng) },
    { name: 'list with job counts at the end', run: (r) => r.listWithJobCounts() },
  ],

  // what is left in the database afterwards (the same fields from both, in a comparable form)
  state: {
    mongo: async ({ mongo }) => ({
      departments: (await mongo.collection('departments').find().toArray()).map((d) => ({ _id: d._id, name: d.name, description: d.description, createdBy: d.createdBy, createdAt: d.createdAt, updatedAt: d.updatedAt })).sort((a, b) => String(a._id).localeCompare(String(b._id))),
      requisitions: (await mongo.collection('requisitions').find().toArray()).map((j) => ({ _id: j._id, title: j.title, status: j.status, departmentId: j.departmentId, updatedAt: j.updatedAt })).sort((a, b) => String(a._id).localeCompare(String(b._id))),
    }),
    postgres: async ({ prisma }) => ({
      departments: (await prisma.department.findMany()).map((d) => ({ _id: d.id, name: d.name, description: d.description, createdBy: d.createdBy ?? undefined, createdAt: d.createdAt, updatedAt: d.updatedAt })).sort((a, b) => String(a._id).localeCompare(String(b._id))),
      requisitions: (await prisma.requisition.findMany()).map((j) => ({ _id: j.id, title: j.title, status: j.status, departmentId: j.departmentId ?? undefined, updatedAt: j.updatedAt })).sort((a, b) => String(a._id).localeCompare(String(b._id))),
    }),
  },
};
