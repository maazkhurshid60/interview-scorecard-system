import { oid, tableState } from './harness.js';

/** Parity scenario for refreshTokenRepository. */

const T = new Date('2026-01-01T09:30:00.123Z');
const hex = (n) => n.toString(16).padStart(24, '0');
export const ID = { alice: hex(1), bob: hex(2), t1: hex(50), t2: hex(51), t3: hex(52), t4: hex(53), unknown: hex(99) };
const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const user = (id, name) => ({ _id: oid(id), name, email: `${name.toLowerCase()}@example.com`, passwordHash: 'x', role: 'recruiter', active: true, createdAt: T, updatedAt: T });
const token = (id, userId, hash, family, extra = {}) => ({ _id: oid(id), userId: oid(userId), tokenHash: hash, familyId: family, familyStartedAt: T, expiresAt: future, usedAt: null, revokedAt: null, createdAt: T, ...extra });
const sorted = (list) => list.sort((a, b) => String(a._id).localeCompare(String(b._id)));

export default {
  repository: 'refreshTokenRepository',

  seed: () => ({
    users: [user(ID.alice, 'Alice'), user(ID.bob, 'Bob')],
    refreshtokens: [
      token(ID.t1, ID.alice, 'hash-1', 'family-a', { userAgent: 'Firefox', ip: '10.0.0.1' }),
      token(ID.t2, ID.alice, 'hash-2', 'family-a'),
      token(ID.t3, ID.alice, 'hash-3', 'family-b', { usedAt: T }),
      token(ID.t4, ID.bob, 'hash-4', 'family-c', { revokedAt: T }),
      token(hex(54), ID.bob, 'hash-null-seed', 'family-d', { userAgent: null, ip: null }),
    ],
  }),

  steps: [
    { name: 'find by hash', run: (r) => r.findByHash('hash-1') },
    { name: 'find by hash: no user agent or address', run: (r) => r.findByHash('hash-2') },
    { name: 'find by hash: used token', run: (r) => r.findByHash('hash-3') },
    { name: 'find by hash: revoked token', run: (r) => r.findByHash('hash-4') },
    { name: 'find by hash: other case (no match)', run: (r) => r.findByHash('HASH-1') },
    { name: 'find by hash: with % (no wildcard)', run: (r) => r.findByHash('hash-%') },
    { name: 'find by hash: explicit null user agent', run: (r) => r.findByHash('hash-null-seed') },
    { name: 'find by hash: unknown', run: (r) => r.findByHash('nothing') },
    { name: 'find by id', run: (r) => r.findById(ID.t1) },
    { name: 'find by id: capital letters', run: (r) => r.findById(ID.t1.toUpperCase()) },
    { name: 'find by id: unknown', run: (r) => r.findById(ID.unknown) },
    { name: 'find by id: invalid', run: (r) => r.findById('nope') },
    { name: 'create: everything', run: (r) => r.create({ userId: ID.bob, tokenHash: 'hash-new', familyId: 'family-n', familyStartedAt: new Date('2026-02-01T00:00:00.5Z'), expiresAt: future, userAgent: 'Chrome', ip: '10.0.0.9' }) },
    { name: 'create: no user agent or address', run: (r) => r.create({ userId: ID.alice, tokenHash: 'hash-new2', familyId: 'family-n', familyStartedAt: T, expiresAt: future }) },
    { name: 'create: dates as text', run: (r) => r.create({ userId: ID.alice, tokenHash: 'hash-new3', familyId: 'family-n', familyStartedAt: '2026-02-01T00:00:00.000Z', expiresAt: '2030-01-01' }) },
    { name: 'create: explicit null user agent and address', run: (r) => r.create({ userId: ID.alice, tokenHash: 'hash-null', familyId: 'f', familyStartedAt: T, expiresAt: future, userAgent: null, ip: null }) },
    { name: 'create: same hash again', run: (r) => r.create({ userId: ID.alice, tokenHash: 'hash-new', familyId: 'family-z', familyStartedAt: T, expiresAt: future }) },
    { name: 'create: nothing at all', run: (r) => r.create({}) },
    { name: 'create: empty hash', run: (r) => r.create({ userId: ID.alice, tokenHash: '', familyId: 'f', familyStartedAt: T, expiresAt: future }) },
    { name: 'create: invalid user id', run: (r) => r.create({ userId: 'nope', tokenHash: 'h', familyId: 'f', familyStartedAt: T, expiresAt: future }) },
    { name: 'create: invalid date', run: (r) => r.create({ userId: ID.alice, tokenHash: 'h', familyId: 'f', familyStartedAt: 'not a date', expiresAt: future }) },
    { name: 'create: invalid id and invalid date and missing hash', run: (r) => r.create({ userId: 'nope', familyId: 'f', familyStartedAt: 'x', expiresAt: future }) },
    { name: 'mark used', run: (r) => r.markUsedIfUnused(ID.t1, new Date('2026-03-01T12:00:00.250Z')) },
    { name: 'mark used again (someone got there first)', run: (r) => r.markUsedIfUnused(ID.t1, new Date('2026-03-02T12:00:00Z')) },
    { name: 'mark used: already revoked', run: (r) => r.markUsedIfUnused(ID.t4, new Date('2026-03-02T12:00:00Z')) },
    { name: 'mark used: unknown id', run: (r) => r.markUsedIfUnused(ID.unknown, new Date()) },
    { name: 'mark used: invalid id', run: (r) => r.markUsedIfUnused('nope', new Date()) },
    { name: 'mark used: invalid date', run: (r) => r.markUsedIfUnused(ID.t2, 'not a date') },
    { name: 'mark used: date as text', run: (r) => r.markUsedIfUnused(ID.t2, '2026-03-05T00:00:00.000Z') },
    { name: 'read after marking', run: async (r) => [await r.findById(ID.t1), await r.findById(ID.t2)] },
    { name: 'revoke family', run: (r) => r.revokeFamily('family-a') },
    { name: 'revoke family: nothing left to revoke', run: (r) => r.revokeFamily('family-a') },
    { name: 'revoke family: unknown', run: (r) => r.revokeFamily('nothing') },
    { name: 'revoke all for user', run: (r) => r.revokeAllForUser(ID.alice) },
    { name: 'revoke all for user: unknown', run: (r) => r.revokeAllForUser(ID.unknown) },
    { name: 'revoke all for user: invalid id', run: (r) => r.revokeAllForUser('nope') },
    { name: 'read after revoking', run: async (r) => [await r.findByHash('hash-1'), await r.findByHash('hash-3'), await r.findByHash('hash-4'), await r.findByHash('hash-new')] },
  ],

  state: tableState('refreshToken'),
  oldState: {
    mongo: async ({ mongo }) => sorted((await mongo.collection('refreshtokens').find().toArray()).map((t) => ({ _id: t._id, userId: t.userId, tokenHash: t.tokenHash, familyId: t.familyId, familyStartedAt: t.familyStartedAt, expiresAt: t.expiresAt, usedAt: t.usedAt, revokedAt: t.revokedAt, userAgent: t.userAgent, ip: t.ip, createdAt: t.createdAt }))),
    postgres: async ({ prisma }) => sorted((await prisma.refreshToken.findMany()).map((t) => ({ _id: t.id, userId: t.userId, tokenHash: t.tokenHash, familyId: t.familyId, familyStartedAt: t.familyStartedAt, expiresAt: t.expiresAt, usedAt: t.usedAt, revokedAt: t.revokedAt, userAgent: t.userAgent ?? undefined, ip: t.ip ?? undefined, createdAt: t.createdAt }))),
  },
};
