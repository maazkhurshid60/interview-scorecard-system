const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

/**
 * Minimal console + file logger. Levels: info, warn, error.
 * Every entry is timestamped and written both to stdout/stderr and to a
 * daily rotating file under server/logs/. Never throws — a logging failure
 * must never crash the request that triggered it.
 */

const LOG_DIR = path.join(__dirname, '..', 'logs');

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch (err) {
    // If we can't create the log dir, fall back to console-only logging.
    console.error(`[Logger] Could not create log directory: ${err.message}`);
  }
}

function writeToFile(line) {
  try {
    ensureLogDir();
    const fileName = `${dayjs().format('YYYY-MM-DD')}.log`;
    fs.appendFileSync(path.join(LOG_DIR, fileName), line + '\n');
  } catch (err) {
    console.error(`[Logger] Failed to write log file: ${err.message}`);
  }
}

/**
 * Formats and emits a single log line.
 * @param {'INFO'|'WARN'|'ERROR'} level
 * @param {string} message
 */
function log(level, message) {
  const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss.SSS');
  const line = `[${timestamp}] [${level}] ${message}`;

  if (level === 'ERROR') {
    console.error(line);
  } else if (level === 'WARN') {
    console.warn(line);
  } else {
    console.log(line);
  }

  writeToFile(line);
}

module.exports = {
  info: (message) => log('INFO', message),
  warn: (message) => log('WARN', message),
  error: (message) => log('ERROR', message),
};
