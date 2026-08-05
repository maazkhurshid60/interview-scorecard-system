const mongoose = require('mongoose');

const candidateSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  email: { type: String, index: true },
  phone: String,
  resumeFileUrl: String,       // Cloudinary secure_url (for résumé screen)
  resumeFilePublicId: String,  // Cloudinary public_id — needed to delete/replace the file
  notes: String,
}, { timestamps: true });

module.exports = mongoose.model('Candidate', candidateSchema);
