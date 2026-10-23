const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true });

// Case-insensitive index for department names
departmentSchema.index({ name: 1 }, { collation: { locale: 'en', strength: 2 } });

module.exports = mongoose.model('Department', departmentSchema);
