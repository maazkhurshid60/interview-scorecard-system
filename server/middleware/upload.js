const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * Shared multer instance for every file upload route (résumé, manual
 * transcript upload, task-performance/résumé-screen artifacts). Files are
 * stored under server/uploads/ (git-ignored) with a random filename to
 * avoid collisions/overwrites; the original extension is preserved.
 *
 * Per INSTRUCTIONS.md: "use multipart/form-data via multer; store files
 * under server/uploads/ and save the path on the interview."
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(16).toString('hex');
    cb(null, `${Date.now()}-${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — generous for a résumé/transcript/task deliverable
});

/**
 * Returns the path to persist on a document (relative to server/), so
 * retentionService's file-deletion logic (which resolves relative to
 * server/) can find it later.
 * @param {Express.Multer.File} file
 * @returns {string}
 */
function relativeUploadPath(file) {
  return path.join('uploads', file.filename);
}

module.exports = { upload, relativeUploadPath, UPLOAD_DIR };
