import IORedis from 'ioredis';
import logger from '../utils/logger.js';

/**
 * The Redis connection every BullMQ queue and worker uses (see services/emailQueue.js and
 * services/applicationProcessor.js). REDIS_URL is the address, for example redis://localhost:6379,
 * or rediss://... (with the extra "s") for a hosted Redis that requires a secure connection.
 *
 * The Redis server must be allowed to keep its data (persistence on, and no eviction of keys): the waiting
 * jobs live there. Without that, a Redis restart would lose emails that were still waiting to be sent.
 */

const redisConfigured = () => Boolean(process.env.REDIS_URL);

/** All queue keys sit under this prefix, so two apps (or a test run) can share one Redis without touching each other. */
const queuePrefix = () => process.env.BULLMQ_PREFIX || 'ownerstalent';

/**
 * A new connection for one Queue or one Worker. A worker holds its connection open while it waits for jobs,
 * so queues and workers each get their own. BullMQ requires maxRetriesPerRequest to be null.
 *
 * A queue's connection (forQueue) fails at once when Redis is down instead of holding the request until Redis is
 * back, as BullMQ advises: otherwise a page that sends an email (forgot password, offer letter) would hang while
 * Redis is unreachable. A worker's connection does wait, so it carries on by itself when Redis returns.
 */
function createRedisConnection({ forQueue = false } = {}) {
  const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, ...(forQueue ? { enableOfflineQueue: false } : {}) });
  // Without a listener an unreachable Redis would crash the process; it reconnects by itself.
  connection.on('error', (err) => logger.warn(`[Redis] ${err.message}`));
  return connection;
}

/**
 * Closes a connection made by createRedisConnection(). BullMQ does not close a connection it was handed, and an
 * open connection keeps a script or a test from ever exiting.
 */
async function closeRedisConnection(connection) {
  if (!connection) return;
  try {
    await connection.quit();
  } catch (err) {
    connection.disconnect(); // already gone, or Redis is down: just drop it
  }
}

/**
 * Waits until the queue's Redis connection is ready, but only a few seconds. BullMQ otherwise waits for ever while Redis
 * is down, which would leave the page that asked for an email hanging. Nothing is sent to Redis before this passes, so a
 * request that was told "not queued" can never turn into a queued job later.
 * @param {import('bullmq').Queue} queue
 * @param {number} [ms]
 * @throws {Error} when Redis is not ready in time.
 */
async function whenReady(queue, ms = 3000) {
  let timer;
  try {
    await Promise.race([
      queue.waitUntilReady(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Redis is not reachable.')), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** BullMQ rejects job ids that contain ":" or are plain numbers, so a readable key such as "a:123" is made safe. */
const safeJobId = (key) => `k-${String(key).replace(/:/g, '-')}`;

export { redisConfigured, queuePrefix, createRedisConnection, closeRedisConnection, safeJobId, whenReady };
