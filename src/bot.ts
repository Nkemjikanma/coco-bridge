/**
 * Coco Bridge Bot
 * Towns Protocol bot with event handlers for messages, slash commands, and interaction responses.
 *
 * @module bot
 */

import {
  makeTownsBot,
  type Bot,
  type BotCommand,
  type BotHandler,
  type BasePayload,
  type DecryptedInteractionResponse,
  type FlattenedInteractionRequest,
  type FlattenedFormComponent,
} from '@towns-protocol/bot';
import type { Address } from 'viem';
import { randomUUID } from 'crypto';

import { CocoAgent, type AgentRunResult } from './ai/cocoAgent';
import { getSession } from './ai/sessions';
import { BOT_COMMANDS } from './commands';

/** Session ID format for consistent session management */
function createSessionId(userId: string, channelId: string): string {
  return `coco-bridge:${userId}:${channelId}`;
}

// ============================================================================
// Logging Utilities
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  userId?: string;
  channelId?: string;
  sessionId?: string;
  eventId?: string;
  command?: string;
  error?: unknown;
  [key: string]: unknown;
}

/**
 * Structured logger for bot events
 */
function log(level: LogLevel, message: string, context?: LogContext): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...context,
  };

  // Format error objects for logging
  if (context?.error instanceof Error) {
    logEntry.error = {
      name: context.error.name,
      message: context.error.message,
      stack: context.error.stack,
    };
  }

  const logString = JSON.stringify(logEntry);

  switch (level) {
    case 'debug':
      console.debug(logString);
      break;
    case 'info':
      console.info(logString);
      break;
    case 'warn':
      console.warn(logString);
      break;
    case 'error':
      console.error(logString);
      break;
  }
}

// ============================================================================
// Response Formatting
// ============================================================================

/**
 * Format agent response for display in Towns chat
 */
function formatAgentResponse(result: AgentRunResult): string {
  if (!result.success) {
    return result.error || 'Technical issue. Please try again.';
  }

  if (result.responseText) {
    return result.responseText;
  }

  if (result.awaitingAction) {
    // Response will be sent via interaction request
    return '';
  }

  return 'Done.';
}

/**
 * Format error message for user display
 */
function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Don't expose internal error details to users
    if (error.message.includes('Session')) {
      return 'Session issue. Please try again.';
    }
    if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      return 'Request timed out. Please try again.';
    }
  }
  return 'Technical issue. Please try again.';
}

// ============================================================================
// Interaction Request Builders
// ============================================================================

/**
 * Build a confirmation form interaction request
 */
function buildConfirmationRequest(
  message: string,
  title: string = 'Confirmation Required'
): FlattenedInteractionRequest {
  const components: FlattenedFormComponent[] = [
    {
      id: 'confirm',
      type: 'button',
      label: 'Confirm',
    },
    {
      id: 'cancel',
      type: 'button',
      label: 'Cancel',
    },
  ];

  return {
    type: 'form',
    id: randomUUID(),
    title,
    subtitle: message,
    components,
  };
}

/**
 * Build a transaction interaction request
 */
function buildTransactionRequest(
  transaction: {
    to: string;
    data: string;
    value: string;
    chainId: number;
  },
  description: string,
  title: string = 'Transaction Required'
): FlattenedInteractionRequest {
  return {
    type: 'transaction',
    id: randomUUID(),
    title,
    subtitle: description,
    tx: {
      to: transaction.to as Address,
      data: transaction.data as `0x${string}`,
      value: transaction.value,
      chainId: transaction.chainId.toString(),
    },
  };
}

// ============================================================================
// Pending Action Handlers
// ============================================================================

/**
 * Send interaction request based on pending action type
 */
