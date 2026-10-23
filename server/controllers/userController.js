const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { USER_ROLES } = require('../utils/constants');
const { asyncHandler, sanitizeUser } = require('../utils/helpers');
const logger = require('../utils/logger');
const { revokeAllForUser } = require('../services/sessionService');

/**
 * GET /api/users
 * Returns list of users.
 * If user is owner/admin and not requesting brief view: returns full user management list.
 * Otherwise, returns minimal active user list (_id, name, email) for dropdowns.
 */
const list = asyncHandler(async (req, res) => {
  const isManager = req.user && (req.user.role === 'owner' || req.user.role === 'admin');
  const isBrief = req.query.brief === 'true';

  if (!isManager || isBrief) {
    const users = await User.find({ active: true }).select('name email').sort({ name: 1 });
    return res.json({ users });
  }

  const users = await User.find().select('-passwordHash -passwordResetTokenHash').sort({ createdAt: -1 });
  res.json({ users: users.map(sanitizeUser) });
});

/**
 * POST /api/users
 * Creates a new user (restricted to owner and admin).
 * Body: { name, email, password, role }
 */
const create = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Full name is required.' });
  }
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email address is required.' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const normalizedEmail = email.toLowerCase().trim();
  if (!emailRegex.test(normalizedEmail)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Please provide a valid email address.' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Password must be at least 6 characters long.' });
  }
  if (!role || !USER_ROLES.includes(role)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: `Role must be one of: ${USER_ROLES.join(', ')}.` });
  }

  // Permission rule: Admins cannot create an Owner account
  if (role === 'owner' && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Only an Owner can assign the Owner role.' });
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ error: 'CONFLICT', message: `A user with email "${normalizedEmail}" already exists.` });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
    role,
    active: true,
  });

  logger.info(`[Users] Created user ${user.email} (${user.role}) by ${req.user.email} (${req.user.role})`);
  res.status(201).json({ user: sanitizeUser(user), message: 'User created successfully.' });
});

/**
 * PATCH /api/users/:id
 * Updates an existing user (restricted to owner and admin).
 * Body: { name, email, role, active, password }
 */
const update = asyncHandler(async (req, res) => {
  const targetUser = await User.findById(req.params.id);
  if (!targetUser) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
  }

  // Permission rule: Admins cannot edit or modify an Owner account
  if (targetUser.role === 'owner' && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Admins cannot edit or modify an Owner account.' });
  }

  // Permission rule: Admins cannot promote anyone to Owner
  if (req.body.role === 'owner' && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Only an Owner can assign the Owner role.' });
  }

  const { name, email, role, active, password } = req.body;

  // Protect the last active Owner from being deactivated or changed to another role
  if (targetUser.role === 'owner') {
    const isDeactivating = active === false || active === 'false';
    const isChangingRole = role && role !== 'owner';
    if (isDeactivating || isChangingRole) {
      const otherActiveOwners = await User.countDocuments({
        role: 'owner',
        active: true,
        _id: { $ne: targetUser._id },
      });
      if (otherActiveOwners === 0) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'There must be at least one active Owner in the system.' });
      }
    }
  }

  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Name cannot be empty.' });
    targetUser.name = name.trim();
  }

  if (email !== undefined) {
    const normalizedEmail = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Please provide a valid email address.' });
    }
    if (normalizedEmail !== targetUser.email) {
      const existing = await User.findOne({ email: normalizedEmail, _id: { $ne: targetUser._id } });
      if (existing) {
        return res.status(409).json({ error: 'CONFLICT', message: `A user with email "${normalizedEmail}" already exists.` });
      }
      targetUser.email = normalizedEmail;
    }
  }

  if (role !== undefined) {
    if (!USER_ROLES.includes(role)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: `Role must be one of: ${USER_ROLES.join(', ')}.` });
    }
    targetUser.role = role;
  }

  let endSessions = false; // sign the person out everywhere when their access is cut or their password changes
  if (active !== undefined) {
    if (!Boolean(active) && targetUser.active) endSessions = true;
    targetUser.active = Boolean(active);
  }

  if (password && String(password).trim()) {
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'New password must be at least 6 characters long.' });
    }
    targetUser.passwordHash = await bcrypt.hash(password, 10);
    targetUser.passwordChangedAt = new Date();
    endSessions = true;
  }

  await targetUser.save();
  if (endSessions) await revokeAllForUser(targetUser._id);
  logger.info(`[Users] Updated user ${targetUser.email} (${targetUser.role}) by ${req.user.email} (${req.user.role})`);
  res.json({ user: sanitizeUser(targetUser), message: 'User updated successfully.' });
});

/**
 * DELETE /api/users/:id
 * Removes a user account (restricted to owner and admin).
 */
const remove = asyncHandler(async (req, res) => {
  const targetUser = await User.findById(req.params.id);
  if (!targetUser) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
  }

  if (String(targetUser._id) === String(req.user._id)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'You cannot delete your own account.' });
  }

  // Permission rule: Admins cannot delete an Owner account
  if (targetUser.role === 'owner' && req.user.role !== 'owner') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Admins cannot delete an Owner account.' });
  }

  // Protect the last active Owner from deletion
  if (targetUser.role === 'owner') {
    const otherOwners = await User.countDocuments({
      role: 'owner',
      _id: { $ne: targetUser._id },
    });
    if (otherOwners === 0) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Cannot delete the only Owner in the system.' });
    }
  }

  await User.findByIdAndDelete(req.params.id);
  await revokeAllForUser(targetUser._id);
  logger.info(`[Users] Deleted user ${targetUser.email} (${targetUser.role}) by ${req.user.email} (${req.user.role})`);
  res.json({ message: 'User deleted successfully.' });
});

module.exports = { list, create, update, remove };
