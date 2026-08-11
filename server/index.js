require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const connectDB = require('./config/db');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { startRetentionSchedule } = require('./services/retentionService');

const authRoutes = require('./routes/auth');
const requisitionRoutes = require('./routes/requisitions');
const pipelineRoutes = require('./routes/pipelines');
const candidateRoutes = require('./routes/candidates');
const interviewRoutes = require('./routes/interviews');
const scoringRoutes = require('./routes/scoring');
const settingsRoutes = require('./routes/settings');
const auditRoutes = require('./routes/audit');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());

/**
 * Only real frontend origins may call this API — never a wildcard.
 *
 * CLIENT_URL accepts a COMMA-SEPARATED list so a Vercel preview deployment
 * (which gets its own generated origin, distinct from production) can be
 * allowed alongside the production URL without opening the API to everyone.
 * The first entry is still the canonical one used for Slack notification links.
 */
const ALLOWED_ORIGINS = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, '')) // tolerate a trailing slash
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // A missing Origin header means same-origin or a non-browser caller (curl,
    // Render's health check) — those aren't subject to CORS at all.
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin.replace(/\/+$/, ''))) return callback(null, true);
    logger.warn(`[CORS] Blocked origin: ${origin} (allowed: ${ALLOWED_ORIGINS.join(', ')})`);
    return callback(null, false); // clean CORS rejection, not a 500
  },
}));
app.use(express.json({ limit: '10mb' })); // 10mb: JD text + transcript uploads via JSON paths
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev', {
  stream: { write: (message) => logger.info(`[HTTP] ${message.trim()}`) },
}));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/requisitions', requisitionRoutes);
app.use('/api/pipelines', pipelineRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/scoring', scoringRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/users', userRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

/**
 * Connects to MongoDB then starts listening. Exits the process if the DB
 * connection cannot be established — the app is useless without it.
 */
async function start() {
  try {
    await connectDB();
    startRetentionSchedule();
    app.listen(PORT, () => {
      logger.info(`[Server] Listening on port ${PORT} (env=${process.env.NODE_ENV || 'development'})`);
    });
  } catch (err) {
    logger.error(`[Server] Failed to start: ${err.message}`);
    process.exit(1);
  }
}

start();

module.exports = app;
