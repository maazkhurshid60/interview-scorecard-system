const mongoose = require('mongoose');

const candidateSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  email: { type: String, required: true, index: true },
  phone: {
    type: String,
    validate: {
      validator(value) {
        return !value || /^\d{11}$/.test(value);
      },
      message: 'Phone number must contain exactly 11 digits.',
    },
  },
  resumeFileUrl: String,       // Cloudinary secure_url, or s3://bucket/key for a private S3 file (for résumé screen)
  resumeFilePublicId: String,  // Cloudinary public_id, or "s3:<key>" — needed to delete/replace the file
  resumeFileName: String,      // Original file name
  resumeFileSize: Number,      // Size in bytes (before any compression)
  resumeFileMimeType: String,  // e.g. application/pdf
  notes: String,
}, { timestamps: true });

module.exports = mongoose.model('Candidate', candidateSchema);
