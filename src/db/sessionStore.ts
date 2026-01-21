import { getRedisClient } from './redisClient';

/**
 * Session Store for managing multi-turn conversations.
 * Mirrors coco-bot's session architecture with 30-minute TTL.
 */

/** Session TTL in seconds (30 minutes) */
const SESSION_TTL_SECONDS = 30 * 60;

/** Redis key prefix for sessions */
const SESSION_KEY_PREFIX = 'coco-bridge:session:';

/** Session status types */
export type SessionStatus = 'active' | 'pending_confirmation' | 'completed' | 'cancelled' | 'error';

/** Pending action types for bridge operations */
export type PendingActionType =
  | 'bridge'
  | 'swap_bridge'
  | 'token_approval'
  | 'balance_check'
  | 'quote_request'
  | null;

/** Current action being executed */
export type CurrentActionType =
  | 'awaiting_signature'
  | 'processing_transaction'
  | 'checking_balance'
  | 'getting_quote'
  | 'idle'
  | null;

/** Message role in conversation */
export type MessageRole = 'user' | 'assistant' | 'system';

/** Individual message in a session */
export interface SessionMessage {
  role: MessageRole;
  content: string;
  timestamp: number;
}

/** Pending action data structure */
export interface PendingAction {
  type: PendingActionType;
  data: Record<string, unknown>;
  createdAt: number;
}

/** Session data structure */
export interface Session {
  sessionId: string;
  userId: string;
  threadId: string;
  messages: SessionMessage[];
  pendingAction: PendingAction | null;
  currentAction: CurrentActionType;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
}

/**
 * Generate the Redis key for a session.
 */
function getSessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

/**
 * Get a session by ID.
 * Returns null if session doesn't exist or has expired.
 */
export async function getSession(sessionId: string): Promise<Session | null> {
  const redis = getRedisClient();
  const key = getSessionKey(sessionId);

  const data = await redis.get(key);

  if (!data) {
    return null;
  }

  try {
    const session = JSON.parse(data) as Session;
    return session;
  } catch {
    console.error('[SessionStore] Failed to parse session data:', sessionId);
    return null;
  }
}

/**
 * Create a new session.
 * Automatically sets createdAt, updatedAt, and applies 30-minute TTL.
 */
export async function createSession(
  sessionId: string,
  userId: string,
  threadId: string,
  initialMessage?: SessionMessage
): Promise<Session> {
  const redis = getRedisClient();
  const key = getSessionKey(sessionId);
  const now = Date.now();

  const session: Session = {
    sessionId,
    userId,
    threadId,
    messages: initialMessage ? [initialMessage] : [],
    pendingAction: null,
    currentAction: 'idle',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  await redis.setex(key, SESSION_TTL_SECONDS, JSON.stringify(session));

  return session;
}

/**
 * Update an existing session.
 * Refreshes the TTL on every update.
 * Returns the updated session or null if session doesn't exist.
 */
export async function updateSession(
  sessionId: string,
  updates: Partial<Omit<Session, 'sessionId' | 'createdAt'>>
): Promise<Session | null> {
  const redis = getRedisClient();
  const key = getSessionKey(sessionId);

  const existingData = await redis.get(key);

  if (!existingData) {
    return null;
  }

  let existingSession: Session;
  try {
    existingSession = JSON.parse(existingData) as Session;
  } catch {
    console.error('[SessionStore] Failed to parse existing session:', sessionId);
    return null;
  }

  const updatedSession: Session = {
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
 * Delete a session by ID.
 * Returns true if session was deleted, false if it didn't exist.
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = getSessionKey(sessionId);

  const result = await redis.del(key);

  return result > 0;
}

/**
 * Add a message to an existing session.
 * Convenience method that handles message array updates.
 */
export async function addMessageToSession(
  sessionId: string,
  message: Omit<SessionMessage, 'timestamp'>
): Promise<Session | null> {
  const session = await getSession(sessionId);

  if (!session) {
    return null;
  }

  const newMessage: SessionMessage = {
    ...message,
    timestamp: Date.now(),
  };

  return updateSession(sessionId, {
    messages: [...session.messages, newMessage],
  });
}

/**
 * Set a pending action on a session.
 */
export async function setPendingAction(
  sessionId: string,
  type: PendingActionType,
  data: Record<string, unknown>
): Promise<Session | null> {
  const pendingAction: PendingAction = {
    type,
    data,
    createdAt: Date.now(),
  };

  return updateSession(sessionId, {
    pendingAction,
    status: 'pending_confirmation',
  });
}

/**
 * Clear the pending action from a session.
 */
export async function clearPendingAction(sessionId: string): Promise<Session | null> {
  return updateSession(sessionId, {
    pendingAction: null,
    status: 'active',
  });
}

/**
 * Update the current action status.
 */
export async function setCurrentAction(
  sessionId: string,
  action: CurrentActionType
): Promise<Session | null> {
  return updateSession(sessionId, {
    currentAction: action,
  });
}

/**
 * Mark a session as completed.
 */
export async function completeSession(sessionId: string): Promise<Session | null> {
  return updateSession(sessionId, {
    status: 'completed',
    currentAction: 'idle',
    pendingAction: null,
  });
}

/**
 * Mark a session as cancelled.
 */
export async function cancelSession(sessionId: string): Promise<Session | null> {
  return updateSession(sessionId, {
    status: 'cancelled',
    currentAction: 'idle',
    pendingAction: null,
  });
}

/**
 * Get or create a session.
 * Useful for ensuring a session exists before operations.
 */
export async function getOrCreateSession(
  sessionId: string,
  userId: string,
  threadId: string
): Promise<Session> {
  const existing = await getSession(sessionId);

  if (existing) {
    return existing;
  }

  return createSession(sessionId, userId, threadId);
}

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
