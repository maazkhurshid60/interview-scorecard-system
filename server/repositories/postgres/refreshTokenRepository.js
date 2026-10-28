import { prisma } from './client.js';
import { castDate, castError, castId, castIdField, castString, newId, nextNulls, nullSet, translateError, validationError } from './helpers.js';

/**
 * Everything the app needs from the database about login refresh tokens, on PostgreSQL. It offers exactly the functions
 * of ../mongo/refreshTokenRepository.js and answers the same way. Only the SHA-256 hash of a token is ever stored.
 *
 * Two things PostgreSQL does for itself that MongoDB needed help with, or the other way round: a token row is deleted
 * with its user (a foreign key), and MongoDB's automatic removal of expired rows (a TTL index) does not exist here, so
 * expired rows stay until a cleanup removes them (callers already check `expiresAt`).
 */

const has = (value) => value !== null && value !== undefined;

/** A token row as the app has always seen it: `usedAt` and `revokedAt` are null until set; an empty user agent or address is left out. */
const toToken = (row) => ({
  _id: row.id,
  userId: row.userId,
  tokenHash: row.tokenHash,
  familyId: row.familyId,
  familyStartedAt: row.familyStartedAt,
  expiresAt: row.expiresAt,
  usedAt: row.usedAt,
  revokedAt: row.revokedAt,
  ...(has(row.userAgent) ? { userAgent: row.userAgent } : (nullSet(row).has('userAgent') ? { userAgent: null } : {})),
  ...(has(row.ip) ? { ip: row.ip } : (nullSet(row).has('ip') ? { ip: null } : {})),
  createdAt: row.createdAt,
});

/** Stores a new refresh token row. */
export async function create({ userId, tokenHash, familyId, familyStartedAt, expiresAt, userAgent, ip } = {}) {
  const casting = {}; const checking = {};
  const take = (cast, field, value) => {
    const done = cast(value, field);
    if (done.problem) casting[field] = done.problem;
    return done.value;
  };
  const values = {
    userId: take(castIdField, 'userId', userId),
    tokenHash: take(castString, 'tokenHash', tokenHash),
    familyId: take(castString, 'familyId', familyId),
    familyStartedAt: take(castDate, 'familyStartedAt', familyStartedAt),
    expiresAt: take(castDate, 'expiresAt', expiresAt),
    userAgent: take(castString, 'userAgent', userAgent),
    ip: take(castString, 'ip', ip),
  };
  for (const field of ['userId', 'tokenHash', 'familyId', 'familyStartedAt', 'expiresAt']) {
    if (!casting[field] && (!has(values[field]) || values[field] === '')) checking[field] = `Path \`${field}\` is required.`;
  }
  const problems = { ...casting, ...checking };
  if (Object.keys(problems).length) throw validationError('RefreshToken', problems);

  try {
    const row = await prisma.refreshToken.create({
      data: { id: newId(), ...values, userAgent: values.userAgent ?? null, ip: values.ip ?? null, createdAt: new Date(), nullFields: nextNulls(null, { add: ['userAgent', 'ip'].filter((field) => values[field] === null) }) },
    });
    return toToken(row);
  } catch (error) {
    throw translateError(error, { tokenHash: values.tokenHash });
  }
}

/** The token row with this hash, or null. */
export async function findByHash(tokenHash) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: String(tokenHash) } });
  return row ? toToken(row) : null;
}

/** The token row with this id, or null. */
export async function findById(id) {
  const row = await prisma.refreshToken.findUnique({ where: { id: castId(id, '_id') } });
  return row ? toToken(row) : null;
}

/** A date from the caller, or the error MongoDB gives for one it cannot read. */
function dateOrError(value, path) {
  const done = castDate(value, path);
  if (done.problem) throw Object.assign(castError(path, value), { message: done.problem, kind: 'date' });
  return done.value;
}

/**
 * Marks a token as used, but only if nobody has used or revoked it yet, in one atomic step.
 * @returns {Promise<boolean>} true when this call was the one that marked it; false when something else got there first.
 */
export async function markUsedIfUnused(id, usedAt) {
  const tokenId = castId(id, '_id');
  const when = dateOrError(usedAt, 'usedAt');
  const { count } = await prisma.refreshToken.updateMany({ where: { id: tokenId, usedAt: null, revokedAt: null }, data: { usedAt: when } });
  return count > 0;
}

/** Revokes every token of one login (family) that is not revoked yet. */
export async function revokeFamily(familyId) {
  await prisma.refreshToken.updateMany({ where: { familyId: String(familyId), revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Revokes every token of one user that is not revoked yet, on every device. */
export async function revokeAllForUser(userId) {
  await prisma.refreshToken.updateMany({ where: { userId: castId(userId, 'userId'), revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Deletes every token that has expired and returns how many were deleted (PostgreSQL does not remove them by itself). */
export async function removeExpired() {
  return (await prisma.refreshToken.deleteMany({ where: { expiresAt: { lte: new Date() } } })).count;
}
