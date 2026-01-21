/**
 * Natural Language Parsing Types
 * Type definitions for intent classification and entity extraction.
 * User Story: US-022 - Natural Language Parsing
 */

import type { ChainId } from '../../services/bridge';
import type { TokenSymbol } from '../../services/tokens';

// ============================================================================
// Intent Types
// ============================================================================

/** User intents that the agent can handle */
export type BridgeIntent =
  | 'bridge' // Bridge tokens from one chain to another
  | 'swap_bridge' // Swap token A for token B while bridging
  | 'balance' // Check balance(s)
  | 'help' // Request help or information
  | 'cancel' // Cancel current operation
  | 'confirm' // Confirm pending action
  | 'reject' // Reject/decline pending action
  | 'unknown'; // Intent cannot be determined

/** Confidence levels for parsed results */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

// ============================================================================
// Entity Types
// ============================================================================

/** Parsed amount from user input */
export interface ParsedAmount {
  /** Raw value as string (e.g., "0.1", "100", "all") */
  raw: string;
  /** Numeric value (null for "all" or "max") */
  value: number | null;
  /** Whether user said "all" or "max" */
  isAll: boolean;
}

/** Parsed chain reference from user input */
export interface ParsedChain {
  /** Original text from user input */
  raw: string;
  /** Resolved chain ID */
  chainId: ChainId;
  /** Chain name for display */
  name: string;
  /** Confidence in the match */
  confidence: ConfidenceLevel;
}

/** Parsed token reference from user input */
export interface ParsedToken {
  /** Original text from user input */
  raw: string;
  /** Resolved token symbol */
  symbol: TokenSymbol;
  /** Confidence in the match */
  confidence: ConfidenceLevel;
}

// ============================================================================
// Parsed Request Types
// ============================================================================

/** Parsed bridge request */
export interface ParsedBridgeRequest {
  intent: 'bridge';
  /** Amount to bridge */
  amount: ParsedAmount | null;
  /** Token to bridge */
  token: ParsedToken | null;
  /** Source chain */
  fromChain: ParsedChain | null;
  /** Destination chain */
  toChain: ParsedChain | null;
  /** Overall confidence in the parse */
  confidence: ConfidenceLevel;
  /** Missing required fields */
  missing: Array<'amount' | 'token' | 'fromChain' | 'toChain'>;
  /** Original user message */
  originalMessage: string;
}

/** Parsed swap + bridge request */
export interface ParsedSwapBridgeRequest {
  intent: 'swap_bridge';
  /** Amount to swap/bridge */
  amount: ParsedAmount | null;
  /** Input token (to swap from) */
  inputToken: ParsedToken | null;
  /** Output token (to receive) */
  outputToken: ParsedToken | null;
  /** Source chain */
  fromChain: ParsedChain | null;
  /** Destination chain */
  toChain: ParsedChain | null;
  /** Overall confidence in the parse */
  confidence: ConfidenceLevel;
  /** Missing required fields */
  missing: Array<'amount' | 'inputToken' | 'outputToken' | 'fromChain' | 'toChain'>;
  /** Original user message */
  originalMessage: string;
}

/** Parsed balance check request */
export interface ParsedBalanceRequest {
  intent: 'balance';
  /** Specific token to check (null = all tokens) */
  token: ParsedToken | null;
  /** Specific chain to check (null = all chains) */
  chain: ParsedChain | null;
  /** Overall confidence in the parse */
  confidence: ConfidenceLevel;
  /** Original user message */
  originalMessage: string;
}

/** Parsed help request */
export interface ParsedHelpRequest {
  intent: 'help';
  /** Specific topic (optional) */
  topic: string | null;
  /** Overall confidence in the parse */
  confidence: ConfidenceLevel;
  /** Original user message */
  originalMessage: string;
}

/** Parsed cancel request */
export interface ParsedCancelRequest {
  intent: 'cancel';
  /** Overall confidence in the parse */
  confidence: ConfidenceLevel;
  /** Original user message */
  originalMessage: string;
}

