import { prisma } from './client.js';
import { castBoolean, castDate, castId, castString, compareBytes, newId, nextNulls, nullSet, translateError, validationError } from './helpers.js';

/**
 * Everything the app needs from the database about user accounts, on PostgreSQL. It offers exactly the functions of
 * ../mongo/userRepository.js and answers the same way. Results include the password hash (the login and the auth
 * middleware need it), so a user returned from here must go through `sanitizeUser` before it is sent to a client.
 */

const ROLES = ['owner', 'admin', 'hiring_manager', 'recruiter', 'interviewer'];
const has = (value) => value !== null && value !== undefined;

/**
 * A user row as the app has always seen it. An empty `passwordChangedAt` is left out, as MongoDB left it out. The
 * password-reset fields are only given when asked for (`withReset`), as with the `select: false` of the Mongoose model.
 */
const toUser = (row, { withReset = false } = {}) => {
  const nulls = nullSet(row);
  const optional = (field, wanted = true) => (!wanted ? {} : (has(row[field]) ? { [field]: row[field] } : (nulls.has(field) ? { [field]: null } : {})));
  return {
  _id: row.id,
  name: row.name,
  email: row.email,
  passwordHash: row.passwordHash,
  ...optional('passwordResetTokenHash', withReset),
  ...optional('passwordResetExpiresAt', withReset),
  ...optional('passwordChangedAt'),
  role: row.role,
  active: row.active,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  };
};

const withoutSecrets = (row) => { const { passwordHash, ...user } = toUser(row); void passwordHash; return user; };

/** One user, or null when there is none with that id. */
export async function findById(id) {
  const row = await prisma.user.findUnique({ where: { id: castId(id, '_id') } });
  return row ? toUser(row) : null;
}

/**
 * The user with this (already lower-cased) email, or null. Pass `exceptId` to leave one user out, for example the
 * one who is changing their own email.
 */
export async function findByEmail(email, { exceptId } = {}) {
  const row = await prisma.user.findFirst({ where: { email: String(email), ...(exceptId ? { id: { not: castId(exceptId, '_id') } } : {}) } });
  return row ? toUser(row) : null;
}

/** The active user with this (already lower-cased) email, or null. */
export async function findActiveByEmail(email) {
  const row = await prisma.user.findFirst({ where: { email: String(email), active: true } });
  return row ? toUser(row) : null;
}

/** Every active user as `{ _id, name, email }`, sorted by name: what the pickers and dropdowns need. */
export async function listActiveBrief() {
  const rows = await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true } });
  return rows.sort((a, b) => compareBytes(a.name, b.name) || compareBytes(a.id, b.id)).map((row) => ({ _id: row.id, name: row.name, email: row.email }));
}

/** Every user, newest first, without password hashes or reset tokens. */
export async function listAll() {
  const rows = await prisma.user.findMany();
  return rows.sort((a, b) => b.createdAt - a.createdAt || compareBytes(a.id, b.id)).map(withoutSecrets);
}

/** True when at least one owner account exists. */
export async function hasOwner() {
  return (await prisma.user.count({ where: { role: 'owner' } })) > 0;
}

/** How many owners there are besides this user. Pass `activeOnly` to count only active owners. */
export async function countOwnersExcept(id, { activeOnly = false } = {}) {
  return prisma.user.count({ where: { role: 'owner', ...(activeOnly ? { active: true } : {}), id: { not: castId(id, '_id') } } });
}

/**
 * Casts and checks user values the way the Mongoose model does. `fields` lists what is being set (all of them for a new
 * user). Throws the ValidationError Mongoose would throw; returns the cast values.
 */
function build(input, fields, { creating }) {
  const casting = {}; const checking = {}; const values = {};
  const take = (cast, field) => {
    const done = cast(input[field], field);
    if (done.problem) casting[field] = done.problem;
    values[field] = done.value;
  };
  for (const field of fields) {
    if (['name', 'email', 'passwordHash', 'role'].includes(field)) take(castString, field);
    else if (field === 'active') take(castBoolean, field);
    else take(castDate, field); // passwordChangedAt
  }
  if (creating) {
    if (values.role === undefined) values.role = 'recruiter';
    if (values.active === undefined) values.active = true;
  }
  for (const field of ['name', 'email', 'passwordHash']) {
    if (fields.includes(field) && !casting[field] && (!has(values[field]) || values[field] === '')) checking[field] = `Path \`${field}\` is required.`;
  }
  if (fields.includes('role') && !casting.role && has(values.role) && !ROLES.includes(values.role)) checking.role = `\`${values.role}\` is not a valid enum value for path \`role\`.`;
  const problems = { ...casting, ...checking };
  if (Object.keys(problems).length) throw validationError('User', problems);
  return values;
}

/** Creates a user and returns it. */
export async function create({ name, email, passwordHash, role, active } = {}) {
  const values = build({ name, email, passwordHash, role, active }, ['name', 'email', 'passwordHash', 'role', 'active'], { creating: true });
  const now = new Date();
  try {
    const row = await prisma.user.create({ data: { id: newId(), ...values, createdAt: now, updatedAt: now } });
    return toUser(row);
  } catch (error) {
    throw translateError(error, { email: values.email });
  }
}

const sameValue = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : (a ?? null) === (b ?? null));

/**
 * Changes the given fields of a user (name, email, role, active, passwordHash, passwordChangedAt; fields left out
 * stay as they are) and returns the saved user, or null when there is none with that id. Nothing is written when
 * nothing changes.
 */
