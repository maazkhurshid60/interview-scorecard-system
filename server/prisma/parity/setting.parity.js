import { oid, tableState } from './harness.js';

/** Parity scenario for settingRepository. */

const T2 = new Date('2026-01-02T10:45:30.456Z');
const hex = (n) => n.toString(16).padStart(24, '0');
const set = (n, key, value, description) => ({ _id: oid(hex(n)), key, ...(value !== undefined ? { value } : {}), ...(description !== undefined ? { description } : {}), updatedAt: T2 });

const sorted = (list) => list.sort((a, b) => String(a._id).localeCompare(String(b._id)));

export default {
  repository: 'settingRepository',

  seed: () => ({
    settings: [
      set(1, 'scoreThreshold', 3.5, 'Pass mark'),
      set(2, 'longNumber', 0.30000000000000004, 'Needs 17 digits'),
      set(3, 'Zeta', 'last in byte order'),
      set(4, 'alpha', { nested: { list: [1, 2, { deep: true }], text: 'x' }, n: 1e-7 }, 'An object'),
      set(5, 'flagOff', false),
      set(6, 'zero', 0),
      set(7, 'emptyText', ''),
      set(8, 'nullValue', null, 'explicit null'),
      set(9, 'noValue', undefined, 'no value stored'),
      set(10, 'warnedMonths', ['2026-08', '2026-09']),
      set(11, 'aiMonthlySpend', { '2026-09': 1.1, '2026-10': 0.1 }),
      set(12, 'stageModelTiers', { resume_screen: 'cheap', technical: 'deep' }),
      set(13, 'textValue', 'hello'),
      set(14, 'bigNumber', 12345678901234567890),
      set(15, 'äpfel', 'accent'),
    ],
  }),

  steps: [
    { name: 'list all (byte order: Zeta before alpha)', run: (r) => r.listAll() },
    { name: 'find by key', run: (r) => r.findByKey('scoreThreshold') },
    { name: 'find by key: 17-digit number', run: (r) => r.findByKey('longNumber') },
    { name: 'find by key: object', run: (r) => r.findByKey('alpha') },
    { name: 'find by key: explicit null', run: (r) => r.findByKey('nullValue') },
    { name: 'find by key: no value stored', run: (r) => r.findByKey('noValue') },
    { name: 'find by key: other case (no match)', run: (r) => r.findByKey('SCORETHRESHOLD') },
    { name: 'find by key: missing', run: (r) => r.findByKey('missing') },
    { name: 'find by key: with % (no wildcard)', run: (r) => r.findByKey('score%') },
    { name: 'get value', run: (r) => r.getValue('scoreThreshold', 9) },
    { name: 'get value: false is kept', run: (r) => r.getValue('flagOff', true) },
    { name: 'get value: zero is kept', run: (r) => r.getValue('zero', 9) },
    { name: 'get value: empty text is kept', run: (r) => r.getValue('emptyText', 'fallback') },
    { name: 'get value: null uses the fallback', run: (r) => r.getValue('nullValue', 'fallback') },
    { name: 'get value: no value uses the fallback', run: (r) => r.getValue('noValue', 'fallback') },
    { name: 'get value: missing uses the fallback', run: (r) => r.getValue('missing', { a: 1 }) },
    { name: 'get value: missing, no fallback', run: (r) => r.getValue('missing') },
    { name: 'get value: 17-digit number', run: (r) => r.getValue('longNumber') },
    { name: 'get value: huge number', run: (r) => r.getValue('bigNumber') },
    { name: 'get values', run: (r) => r.getValues(['scoreThreshold', 'missing', 'alpha', 'noValue', 'nullValue', 'flagOff']) },
    { name: 'get values: none', run: (r) => r.getValues([]) },
    { name: 'update value: number', run: (r) => r.updateValue('scoreThreshold', 4.25) },
    { name: 'update value: same value again', run: (r) => r.updateValue('scoreThreshold', 4.25) },
    { name: 'update value: 17-digit number', run: (r) => r.updateValue('zero', 0.1 + 0.2) },
    { name: 'update value: object', run: (r) => r.updateValue('textValue', { a: [1, 2, 3], b: { c: null } }) },
    { name: 'update value: null', run: (r) => r.updateValue('emptyText', null) },
    { name: 'update value: undefined (cleared)', run: (r) => r.updateValue('flagOff', undefined) },
    { name: 'update value: false', run: (r) => r.updateValue('Zeta', false) },
    { name: 'update value: a value over an explicit null', run: (r) => r.updateValue('nullValue', 7) },
    { name: 'update value: cleared over an explicit null', run: (r) => r.updateValue('alpha', undefined) },
    { name: 'update value: missing key', run: (r) => r.updateValue('missing', 1) },
    { name: 'create if missing: new', run: (r) => r.createIfMissing('newKey', { x: 1 }, 'New setting') },
    { name: 'create if missing: new, no description', run: (r) => r.createIfMissing('newKey2', 7) },
    { name: 'create if missing: explicit null description', run: (r) => r.createIfMissing('nullDesc', 1, null) },
    { name: 'create if missing: explicit null value', run: (r) => r.createIfMissing('nullVal', null, 'd') },
    { name: 'create if missing: already there (untouched)', run: (r) => r.createIfMissing('scoreThreshold', 1, 'Other') },
    { name: 'add to list: existing list, new item', run: (r) => r.addToList('warnedMonths', '2026-10') },
    { name: 'add to list: item already there', run: (r) => r.addToList('warnedMonths', '2026-08') },
    { name: 'add to list: setting does not exist yet', run: (r) => r.addToList('brandNewList', '2026-10') },
    { name: 'add to list: setting holds text', run: (r) => r.addToList('textValue', 'x') },
    { name: 'add to list: setting has no value', run: (r) => r.addToList('noValue', 'x') },
    { name: 'read lists afterwards', run: async (r) => [await r.findByKey('warnedMonths'), await r.findByKey('brandNewList'), await r.findByKey('noValue')] },
    { name: 'increment: existing entry (floating point sum)', run: (r) => r.incrementEntry('aiMonthlySpend', '2026-10', 0.2) },
    { name: 'increment: another existing entry', run: (r) => r.incrementEntry('aiMonthlySpend', '2026-09', 2.2) },
    { name: 'increment: new entry', run: (r) => r.incrementEntry('aiMonthlySpend', '2026-11', 0.07) },
    { name: 'increment: setting does not exist yet', run: (r) => r.incrementEntry('brandNewSpend', '2026-10', 1.5) },
    { name: 'increment: setting has no value', run: (r) => r.incrementEntry('noValue', '2026-10', 1) },
    { name: 'increment: setting holds a number', run: (r) => r.incrementEntry('longNumber', '2026-10', 1) },
    { name: 'increment: entry is text', run: (r) => r.incrementEntry('stageModelTiers', 'technical', 1) },
    { name: 'read spend afterwards', run: async (r) => [await r.getValue('aiMonthlySpend'), await r.getValue('brandNewSpend'), await r.getValue('noValue')] },
    { name: 'list all at the end', run: (r) => r.listAll() },
  ],

  state: tableState('setting'),
  oldState: {
    mongo: async ({ mongo }) => sorted((await mongo.collection('settings').find().toArray()).map((s) => ({ _id: s._id, key: s.key, value: s.value, description: s.description, updatedAt: s.updatedAt }))),
    postgres: async ({ prisma }) => sorted((await prisma.$queryRawUnsafe(`SELECT id, "key", "value"::text AS v, description, "updatedAt" FROM settings`)).map((s) => ({ _id: s.id, key: s.key, value: s.v === null ? undefined : JSON.parse(s.v), description: s.description ?? undefined, updatedAt: s.updatedAt }))),
  },
};