async function sendPendingActionRequest(
  handler: BotHandler,
  channelId: string,
  pendingAction: {
    type: 'confirmation' | 'signature' | 'input';
    message: string;
    data: Record<string, unknown>;
  },
  threadId?: string
): Promise<void> {
  if (pendingAction.type === 'confirmation') {
    const request = buildConfirmationRequest(pendingAction.message);
    await handler.sendInteractionRequest(channelId, request, { threadId });
  } else if (pendingAction.type === 'signature') {
    const txData = pendingAction.data as {
      transaction?: {
        to: string;
        data: string;
        value: string;
        chainId: number;
      };
    };

    if (txData.transaction) {
      const request = buildTransactionRequest(txData.transaction, pendingAction.message);
      await handler.sendInteractionRequest(channelId, request, { threadId });
    }
  }
}

// ============================================================================
// Bot Event Handlers
// ============================================================================

/**
 * Handle incoming messages
 * Triggers the agent when the bot is mentioned
 */
async function handleMessage(
  handler: BotHandler,
  event: BasePayload & {
    message: string;
    replyId: string | undefined;
    threadId: string | undefined;
    mentions: { userId?: string; displayName?: string }[];
    isMentioned: boolean;
  },
  agent: CocoAgent
): Promise<void> {
  const { userId, channelId, eventId, message, isMentioned, threadId } = event;

  // Only respond when mentioned
  if (!isMentioned) {
    return;
  }

  log('info', 'Message received with mention', {
    userId,
    channelId,
    eventId,
    messageLength: message.length,
  });

  const sessionId = createSessionId(userId, channelId);

  try {
    // Run the agent with the user's message
    const result = await agent.run({
      message,
      sessionId,
      user: { walletAddress: userId },
      threadId: threadId || channelId,
    });

    log('info', 'Agent completed', {
      userId,
      channelId,
      sessionId,
      success: result.success,
      awaitingAction: result.awaitingAction,
    });

    // Send response to the channel
    const responseText = formatAgentResponse(result);
    if (responseText) {
      await handler.sendMessage(channelId, responseText, {
        threadId,
        replyId: eventId,
      });
    }

    // If awaiting action, send interaction request
    if (result.awaitingAction && result.session.pendingAction) {
      await sendPendingActionRequest(
        handler,
        channelId,
        result.session.pendingAction,
        threadId
      );
    }
  } catch (error) {
    log('error', 'Error handling message', {
      userId,
      channelId,
      sessionId,
      error,
    });

    // Send error message to user
    await handler.sendMessage(channelId, formatErrorMessage(error), {
      threadId,
      replyId: eventId,
    });
  }
}

/**
 * Handle slash commands (/bridge, /balance)
 */
