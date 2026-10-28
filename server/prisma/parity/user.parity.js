import { oid, tableState } from './harness.js';

/** Parity scenario for userRepository. */

const T = new Date('2026-01-01T09:30:00.123Z');
const hex = (n) => n.toString(16).padStart(24, '0');
export const ID = { owner: hex(1), admin: hex(2), rec: hex(3), inactive: hex(4), zed: hex(5), tie: hex(6), reset: hex(7), expired: hex(8), owner2: hex(9), unknown: hex(99) };
const user = (id, name, email, extra = {}) => ({ _id: oid(id), name, email, passwordHash: `hash-${name}`, role: 'recruiter', active: true, createdAt: T, updatedAt: T, ...extra });
const sorted = (list) => list.sort((a, b) => String(a._id).localeCompare(String(b._id)));
const future = new Date(Date.now() + 3600 * 1000);
const past = new Date(Date.now() - 3600 * 1000);

export default {
  repository: 'userRepository',

  seed: () => ({
    users: [
      user(ID.owner, 'Olivia Owner', 'olivia@example.com', { role: 'owner', createdAt: new Date('2026-01-01T00:00:00Z') }),
      user(ID.admin, 'Adam Admin', 'adam@example.com', { role: 'admin', createdAt: new Date('2026-01-02T00:00:00Z'), passwordChangedAt: new Date('2026-01-05T08:00:00.500Z') }),
      user(ID.rec, 'Rita Recruiter', 'rita@example.com', { createdAt: new Date('2026-01-03T00:00:00Z') }),
      user(ID.inactive, 'Ivan Inactive', 'ivan@example.com', { active: false, role: 'interviewer', createdAt: new Date('2026-01-04T00:00:00Z') }),
      user(ID.zed, 'alpha lowercase', 'alpha@example.com', { createdAt: new Date('2026-01-05T00:00:00Z') }),
      user(ID.tie, 'Tia Tie', 'tia@example.com', { createdAt: new Date('2026-01-05T00:00:00Z') }), // same creation time as the one before
      user(ID.reset, 'Reggie Reset', 'reggie@example.com', { passwordResetTokenHash: 'reset-hash', passwordResetExpiresAt: future, createdAt: new Date('2026-01-06T00:00:00Z') }),
      user(ID.expired, 'Eddie Expired', 'eddie@example.com', { passwordResetTokenHash: 'old-hash', passwordResetExpiresAt: past, createdAt: new Date('2026-01-07T00:00:00Z') }),
      user(hex(10), 'Nina Null', 'nina@example.com', { passwordChangedAt: null, createdAt: new Date('2026-01-09T00:00:00Z') }),
      user(ID.owner2, 'Oscar Owner', 'oscar@example.com', { role: 'owner', active: false, createdAt: new Date('2026-01-08T00:00:00Z') }),
    ],
  }),

  steps: [
    { name: 'find by id', run: (r) => r.findById(ID.owner) },
    { name: 'find by id: with a password change date', run: (r) => r.findById(ID.admin) },
    { name: 'find by id: reset fields are not included', run: (r) => r.findById(ID.reset) },
    { name: 'find by id: capital letters', run: (r) => r.findById(ID.owner.toUpperCase()) },
    { name: 'find by id: unknown', run: (r) => r.findById(ID.unknown) },
    { name: 'find by id: invalid', run: (r) => r.findById('nope') },
    { name: 'find by email', run: (r) => r.findByEmail('rita@example.com') },
    { name: 'find by email: other case (no match)', run: (r) => r.findByEmail('RITA@example.com') },
    { name: 'find by email: with % (no wildcard)', run: (r) => r.findByEmail('%@example.com') },
    { name: 'find by email: leaving out itself', run: (r) => r.findByEmail('rita@example.com', { exceptId: ID.rec }) },
    { name: 'find by email: leaving out another', run: (r) => r.findByEmail('rita@example.com', { exceptId: ID.owner }) },
    { name: 'find by email: invalid exceptId', run: (r) => r.findByEmail('rita@example.com', { exceptId: 'nope' }) },
    { name: 'find by email: unknown', run: (r) => r.findByEmail('nobody@example.com') },
    { name: 'find active by email', run: (r) => r.findActiveByEmail('rita@example.com') },
    { name: 'find active by email: inactive user', run: (r) => r.findActiveByEmail('ivan@example.com') },
    { name: 'list active (brief, byte order: Tia before alpha)', run: (r) => r.listActiveBrief() },
    { name: 'list all (newest first, no secrets, equal creation times)', run: (r) => r.listAll() },
    { name: 'has owner', run: (r) => r.hasOwner() },
    { name: 'count owners except the owner', run: (r) => r.countOwnersExcept(ID.owner) },
    { name: 'count active owners except the owner', run: (r) => r.countOwnersExcept(ID.owner, { activeOnly: true }) },
    { name: 'count owners except someone else', run: (r) => r.countOwnersExcept(ID.rec) },
    { name: 'count owners: unknown id', run: (r) => r.countOwnersExcept(ID.unknown) },
    { name: 'count owners: invalid id', run: (r) => r.countOwnersExcept('nope') },
    { name: 'create: everything', run: (r) => r.create({ name: 'New Person', email: 'new@example.com', passwordHash: 'h', role: 'admin', active: false }) },
    { name: 'create: only the required values (role and active default)', run: (r) => r.create({ name: 'Plain', email: 'plain@example.com', passwordHash: 'h' }) },
    { name: 'create: email is kept as typed', run: (r) => r.create({ name: 'Caps', email: 'CAPS@Example.com', passwordHash: 'h' }) },
    { name: 'create: active as text', run: (r) => r.create({ name: 'Text', email: 'text@example.com', passwordHash: 'h', active: 'false' }) },
    { name: 'create: same email again', run: (r) => r.create({ name: 'Dup', email: 'new@example.com', passwordHash: 'h' }) },
    { name: 'create: same email in another case (allowed)', run: (r) => r.create({ name: 'Dup2', email: 'NEW@example.com', passwordHash: 'h' }) },
    { name: 'create: nothing at all', run: (r) => r.create({}) },
    { name: 'create: empty name', run: (r) => r.create({ name: '', email: 'e@example.com', passwordHash: 'h' }) },
    { name: 'create: role not allowed', run: (r) => r.create({ name: 'Bad', email: 'bad@example.com', passwordHash: 'h', role: 'boss' }) },
    { name: 'create: role not allowed and name missing', run: (r) => r.create({ email: 'bad2@example.com', passwordHash: 'h', role: 'boss' }) },
    { name: 'create: active that is not true or false', run: (r) => r.create({ name: 'Bad', email: 'bad3@example.com', passwordHash: 'h', active: 'maybe' }) },
    { name: 'update: name', run: (r) => r.update(ID.rec, { name: 'Rita R.' }) },
    { name: 'update: same values again (nothing to write)', run: (r) => r.update(ID.rec, { name: 'Rita R.', role: 'recruiter', active: true }) },
    { name: 'update: nothing at all', run: (r) => r.update(ID.rec, {}) },
    { name: 'update: role and active', run: (r) => r.update(ID.rec, { role: 'interviewer', active: false }) },
    { name: 'update: password and change date', run: (r) => r.update(ID.rec, { passwordHash: 'new-hash', passwordChangedAt: new Date('2026-04-01T10:00:00.750Z') }) },
    { name: 'update: same change date again (nothing to write)', run: (r) => r.update(ID.rec, { passwordChangedAt: new Date('2026-04-01T10:00:00.750Z') }) },
    { name: 'update: change date set to null', run: (r) => r.update(ID.zed, { passwordChangedAt: null }) },
    { name: 'update: change date null again (nothing to write)', run: (r) => r.update(ID.zed, { passwordChangedAt: null }) },
    { name: 'update: change date over a null', run: (r) => r.update(hex(10), { passwordChangedAt: new Date('2026-07-01T00:00:00.5Z') }) },
    { name: 'update: email taken by another', run: (r) => r.update(ID.zed, { email: 'olivia@example.com' }) },
    { name: 'update: email', run: (r) => r.update(ID.zed, { email: 'alpha2@example.com' }) },
    { name: 'update: role not allowed', run: (r) => r.update(ID.zed, { role: 'boss' }) },
    { name: 'update: empty name', run: (r) => r.update(ID.zed, { name: '' }) },
    { name: 'update: reset fields are not included in the answer', run: (r) => r.update(ID.reset, { name: 'Reggie R.' }) },
    { name: 'update: unknown id', run: (r) => r.update(ID.unknown, { name: 'Ghost' }) },
    { name: 'update: invalid id', run: (r) => r.update('nope', { name: 'Ghost' }) },
    { name: 'find by reset token', run: (r) => r.findByResetToken('reset-hash') },
    { name: 'find by reset token: expired', run: (r) => r.findByResetToken('old-hash') },
    { name: 'find by reset token: unknown', run: (r) => r.findByResetToken('nothing') },
    { name: 'save reset token', run: (r) => r.savePasswordResetToken(ID.tie, { tokenHash: 'tie-hash', expiresAt: new Date('2099-01-01T00:00:00.250Z') }) },
    { name: 'save reset token: same again (nothing to write)', run: async (r) => { const first = await r.findByResetToken('tie-hash'); await r.savePasswordResetToken(ID.tie, { tokenHash: 'tie-hash', expiresAt: first.passwordResetExpiresAt }); return r.findByResetToken('tie-hash'); } },
    { name: 'find by reset token: the new one', run: (r) => r.findByResetToken('tie-hash') },
    { name: 'save reset token: unknown user', run: (r) => r.savePasswordResetToken(ID.unknown, { tokenHash: 'x', expiresAt: new Date() }) },
    { name: 'save reset token: invalid id', run: (r) => r.savePasswordResetToken('nope', { tokenHash: 'x', expiresAt: new Date() }) },
    { name: 'find by reset token: inactive user is skipped', run: async (r) => { await r.update(ID.reset, { active: false }); return r.findByResetToken('reset-hash'); } },
    { name: 'complete reset', run: (r) => r.completePasswordReset(ID.tie, { passwordHash: 'fresh-hash', passwordChangedAt: new Date('2026-05-01T00:00:00.5Z') }) },
    { name: 'read after completing reset', run: async (r) => [await r.findById(ID.tie), await r.findByResetToken('tie-hash')] },
    { name: 'complete reset: nothing to clear', run: (r) => r.completePasswordReset(ID.tie, { passwordHash: 'fresh-hash', passwordChangedAt: new Date('2026-05-01T00:00:00.5Z') }) },
    { name: 'complete reset: unknown user', run: (r) => r.completePasswordReset(ID.unknown, { passwordHash: 'x', passwordChangedAt: new Date() }) },
    { name: 'complete reset: invalid id', run: (r) => r.completePasswordReset('nope', { passwordHash: 'x', passwordChangedAt: new Date() }) },
    { name: 'complete reset: empty password hash', run: (r) => r.completePasswordReset(ID.expired, { passwordHash: '', passwordChangedAt: new Date() }) },
    { name: 'remove', run: (r) => r.remove(ID.inactive) },
    { name: 'remove: already gone', run: (r) => r.remove(ID.inactive) },
    { name: 'remove: invalid id', run: (r) => r.remove('nope') },
    { name: 'list all at the end', run: (r) => r.listAll() },
  ],

  state: tableState('user'),
  oldState: {
    mongo: async ({ mongo }) => sorted((await mongo.collection('users').find().toArray()).map((u) => ({ _id: u._id, name: u.name, email: u.email, passwordHash: u.passwordHash, passwordResetTokenHash: u.passwordResetTokenHash, passwordResetExpiresAt: u.passwordResetExpiresAt, passwordChangedAt: u.passwordChangedAt, role: u.role, active: u.active, createdAt: u.createdAt, updatedAt: u.updatedAt }))),
    postgres: async ({ prisma }) => sorted((await prisma.user.findMany()).map((u) => ({ _id: u.id, name: u.name, email: u.email, passwordHash: u.passwordHash, passwordResetTokenHash: u.passwordResetTokenHash ?? undefined, passwordResetExpiresAt: u.passwordResetExpiresAt ?? undefined, passwordChangedAt: u.passwordChangedAt ?? undefined, role: u.role, active: u.active, createdAt: u.createdAt, updatedAt: u.updatedAt }))),
  },
};
