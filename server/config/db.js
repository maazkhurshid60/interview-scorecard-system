import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import { provider } from '../repositories/provider.js';

/** Connects to PostgreSQL (DATABASE_URL), retrying once, when DB_PROVIDER=postgres. */
async function connectPostgres() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set in the environment.');
  }
  const { connect } = await import('../repositories/postgres/client.js');
  try {
    await connect();
    logger.info('[DB] Connected to PostgreSQL.');
  } catch (firstError) {
    logger.warn(`[DB] Initial PostgreSQL connection failed: ${firstError.message}. Retrying once...`);
    try {
      await connect();
      logger.info('[DB] Connected to PostgreSQL (after retry).');
    } catch (secondError) {
      logger.error(`[DB] PostgreSQL connection retry failed: ${secondError.message}`);
      throw secondError;
    }
  }
}

/**
 * Connects to the database the app is set to use (DB_PROVIDER: MongoDB by default, or PostgreSQL). Retries once on
 * failure (per the DATABASE_ERROR handling spec) before giving up — the caller decides whether a failed connection
 * should stop the server from starting.
 *
 * @returns {Promise<typeof mongoose|undefined>}
 * @throws {Error} if both the initial attempt and the single retry fail.
 */
async function connectDB() {
  if (provider === 'postgres') return connectPostgres();

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

export default connectDB;
