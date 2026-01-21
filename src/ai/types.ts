import type { ChainId } from '../services/bridge';
import type { TokenSymbol } from '../services/tokens';

/**
 * AI Agent Types for Coco Bridge.
 * Defines the core types for AI agent sessions, context, tools, and results.
 */

// ============================================================================
// Agent Session Types
// ============================================================================

/** Status of an agent session */
export type AgentSessionStatus =
  | 'idle'
  | 'processing'
  | 'awaiting_user_action'
  | 'awaiting_signature'
  | 'completed'
  | 'error'
  | 'cancelled';

/** Role of a message in the agent conversation */
export type AgentMessageRole = 'user' | 'assistant' | 'system' | 'tool';

/** Individual message in an agent session */
export interface AgentMessage {
  role: AgentMessageRole;
  content: string;
  timestamp: number;
  /** Tool call ID if this is a tool response */
  toolCallId?: string;
  /** Tool name if this is a tool call or response */
  toolName?: string;
}

/** Pending action that requires user confirmation or signature */
export interface AgentPendingAction {
  /** Type of action pending */
  type: 'confirmation' | 'signature' | 'input';
  /** Unique identifier for this pending action */
  actionId: string;
  /** Tool that initiated this action */
  toolName: string;
  /** Data associated with the pending action */
  data: Record<string, unknown>;
  /** Human-readable message for the user */
  message: string;
  /** When the action was created */
  createdAt: number;
  /** When the action expires (optional) */
  expiresAt?: number;
}

/** Cost tracking for the session */
export interface SessionCost {
  /** Total input tokens used */
  inputTokens: number;
  /** Total output tokens used */
  outputTokens: number;
  /** Estimated cost in USD */
  estimatedCostUsd: number;
}