export async function update(id, changes = {}) {
  const row = await prisma.user.findUnique({ where: { id: castId(id, '_id') } });
  if (!row) return null;
  const fields = ['name', 'email', 'role', 'active', 'passwordHash', 'passwordChangedAt'].filter((field) => changes[field] !== undefined);
  const values = build(changes, fields, { creating: false });
  const data = Object.fromEntries(fields.filter((field) => !sameValue(values[field], row[field])).map((field) => [field, values[field]]));
  // a value saved as an explicit null where none was set is a change (and the reverse); the list of explicit nulls follows
  const held = nullSet(row);
  for (const field of fields.filter((f) => f === 'passwordChangedAt')) {
    if (values[field] === null && !held.has(field)) data[field] = null;
  }
  if (!Object.keys(data).length) return toUser(row);
  if ('passwordChangedAt' in data || (fields.includes('passwordChangedAt') && held.has('passwordChangedAt'))) {
    data.nullFields = nextNulls(row.nullFields, values.passwordChangedAt === null ? { add: ['passwordChangedAt'] } : { remove: ['passwordChangedAt'] });
  }
  try {
    return toUser(await prisma.user.update({ where: { id: row.id }, data: { ...data, updatedAt: new Date() } }));
  } catch (error) {
    throw translateError(error, { email: values.email });
  }
}

/** Deletes a user (and, with them, their refresh tokens). */
export async function remove(id) {
  await prisma.user.deleteMany({ where: { id: castId(id, '_id') } });
}

/** The user row to change, or the error MongoDB code would hit on a missing one (these methods never checked). */
async function rowForChange(id, field) {
  const row = await prisma.user.findUnique({ where: { id: castId(id, '_id') } });
  if (!row) throw new TypeError(`Cannot set properties of null (setting '${field}')`);
  return row;
}

/** Stores the hash of a password-reset token (and when it stops working) on a user; the raw token is never stored. */
export async function savePasswordResetToken(id, { tokenHash, expiresAt }) {
  const row = await rowForChange(id, 'passwordResetTokenHash');
  const hash = castString(tokenHash, 'passwordResetTokenHash');
  const expires = castDate(expiresAt, 'passwordResetExpiresAt');
  const problems = {};
  if (hash.problem) problems.passwordResetTokenHash = hash.problem;
  if (expires.problem) problems.passwordResetExpiresAt = expires.problem;
  if (Object.keys(problems).length) throw validationError('User', problems);
  const data = {};
  if (!sameValue(hash.value, row.passwordResetTokenHash)) data.passwordResetTokenHash = hash.value ?? null;
  if (!sameValue(expires.value, row.passwordResetExpiresAt)) data.passwordResetExpiresAt = expires.value ?? null;
  const held = nullSet(row); const add = []; const remove = [];
  for (const [field, value] of [['passwordResetTokenHash', hash.value], ['passwordResetExpiresAt', expires.value]]) {
    if (value === null) { add.push(field); if (!held.has(field)) data[field] = null; } else if (value !== undefined) remove.push(field);
  }
  if (Object.keys(data).length) await prisma.user.update({ where: { id: row.id }, data: { ...data, nullFields: nextNulls(row.nullFields, { add, remove }), updatedAt: new Date() } });
}

/** The active user holding this password-reset token hash, if it has not expired yet, or null. */
export async function findByResetToken(tokenHash) {
  const row = await prisma.user.findFirst({ where: { passwordResetTokenHash: String(tokenHash), passwordResetExpiresAt: { gt: new Date() }, active: true } });
  return row ? toUser(row, { withReset: true }) : null;
}

/** Sets the new password on a user and clears their password-reset token, so the link cannot be used again. */
export async function completePasswordReset(id, { passwordHash, passwordChangedAt }) {
  const row = await rowForChange(id, 'passwordHash');
  const hash = castString(passwordHash, 'passwordHash');
  const changed = castDate(passwordChangedAt, 'passwordChangedAt');
  const problems = {};
  if (hash.problem) problems.passwordHash = hash.problem;
  if (changed.problem) problems.passwordChangedAt = changed.problem;
  if (!problems.passwordHash && (!has(hash.value) || hash.value === '')) problems.passwordHash = 'Path `passwordHash` is required.';
  if (Object.keys(problems).length) throw validationError('User', problems);
  const data = {};
  if (!sameValue(hash.value, row.passwordHash)) data.passwordHash = hash.value;
  const held = nullSet(row);
  if (row.passwordResetTokenHash !== null || held.has('passwordResetTokenHash')) data.passwordResetTokenHash = null;
  if (row.passwordResetExpiresAt !== null || held.has('passwordResetExpiresAt')) data.passwordResetExpiresAt = null;
  if (!sameValue(changed.value, row.passwordChangedAt) || (changed.value === null && !held.has('passwordChangedAt'))) data.passwordChangedAt = changed.value ?? null;
  const remove = ['passwordResetTokenHash', 'passwordResetExpiresAt', ...(changed.value === null ? [] : ['passwordChangedAt'])];
  if (Object.keys(data).length) await prisma.user.update({ where: { id: row.id }, data: { ...data, nullFields: nextNulls(row.nullFields, { add: changed.value === null ? ['passwordChangedAt'] : [], remove }), updatedAt: new Date() } });
}
