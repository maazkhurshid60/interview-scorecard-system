import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import { describeProviders, usesMongo, usesPostgres } from '../repositories/provider.js';

/** The address without its password, for the log. */
function withoutPassword(address) {
  try {
    const url = new URL(address);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '(address hidden)';
  }
}

/** Connects to PostgreSQL (DATABASE_URL), retrying once. */
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

/** Connects to MongoDB using MONGODB_URI, retrying once. */
async function connectMongo() {
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
    logger.info(`[DB] Connected to MongoDB at ${withoutPassword(uri)}`);
  } catch (firstError) {
    logger.warn(`[DB] Initial connection failed: ${firstError.message}. Retrying once...`);
    try {
      await mongoose.connect(uri);
      logger.info(`[DB] Connected to MongoDB at ${withoutPassword(uri)} (after retry)`);
    } catch (secondError) {
      logger.error(`[DB] Connection retry failed: ${secondError.message}`);
      throw secondError;
    }
  }
}

/**
 * Connects to the database the repositories are set to use (see repositories/provider.js): MongoDB by default, PostgreSQL
 * when chosen. The connection is retried once on failure (per the DATABASE_ERROR handling spec) before giving up — the
 * caller decides whether a failed connection should stop the server from starting.
 *
 * @throws {Error} if both the initial attempt and the single retry fail.
 */
async function connectDB() {
  if (usesPostgres) await connectPostgres();
  if (usesMongo) await connectMongo();
  logger.info(`[DB] ${describeProviders()}`);
}

export default connectDB;