/** Agent session state */
export interface AgentSession {
  /** Unique session identifier */
  sessionId: string;
  /** User's wallet address or ID */
  userId: string;
  /** Thread/channel ID for context */
  threadId: string;
  /** Current session status */
  status: AgentSessionStatus;
  /** Conversation messages */
  messages: AgentMessage[];
  /** Current pending action awaiting user response */
  pendingAction: AgentPendingAction | null;
  /** Number of conversation turns completed */
  turnCount: number;
  /** Cost tracking for the session */
  cost: SessionCost;
  /** When the session was created */
  createdAt: number;
  /** When the session was last updated */
  updatedAt: number;
  /** Session metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Agent Context Types
// ============================================================================

/** User context for the agent */
export interface UserContext {
  /** User's wallet address */
  walletAddress: string;
  /** User's display name (optional) */
  displayName?: string;
  /** User's preferred chain (optional) */
  preferredChain?: ChainId;
}

/** Token balance information */
export interface TokenBalance {
  /** Token symbol */
  symbol: TokenSymbol;
  /** Token address on the chain */
  address: string;
  /** Balance in wei/smallest unit */
  balanceRaw: string;
  /** Balance formatted with decimals */
  balanceFormatted: string;
  /** USD value of the balance (optional) */
  balanceUsd?: string;
  /** Chain the token is on */
  chainId: ChainId;
}

/** Chain context information */
export interface ChainContext {
  /** Chain ID */
  chainId: ChainId;
  /** Chain name */
  name: string;
  /** Native token symbol */
  nativeToken: TokenSymbol;
  /** Current gas price in gwei (optional) */
  gasPrice?: string;
  /** Block number at context creation (optional) */
  blockNumber?: number;
}

/** Bridge quote information for context */
export interface BridgeQuoteContext {
  /** Source chain */
  sourceChain: ChainId;
  /** Destination chain */
  destinationChain: ChainId;
  /** Input token */
  inputToken: TokenSymbol;
  /** Output token */
  outputToken: TokenSymbol;
  /** Input amount (formatted) */
  inputAmount: string;
  /** Output amount (formatted) */
  outputAmount: string;
  /** Bridge fee (formatted) */
  fee: string;
  /** Estimated time in seconds */
  estimatedTimeSeconds: number;
  /** Quote expiration timestamp */
  expiresAt: number;
  /** Quote provider/route name */
  provider: string;
}

/** Complete agent context for a request */
export interface AgentContext {
  /** User information */
  user: UserContext;
  /** Current session reference */
  session: AgentSession;
  /** User's token balances across chains */
  balances?: TokenBalance[];
  /** Available chain contexts */
  chains?: ChainContext[];
  /** Active bridge quote (if any) */
  activeQuote?: BridgeQuoteContext;
  /** Additional context data */
  extra?: Record<string, unknown>;
}

// ============================================================================
// Tool Definition Types
// ============================================================================

/** JSON Schema type for tool parameters */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  description?: string;
  enum?: readonly string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

/** JSON Schema for tool input */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

/** Tool definition for the AI agent */
export interface ToolDefinition {
  /** Unique tool name (snake_case) */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON schema defining the tool's input parameters */
  inputSchema: ToolInputSchema;
  /** Whether the tool requires user confirmation before execution */
  requiresConfirmation?: boolean;
  /** Whether the tool requires a wallet signature */
  requiresSignature?: boolean;
  /** Tool category for organization */
  category?: 'read' | 'write' | 'utility';
}

// ============================================================================
// Tool Result Types
// ============================================================================

/** Base tool result */
export interface ToolResultBase {
  /** Whether the tool execution succeeded */
  success: boolean;
  /** Tool call ID for correlation */
  toolCallId: string;
  /** Tool name that was executed */
  toolName: string;
  /** Timestamp of execution */
  timestamp: number;
}

/** Successful tool result */
export interface ToolResultSuccess extends ToolResultBase {
  success: true;
  /** Result data from the tool */
  data: Record<string, unknown>;
  /** Human-readable message (optional) */
  message?: string;
}

/** Failed tool result */
export interface ToolResultError extends ToolResultBase {
  success: false;
  /** Error code */
  errorCode: string;
  /** Human-readable error message */
  errorMessage: string;
  /** Additional error details (optional) */
  errorDetails?: Record<string, unknown>;
}

/** Tool result requiring user action */
export interface ToolResultPendingAction extends ToolResultBase {
  success: true;
  /** Indicates this result requires user action */
  pendingAction: true;
  /** Type of action required */
  actionType: 'confirmation' | 'signature' | 'input';
  /** Message to display to the user */
  actionMessage: string;
  /** Data for the pending action */
  actionData: Record<string, unknown>;
  /** When the action expires (optional) */
  expiresAt?: number;
}

/** Union type for all tool results */
export type ToolResult = ToolResultSuccess | ToolResultError | ToolResultPendingAction;

// ============================================================================
// Tool Call Types
// ============================================================================

/** Tool call from the AI model */
export interface ToolCall {
  /** Unique ID for this tool call */
  id: string;
  /** Name of the tool to call */
  name: string;
  /** Input parameters for the tool */
  input: Record<string, unknown>;
}

/** Tool call with result */
export interface ToolCallWithResult extends ToolCall {
  /** Result from executing the tool */
  result: ToolResult;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a tool result is successful.
 */
export function isToolResultSuccess(result: ToolResult): result is ToolResultSuccess {
  return result.success === true && !('pendingAction' in result);
}

/**
 * Check if a tool result is an error.
 */
export function isToolResultError(result: ToolResult): result is ToolResultError {
  return result.success === false;
}

/**
 * Check if a tool result requires user action.
 */
export function isToolResultPendingAction(result: ToolResult): result is ToolResultPendingAction {
  return result.success === true && 'pendingAction' in result && result.pendingAction === true;
}

/**
 * Check if a session is awaiting user action.
 */
export function isSessionAwaitingAction(session: AgentSession): boolean {
  return (
    session.status === 'awaiting_user_action' ||
    session.status === 'awaiting_signature' ||
    session.pendingAction !== null
  );
}

/**
 * Check if a session is in a terminal state.
 */
export function isSessionTerminal(session: AgentSession): boolean {
  return (
    session.status === 'completed' ||
    session.status === 'error' ||
    session.status === 'cancelled'
  );
}
