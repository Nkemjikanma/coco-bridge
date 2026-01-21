/**
 * Coco Agent Core
 * Main AI agent class with conversation loop, mirroring coco-bot's agent architecture.
 *
 * @module ai/cocoAgent
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlock, ToolUseBlock, TextBlock } from '@anthropic-ai/sdk/resources/messages';

import {
  COCO_BRIDGE_SYSTEM_PROMPT,
  COCO_BRIDGE_TOOL_GUIDELINES,
} from './prompts';
import {
  toAnthropicTools,
  executeTool,
} from './tools';
import {
  getSession,
  createSession,
  addSessionMessage,
  setSessionProcessing,
  setSessionCompleted,
  setSessionError,
  setSessionPendingAction,
  clearSessionPendingAction,
  updateSessionCost,
} from './sessions';
import type {
  AgentSession,
  AgentContext,
  UserContext,
  ToolCall,
  AgentMessage,
} from './types';
import {
  isToolResultPendingAction,
  isToolResultError,
  isSessionTerminal,
  isSessionAwaitingAction,
} from './types';
import {
  parseUserMessage,
  isParseResultSuccess,
  isParsedCancelRequest,
  isParsedUnknownRequest,
  type ParseResult,
  type ParsedRequest,
} from './parsing';

// ============================================================================
// Constants
// ============================================================================

/** Maximum conversation turns to prevent infinite loops */
const MAX_TURNS = 25;

/** Claude model to use */
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

/** Maximum tokens for Claude response */
const MAX_TOKENS = 4096;

// ============================================================================
// Types
// ============================================================================

/** Result from running the agent */
export interface AgentRunResult {
  /** Whether the run completed successfully */
  success: boolean;
  /** Final session state */
  session: AgentSession;
  /** Final response text (if any) */
  responseText?: string;
  /** Error message (if failed) */
  error?: string;
  /** Whether the session is awaiting user action */
  awaitingAction: boolean;
}

/** Options for creating an agent context */
export interface CreateAgentContextOptions {
  /** User context information */
  user: UserContext;
  /** Session to use (will be created if not provided) */
  session?: AgentSession;
  /** Session ID (required if session not provided) */
  sessionId?: string;
  /** Thread/channel ID */
  threadId?: string;
  /** Additional context data */
  extra?: Record<string, unknown>;
}

/** Options for running the agent */
export interface AgentRunOptions {
  /** User's message */
  message: string;
  /** Session ID for the conversation */
  sessionId: string;
  /** User context */
  user: UserContext;
  /** Thread/channel ID */
  threadId: string;
  /** Maximum turns override (default: 25) */
  maxTurns?: number;
}

/** Options for resuming the agent after user action */
export interface AgentResumeOptions {
  /** Session ID to resume */
  sessionId: string;
  /** User's response to pending action */
  userResponse: string;
  /** Action ID being responded to */
  actionId: string;
  /** Whether user confirmed the action */
  confirmed: boolean;
  /** Additional data from user (e.g., signature) */
  responseData?: Record<string, unknown>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create an agent context for tool execution.
 *
 * @param options - Options for creating the context
 * @returns Agent context object
 *
 * @example
 * ```typescript
 * const context = await createAgentContext({
 *   user: { walletAddress: '0x123...' },
 *   sessionId: 'session-123',
 *   threadId: 'thread-456',
 * });
 * ```
 */
export async function createAgentContext(
  options: CreateAgentContextOptions
): Promise<AgentContext> {
  const { user, extra } = options;

  // Get or create session
  let session: AgentSession;
  if (options.session) {
    session = options.session;
  } else if (options.sessionId) {
    const existingSession = await getSession(options.sessionId);
    if (existingSession) {
      session = existingSession;
    } else {
      session = await createSession(
        options.sessionId,
        user.walletAddress,
        options.threadId || 'default'
      );
    }
  } else {
    throw new Error('Either session or sessionId must be provided');
  }

  return {
    user,
    session,
    extra,
  };
}

/**
 * Convert session messages to Anthropic message format.
 */
function toAnthropicMessages(messages: AgentMessage[]): MessageParam[] {
  const anthropicMessages: MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      anthropicMessages.push({
        role: 'user',
        content: msg.content,
      });
    } else if (msg.role === 'assistant') {
      anthropicMessages.push({
        role: 'assistant',
        content: msg.content,
      });
    } else if (msg.role === 'tool') {
      // Tool results need to be paired with the previous assistant message
      // that made the tool call
      anthropicMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.toolCallId || '',
            content: msg.content,
          },
        ],
      });
    }
    // System messages are handled separately
  }

  return anthropicMessages;
}

