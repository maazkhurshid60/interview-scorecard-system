/**
 * Shared error types used across services and surfaced by the global error
 * handler (server/middleware/errorHandler.js). Every external-API service
 * throws one of these instead of a bare Error so the handler can map it to
 * the correct HTTP status and response shape (see INSTRUCTIONS.md's
 * EXCEPTION HANDLING SPECIFICATION).
 */

/** Claude/Google/Slack key is invalid or expired. Never retried. */
class ApiKeyError extends Error {
  constructor(service, message) {
    super(message);
    this.name = 'ApiKeyError';
    this.errorCode = 'API_KEY_ERROR';
    this.service = service;
    this.statusCode = 401;
  }
}

/** Third-party rate limit hit and retries were exhausted. */
class RateLimitError extends Error {
  constructor(service, retryAfter) {
    super(`${service} rate limit exceeded`);
    this.name = 'RateLimitError';
    this.errorCode = 'RATE_LIMIT_ERROR';
    this.service = service;
    this.retryAfter = retryAfter;
    this.statusCode = 429;
  }
}

/** Monthly AI spend cap has been reached; caller must not proceed. */
class SpendCapError extends Error {
  constructor(message) {
    super(message || 'Monthly AI spend cap reached. Raise the cap in Settings.');
    this.name = 'SpendCapError';
    this.errorCode = 'SPEND_CAP_ERROR';
    this.statusCode = 402;
  }
}

/** Generic external-service failure after all retries were exhausted. */
class ServiceError extends Error {
  constructor(service, message) {
    super(`${service} failed: ${message}`);
    this.name = 'ServiceError';
    this.errorCode = 'NETWORK_ERROR';
    this.service = service;
    this.statusCode = 502;
  }
}

/**
 * The transcript provider hasn't produced the artifact yet. NOT a failure —
 * the caller should keep polling (retryAfter is in seconds).
 */
class TranscriptNotReadyError extends Error {
  constructor(retryAfter = 120) {
    super('Transcript is not ready yet.');
    this.name = 'TranscriptNotReadyError';
    this.errorCode = 'TRANSCRIPT_NOT_READY';
    this.retryAfter = retryAfter;
    this.statusCode = 202;
  }
}

/** Bad input from the client — 400, with per-field messages. */
class ValidationError extends Error {
  constructor(fields, message) {
    super(message || 'Validation failed.');
    this.name = 'ValidationError';
    this.errorCode = 'VALIDATION_ERROR';
    this.fields = fields;
    this.statusCode = 400;
  }
}

module.exports = {
  ApiKeyError, RateLimitError, SpendCapError, ServiceError, TranscriptNotReadyError, ValidationError,
};