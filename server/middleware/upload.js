const multer = require('multer');

/**
 * Shared multer instance for every file upload route (résumé, manual
 * transcript upload, task-performance/résumé-screen artifacts). Files are
 * held in memory only, then uploaded to Cloudinary by the controller —
 * Render's filesystem is ephemeral (wiped on every restart/redeploy), so
 * nothing is ever written to local disk.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — generous for a résumé/transcript/task deliverable
});

module.exports = { upload };
