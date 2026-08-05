const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');

const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.pdf', '.docx'];

/**
 * Extracts plain text from an uploaded artifact file (résumé / task
 * deliverable) so it can be scored the same way a transcript is — via
 * interview.transcriptText. Supports .txt/.md (read directly), .pdf
 * (pdf-parse), and .docx (mammoth).
 * @param {string} absoluteFilePath
 * @returns {Promise<string>}
 * @throws {Error} on an unsupported extension or a corrupt/unreadable file.
 */
async function extractArtifactText(absoluteFilePath) {
  const ext = path.extname(absoluteFilePath).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return fs.readFileSync(absoluteFilePath, 'utf8');
  }
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: fs.readFileSync(absoluteFilePath) });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: absoluteFilePath });
    return result.value;
  }
  throw new Error(`Unsupported artifact file type "${ext}" — only .txt, .md, .pdf, .docx are supported.`);
}

module.exports = { extractArtifactText, SUPPORTED_EXTENSIONS };
