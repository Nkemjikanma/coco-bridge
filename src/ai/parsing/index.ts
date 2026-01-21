/**
 * Natural Language Parsing Module
 * Exports for intent classification, entity extraction, and normalization.
 * User Story: US-022 - Natural Language Parsing
 */

// Parser exports
export {
  parseUserMessage,
  detectIntent,
  BRIDGE_PATTERNS,
  BALANCE_PATTERNS,
  SWAP_BRIDGE_PATTERNS,
  CANCEL_PATTERNS,
  CONFIRM_PATTERNS,
  REJECT_PATTERNS,
  HELP_PATTERNS,
} from './parser';

// Normalizer exports
export {
  normalizeChain,
  normalizeToken,
  normalizeAmount,
  CHAIN_ALIASES,
  CHAIN_BY_ID,
  TOKEN_ALIASES,
} from './normalizer';

// Type exports
export type {
  BridgeIntent,
  ConfidenceLevel,
  ParsedAmount,
  ParsedChain,
  ParsedToken,
  ParsedBridgeRequest,
  ParsedSwapBridgeRequest,
  ParsedBalanceRequest,
  ParsedHelpRequest,
  ParsedCancelRequest,
  ParsedConfirmRequest,
  ParsedRejectRequest,
  ParsedUnknownRequest,
  ParsedRequest,
  ParseResult,
  ParseResultSuccess,
  ParseResultError,
} from './types';

// Type guard exports
export {
  isParsedBridgeRequest,
  isParsedSwapBridgeRequest,
  isParsedBalanceRequest,
  isParsedHelpRequest,
  isParsedCancelRequest,
  isParsedConfirmRequest,
  isParsedRejectRequest,
  isParsedUnknownRequest,
  isParseResultSuccess,
  isParseResultError,
} from './types';
