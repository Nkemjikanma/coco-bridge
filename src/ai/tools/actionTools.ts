/**
 * Action Tools for Coco Bridge
 * Tools that request user confirmation, send messages, and handle transactions.
 * These tools update session pending action state and use Towns interaction request API.
 */

import { randomUUID } from 'crypto';
import { setSessionPendingAction } from '../sessions';
import { CHAIN_NAMES, SUPPORTED_CHAIN_IDS, type ChainId } from '../../services/bridge';
import type {
  ToolDefinition,
  ToolResult,
  ToolResultSuccess,
  ToolResultError,
  ToolResultPendingAction,
  AgentContext,
} from '../types';
import type { TransactionData } from '../../services/bridge/types';

// ============================================================================
// Action Types
// ============================================================================

/** Types of actions that can be requested for confirmation */
export type ActionType =
  | 'bridge'
  | 'swap'
  | 'approval'
  | 'swap_bridge'
  | 'cancel'
  | 'generic';

/** Message types for status updates */
export type MessageType = 'info' | 'success' | 'warning' | 'error' | 'status';

// ============================================================================
// Request Confirmation Tool Definition
// ============================================================================

export const requestConfirmationToolDefinition: ToolDefinition = {
  name: 'request_confirmation',
  description:
    'Request user confirmation before executing an action. ' +
    'Use this when an action requires explicit user approval (e.g., bridge, swap, approval). ' +
    'The confirmation UI will be displayed to the user via Towns interaction request API. ' +
    'DO NOT output any text before calling this tool - it handles all UI.',
  inputSchema: {
    type: 'object',
    properties: {
      actionType: {
        type: 'string',
        description:
          'Type of action requiring confirmation. ' +
          'Options: bridge, swap, approval, swap_bridge, cancel, generic.',
        enum: ['bridge', 'swap', 'approval', 'swap_bridge', 'cancel', 'generic'] as const,
      },
      actionName: {
        type: 'string',
        description:
          'Human-readable name for the action (e.g., "Bridge 0.1 ETH to Ethereum", "Approve USDC spending").',
      },
      message: {
        type: 'string',
        description:
          'Detailed message to display to the user explaining the action and its implications.',
      },
      actionData: {
        type: 'object',
        description:
          'Additional data associated with the action (e.g., quote details, transaction data). ' +
          'This data will be stored in the session for use when user confirms.',
      },
      expiresInSeconds: {
        type: 'number',
        description:
          'Optional expiration time in seconds. Default is 120 seconds (2 minutes). ' +
          'Set for time-sensitive actions like bridge quotes.',
        minimum: 30,
        maximum: 600,
      },
    },
    required: ['actionType', 'actionName', 'message'],
    additionalProperties: false,
  },
  requiresConfirmation: false,
  requiresSignature: false,
  category: 'utility',
};

// ============================================================================
// Request Confirmation Tool Input/Output Types
// ============================================================================

export interface RequestConfirmationInput {
  actionType: ActionType;
  actionName: string;
  message: string;
  actionData?: Record<string, unknown>;
  expiresInSeconds?: number;
}

export interface RequestConfirmationOutput {
  actionId: string;
  actionType: ActionType;
  actionName: string;
  message: string;
  expiresAt?: number;
  timestamp: number;
}

// ============================================================================
// Request Confirmation Tool Executor
// ============================================================================

/**
 * Execute the request_confirmation tool.
 * Creates a pending action in the session and returns a result that signals
 * the UI to display a confirmation dialog via Towns interaction request API.
 *
 * @param input - Tool input parameters
 * @param context - Agent context with session info
 * @param toolCallId - Unique ID for this tool call
 * @returns Tool result with pending action for confirmation
 */