/**
 * Extract tool calls from Claude's response.
 */
function extractToolCalls(content: ContentBlock[]): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    if (block.type === 'tool_use') {
      const toolBlock = block as ToolUseBlock;
      toolCalls.push({
        id: toolBlock.id,
        name: toolBlock.name,
        input: toolBlock.input as Record<string, unknown>,
      });
    }
  }

  return toolCalls;
}

/**
 * Extract text content from Claude's response.
 */
function extractTextContent(content: ContentBlock[]): string {
  const textParts: string[] = [];

  for (const block of content) {
    if (block.type === 'text') {
      const textBlock = block as TextBlock;
      textParts.push(textBlock.text);
    }
  }

  return textParts.join('\n');
}

// ============================================================================
// CocoAgent Class
// ============================================================================

/**
 * Main Coco Agent class for handling AI conversations.
 * Manages the conversation loop, tool execution, and session state.
 *
 * @example
 * ```typescript
 * const agent = new CocoAgent();
 *
 * // Start a new conversation
 * const result = await agent.run({
 *   message: 'Bridge 0.1 ETH from Base to Ethereum',
 *   sessionId: 'session-123',
 *   user: { walletAddress: '0x123...' },
 *   threadId: 'thread-456',
 * });
 *
 * // Resume after user confirmation
 * if (result.awaitingAction) {
 *   const resumeResult = await agent.resume({
 *     sessionId: 'session-123',
 *     userResponse: 'yes',
 *     actionId: 'action-789',
 *     confirmed: true,
 *   });
 * }
 * ```
 */
export class CocoAgent {
  private client: Anthropic;
  private systemPrompt: string;

  constructor() {
    this.client = new Anthropic();
    this.systemPrompt = `${COCO_BRIDGE_SYSTEM_PROMPT}\n\n${COCO_BRIDGE_TOOL_GUIDELINES}`;
  }

  /**
   * Pre-process user message using natural language parser.
   * Returns parsed result that can be used to:
   * 1. Handle cancel requests immediately
   * 2. Provide context hints to the AI
   * 3. Generate clarification questions for unclear requests
   *
   * @param message - The user's message
   * @returns Parse result with intent and extracted entities
   */
  public preprocessMessage(message: string): ParseResult {
    return parseUserMessage(message);
  }

  /**
   * Enrich user message with parsed context for the AI.
   * Adds helpful hints about detected intent and entities.
   *
   * @param message - Original user message
   * @param parsed - Parsed request from preprocessMessage
   * @returns Enriched message with context hints
   */
  private enrichMessageWithContext(message: string, parsed: ParsedRequest): string {
    // For unknown or low-confidence requests, add clarification context
    if (isParsedUnknownRequest(parsed)) {
      return `${message}\n\n[Context: User intent is unclear. Possible intents: ${parsed.possibleIntents.join(', ')}. Consider asking for clarification.]`;
    }

    // For bridge requests with missing fields, add hints
    if (parsed.intent === 'bridge' && 'missing' in parsed && parsed.missing.length > 0) {
      const missingStr = parsed.missing.join(', ');
      return `${message}\n\n[Context: Bridge request detected. Missing: ${missingStr}. Ask user to clarify.]`;
    }

    // For swap_bridge requests with missing fields
    if (parsed.intent === 'swap_bridge' && 'missing' in parsed && parsed.missing.length > 0) {
      const missingStr = parsed.missing.join(', ');
      return `${message}\n\n[Context: Swap+bridge request detected. Missing: ${missingStr}. Ask user to clarify.]`;
    }

    // For balance requests, add detected specifics
    if (parsed.intent === 'balance') {
      const parts: string[] = [];
      if ('token' in parsed && parsed.token) parts.push(`token: ${parsed.token.symbol}`);
      if ('chain' in parsed && parsed.chain) parts.push(`chain: ${parsed.chain.name}`);
      if (parts.length > 0) {
        return `${message}\n\n[Context: Balance check for ${parts.join(', ')}]`;
      }
    }

    return message;
  }

  /**
   * Run the agent with a new user message.
   * Starts or continues a conversation based on the session state.
   *
   * @param options - Run options including message, session ID, and user context
   * @returns Result containing session state and response
   */
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const { message, sessionId, user, threadId, maxTurns = MAX_TURNS } = options;

