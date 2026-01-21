import Redis from 'ioredis';

/**
 * Redis client singleton for managing connections to the Redis server.
 * Uses REDIS_URL environment variable for connection configuration.
 */

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redisClient: Redis | null = null;

/**
 * Get or create the Redis client instance.
 * Returns a singleton Redis connection.
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError(err) {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      },
    });

    redisClient.on('connect', () => {
      console.log('[Redis] Connected to Redis server');
    });

    redisClient.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    redisClient.on('close', () => {
      console.log('[Redis] Connection closed');
    });
  }

  return redisClient;
}

/**
 * Close the Redis connection gracefully.
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('[Redis] Connection closed gracefully');
  }
}

/**
 * Check if Redis connection is ready.
 */
export function isRedisReady(): boolean {
  return redisClient?.status === 'ready';
}

export { Redis };
