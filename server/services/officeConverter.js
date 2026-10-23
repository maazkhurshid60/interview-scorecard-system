const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Turns a Word file into a PDF with LibreOffice running without a window.
 *
 * LibreOffice can only do one conversion at a time with the same settings
 * folder, so conversions wait in line here (about 3 seconds each). A
 * conversion that hangs is stopped after CONVERT_TIMEOUT_MS. The temporary
 * files are always deleted.
 *
 * Where LibreOffice is: LIBREOFFICE_PATH, else the usual install folders,
 * else "soffice" / "libreoffice" on the PATH.
 */

const CONVERT_TIMEOUT_MS = 60 * 1000;
const PROFILE_DIR = path.join(os.tmpdir(), 'scorecard-libreoffice-profile');

function findLibreOffice() {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    '/usr/bin/soffice',
    '/usr/bin/libreoffice',
    '/usr/local/bin/soffice',
    '/opt/libreoffice/program/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  return found || null;
}

class ConverterUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.code = 'CONVERTER_UNAVAILABLE';
  }
}

let line = Promise.resolve();

function convert(docxBuffer) {
  const exe = findLibreOffice();
  if (!exe) {
    return Promise.reject(new ConverterUnavailableError('LibreOffice is not installed on this server (set LIBREOFFICE_PATH).'));
  }

  const run = async () => {
    const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'offer-letter-'));
    try {
      const input = path.join(work, 'letter.docx');
      await fsp.writeFile(input, docxBuffer);
      const profileUrl = `file:///${PROFILE_DIR.replace(/\\/g, '/').replace(/^\//, '')}`;
      await new Promise((resolve, reject) => {
        execFile(
          exe,
          [`-env:UserInstallation=${profileUrl}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', work, input],
          { timeout: CONVERT_TIMEOUT_MS, windowsHide: true },
          (err, stdout, stderr) => {
            if (err) {
              err.message = `LibreOffice failed: ${err.killed ? 'timed out' : err.message} ${String(stderr || '').slice(0, 300)}`;
              return reject(err);
            }
            return resolve();
          },
        );
      });
      const pdf = await fsp.readFile(path.join(work, 'letter.pdf'));
      if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('LibreOffice did not produce a PDF.');
      return pdf;
    } catch (err) {
      // A crashed or timed-out run can leave the settings folder locked; start clean next time.
      await fsp.rm(PROFILE_DIR, { recursive: true, force: true }).catch(() => {});
      throw err;
    } finally {
      await fsp.rm(work, { recursive: true, force: true }).catch((e) => logger.warn(`[OfficeConverter] Could not clean ${work}: ${e.message}`));
    }
  };

  const result = line.then(run, run);
  line = result.catch(() => {}); // a failed conversion must not block the next one
  return result;
}

/** @returns {boolean} Whether LibreOffice can be found on this server. */
function isConverterAvailable() {
  return findLibreOffice() !== null;
}

module.exports = { convert, isConverterAvailable, ConverterUnavailableError };
