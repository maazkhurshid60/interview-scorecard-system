import User from '../models/User.js';
import { plain } from './plain.js';

/**
 * Everything the app needs from the database about user accounts. Only this file (and the model) knows where they
 * live. Results include the password hash (the login and the auth middleware need it), so a user returned from here
 * must go through `sanitizeUser` before it is sent to a client.
 */

const WITHOUT_SECRETS = '-passwordHash -passwordResetTokenHash';
const WITH_RESET_FIELDS = '+passwordResetTokenHash +passwordResetExpiresAt';

/** One user, or null when there is none with that id. */
export async function findById(id) {
  return plain(await User.findById(id));
}

/**
 * The user with this (already lower-cased) email, or null. Pass `exceptId` to leave one user out, for example the
 * one who is changing their own email.
 */
export async function findByEmail(email, { exceptId } = {}) {
  return plain(await User.findOne({ email, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }));
}

/** The active user with this (already lower-cased) email, or null. */
export async function findActiveByEmail(email) {
  return plain(await User.findOne({ email, active: true }));
}

/** Every active user as `{ _id, name, email }`, sorted by name: what the pickers and dropdowns need. */
export async function listActiveBrief() {
  return plain(await User.find({ active: true }).select('name email').sort({ name: 1 }));
}

/** Every user, newest first, without password hashes or reset tokens. */
export async function listAll() {
  return plain(await User.find().select(WITHOUT_SECRETS).sort({ createdAt: -1 }));
}

/** True when at least one owner account exists. */
export async function hasOwner() {
  return !!(await User.exists({ role: 'owner' }));
}

/** How many owners there are besides this user. Pass `activeOnly` to count only active owners. */
export async function countOwnersExcept(id, { activeOnly = false } = {}) {
  return User.countDocuments({ role: 'owner', ...(activeOnly ? { active: true } : {}), _id: { $ne: id } });
}

/** Creates a user and returns it. */
export async function create({ name, email, passwordHash, role, active }) {
  return plain(await User.create({ name, email, passwordHash, role, active }));
}

/**
 * Changes the given fields of a user (name, email, role, active, passwordHash, passwordChangedAt; fields left out
 * stay as they are) and returns the saved user, or null when there is none with that id.
 */
export async function update(id, changes) {
  const user = await User.findById(id);
  if (!user) return null;
  for (const field of ['name', 'email', 'role', 'active', 'passwordHash', 'passwordChangedAt']) {
    if (changes[field] !== undefined) user[field] = changes[field];
  }
  await user.save();
  return plain(user);
}

/** Deletes a user. */
export async function remove(id) {
  await User.findByIdAndDelete(id);
}

/** Stores the hash of a password-reset token (and when it stops working) on a user; the raw token is never stored. */
export async function savePasswordResetToken(id, { tokenHash, expiresAt }) {
  const user = await User.findById(id).select(WITH_RESET_FIELDS);
  user.passwordResetTokenHash = tokenHash;
  user.passwordResetExpiresAt = expiresAt;
  await user.save();
}

/** The active user holding this password-reset token hash, if it has not expired yet, or null. */
export async function findByResetToken(tokenHash) {
  return plain(await User.findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpiresAt: { $gt: new Date() },
    active: true,
  }).select(WITH_RESET_FIELDS));
}

/** Sets the new password on a user and clears their password-reset token, so the link cannot be used again. */
export async function completePasswordReset(id, { passwordHash, passwordChangedAt }) {
  const user = await User.findById(id).select(WITH_RESET_FIELDS);
  user.passwordHash = passwordHash;
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  user.passwordChangedAt = passwordChangedAt;
  await user.save();
}
