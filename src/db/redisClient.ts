import { createClient, type RedisClientType } from "redis";

/**
 * Redis client singleton for managing connections to the Redis server.
 * Uses REDIS_URL environment variable for connection configuration.
 */

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const REDIS_PORT = process.env.REDIS_PORT;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

let redisReady = false;

export const client: RedisClientType = createClient({
  username: "default",
  password: REDIS_PASSWORD,
  socket: {
    host: REDIS_URL,
    port: parseInt(REDIS_PORT!) || 19777,
    // tls: true,
    // rejectUnauthorized: true,
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error("Redis: Max reconnection attempts reached");
        return new Error("Max reconnection attempts reached");
      }
      // Exponential backoff: 100ms, 200ms, 400ms, etc.
      const delay = Math.min(retries * 100, 3000);
      console.log(`Redis: Reconnecting in ${delay}ms... (attempt ${retries})`);
      return delay;
    },
  },
});

/**
 * Get or create the Redis client instance.
 * Returns a singleton Redis connection.
 */

client.on("error", (err) => console.log("Redis Client Error", err));
client.on("connect", () => {
  console.log("Redis: Connected");
});

client.on("reconnecting", () => {
  console.log("Redis: Reconnecting...");
});

client.on("ready", () => {
  redisReady = true;
  console.log("Redis: Ready");
});

export async function initRedis() {
  if (!client.isOpen) {
    await client.connect();
  }
}

/**
 * Close the Redis connection gracefully.
 */
export async function closeRedisConnection(): Promise<void> {
  if (client) {
    redisReady = false;
    await client.quit();
    console.log("[Redis] Connection closed gracefully");
  }
}

/**
 * Get the Redis client instance.
 */
export function getRedisClient(): RedisClientType {
  return client;
}

/**
 * Check if Redis connection is ready.
 */
export function isRedisReady(): boolean {
  return redisReady && client.isOpen;
}
