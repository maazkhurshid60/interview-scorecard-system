/** Largest PDF accepted for uploads (matches the server's limit, MAX_UPLOAD_PDF_MB, default 5). */
export const MAX_PDF_MB = 5;

/**
 * Quick browser-side check of a chosen file before it is uploaded: it saves the
 * user a round trip. The server repeats these checks (and more), so this is a
 * convenience, never the only protection.
 * @param {File|null|undefined} file
 * @param {string} [label] - Name used in the message, e.g. "résumé".
 * @returns {string|null} A message to show the user, or null when the file is fine.
 */
export function validatePdfFile(file, label = 'file') {
  if (!file) return null;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return `The ${label} must be a PDF file.`;
  if (file.size > MAX_PDF_MB * 1024 * 1024) return `The ${label} must be ${MAX_PDF_MB} MB or smaller.`;
  if (file.size === 0) return `The ${label} is empty.`;
  return null;
}
