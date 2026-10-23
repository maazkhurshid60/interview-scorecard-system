const mongoose = require('mongoose');
const { USER_ROLES } = require('../utils/constants');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  // Only a SHA-256 hash of a password-reset token is stored. The raw token is
  // emailed once and never persisted, so a database export cannot be used to
  // reset accounts.
  passwordResetTokenHash: { type: String, select: false },
  passwordResetExpiresAt: { type: Date, select: false },
  passwordChangedAt: Date,
  role: {
    type: String,
    enum: USER_ROLES,
    default: 'recruiter',
    index: true,
  },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
