const mongoose = require('mongoose');
const { USER_ROLES } = require('../utils/constants');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  role: {
    type: String,
    enum: USER_ROLES,
    default: 'recruiter',
    index: true,
  },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
