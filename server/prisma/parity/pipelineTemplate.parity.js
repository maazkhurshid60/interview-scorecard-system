import { oid, tableState } from './harness.js';

/** Parity scenario for pipelineTemplateRepository. */

const T = new Date('2026-01-01T09:30:00.123Z');
const T2 = new Date('2026-01-02T10:45:30.456Z');
const hex = (n) => n.toString(16).padStart(24, '0');
export const ID = { standard: hex(10), tech: hex(11), legacy: hex(12), zeta: hex(13), alpha: hex(14), unknown: hex(99) };

const stage = (key, order, extra = {}) => ({ key, label: key.replace('_', ' '), stageType: 'hr_screen', inputType: 'transcript', enabled: true, order, weight: 0.5, passThreshold: 3, ...extra });
const tpl = (id, name, extra = {}) => ({ _id: oid(id), name, isDefault: false, autoWeights: true, stages: [], createdAt: T, updatedAt: T2, ...extra });

const sorted = (list) => list.sort((a, b) => String(a._id).localeCompare(String(b._id)));
const good = [stage('hr_screen', 1), stage('technical', 2, { stageType: 'technical', inputType: 'artifact', weight: 0.5, passThreshold: 3.5 })];

export default {
  repository: 'pipelineTemplateRepository',

  seed: () => ({
    pipelinetemplates: [
      tpl(ID.standard, 'Standard', { description: 'The usual process', isDefault: true, stages: [stage('hr_screen', 1, { weight: 0.30000000000000004 }), stage('technical', 2, { stageType: 'technical', weight: 0.7, passThreshold: 4.25 }), stage('offer', 3, { stageType: 'offer', inputType: 'status_only', weight: 0, enabled: false })] }),
      tpl(ID.tech, 'Technical only', { description: 'Short', stages: [stage('technical', 1, { stageType: 'technical', weight: 1 })], autoWeights: false }),
      tpl(ID.legacy, 'Legacy', { stages: [{ key: 'hr_screen', label: 'HR', stageType: 'hr_screen', inputType: 'transcript', order: 1 }] }), // old data: no enabled, weight, passThreshold, description
      tpl(ID.zeta, 'Zeta', { stages: good }),
      tpl(ID.alpha, 'alpha', { stages: good }),
      tpl(hex(15), 'Null described', { description: null, stages: good }),
    ],
  }),

  steps: [
    { name: 'list all (byte order: Zeta before alpha)', run: (r) => r.listAll() },
    { name: 'find by id', run: (r) => r.findById(ID.standard) },
    { name: 'find by id: legacy stages get defaults', run: (r) => r.findById(ID.legacy) },
    { name: 'find by id: capital letters', run: (r) => r.findById(ID.standard.toUpperCase()) },
    { name: 'find by id: unknown', run: (r) => r.findById(ID.unknown) },
    { name: 'find by id: invalid', run: (r) => r.findById('nope') },
    { name: 'find default', run: (r) => r.findDefault() },
    { name: 'create: full', run: (r) => r.create({ name: 'Sales', description: 'For sales', stages: good, autoWeights: false, isDefault: false }) },
    { name: 'create: explicit null description', run: (r) => r.create({ name: 'NullDesc', description: null }) },
    { name: 'create: only a name', run: (r) => r.create({ name: 'Bare' }) },
    { name: 'create: defaults for enabled, weight, pass mark', run: (r) => r.create({ name: 'Defaults', stages: [{ key: 'k', label: 'L', stageType: 'final', inputType: 'pass_fail', order: 1 }] }) },
    { name: 'create: 17-digit weights', run: (r) => r.create({ name: 'Weights', stages: [stage('a', 1, { weight: 0.1 + 0.2 }), stage('b', 2, { weight: 0.7 })] }) },
    { name: 'create: numbers and flags given as text', run: (r) => r.create({ name: 'Text', isDefault: 'true', autoWeights: 'false', stages: [stage('a', '2', { weight: '0.25', enabled: 'false', passThreshold: '4' })] }) },
    { name: 'create: same name again', run: (r) => r.create({ name: 'Sales', stages: good }) },
    { name: 'create: same name, other case (allowed)', run: (r) => r.create({ name: 'sales', stages: good }) },
    { name: 'create: no name', run: (r) => r.create({ stages: good }) },
    { name: 'create: empty name', run: (r) => r.create({ name: '' }) },
    { name: 'create: stage with nothing', run: (r) => r.create({ name: 'Broken1', stages: [{}] }) },
    { name: 'create: stage type not allowed', run: (r) => r.create({ name: 'Broken2', stages: [stage('a', 1, { stageType: 'nope', inputType: 'nope' })] }) },
    { name: 'create: pass mark too low and too high', run: (r) => r.create({ name: 'Broken3', stages: [stage('a', 1, { passThreshold: 0.5 }), stage('b', 2, { passThreshold: 6 })] }) },
    { name: 'create: name and stage problems together', run: (r) => r.create({ stages: [{ key: 'a' }, stage('b', 2, { stageType: 'x' })] }) },
    { name: 'create: missing values, wrong values and pass marks mixed', run: (r) => r.create({ name: 'Mixed', stages: [{ label: 'L', stageType: 'bad', order: 1, passThreshold: 9 }, { key: 'k', stageType: 'technical', inputType: 'bad', passThreshold: 0 }] }) },
    { name: 'create: order that is not a number', run: (r) => r.create({ name: 'Broken4', stages: [stage('a', 'abc')] }) },
    { name: 'create: flag that is not true or false', run: (r) => r.create({ name: 'Broken5', isDefault: 'maybe' }) },
    { name: 'create: extra fields on a stage are dropped', run: (r) => r.create({ name: 'Extras', stages: [stage('a', 1, { surprise: true })] }) },
    { name: 'update: name', run: (r) => r.update(ID.tech, { name: 'Technical' }) },
    { name: 'update: same values again (nothing to write)', run: (r) => r.update(ID.tech, { name: 'Technical', autoWeights: false }) },
    { name: 'update: nothing at all', run: (r) => r.update(ID.zeta, {}) },
    { name: 'update: description only', run: (r) => r.update(ID.zeta, { description: 'Now described' }) },
    { name: 'update: description set to null', run: (r) => r.update(ID.zeta, { description: null }) },
    { name: 'update: description null again (nothing to write)', run: (r) => r.update(ID.zeta, { description: null }) },
    { name: 'update: description over a null', run: (r) => r.update(hex(15), { description: 'now text' }) },
    { name: 'update: stages', run: (r) => r.update(ID.alpha, { stages: [stage('x', 1, { weight: 0.1 + 0.2 }), stage('y', 2, { weight: 0.7 })] }) },
    { name: 'update: same stages again (nothing to write)', run: (r) => r.update(ID.alpha, { stages: [stage('x', 1, { weight: 0.1 + 0.2 }), stage('y', 2, { weight: 0.7 })] }) },
    { name: 'update: stages with the same content in another key order', run: (r) => r.update(ID.alpha, { stages: [{ order: 1, weight: 0.1 + 0.2, key: 'x', label: 'x', stageType: 'hr_screen', inputType: 'transcript', enabled: true, passThreshold: 3 }, stage('y', 2, { weight: 0.7 })] }) },
    { name: 'update: no stages left', run: (r) => r.update(ID.alpha, { stages: [] }) },
    { name: 'update: stages that are not valid', run: (r) => r.update(ID.zeta, { stages: [{ key: 'q' }] }) },
    { name: 'update: auto weights flag as text', run: (r) => r.update(ID.zeta, { autoWeights: 'false' }) },
    { name: 'update: name taken by another', run: (r) => r.update(ID.zeta, { name: 'Standard' }) },
    { name: 'update: name emptied', run: (r) => r.update(ID.zeta, { name: '' }) },
    { name: 'update: name, description and stages together', run: (r) => r.update(ID.legacy, { name: 'Legacy 2', description: 'both', stages: good }) },
    { name: 'update: unknown id', run: (r) => r.update(ID.unknown, { name: 'Ghost' }) },
    { name: 'update: invalid id', run: (r) => r.update('nope', { name: 'Ghost' }) },
    { name: 'make default: another template', run: (r) => r.makeDefault(ID.tech) },
    { name: 'make default: the one that already is', run: (r) => r.makeDefault(ID.tech) },
    { name: 'find default now', run: (r) => r.findDefault() },
    { name: 'make default: unknown id', run: (r) => r.makeDefault(ID.unknown) },
    { name: 'make default: invalid id', run: (r) => r.makeDefault('nope') },
    { name: 'delete', run: (r) => r.remove(ID.zeta) },
    { name: 'delete: already gone', run: (r) => r.remove(ID.zeta) },
    { name: 'delete: invalid id', run: (r) => r.remove('nope') },
    { name: 'list all at the end', run: (r) => r.listAll() },
  ],

  state: tableState('pipelineTemplate'),
  oldState: {
    mongo: async ({ mongo }) => sorted((await mongo.collection('pipelinetemplates').find().toArray()).map((t) => ({ _id: t._id, name: t.name, description: t.description, isDefault: t.isDefault, autoWeights: t.autoWeights, stages: t.stages, createdAt: t.createdAt, updatedAt: t.updatedAt }))),
    postgres: async ({ prisma }) => sorted((await prisma.$queryRawUnsafe(`SELECT id, name, description, "isDefault", "autoWeights", stages::text AS stages, "createdAt", "updatedAt" FROM pipeline_templates`)).map((t) => ({ _id: t.id, name: t.name, description: t.description ?? undefined, isDefault: t.isDefault, autoWeights: t.autoWeights, stages: JSON.parse(t.stages), createdAt: t.createdAt, updatedAt: t.updatedAt }))),
  },
};
