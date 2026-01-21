// Redis client exports
export {
  getRedisClient,
  closeRedisConnection,
  isRedisReady,
  initRedis,
} from './redisClient';

// Session store exports
export {
  // Types
  type SessionStatus,
  type PendingActionType,
  type CurrentActionType,
  type MessageRole,
  type SessionMessage,
  type PendingAction,
  type Session,
  // Core CRUD operations
  getSession,
  createSession,
  updateSession,
  deleteSession,
  // Convenience methods
  addMessageToSession,
  setPendingAction,
  clearPendingAction,
  setCurrentAction,
  completeSession,
  cancelSession,
  getOrCreateSession,
  refreshSessionTTL,
  getSessionTTL,
} from './sessionStore';
