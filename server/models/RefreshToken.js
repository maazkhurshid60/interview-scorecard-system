const mongoose = require('mongoose');

/**
 * One row per issued refresh token. The token itself (a random secret kept in
 * the user's HTTP-only cookie) is NEVER stored: only its SHA-256 hash, so a
 * database export cannot be used to sign anyone in.
 *
 * Tokens are single-use. Every refresh marks the old token used (`usedAt`)
 * and issues a new one in the same `familyId` (one family = one login). If a
 * token that was already used shows up again, someone is replaying a stolen
 * copy, and the whole family is revoked (`revokedAt`). A revoked token never
 * works again: logout, a password change and theft detection all revoke.
 */
const refreshTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  familyId: { type: String, required: true, index: true },
  familyStartedAt: { type: Date, required: true },   // when the original login happened (caps total session length)
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },      // exchanged for a newer token
  revokedAt: { type: Date, default: null },   // killed: logout, password change, deactivation, or theft detected
  userAgent: String,
  ip: String,
}, { timestamps: { createdAt: true, updatedAt: false } });

// MongoDB deletes each row automatically once its expiry time has passed.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