/** Parsed confirm request */
export interface ParsedConfirmRequest {
  intent: 'confirm';
  /** Overall confidence in the parse */
  confidence: ConfidenceLevel;
  /** Original user message */
  originalMessage: string;
}

/** Parsed reject request */
export interface ParsedRejectRequest {
  intent: 'reject';
  /** Overall confidence in the parse */
  confidence: ConfidenceLevel;
  /** Original user message */
  originalMessage: string;
}

/** Unknown intent - could not parse */
export interface ParsedUnknownRequest {
  intent: 'unknown';
  /** Best guess at the intent */
  possibleIntents: BridgeIntent[];
  /** Suggestion for clarification question */
  clarificationNeeded: string;
  /** Overall confidence in the parse */
  confidence: 'low';
  /** Original user message */
  originalMessage: string;
}

/** Union of all parsed request types */
export type ParsedRequest =
  | ParsedBridgeRequest
  | ParsedSwapBridgeRequest
  | ParsedBalanceRequest
  | ParsedHelpRequest
  | ParsedCancelRequest
  | ParsedConfirmRequest
  | ParsedRejectRequest
  | ParsedUnknownRequest;

// ============================================================================
// Parser Result Types
// ============================================================================

/** Successful parse result */
export interface ParseResultSuccess<T extends ParsedRequest = ParsedRequest> {
  success: true;
  /** The parsed request */
  parsed: T;
  /** Whether clarification is needed */
  needsClarification: boolean;
  /** Clarification question if needed */
  clarificationQuestion?: string;
}

/** Failed parse result */
export interface ParseResultError {
  success: false;
  /** Error code */
  errorCode: string;
  /** Human-readable error message */
  errorMessage: string;
}

/** Parse result union */
export type ParseResult<T extends ParsedRequest = ParsedRequest> =
  | ParseResultSuccess<T>
  | ParseResultError;

// ============================================================================
// Type Guards
// ============================================================================

/** Check if parsed request is a bridge request */
export function isParsedBridgeRequest(
  parsed: ParsedRequest
): parsed is ParsedBridgeRequest {
  return parsed.intent === 'bridge';
}

/** Check if parsed request is a swap+bridge request */
export function isParsedSwapBridgeRequest(
  parsed: ParsedRequest
): parsed is ParsedSwapBridgeRequest {
  return parsed.intent === 'swap_bridge';
}

/** Check if parsed request is a balance request */
export function isParsedBalanceRequest(
  parsed: ParsedRequest
): parsed is ParsedBalanceRequest {
  return parsed.intent === 'balance';
}

/** Check if parsed request is a help request */
export function isParsedHelpRequest(
  parsed: ParsedRequest
): parsed is ParsedHelpRequest {
  return parsed.intent === 'help';
}

/** Check if parsed request is a cancel request */
export function isParsedCancelRequest(
  parsed: ParsedRequest
): parsed is ParsedCancelRequest {
  return parsed.intent === 'cancel';
}

/** Check if parsed request is a confirm request */
export function isParsedConfirmRequest(
  parsed: ParsedRequest
): parsed is ParsedConfirmRequest {
  return parsed.intent === 'confirm';
}

/** Check if parsed request is a reject request */
export function isParsedRejectRequest(
  parsed: ParsedRequest
): parsed is ParsedRejectRequest {
  return parsed.intent === 'reject';
}

/** Check if parsed request is unknown */
export function isParsedUnknownRequest(
  parsed: ParsedRequest
): parsed is ParsedUnknownRequest {
  return parsed.intent === 'unknown';
}

/** Check if parse result was successful */
export function isParseResultSuccess<T extends ParsedRequest>(
  result: ParseResult<T>
): result is ParseResultSuccess<T> {
  return result.success === true;
}

/** Check if parse result was an error */
export function isParseResultError(result: ParseResult): result is ParseResultError {
  return result.success === false;
}
