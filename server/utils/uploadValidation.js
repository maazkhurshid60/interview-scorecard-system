const { ValidationError } = require('./errors');

/** Largest PDF the app accepts (résumés, interview files, offer letters). Override with MAX_UPLOAD_PDF_MB. */
const MAX_PDF_MB = Number(process.env.MAX_UPLOAD_PDF_MB) > 0 ? Number(process.env.MAX_UPLOAD_PDF_MB) : 5;
const MAX_PDF_BYTES = MAX_PDF_MB * 1024 * 1024;

/** Every real PDF starts with these bytes, whatever its file name or declared type says. */
const PDF_MAGIC = '%PDF-';

function isPdfMimeOrName(file) {
  return file?.mimetype === 'application/pdf' || /\.pdf$/i.test(file?.originalname || '');
}

/**
 * Server-side check that an uploaded file really is an acceptable PDF. Never
 * trust the browser's checks alone: the declared type and the file name can
 * both be faked, so the file's own first bytes are checked too.
 *
 * @param {{buffer?: Buffer, size?: number, mimetype?: string, originalname?: string}|undefined} file - multer file.
 * @param {object} [options]
 * @param {string} [options.field='file'] - Field name reported in the error.
 * @param {string} [options.label='file'] - Human name used in messages ("résumé", "offer letter").
 * @param {boolean} [options.required=true] - When false, a missing file is allowed.
 * @returns {{name: string, size: number, mimeType: string}|null} Metadata to store with the file, or null if none given.
 * @throws {ValidationError} (HTTP 400) when the file is missing, too large, or not a PDF.
 */
function assertPdfUpload(file, { field = 'file', label = 'file', required = true } = {}) {
  if (!file) {
    if (required) throw new ValidationError([field], `Please upload the ${label} as a PDF.`);
    return null;
  }
  if (!isPdfMimeOrName(file)) {
    throw new ValidationError([field], `The ${label} must be a PDF file.`);
  }
  const size = file.size ?? file.buffer?.length ?? 0;
  if (size <= 0) {
    throw new ValidationError([field], `The ${label} is empty.`);
  }
  if (size > MAX_PDF_BYTES) {
    throw new ValidationError([field], `The ${label} must be ${MAX_PDF_MB} MB or smaller.`);
  }
  const head = file.buffer ? file.buffer.subarray(0, PDF_MAGIC.length).toString('latin1') : PDF_MAGIC;
  if (head !== PDF_MAGIC) {
    throw new ValidationError([field], `The ${label} is not a valid PDF file.`);
  }
  return { name: file.originalname, size, mimeType: 'application/pdf' };
}

module.exports = { assertPdfUpload, MAX_PDF_BYTES, MAX_PDF_MB, PDF_MAGIC };
