/**
 * Coco Bridge - Main Entry Point
 *
 * Initializes and starts the Coco Bridge bot for cross-chain bridging
 * and token swaps on Towns Protocol.
 *
 * @module index
 */

import { Hono } from "hono";
import {
  type Bot,
  type CocoBridgeBotOptions,
  createCocoBridgeBot,
} from "./bot";
import { BOT_COMMANDS } from "./commands";
import {
  closeRedisConnection,
  getRedisClient,
  initRedis,
  isRedisReady,
} from "./db/redisClient";

// ============================================================================
// Environment Configuration
// ============================================================================

interface EnvConfig {
  botPrivateKey: string;
  jwtSecret: string;
  redisUrl: string;
  port: number;
  baseRpcUrl?: string;
}

/**
 * Load and validate environment variables.
 * Throws if required variables are missing.
 */
function loadEnvConfig(): EnvConfig {
  const botPrivateKey = process.env.APP_PRIVATE_DATA;
  const jwtSecret = process.env.JWT_SECRET;
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const port = parseInt(process.env.PORT || "3000", 10);
  const baseRpcUrl = process.env.BASE_RPC_URL;

  const missing: string[] = [];

  if (!botPrivateKey) {
    missing.push("BOT_PRIVATE_KEY");
  }
  if (!jwtSecret) {
    missing.push("JWT_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  return {
    botPrivateKey: botPrivateKey!,
    jwtSecret: jwtSecret!,
    redisUrl,
    port,
    baseRpcUrl,
  };
}

// ============================================================================
// Logging
// ============================================================================

type LogLevel = "info" | "warn" | "error";

function log(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
): void {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, level, message, ...data };
  const logString = JSON.stringify(logEntry);

  switch (level) {
    case "info":
      console.info(logString);
      break;
    case "warn":
      console.warn(logString);
      break;
    case "error":
      console.error(logString);
      break;
  }
}

// ============================================================================
// Bot Instance (for external access)
// ============================================================================

const botInstance: Bot<typeof BOT_COMMANDS> | null = null;

/**
 * Get the current bot instance.
 * Returns null if the bot hasn't been started yet.
 */
export function getBot(): Bot<typeof BOT_COMMANDS> | null {
  return botInstance;
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

let isShuttingDown = false;

/**
 * Handle graceful shutdown of the bot and connections.
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    log("warn", "Shutdown already in progress");
    return;
  }

  isShuttingDown = true;
  log("info", `Received ${signal}, starting graceful shutdown`);

  try {
    // Close Redis connection
    log("info", "Closing Redis connection");
    await closeRedisConnection();

    log("info", "Shutdown completed successfully");
    process.exit(0);
  } catch (error) {
    log("error", "Error during shutdown", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

/**
 * Register shutdown handlers for graceful termination.
 */
function registerShutdownHandlers(): void {
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("uncaughtException", (error) => {
    log("error", "Uncaught exception", {
      error: error.message,
      stack: error.stack,
    });
    shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    log("error", "Unhandled rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    shutdown("unhandledRejection");
  });
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize Redis connection and verify it's ready.
 */
async function initializeRedis(): Promise<void> {
  log("info", "Initializing Redis connection");

  await initRedis();

  // Wait for connection with timeout
  const timeout = 10000; // 10 seconds
  const startTime = Date.now();

  while (!isRedisReady() && Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!isRedisReady()) {
    throw new Error("Redis connection timeout");
  }

  // Verify connection with a ping
  const client = getRedisClient();
  await client.ping();
  log("info", "Redis connection established");
}

/**
 * Initialize and start the Coco Bridge bot.
 */
async function startBot(config: EnvConfig) {
  log("info", "Creating Coco Bridge bot");

  const options: CocoBridgeBotOptions = {
    appPrivateKey: config.botPrivateKey,
    jwtSecret: config.jwtSecret,
    baseRpcUrl: config.baseRpcUrl,
  };

  const bot = await createCocoBridgeBot(options);

  log("info", "Starting bot server", { port: config.port });

  // Create Hono app and mount bot handlers
  const app = bot.start();
  app.get("/", (c) => c.text("Coco is up and running"));
  app.get("/.well-known/agent-metadata.json", async (c) => {
    return c.json(await bot.getIdentityMetadata());
  });

  log("info", "Coco Bridge bot started successfully", {
    port: config.port,
    commands: BOT_COMMANDS.map((c) => `/${c.name}`),
  });

  return app;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main function to initialize and start the Coco Bridge bot.
 */
async function main(): Promise<void> {
  log("info", "Starting Coco Bridge");

  try {
    // Load environment configuration
    const config = loadEnvConfig();
    log("info", "Environment configuration loaded", {
      port: config.port,
      redisUrl: config.redisUrl.replace(/\/\/.*@/, "//*****@"), // Mask credentials
      hasBaseRpcUrl: !!config.baseRpcUrl,
    });

    // Register shutdown handlers
    registerShutdownHandlers();

    // Initialize Redis
    await initializeRedis();

    // Start the bot

    await startBot(config);

    log("info", "Coco Bridge is running");
  } catch (error) {
    log("error", "Failed to start Coco Bridge", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Run main function
main();

// ============================================================================
// Exports
// ============================================================================

// Re-export from modules for external access
export * from "./ai";
export * from "./bot";
export {
  closeRedisConnection,
  getRedisClient,
  isRedisReady,
} from "./db/redisClient";