async function handleSlashCommand(
  handler: BotHandler,
  event: BasePayload & {
    command: (typeof BOT_COMMANDS)[number]['name'];
    args: string[];
    mentions: { userId?: string; displayName?: string }[];
    replyId: string | undefined;
    threadId: string | undefined;
  },
  agent: CocoAgent
): Promise<void> {
  const { userId, channelId, eventId, command, args, threadId } = event;

  log('info', 'Slash command received', {
    userId,
    channelId,
    eventId,
    command,
    argsCount: args.length,
  });

  const sessionId = createSessionId(userId, channelId);

  // Build the natural language message from the command
  let message: string;

  switch (command) {
    case 'bridge':
      // Convert command args to natural language
      // e.g., /bridge 0.1 ETH from Base to Ethereum
      if (args.length === 0) {
        message = 'Help me bridge tokens. What are the options?';
      } else {
        message = `Bridge ${args.join(' ')}`;
      }
      break;

    case 'balance':
      // Convert to balance check request
      if (args.length === 0) {
        message = 'Check my balances across all chains';
      } else {
        message = `Check my ${args.join(' ')} balance`;
      }
      break;

    case 'help':
      // Send help message directly without involving the agent
      await handler.sendMessage(
        channelId,
        `**Coco Bridge Commands**\n\n` +
          `\`/bridge\` - Bridge tokens between chains\n` +
          `  Usage: \`/bridge <amount> <token> from <chain> to <chain>\`\n` +
          `  Example: \`/bridge 0.1 ETH from Base to Ethereum\`\n\n` +
          `\`/balance\` - Check your balances across chains\n` +
          `  Usage: \`/balance [token] [chain]\`\n` +
          `  Example: \`/balance ETH\` or \`/balance\`\n\n` +
          `\`/help\` - Show this help message\n\n` +
          `**Supported Chains:** Ethereum, Base, Optimism, Arbitrum, Polygon`,
        { threadId, replyId: eventId }
      );
      return;

    default:
      log('warn', 'Unknown command', { command, userId, channelId });
      await handler.sendMessage(
        channelId,
        `Unknown command: /${command}. Available commands: /bridge, /balance, /help`,
        { threadId, replyId: eventId }
      );
      return;
  }

  try {
    // Run the agent with the constructed message
    const result = await agent.run({
      message,
      sessionId,
      user: { walletAddress: userId },
      threadId: threadId || channelId,
    });

    log('info', 'Agent completed for slash command', {
      userId,
      channelId,
      sessionId,
      command,
      success: result.success,
      awaitingAction: result.awaitingAction,
    });

    // Send response to the channel
    const responseText = formatAgentResponse(result);
    if (responseText) {
      await handler.sendMessage(channelId, responseText, {
        threadId,
        replyId: eventId,
      });
    }

    // If awaiting action, send interaction request
    if (result.awaitingAction && result.session.pendingAction) {
      await sendPendingActionRequest(
        handler,
        channelId,
        result.session.pendingAction,
        threadId
      );
    }
  } catch (error) {
    log('error', 'Error handling slash command', {
      userId,
      channelId,
      sessionId,
      command,
      error,
    });

    // Send error message to user
    await handler.sendMessage(channelId, formatErrorMessage(error), {
      threadId,
      replyId: eventId,
    });
  }
}

/**
 * Handle interaction responses (confirmations and transaction signatures)
 */
async function handleInteractionResponse(
  handler: BotHandler,
  event: BasePayload & {
    response: DecryptedInteractionResponse;
    threadId: string | undefined;
  },
  agent: CocoAgent
): Promise<void> {
  const { userId, channelId, eventId, response, threadId } = event;

  log('info', 'Interaction response received', {
    userId,
    channelId,
    eventId,
  });

  const sessionId = createSessionId(userId, channelId);

  try {
    // Get the current session to find the pending action
    const session = await getSession(sessionId);

    if (!session) {
      log('warn', 'No session found for interaction response', {
        userId,
        channelId,
        sessionId,
      });
      await handler.sendMessage(
        channelId,
        'Session expired. Please start a new request.',
        { threadId }
      );
      return;
    }

    if (!session.pendingAction) {
      log('warn', 'No pending action for interaction response', {
        userId,
        channelId,
        sessionId,
      });
      await handler.sendMessage(
        channelId,
        'No pending action found. Please start a new request.',
        { threadId }
      );
      return;
    }

    // Parse the interaction response payload
    const payload = response.payload;

    // Determine if user confirmed or cancelled
    let confirmed = false;
    let userResponse = '';
    let responseData: Record<string, unknown> | undefined;

    // Handle form responses (confirmation buttons)
    if (payload.content?.case === 'form') {
      const formResponse = payload.content.value;
      // Check for confirm button click
      if (formResponse.components && Array.isArray(formResponse.components)) {
        for (const component of formResponse.components) {
          if (component.component?.case === 'button') {
            // Button was clicked - check the component id
            const buttonId = component.id;
            if (buttonId === 'confirm') {
              confirmed = true;
              userResponse = 'Confirmed';
            } else if (buttonId === 'cancel') {
              confirmed = false;
              userResponse = 'Cancelled';
            }
          }
        }
      }
    }

    // Handle transaction signature responses
    if (payload.content?.case === 'transaction') {
      const txResponse = payload.content.value;
      if (txResponse.txHash) {
        confirmed = true;
        userResponse = 'Transaction signed';
        responseData = {
          txHash: txResponse.txHash,
          requestId: txResponse.requestId,
        };
      } else {
        confirmed = false;
        userResponse = 'Transaction rejected';
      }
    }

    log('info', 'Resuming agent with interaction response', {
      userId,
      channelId,
      sessionId,
      confirmed,
      actionId: session.pendingAction.actionId,
    });

    // Resume the agent with the user's response
    const result = await agent.resume({
      sessionId,
      userResponse,
      actionId: session.pendingAction.actionId,
      confirmed,
      responseData,
    });

    log('info', 'Agent resumed', {
      userId,
      channelId,
      sessionId,
      success: result.success,
      awaitingAction: result.awaitingAction,
    });

    // Send response to the channel
    const responseText = formatAgentResponse(result);
    if (responseText) {
      await handler.sendMessage(channelId, responseText, { threadId });
    }

    // Handle any new pending actions
    if (result.awaitingAction && result.session.pendingAction) {
      await sendPendingActionRequest(
        handler,
        channelId,
        result.session.pendingAction,
        threadId
      );
    }
  } catch (error) {
    log('error', 'Error handling interaction response', {
      userId,
      channelId,
      sessionId,
      error,
    });

    // Send error message to user
    await handler.sendMessage(channelId, formatErrorMessage(error), { threadId });
  }
}

