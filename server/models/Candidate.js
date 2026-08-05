const mongoose = require('mongoose');

const candidateSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  email: { type: String, index: true },
  phone: String,
  resumeFileUrl: String,       // Uploaded CV path (for résumé screen)
  notes: String,
}, { timestamps: true });

module.exports = mongoose.model('Candidate', candidateSchema);