    try {
      // Get or create session
      let session = await getSession(sessionId);
      if (!session) {
        session = await createSession(sessionId, user.walletAddress, threadId);
      }

      // Check if session is in terminal state
      if (isSessionTerminal(session)) {
        return {
          success: false,
          session,
          error: `Session is in terminal state: ${session.status}`,
          awaitingAction: false,
        };
      }

      // Check if session is awaiting action (should use resume instead)
      if (isSessionAwaitingAction(session)) {
        return {
          success: false,
          session,
          error: 'Session is awaiting user action. Use resume() instead.',
          awaitingAction: true,
        };
      }

      // Pre-process message using natural language parser
      const parseResult = this.preprocessMessage(message);

      // Handle cancel requests immediately (no need to call AI)
      if (isParseResultSuccess(parseResult) && isParsedCancelRequest(parseResult.parsed)) {
        const cancelResponse = 'Cancelled. Anything else?';
        session = (await addSessionMessage(sessionId, 'user', message))!;
        session = (await addSessionMessage(sessionId, 'assistant', cancelResponse))!;
        session = (await setSessionCompleted(sessionId))!;

        return {
          success: true,
          session,
          responseText: cancelResponse,
          awaitingAction: false,
        };
      }

      // Enrich message with parsed context for the AI
      let enrichedMessage = message;
      if (isParseResultSuccess(parseResult)) {
        enrichedMessage = this.enrichMessageWithContext(message, parseResult.parsed);
      }

      // Add enriched user message to session
      session = (await addSessionMessage(sessionId, 'user', enrichedMessage))!;

      // Mark session as processing
      session = (await setSessionProcessing(sessionId))!;

      // Create agent context
      const context = await createAgentContext({
        user,
        session,
        threadId,
      });

      // Run the agent loop
      return this.agentLoop(context, maxTurns);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const session = await getSession(sessionId);

      if (session) {
        await setSessionError(sessionId, { error: errorMessage });
      }

      return {
        success: false,
        session: session || ({} as AgentSession),
        error: errorMessage,
        awaitingAction: false,
      };
    }
  }

  /**
   * Resume the agent after a user action (confirmation, signature, etc.).
   *
   * @param options - Resume options including session ID and user response
   * @returns Result containing session state and response
   */
  async resume(options: AgentResumeOptions): Promise<AgentRunResult> {
    const { sessionId, userResponse, actionId, confirmed, responseData } = options;

    try {
      // Get existing session
      const session = await getSession(sessionId);
      if (!session) {
        return {
          success: false,
          session: {} as AgentSession,
          error: 'Session not found',
          awaitingAction: false,
        };
      }

      // Verify session is awaiting action
      if (!isSessionAwaitingAction(session)) {
        return {
          success: false,
          session,
          error: 'Session is not awaiting user action',
          awaitingAction: false,
        };
      }

      // Verify action ID matches
      if (session.pendingAction?.actionId !== actionId) {
        return {
          success: false,
          session,
          error: `Action ID mismatch. Expected: ${session.pendingAction?.actionId}, Got: ${actionId}`,
          awaitingAction: true,
        };
      }

      // Clear pending action and add user response
      await clearSessionPendingAction(sessionId, 'processing');

      // Format the user response based on action type
      let responseMessage: string;
      if (session.pendingAction?.type === 'confirmation') {
        responseMessage = confirmed ? 'Confirmed' : 'Cancelled';
      } else if (session.pendingAction?.type === 'signature') {
        responseMessage = confirmed
          ? `Signed: ${JSON.stringify(responseData || {})}`
          : 'Signature rejected';
      } else {
        responseMessage = userResponse;
      }

      // Add user response as a message
      const updatedSession = await addSessionMessage(sessionId, 'user', responseMessage);

      // Create context from session
      const context = await createAgentContext({
        user: {
          walletAddress: session.userId,
        },
        session: updatedSession!,
        sessionId,
        threadId: session.threadId,
      });

      // Continue the agent loop
      return this.agentLoop(context, MAX_TURNS - session.turnCount);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const session = await getSession(sessionId);

      if (session) {
        await setSessionError(sessionId, { error: errorMessage });
      }

      return {
        success: false,
        session: session || ({} as AgentSession),
        error: errorMessage,
        awaitingAction: false,
      };
    }
  }

  /**
   * Main agent loop that processes Claude responses and executes tools.
   * Continues until the conversation completes, requires user action, or hits max turns.
   *
   * @param context - Agent context with user and session info
   * @param maxTurns - Maximum turns before stopping
   * @returns Result containing final session state
   */
  private async agentLoop(
    context: AgentContext,
    maxTurns: number
  ): Promise<AgentRunResult> {
    let session = context.session;
    let turnCount = 0;
    let lastResponseText = '';

    while (turnCount < maxTurns) {
      turnCount++;

      // Check for max turns
      if (turnCount >= maxTurns) {
        lastResponseText = 'Maximum conversation turns reached. Please start a new conversation.';
        await addSessionMessage(session.sessionId, 'assistant', lastResponseText);
        session = (await setSessionCompleted(session.sessionId))!;

        return {
          success: true,
          session,
          responseText: lastResponseText,
          awaitingAction: false,
        };
      }

      // Convert messages to Anthropic format
      const messages = toAnthropicMessages(session.messages);

      // Call Claude
      const response = await this.client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        system: this.systemPrompt,
        tools: toAnthropicTools(),
        messages,
      });

      // Track token usage
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;
      await updateSessionCost(session.sessionId, inputTokens, outputTokens);

      // Extract text content and tool calls
      const textContent = extractTextContent(response.content);
      const toolCalls = extractToolCalls(response.content);

      // Store assistant response
      if (textContent || toolCalls.length > 0) {
        // For assistant messages with tool calls, we need to store the full response
        const assistantContent = textContent || (toolCalls.length > 0 ? '[Tool calls]' : '');
        await addSessionMessage(session.sessionId, 'assistant', assistantContent);
        lastResponseText = textContent;
      }

      // If no tool calls, the conversation turn is complete
      if (toolCalls.length === 0) {
        // Check stop reason
        if (response.stop_reason === 'end_turn') {
          session = (await setSessionCompleted(session.sessionId))!;
          return {
            success: true,
            session,
            responseText: lastResponseText,
            awaitingAction: false,
          };
        }

        // Refresh session and continue if there might be more
        session = (await getSession(session.sessionId))!;
        continue;
      }

      // Execute tool calls
      for (const toolCall of toolCalls) {
        // Update context with latest session
        context.session = (await getSession(session.sessionId))!;

        // Execute the tool
        const result = await executeTool(
          toolCall.name,
          toolCall.input,
          context,
          toolCall.id
        );

        // Check if tool result requires user action
        if (isToolResultPendingAction(result)) {
          // Set pending action on session
          await setSessionPendingAction(session.sessionId, {
            type: result.actionType,
            actionId: toolCall.id,
            toolName: toolCall.name,
            data: result.actionData,
            message: result.actionMessage,
            expiresAt: result.expiresAt,
          });

          // Add tool result to session
          await addSessionMessage(
            session.sessionId,
            'tool',
            JSON.stringify({
              status: 'pending_action',
              actionType: result.actionType,
              message: result.actionMessage,
            }),
            { toolCallId: toolCall.id, toolName: toolCall.name }
          );

          // Return awaiting action
          session = (await getSession(session.sessionId))!;
          return {
            success: true,
            session,
            responseText: lastResponseText,
            awaitingAction: true,
          };
        }

        // Check for tool error
        if (isToolResultError(result)) {
          // Add error result to session
          await addSessionMessage(
            session.sessionId,
            'tool',
            JSON.stringify({
              error: result.errorCode,
              message: result.errorMessage,
              details: result.errorDetails,
            }),
            { toolCallId: toolCall.id, toolName: toolCall.name }
          );
        } else {
          // Add successful result to session
          await addSessionMessage(
            session.sessionId,
            'tool',
            JSON.stringify(result.data),
            { toolCallId: toolCall.id, toolName: toolCall.name }
          );
        }
      }

      // Refresh session for next iteration
      session = (await getSession(session.sessionId))!;
    }

    // Max turns exceeded
    lastResponseText = 'Maximum conversation turns reached.';
    await addSessionMessage(session.sessionId, 'assistant', lastResponseText);
    session = (await setSessionCompleted(session.sessionId))!;

    return {
      success: true,
      session,
      responseText: lastResponseText,
      awaitingAction: false,
    };
  }
}

// ============================================================================
// Default Export
// ============================================================================

export default CocoAgent;