// ============================================================================
// Bot Initialization
// ============================================================================

/** Bot configuration options */
export interface CocoBridgeBotOptions {
  /** Bot app private key (hex string) */
  appPrivateKey: string;
  /** JWT secret for webhook authentication (base64 encoded) */
  jwtSecret: string;
  /** Base RPC URL for blockchain interactions */
  baseRpcUrl?: string;
}

/**
 * Create and configure the Coco Bridge bot with all event handlers.
 *
 * @param options - Bot configuration options
 * @returns Configured Towns bot instance
 *
 * @example
 * ```typescript
 * const bot = await createCocoBridgeBot({
 *   appPrivateKey: process.env.BOT_PRIVATE_KEY!,
 *   jwtSecret: process.env.JWT_SECRET!,
 * });
 *
 * // Start the bot's Hono server
 * const app = bot.start();
 * ```
 */
export async function createCocoBridgeBot(
  options: CocoBridgeBotOptions
): Promise<Bot<typeof BOT_COMMANDS>> {
  const { appPrivateKey, jwtSecret, baseRpcUrl } = options;

  log('info', 'Initializing Coco Bridge bot');

  // Create the Towns bot instance
  const bot = await makeTownsBot(appPrivateKey, jwtSecret, {
    commands: BOT_COMMANDS,
    baseRpcUrl,
  });

  // Create a shared agent instance
  const agent = new CocoAgent();

  log('info', 'Registering event handlers');

  // Register message handler
  bot.onMessage((handler, event) => {
    // Fire and forget - don't block the event loop
    handleMessage(handler, event, agent).catch((error) => {
      log('error', 'Unhandled error in message handler', { error });
    });
  });

  // Register slash command handlers
  bot.onSlashCommand('bridge', (handler, event) => {
    handleSlashCommand(handler, event, agent).catch((error) => {
      log('error', 'Unhandled error in /bridge handler', { error });
    });
  });

  bot.onSlashCommand('balance', (handler, event) => {
    handleSlashCommand(handler, event, agent).catch((error) => {
      log('error', 'Unhandled error in /balance handler', { error });
    });
  });

  bot.onSlashCommand('help', (handler, event) => {
    handleSlashCommand(handler, event, agent).catch((error) => {
      log('error', 'Unhandled error in /help handler', { error });
    });
  });

  // Register interaction response handler
  bot.onInteractionResponse((handler, event) => {
    handleInteractionResponse(handler, event, agent).catch((error) => {
      log('error', 'Unhandled error in interaction response handler', { error });
    });
  });

  log('info', 'Coco Bridge bot initialized successfully', {
    commands: BOT_COMMANDS.map((c) => `/${c.name}`),
  });

  return bot;
}

// ============================================================================
// Exports
// ============================================================================

export { BOT_COMMANDS } from './commands';
export type { Bot, BotCommand, BotHandler };
