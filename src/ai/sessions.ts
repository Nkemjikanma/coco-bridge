import { getRedisClient } from '../db/redisClient';
import type {
  AgentSession,
  AgentSessionStatus,
  AgentMessage,
  AgentMessageRole,
  AgentPendingAction,
  SessionCost,
} from './types';

/**
 * AI Agent Session Management.
 * Provides functions for managing AI agent sessions with Redis persistence.
 * Mirrors coco-bot's session architecture with turn count and cost tracking.
 */

/** Session TTL in seconds (30 minutes) */
const SESSION_TTL_SECONDS = 30 * 60;

/** Redis key prefix for agent sessions */
const AGENT_SESSION_KEY_PREFIX = 'coco-bridge:agent-session:';

/**
 * Generate the Redis key for an agent session.
 */
function getSessionKey(sessionId: string): string {
  return `${AGENT_SESSION_KEY_PREFIX}${sessionId}`;
}

/**
 * Create an empty session cost object.
 */
function createEmptyCost(): SessionCost {
  return {
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };
}

/**
 * Create a new agent session object.
 */
function createSessionObject(
  sessionId: string,
  userId: string,
  threadId: string,
  initialMessage?: AgentMessage
): AgentSession {
  const now = Date.now();

  return {
    sessionId,
    userId,
    threadId,
    status: 'idle',
    messages: initialMessage ? [initialMessage] : [],
    pendingAction: null,
    turnCount: 0,
    cost: createEmptyCost(),
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// Core Session Functions
// ============================================================================

/**
 * Get an agent session by ID.
 * Returns null if session doesn't exist or has expired.
 */
export async function getSession(sessionId: string): Promise<AgentSession | null> {
  const redis = getRedisClient();
  const key = getSessionKey(sessionId);

  const data = await redis.get(key);

  if (!data) {
    return null;
  }

  try {
    const session = JSON.parse(data) as AgentSession;
    return session;
  } catch {
    console.error('[AgentSessions] Failed to parse session data:', sessionId);
    return null;
  }
}

/**
 * Create a new agent session.
 * Automatically sets timestamps and applies 30-minute TTL.
 */
export async function createSession(
  sessionId: string,
  userId: string,
  threadId: string,
  initialMessage?: AgentMessage
): Promise<AgentSession> {
  const redis = getRedisClient();
  const key = getSessionKey(sessionId);

  const session = createSessionObject(sessionId, userId, threadId, initialMessage);

  await redis.setex(key, SESSION_TTL_SECONDS, JSON.stringify(session));

  return session;
}

/**
 * Get or create an agent session.
 * Returns existing session if found, otherwise creates a new one.
 */
export async function getOrCreateSession(
  sessionId: string,
  userId: string,
  threadId: string
): Promise<AgentSession> {
  const existing = await getSession(sessionId);

  if (existing) {
    return existing;
  }

  return createSession(sessionId, userId, threadId);
}

/**
 * Update an existing session.
 * Refreshes the TTL on every update.
 * Returns the updated session or null if session doesn't exist.
 */
export async function updateSession(
  sessionId: string,
  updates: Partial<Omit<AgentSession, 'sessionId' | 'createdAt'>>
): Promise<AgentSession | null> {
  const redis = getRedisClient();
  const key = getSessionKey(sessionId);

  const existingData = await redis.get(key);

  if (!existingData) {
    return null;
  }

  let existingSession: AgentSession;
  try {
    existingSession = JSON.parse(existingData) as AgentSession;
  } catch {
    console.error('[AgentSessions] Failed to parse existing session:', sessionId);
    return null;
  }

  const updatedSession: AgentSession = {
    ...existingSession,
    ...updates,
    sessionId: existingSession.sessionId,
    createdAt: existingSession.createdAt,
    updatedAt: Date.now(),
  };

  await redis.setex(key, SESSION_TTL_SECONDS, JSON.stringify(updatedSession));

  return updatedSession;
}

/**
 * Delete an agent session by ID.
 * Returns true if session was deleted, false if it didn't exist.
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = getSessionKey(sessionId);

  const result = await redis.del(key);

  return result > 0;
}

// ============================================================================
// Message Management
// ============================================================================

/**
 * Add a message to an agent session.
 * Increments turn count for user messages.
 */
export async function addSessionMessage(
  sessionId: string,
  role: AgentMessageRole,
  content: string,
  options?: {
    toolCallId?: string;
    toolName?: string;
  }
): Promise<AgentSession | null> {
  const session = await getSession(sessionId);

  if (!session) {
    return null;
  }

  const newMessage: AgentMessage = {
    role,
    content,
    timestamp: Date.now(),
    ...(options?.toolCallId && { toolCallId: options.toolCallId }),
    ...(options?.toolName && { toolName: options.toolName }),
  };

  // Increment turn count on user messages
  const newTurnCount = role === 'user' ? session.turnCount + 1 : session.turnCount;

  return updateSession(sessionId, {
    messages: [...session.messages, newMessage],
    turnCount: newTurnCount,
  });
}

/**
 * Get all messages from a session.
 */
export async function getSessionMessages(sessionId: string): Promise<AgentMessage[]> {
  const session = await getSession(sessionId);

  if (!session) {
    return [];
  }

  return session.messages;
}

// ============================================================================
// Status Management
// ============================================================================

/**
 * Update the status of an agent session.
 */
export async function updateSessionStatus(
  sessionId: string,
  status: AgentSessionStatus
): Promise<AgentSession | null> {
  return updateSession(sessionId, { status });
}

/**
 * Mark a session as processing (agent is working).
 */
export async function setSessionProcessing(sessionId: string): Promise<AgentSession | null> {
  return updateSessionStatus(sessionId, 'processing');
}

/**
 * Mark a session as completed.
 */
export async function setSessionCompleted(sessionId: string): Promise<AgentSession | null> {
  return updateSession(sessionId, {
    status: 'completed',
    pendingAction: null,
  });
}

/**
 * Mark a session as cancelled.
 */
export async function setSessionCancelled(sessionId: string): Promise<AgentSession | null> {
  return updateSession(sessionId, {
    status: 'cancelled',
    pendingAction: null,
  });
}

/**
 * Mark a session as errored.
 */
export async function setSessionError(
  sessionId: string,
  errorDetails?: Record<string, unknown>
): Promise<AgentSession | null> {
  return updateSession(sessionId, {
    status: 'error',
    pendingAction: null,
    ...(errorDetails && { metadata: { error: errorDetails } }),
  });
}

// ============================================================================
// Pending Action Management
// ============================================================================

/**
 * Set a pending action on a session.
 * Updates session status to awaiting_user_action or awaiting_signature based on action type.
 */
export async function setSessionPendingAction(
  sessionId: string,
  action: Omit<AgentPendingAction, 'createdAt'>
): Promise<AgentSession | null> {
  const pendingAction: AgentPendingAction = {
    ...action,
    createdAt: Date.now(),
  };

  const status: AgentSessionStatus =
    action.type === 'signature' ? 'awaiting_signature' : 'awaiting_user_action';

  return updateSession(sessionId, {
    pendingAction,
    status,
  });
}

/**
 * Clear the pending action from a session.
 * Resets status to processing or idle based on context.
 */
export async function clearSessionPendingAction(
  sessionId: string,
  newStatus: AgentSessionStatus = 'processing'
): Promise<AgentSession | null> {
  return updateSession(sessionId, {
    pendingAction: null,
    status: newStatus,
  });
}

/**
 * Get the current pending action from a session.
 */
export async function getSessionPendingAction(
  sessionId: string
): Promise<AgentPendingAction | null> {
  const session = await getSession(sessionId);

  if (!session) {
    return null;
  }

  return session.pendingAction;
}

/**
 * Check if a session is awaiting user action.
 */
export async function isAwaitingUserAction(sessionId: string): Promise<boolean> {
  const session = await getSession(sessionId);

  if (!session) {
    return false;
  }

  return (
    session.status === 'awaiting_user_action' ||
    session.status === 'awaiting_signature' ||
    session.pendingAction !== null
  );
}

/**
 * Check if a pending action has expired.
 */
export async function isPendingActionExpired(sessionId: string): Promise<boolean> {
  const pendingAction = await getSessionPendingAction(sessionId);

  if (!pendingAction || !pendingAction.expiresAt) {
    return false;
  }

  return Date.now() > pendingAction.expiresAt;
}

// ============================================================================
// Cost Tracking
// ============================================================================

/**
 * Update session cost with new token usage.
 * Automatically calculates estimated USD cost.
 */
export async function updateSessionCost(
  sessionId: string,
  inputTokens: number,
  outputTokens: number
): Promise<AgentSession | null> {
  const session = await getSession(sessionId);

  if (!session) {
    return null;
  }

  // Pricing based on Claude 3.5 Sonnet (approximate)
  const INPUT_TOKEN_COST_USD = 0.003 / 1000; // $0.003 per 1K input tokens
  const OUTPUT_TOKEN_COST_USD = 0.015 / 1000; // $0.015 per 1K output tokens

  const newCost: SessionCost = {
    inputTokens: session.cost.inputTokens + inputTokens,
    outputTokens: session.cost.outputTokens + outputTokens,
    estimatedCostUsd:
      session.cost.estimatedCostUsd +
      inputTokens * INPUT_TOKEN_COST_USD +
      outputTokens * OUTPUT_TOKEN_COST_USD,
  };

  return updateSession(sessionId, { cost: newCost });
}

/**
 * Get the total cost of a session.
 */
export async function getSessionCost(sessionId: string): Promise<SessionCost | null> {
  const session = await getSession(sessionId);

  if (!session) {
    return null;
  }

  return session.cost;
}

// ============================================================================
// Turn Count
// ============================================================================

/**
 * Get the current turn count for a session.
 */
export async function getSessionTurnCount(sessionId: string): Promise<number> {
  const session = await getSession(sessionId);

  if (!session) {
    return 0;
  }

  return session.turnCount;
}

/**
 * Increment the turn count for a session.
 */
export async function incrementSessionTurnCount(sessionId: string): Promise<AgentSession | null> {
  const session = await getSession(sessionId);

  if (!session) {
    return null;
  }

  return updateSession(sessionId, {
    turnCount: session.turnCount + 1,
  });
}

// ============================================================================
// Session TTL Management
// ============================================================================

/**
 * Refresh session TTL without modifying data.
 * Useful for keeping sessions alive during long operations.
 */
export async function refreshSessionTTL(sessionId: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = getSessionKey(sessionId);

  const result = await redis.expire(key, SESSION_TTL_SECONDS);

  return result === 1;
}

/**
 * Get remaining TTL for a session in seconds.
 * Returns -2 if session doesn't exist, -1 if no TTL is set.
 */
export async function getSessionTTL(sessionId: string): Promise<number> {
  const redis = getRedisClient();
  const key = getSessionKey(sessionId);

  return redis.ttl(key);
}

// ============================================================================
// Session Metadata
// ============================================================================

/**
 * Update session metadata.
 */
export async function updateSessionMetadata(
  sessionId: string,
  metadata: Record<string, unknown>
): Promise<AgentSession | null> {
  const session = await getSession(sessionId);

  if (!session) {
    return null;
  }

  return updateSession(sessionId, {
    metadata: {
      ...session.metadata,
      ...metadata,
    },
  });
}
