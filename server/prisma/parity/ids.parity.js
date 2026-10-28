import mongoose from 'mongoose';

/** Parity scenario for the id checks (ids.js): no data, only what counts as an id. */

const objectId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const samples = [
  ['a 24 character id', '507f1f77bcf86cd799439011'], ['capital letters', '507F1F77BCF86CD799439011'], ['mixed case', '507f1F77bcf86Cd799439011'],
  ['12 characters', 'abcdefghijkl'], ['13 characters', 'abcdefghijklm'], ['empty text', ''], ['a word', 'nope'], ['leading space', ' 507f1f77bcf86cd799439011'],
  ['too short', '507f1f77bcf86cd79943901'], ['too long', '507f1f77bcf86cd7994390111'], ['not hex', 'zzzzzzzzzzzzzzzzzzzzzzzz'], ['trailing newline', '507f1f77bcf86cd799439011\n'],
  ['an id object', objectId], ['an object with an _id', { _id: '507f1f77bcf86cd799439011' }], ['12 bytes', Buffer.from('abcdefghijkl')], ['5 bytes', Buffer.from('abcde')],
  ['plain 12 byte array', new Uint8Array(12)], ['true', true], ['an empty object', {}], ['a list', []], ['a list holding an id', ['507f1f77bcf86cd799439011']],
];
const numbers = [['123', 123], ['zero', 0], ['minus one', -1], ['1.5', 1.5], ['a big number', 4294967295], ['too big', 4294967296 * 3]];

// the last 16 characters of an id made from a number are random, so only the first 8 (the time) are compared
const stable = (fn) => (value) => { const out = fn(value); return typeof out === 'string' && /^[0-9a-f]{24}$/.test(out) && typeof value !== 'string' && !(value && typeof value === 'object') ? `${out.slice(0, 8)}...` : out; };

export default {
  repository: 'ids',
  seed: () => ({}),
  steps: [
    ...samples.flatMap(([label, value]) => [
      { name: `is valid: ${label}`, run: (r) => r.isValidId(value) },
      { name: `is valid (strict): ${label}`, run: (r) => r.isValidIdString(value) },
      { name: `normalize: ${label}`, run: (r) => r.normalizeId(value) },
    ]),
    ...numbers.flatMap(([label, value]) => [
      { name: `is valid: number ${label}`, run: (r) => r.isValidId(value) },
      { name: `is valid (strict): number ${label}`, run: (r) => r.isValidIdString(value) },
      { name: `normalize: number ${label}`, run: (r) => stable(r.normalizeId)(value) },
    ]),
    { name: 'is valid: null', run: (r) => r.isValidId(null) },
    { name: 'is valid: undefined', run: (r) => r.isValidId(undefined) },
    { name: 'is valid (strict): null', run: (r) => r.isValidIdString(null) },
    { name: 'normalize: null (makes a new id)', run: (r) => /^[0-9a-f]{24}$/.test(r.normalizeId(null)) },
    { name: 'normalize: undefined (makes a new id)', run: (r) => /^[0-9a-f]{24}$/.test(r.normalizeId(undefined)) },
    { name: 'normalize: NaN', run: (r) => { try { return stable(r.normalizeId)(NaN); } catch (error) { return `${error.name}`; } } },
    { name: 'is valid: NaN', run: (r) => r.isValidId(NaN) },
    { name: 'is valid: Infinity', run: (r) => r.isValidId(Infinity) },
  ],
  state: { mongo: async () => ({}), postgres: async () => ({}) },
};