export async function executeRequestConfirmation(
  input: RequestConfirmationInput,
  context: AgentContext,
  toolCallId: string
): Promise<ToolResult> {
  const timestamp = Date.now();

  try {
    const { actionType, actionName, message, actionData, expiresInSeconds } = input;

    // Generate unique action ID
    const actionId = randomUUID();

    // Calculate expiration (default 2 minutes)
    const expiresAt = expiresInSeconds
      ? timestamp + expiresInSeconds * 1000
      : timestamp + 120000;

    // Store pending action in session
    const pendingActionResult = await setSessionPendingAction(context.session.sessionId, {
      type: 'confirmation',
      actionId,
      toolName: 'request_confirmation',
      data: {
        actionType,
        actionName,
        ...actionData,
      },
      message,
      expiresAt,
    });

    if (!pendingActionResult) {
      return createConfirmationErrorResult(
        toolCallId,
        'SESSION_NOT_FOUND',
        'Session not found. Please try again.',
        timestamp
      );
    }

    const output: RequestConfirmationOutput = {
      actionId,
      actionType,
      actionName,
      message,
      expiresAt,
      timestamp,
    };

    // Return pending action result - this signals the system to display confirmation UI
    return createConfirmationPendingResult(
      toolCallId,
      output,
      message,
      timestamp,
      expiresAt
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return createConfirmationErrorResult(
      toolCallId,
      'CONFIRMATION_FAILED',
      'Technical issue requesting confirmation. Please try again.',
      timestamp,
      { originalError: errorMessage }
    );
  }
}

// ============================================================================
// Send Message Tool Definition
// ============================================================================

export const sendMessageToolDefinition: ToolDefinition = {
  name: 'send_message',
  description:
    'Send a status update or informational message to the user. ' +
    'Use this for progress updates, success confirmations, warnings, or error messages. ' +
    'The message will be displayed in the chat via Towns protocol.',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The message content to send to the user.',
      },
      messageType: {
        type: 'string',
        description:
          'Type of message for appropriate styling. ' +
          'Options: info, success, warning, error, status. Default: info.',
        enum: ['info', 'success', 'warning', 'error', 'status'] as const,
      },
      metadata: {
        type: 'object',
        description:
          'Optional metadata to include with the message (e.g., transaction hash, explorer URL).',
      },
    },
    required: ['message'],
    additionalProperties: false,
  },
  requiresConfirmation: false,
  requiresSignature: false,
  category: 'utility',
};

// ============================================================================
// Send Message Tool Input/Output Types
// ============================================================================

export interface SendMessageInput {
  message: string;
  messageType?: MessageType;
  metadata?: Record<string, unknown>;
}

