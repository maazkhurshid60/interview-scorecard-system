import RefreshToken from '../models/RefreshToken.js';
import { plain } from './plain.js';

/**
 * Everything the app needs from the database about login refresh tokens. Only the SHA-256 hash of a token is ever
 * stored, so callers pass hashes in, never the raw token. A "family" is every token issued from one login.
 */

/** Stores a new refresh token row. */
export async function create({ userId, tokenHash, familyId, familyStartedAt, expiresAt, userAgent, ip }) {
  return plain(await RefreshToken.create({ userId, tokenHash, familyId, familyStartedAt, expiresAt, userAgent, ip }));
}

/** The token row with this hash, or null. */
export async function findByHash(tokenHash) {
  return plain(await RefreshToken.findOne({ tokenHash }).lean());
}

/** The token row with this id, or null. */
export async function findById(id) {
  return plain(await RefreshToken.findById(id).lean());
}

/**
 * Marks a token as used, but only if nobody has used or revoked it yet, in one atomic step.
 * @returns {Promise<boolean>} true when this call was the one that marked it; false when something else got there first.
 */
export async function markUsedIfUnused(id, usedAt) {
  const marked = await RefreshToken.findOneAndUpdate({ _id: id, usedAt: null, revokedAt: null }, { usedAt });
  return !!marked;
}

/** Revokes every token of one login (family) that is not revoked yet. */
export async function revokeFamily(familyId) {
  await RefreshToken.updateMany({ familyId, revokedAt: null }, { revokedAt: new Date() });
}

/** Revokes every token of one user that is not revoked yet, on every device. */
export async function revokeAllForUser(userId) {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
}
