const multer = require('multer');
const { ValidationError } = require('../utils/errors');
const { MAX_PDF_BYTES, MAX_PDF_MB } = require('../utils/uploadValidation');

/**
 * Shared multer instance for routes that accept more than PDFs (the manual
 * transcript upload: txt / md / pdf / docx — its text is extracted and the
 * file itself is not stored). Files are held in memory only, never written to
 * local disk, so nothing is lost when the server restarts.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — generous for a transcript
});

/**
 * Multer instance for every file that gets STORED (résumés, interview files,
 * offer letters): PDF only, size-limited, and rejected before the whole body
 * is buffered. The controller still runs assertPdfUpload as the second line of
 * defence (it also checks the file's real content, which multer cannot).
 */
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
    if (!isPdf) return cb(new ValidationError([file.fieldname], 'Only PDF files are allowed.'));
    return cb(null, true);
  },
});

/**
 * Express middleware accepting ONE PDF in `fieldName`. Turns multer's own
 * errors into the app's normal error responses (400 for a wrong type, 413 for
 * a file that is too large) instead of a generic 500.
 * @param {string} fieldName
 */
function uploadPdf(fieldName) {
  const handler = pdfUpload.single(fieldName);
  return function uploadPdfMiddleware(req, res, next) {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        const tooBig = new ValidationError([fieldName], `The file must be ${MAX_PDF_MB} MB or smaller.`);
        tooBig.statusCode = 413;
        return next(tooBig);
      }
      if (err instanceof multer.MulterError) {
        return next(new ValidationError([fieldName], 'The file could not be uploaded. Please send a single PDF file.'));
      }
      return next(err);
    });
  };
}

module.exports = { upload, uploadPdf };