export interface SendMessageOutput {
  messageId: string;
  message: string;
  messageType: MessageType;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

// ============================================================================
// Send Message Tool Executor
// ============================================================================

/**
 * Execute the send_message tool.
 * Sends a status update or informational message to the user.
 *
 * @param input - Tool input parameters
 * @param context - Agent context (unused but included for consistency)
 * @param toolCallId - Unique ID for this tool call
 * @returns Tool result with message details
 */
export async function executeSendMessage(
  input: SendMessageInput,
  _context: AgentContext,
  toolCallId: string
): Promise<ToolResult> {
  const timestamp = Date.now();

  try {
    const { message, messageType = 'info', metadata } = input;

    // Generate unique message ID
    const messageId = randomUUID();

    const output: SendMessageOutput = {
      messageId,
      message,
      messageType,
      metadata,
      timestamp,
    };

    return createMessageSuccessResult(toolCallId, output, timestamp, message);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return createMessageErrorResult(
      toolCallId,
      'MESSAGE_FAILED',
      'Technical issue sending message.',
      timestamp,
      { originalError: errorMessage }
    );
  }
}

// ============================================================================
// Send Transaction Tool Definition
// ============================================================================

export const sendTransactionToolDefinition: ToolDefinition = {
  name: 'send_transaction',
  description:
    'Request the user to sign and send a blockchain transaction. ' +
    'This creates a signature request via Towns interaction request API. ' +
    'Use this for bridge transactions, token approvals, and other on-chain operations. ' +
    'The transaction data must include: to, data, value, and chainId.',
  inputSchema: {
    type: 'object',
    properties: {
      transactionType: {
        type: 'string',
        description:
          'Type of transaction for display and tracking. ' +
          'Options: bridge, approval, swap, swap_bridge.',
        enum: ['bridge', 'approval', 'swap', 'swap_bridge'] as const,
      },
      description: {
        type: 'string',
        description:
          'Human-readable description of the transaction (e.g., "Bridge 0.1 ETH from Base to Ethereum").',
      },
      transaction: {
        type: 'object',
        description: 'EVM transaction data to be signed.',
        properties: {
          to: {
            type: 'string',
            description: 'Target contract address (0x...)',
          },
          data: {
            type: 'string',
            description: 'Transaction calldata (0x...)',
          },
          value: {
            type: 'string',
            description: 'Value in wei to send with transaction',
          },
          chainId: {
            type: 'number',
            description: 'Chain ID for the transaction',
          },
          gasLimit: {
            type: 'string',
            description: 'Optional gas limit estimate',
          },
        },
        required: ['to', 'data', 'value', 'chainId'],
      },
      metadata: {
        type: 'object',
        description:
          'Additional metadata for tracking (e.g., quoteId, inputToken, outputToken).',
      },
      expiresInSeconds: {
        type: 'number',
        description:
          'Optional expiration time in seconds. Default is 300 seconds (5 minutes).',
        minimum: 60,
        maximum: 600,
      },
    },
    required: ['transactionType', 'description', 'transaction'],
    additionalProperties: false,
  },
  requiresConfirmation: false,
  requiresSignature: true,
  category: 'write',
};

// ============================================================================
// Send Transaction Tool Input/Output Types
// ============================================================================

/** Transaction type for categorization */
export type TransactionType = 'bridge' | 'approval' | 'swap' | 'swap_bridge';

export interface SendTransactionInput {
  transactionType: TransactionType;
  description: string;
  transaction: TransactionData;
  metadata?: Record<string, unknown>;
  expiresInSeconds?: number;
}

export interface SendTransactionOutput {
  transactionId: string;
  transactionType: TransactionType;
  description: string;
  transaction: TransactionData;
  chainId: ChainId;
  chainName: string;
  metadata?: Record<string, unknown>;
  expiresAt?: number;
  timestamp: number;
}

// ============================================================================
// Send Transaction Tool Executor
// ============================================================================

/**
 * Execute the send_transaction tool.
 * Creates a signature request in the session for the user to sign via Towns interaction API.
 *
 * @param input - Tool input parameters
 * @param context - Agent context with session info
 * @param toolCallId - Unique ID for this tool call
 * @returns Tool result with pending signature request
 */
export async function executeSendTransaction(
  input: SendTransactionInput,
  context: AgentContext,
  toolCallId: string
): Promise<ToolResult> {
  const timestamp = Date.now();

  try {
    const { transactionType, description, transaction, metadata, expiresInSeconds } = input;

    // Validate chain ID
    const chainId = transaction.chainId as ChainId;
    if (!SUPPORTED_CHAIN_IDS.includes(chainId)) {
      return createTransactionErrorResult(
        toolCallId,
        'INVALID_CHAIN',
        `Chain ID ${chainId} is not supported. Supported chains: Ethereum (1), Base (8453), Optimism (10), Polygon (137), Arbitrum (42161).`,
        timestamp
      );
    }

    // Validate transaction data
    if (!transaction.to || !transaction.data || transaction.value === undefined) {
      return createTransactionErrorResult(
        toolCallId,
        'INVALID_TRANSACTION',
        'Transaction must include to, data, and value fields.',
        timestamp
      );
    }

    // Generate unique transaction ID
    const transactionId = randomUUID();

    // Calculate expiration (default 5 minutes for transactions)
    const expiresAt = expiresInSeconds
      ? timestamp + expiresInSeconds * 1000
      : timestamp + 300000;

    const chainName = CHAIN_NAMES[chainId];

    // Store pending action in session as a signature request
    const pendingActionResult = await setSessionPendingAction(context.session.sessionId, {
      type: 'signature',
      actionId: transactionId,
      toolName: 'send_transaction',
      data: {
        transactionType,
        description,
        transaction,
        chainId,
        chainName,
        ...metadata,
      },
      message: description,
      expiresAt,
    });

    if (!pendingActionResult) {
      return createTransactionErrorResult(
        toolCallId,
        'SESSION_NOT_FOUND',
        'Session not found. Please try again.',
        timestamp
      );
    }

    const output: SendTransactionOutput = {
      transactionId,
      transactionType,
      description,
      transaction,
      chainId,
      chainName,
      metadata,
      expiresAt,
      timestamp,
    };

    // Return pending action result for signature request
    return createTransactionPendingResult(
      toolCallId,
      output,
      description,
      timestamp,
      expiresAt
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return createTransactionErrorResult(
      toolCallId,
      'TRANSACTION_FAILED',
      'Technical issue preparing transaction. Please try again.',
      timestamp,
      { originalError: errorMessage }
    );
  }
}

// ============================================================================
// Result Helpers - Request Confirmation
// ============================================================================

function createConfirmationPendingResult(
  toolCallId: string,
  data: RequestConfirmationOutput,
  message: string,
  timestamp: number,
  expiresAt?: number
): ToolResultPendingAction {
  return {
    success: true,
    toolCallId,
    toolName: 'request_confirmation',
    timestamp,
    pendingAction: true,
    actionType: 'confirmation',
    actionMessage: message,
    actionData: data as unknown as Record<string, unknown>,
    expiresAt,
  };
}

function createConfirmationErrorResult(
  toolCallId: string,
  errorCode: string,
  errorMessage: string,
  timestamp: number,
  errorDetails?: Record<string, unknown>
): ToolResultError {
  return {
    success: false,
    toolCallId,
    toolName: 'request_confirmation',
    timestamp,
    errorCode,
    errorMessage,
    errorDetails,
  };
}

// ============================================================================
// Result Helpers - Send Message
// ============================================================================

function createMessageSuccessResult(
  toolCallId: string,
  data: SendMessageOutput,
  timestamp: number,
  message?: string
): ToolResultSuccess {
  return {
    success: true,
    toolCallId,
    toolName: 'send_message',
    timestamp,
    data: data as unknown as Record<string, unknown>,
    message,
  };
}

function createMessageErrorResult(
  toolCallId: string,
  errorCode: string,
  errorMessage: string,
  timestamp: number,
  errorDetails?: Record<string, unknown>
): ToolResultError {
  return {
    success: false,
    toolCallId,
    toolName: 'send_message',
    timestamp,
    errorCode,
    errorMessage,
    errorDetails,
  };
}

// ============================================================================
// Result Helpers - Send Transaction
// ============================================================================

function createTransactionPendingResult(
  toolCallId: string,
  data: SendTransactionOutput,
  message: string,
  timestamp: number,
  expiresAt?: number
): ToolResultPendingAction {
  return {
    success: true,
    toolCallId,
    toolName: 'send_transaction',
    timestamp,
    pendingAction: true,
    actionType: 'signature',
    actionMessage: message,
    actionData: data as unknown as Record<string, unknown>,
    expiresAt,
  };
}

function createTransactionErrorResult(
  toolCallId: string,
  errorCode: string,
  errorMessage: string,
  timestamp: number,
  errorDetails?: Record<string, unknown>
): ToolResultError {
  return {
    success: false,
    toolCallId,
    toolName: 'send_transaction',
    timestamp,
    errorCode,
    errorMessage,
    errorDetails,
  };
}

// ============================================================================
// Exports
// ============================================================================

export const actionTools = {
  request_confirmation: {
    definition: requestConfirmationToolDefinition,
    execute: executeRequestConfirmation,
  },
  send_message: {
    definition: sendMessageToolDefinition,
    execute: executeSendMessage,
  },
  send_transaction: {
    definition: sendTransactionToolDefinition,
    execute: executeSendTransaction,
  },
} as const;
