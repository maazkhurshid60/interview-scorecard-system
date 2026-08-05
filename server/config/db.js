const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * Connects to MongoDB using MONGODB_URI. Retries once on failure (per the
 * DATABASE_ERROR handling spec) before giving up — the caller decides
 * whether a failed connection should stop the server from starting.
 *
 * @returns {Promise<typeof mongoose>}
 * @throws {Error} if both the initial attempt and the single retry fail.
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set in the environment.');
  }

  mongoose.connection.on('disconnected', () => {
    logger.warn('[DB] MongoDB disconnected.');
  });
  mongoose.connection.on('error', (err) => {
    logger.error(`[DB] MongoDB connection error: ${err.message}`);
  });

  try {
    await mongoose.connect(uri);
    logger.info(`[DB] Connected to MongoDB at ${uri}`);
    return mongoose;
  } catch (firstError) {
    logger.warn(`[DB] Initial connection failed: ${firstError.message}. Retrying once...`);
    try {
      await mongoose.connect(uri);
      logger.info(`[DB] Connected to MongoDB at ${uri} (after retry)`);
      return mongoose;
    } catch (secondError) {
      logger.error(`[DB] Connection retry failed: ${secondError.message}`);
      throw secondError;
    }
  }
}

module.exports = connectDB;
