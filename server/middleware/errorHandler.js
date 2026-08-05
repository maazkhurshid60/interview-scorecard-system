const crypto = require('crypto');
const logger = require('../utils/logger');
const {
  ApiKeyError, RateLimitError, SpendCapError, ServiceError, TranscriptNotReadyError, ValidationError,
} = require('../utils/errors');

/**
 * Global error-handling middleware. Every controller action is wrapped in
 * asyncHandler (utils/helpers.js), so any thrown/rejected error lands here.
 * Maps each known error type to the exact response shape in INSTRUCTIONS.md's
 * EXCEPTION HANDLING SPECIFICATION; anything unrecognized becomes a generic
 * 500 with no internal detail leaked to the client.
 *
 * Every response includes: timestamp, a requestId (for log correlation), a
 * human-readable message, and (server-side only, via the log line) the
 * technical stack trace.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const requestId = crypto.randomUUID();
  const base = { timestamp: new Date().toISOString(), requestId };

  logger.error(`[ErrorHandler] requestId=${requestId} ${req.method} ${req.originalUrl} -> ${err.name}: ${err.message}\n${err.stack}`);

  // Custom typed errors — checked via instanceof (NOT err.name) because
  // Mongoose's own built-in ValidationError also has .name === 'ValidationError';
  // a string match would wrongly swallow real Mongoose errors into this branch.
  if (err instanceof ApiKeyError) {
    return res.status(err.statusCode).json({
      ...base, error: err.errorCode, service: err.service,
      message: `${err.service} connection failed or expired. Reconnect in Settings.`,
    });
  }
  if (err instanceof RateLimitError) {
    return res.status(err.statusCode).json({
      ...base, error: err.errorCode, service: err.service, retryAfter: err.retryAfter,
      message: `${err.service} rate limit hit. Please try again shortly.`,
    });
  }
  if (err instanceof SpendCapError) {
    return res.status(err.statusCode).json({ ...base, error: err.errorCode, message: err.message });
  }
  if (err instanceof TranscriptNotReadyError) {
    return res.status(err.statusCode).json({ ...base, error: err.errorCode, retryAfter: err.retryAfter, message: err.message });
  }
  if (err instanceof ValidationError) {
    return res.status(err.statusCode).json({ ...base, error: err.errorCode, fields: err.fields, message: err.message });
  }
  if (err instanceof ServiceError) {
    return res.status(err.statusCode).json({ ...base, error: err.errorCode, service: err.service, message: 'Could not reach an external service. Please try again.' });
  }

  // Mongoose's own validation error — bad input the schema itself rejected.
  if (err.name === 'ValidationError') {
    const fields = err.errors ? Object.keys(err.errors) : [];
    return res.status(400).json({ ...base, error: 'VALIDATION_ERROR', fields, message: err.message });
  }

  // Bad ObjectId / cast failure — also client input error.
  if (err.name === 'CastError') {
    return res.status(400).json({ ...base, error: 'VALIDATION_ERROR', fields: [err.path], message: `Invalid value for "${err.path}".` });
  }

  // Duplicate key (unique index violation).
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return res.status(400).json({ ...base, error: 'VALIDATION_ERROR', fields: [field], message: `"${field}" must be unique — this value is already in use.` });
  }

  // MongoDB connection/query failures.
  if (err.name === 'MongoServerError' || err.name === 'MongooseServerSelectionError' || err.name === 'MongoNetworkError') {
    return res.status(500).json({ ...base, error: 'DATABASE_ERROR', message: 'A database error occurred. Scores may not have been saved — please retry.' });
  }

  // Anything else: generic 500, no internal detail leaked.
  return res.status(err.statusCode || 500).json({
    ...base,
    error: err.errorCode || 'INTERNAL_ERROR',
    message: err.statusCode && err.statusCode < 500 ? err.message : 'Something went wrong. Please try again.',
  });
}

/** 404 handler for unmatched routes. */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `No route for ${req.method} ${req.originalUrl}`,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { errorHandler, notFoundHandler };
