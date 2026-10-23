require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const connectDB = require('./config/db');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { startRetentionSchedule } = require('./services/retentionService');
const { startApplicationProcessor } = require('./services/applicationProcessor');
const { startEmailQueue } = require('./services/emailQueue');
const { getAllowedOrigins, normalizeOrigin } = require('./utils/allowedOrigins');
const { createOriginGuard } = require('./middleware/originGuard');
const { getCaptchaConfig } = require('./services/captchaService');

const authRoutes = require('./routes/auth');
const requisitionRoutes = require('./routes/requisitions');
const pipelineRoutes = require('./routes/pipelines');
const candidateRoutes = require('./routes/candidates');
const interviewRoutes = require('./routes/interviews');
const scoringRoutes = require('./routes/scoring');
const settingsRoutes = require('./routes/settings');
const auditRoutes = require('./routes/audit');
const userRoutes = require('./routes/users');
const departmentRoutes = require('./routes/departments');
const fileRoutes = require('./routes/files');

const app = express();
const PORT = process.env.PORT || 5000;

/**
 * Behind a hosting proxy (Render, nginx) every request appears to come from the
 * proxy unless Express is told to trust it — which would make per-visitor
 * rate limits (and req.ip generally) meaningless. TRUST_PROXY_HOPS = number of
 * proxies in front of the app; defaults to 1 in production, off locally so a
 * client can't spoof its address with an X-Forwarded-For header.
 */
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? (process.env.NODE_ENV === 'production' ? 1 : 0));
if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);

app.use(helmet());

// Compress responses (gzip) when the browser accepts it. JSON compresses to a fraction of its size, so big lists
// download much faster. Only responses over 1 KB are compressed, so small ones cost nothing extra.
app.use(compression({ threshold: 1024 }));

/**
 * Only real frontend origins may call this API — never a wildcard.
 *
 * ALLOWED_ORIGINS is a COMMA-SEPARATED list of website addresses (for example
 * "https://app.ownerstalent.com,https://staging-app.example.com"). If it is not
 * set, CLIENT_URL is used instead, so older setups keep working. See
 * utils/allowedOrigins.js for the exact rules.
 * CLIENT_URL itself is the website's main address, used to build links in emails
 * and Slack messages.
 */
const { origins: ALLOWED_ORIGINS, ignored: IGNORED_ORIGINS, source: ORIGINS_SOURCE } = getAllowedOrigins();
logger.info(`[CORS] Allowed origins (from ${ORIGINS_SOURCE}): ${ALLOWED_ORIGINS.join(', ') || 'NONE'}`);
if (IGNORED_ORIGINS.length > 0) {
  logger.warn(`[CORS] Ignored invalid origin entries (use scheme + host only, no wildcard or path): ${IGNORED_ORIGINS.join(', ')}`);
}
if (ALLOWED_ORIGINS.length === 0) {
  logger.error('[CORS] No valid allowed origins configured: browsers will be blocked. Check ALLOWED_ORIGINS.');
}

app.use(cors({
  origin(origin, callback) {
    // A missing Origin header means same-origin or a non-browser caller (curl,
    // a load balancer's health check) — those aren't subject to CORS at all.
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(normalizeOrigin(origin))) return callback(null, true);
    logger.warn(`[CORS] Blocked origin: ${origin} (allowed: ${ALLOWED_ORIGINS.join(', ')})`);
    return callback(null, false); // clean CORS rejection, not a 500
  },
  credentials: true, // the website sends its login cookies to this API
}));
// Login now lives in cookies, so refuse data-changing requests that come from a
// website we have not allowed (CSRF protection). See middleware/originGuard.js.
app.use('/api', createOriginGuard(ALLOWED_ORIGINS));
app.use(cookieParser());
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
app.use('/api/departments', departmentRoutes);
app.use('/api/files', fileRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

/**
 * Connects to MongoDB then starts listening. Exits the process if the DB
 * connection cannot be established — the app is useless without it.
 */
async function start() {
  try {
    await connectDB();
    if (process.env.NODE_ENV === 'production' && !getCaptchaConfig().enabled) {
      logger.warn('[Security] Cloudflare Turnstile is NOT configured (TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY). Public application forms have no bot protection and can be abused to consume AI spend and storage.');
    }
    startRetentionSchedule();
    startApplicationProcessor(); // finishes AI screening of public applications in the background
    startEmailQueue();           // sends queued emails in the background, with retries
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
