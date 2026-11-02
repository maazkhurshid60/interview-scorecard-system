import { oid, tableState } from './harness.js';

/** Parity scenario for scorecardRepository. */

const hex = (n) => n.toString(16).padStart(24, '0');
const at = (iso) => new Date(iso);
export const ID = { r1: hex(21), r2: hex(22), r3: hex(23), s1: hex(51), s2: hex(52), unknown: hex(99) };
const req = (id, title) => ({ _id: oid(id), title, jobDescription: 'Describe', status: 'open', createdAt: at('2026-01-01T00:00:00Z'), updatedAt: at('2026-01-01T00:00:00Z') });
const attr = (n) => ({ attributeId: `attr-${n}`, name: `Attribute ${n}`, question: `Question ${n}?`, anchor5: 'Excellent', redFlags: 'Poor' });

export default {
  repository: 'scorecardRepository',

  seed: () => ({
    requisitions: [req(ID.r1, 'Job number one'), req(ID.r2, 'Job number two'), req(ID.r3, 'Job number three')],
    scorecards: [
      { _id: oid(ID.s1), requisitionId: oid(ID.r1), generatedByAI: false, stages: [{ stageKey: 'technical', attributes: [attr(1), attr(2)] }, { stageKey: 'hr_screen', attributes: [{ attributeId: 'a', name: 'Only the required' }] }], createdAt: at('2026-02-01T10:00:00.100Z'), updatedAt: at('2026-02-02T10:00:00.200Z') },
      { _id: oid(ID.s2), requisitionId: oid(ID.r2), generatedByAI: true, stages: [], createdAt: at('2026-02-03T10:00:00.300Z'), updatedAt: at('2026-02-03T10:00:00.300Z') },
    ],
  }),

  steps: [
    { name: 'find by id', run: (r) => r.findById(ID.s1) },
    { name: 'find by id: no stages', run: (r) => r.findById(ID.s2) },
    { name: 'find by id: unknown', run: (r) => r.findById(ID.unknown) },
    { name: 'find by id: invalid', run: (r) => r.findById('nope') },
    { name: 'find by job opening', run: (r) => r.findByRequisition(ID.r1) },
    { name: 'find by job opening: none', run: (r) => r.findByRequisition(ID.r3) },
    { name: 'find by job opening: invalid', run: (r) => r.findByRequisition('nope') },
    { name: 'create: only the job opening (defaults fill in)', run: (r) => r.create({ requisitionId: ID.r3 }) },
    { name: 'create: with stages', run: (r) => r.create({ requisitionId: ID.r3, generatedByAI: false, stages: [{ stageKey: 'final', attributes: [attr(7)] }, { stageKey: 'client' }] }) },
    { name: 'create: unknown fields dropped', run: (r) => r.create({ requisitionId: ID.r3, surprise: 1, stages: [{ stageKey: 'x', extra: 1, attributes: [{ attributeId: 'a', name: 'n', more: 2 }] }] }) },
    { name: 'create: nothing', run: (r) => r.create({}) },
    { name: 'create: invalid job opening id', run: (r) => r.create({ requisitionId: 'nope' }) },
    { name: 'create: stage and attribute problems', run: (r) => r.create({ requisitionId: ID.r3, stages: [{ attributes: [{ question: 'q' }, { attributeId: 'a' }] }, { stageKey: 'k', attributes: [{ name: 'n' }] }] }) },
    { name: 'create: flag as text and bad flag', run: (r) => r.create({ requisitionId: ID.r3, generatedByAI: 'maybe' }) },
    { name: 'save: change a rubric in place', run: async (r) => { const s = await r.findById(ID.s1); s.stages[0].attributes[1].name = 'Renamed'; s.stages[1].attributes.push(attr(9)); s.generatedByAI = true; await r.save(s); return s; } },
    { name: 'save: nothing changed (nothing to write)', run: async (r) => { const s = await r.findById(ID.s1); await r.save(s); return s; } },
    { name: 'save: stages replaced', run: async (r) => { const s = await r.findById(ID.s2); s.stages = [{ stageKey: 'new', attributes: [attr(3)] }]; await r.save(s); return s; } },
    { name: 'save: invalid stage', run: async (r) => { const s = await r.findById(ID.s2); s.stages = [{ attributes: [] }]; await r.save(s); return s; } },
    { name: 'save: read afterwards', run: async (r) => [await r.findById(ID.s1), await r.findById(ID.s2)] },
    { name: 'save: deleted meanwhile', run: async (r) => { const s = await r.findById(ID.s2); await r.remove(ID.s2); s.generatedByAI = false; await r.save(s); return s; } },
    { name: 'remove', run: (r) => r.remove(ID.s1) },
    { name: 'remove: already gone', run: (r) => r.remove(ID.s1) },
    { name: 'remove: invalid', run: (r) => r.remove('nope') },
    { name: 'remove by job opening', run: (r) => r.removeByRequisition(ID.r3) },
    { name: 'remove by job opening: invalid', run: (r) => r.removeByRequisition('nope') },
    { name: 'find by job opening afterwards', run: (r) => r.findByRequisition(ID.r3) },
  ],

  state: tableState('scorecard'),
};
