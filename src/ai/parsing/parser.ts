/**
 * Natural Language Parser
 * Parses user messages to extract intents and entities for bridge operations.
 * User Story: US-022 - Natural Language Parsing
 *
 * Handles:
 * - 'bridge X ETH from A to B'
 * - 'move my USDC to Optimism'
 * - 'send 100 USDC from Polygon to Base'
 * - 'swap ETH on Base for USDC on mainnet'
 * - 'what's my balance?'
 * - Agent asks for clarification when intent is unclear
 */

import type {
  BridgeIntent,
  ConfidenceLevel,
  ParsedAmount,
  ParsedBalanceRequest,
  ParsedBridgeRequest,
  ParsedCancelRequest,
  ParsedChain,
  ParsedConfirmRequest,
  ParsedHelpRequest,
  ParsedRejectRequest,
  ParsedSwapBridgeRequest,
  ParsedToken,
  ParsedUnknownRequest,
  ParseResult,
} from './types';
import { normalizeAmount, normalizeChain, normalizeToken } from './normalizer';

// ============================================================================
// Intent Detection Patterns
// ============================================================================

/** Patterns that indicate a bridge intent */
const BRIDGE_PATTERNS = [
  /\b(?:bridge|move|send|transfer)\b/i,
  /\bto\s+(?:ethereum|base|optimism|polygon|arbitrum|mainnet|op|arb)\b/i,
  /\bfrom\s+(?:ethereum|base|optimism|polygon|arbitrum|mainnet|op|arb)\b/i,
  /\b(?:ethereum|base|optimism|polygon|arbitrum)\s*(?:->|to|→)\s*(?:ethereum|base|optimism|polygon|arbitrum)\b/i,
];

/** Patterns that indicate a swap+bridge intent */
const SWAP_BRIDGE_PATTERNS = [
  /\bswap\b.*\bfor\b/i,
  /\bconvert\b.*\bto\b/i,
  /\bexchange\b.*\bfor\b/i,
  /\b(?:eth|usdc|usdt|weth|matic)\b.*\bfor\b.*\b(?:eth|usdc|usdt|weth|matic)\b/i,
];

/** Patterns that indicate a balance check intent */
const BALANCE_PATTERNS = [
  /\b(?:balance|balances)\b/i,
  /\bhow\s+much\b/i,
  /\bwhat(?:'s|\s+is)\s+my\b/i,
  /\bcheck\s+(?:my\s+)?(?:balance|wallet)\b/i,
  /\bdo\s+i\s+have\b/i,
  /\bshow\s+(?:me\s+)?(?:my\s+)?balance\b/i,
];

/** Patterns that indicate a help intent */
const HELP_PATTERNS = [
  /\bhelp\b/i,
  /\bhow\s+do\s+(?:i|you)\b/i,
  /\bwhat\s+can\s+(?:i|you)\b/i,
  /\bcommands?\b/i,
  /\binstructions?\b/i,
  /\bguide\b/i,
];

/** Patterns that indicate a cancel intent */
const CANCEL_PATTERNS = [
  /\bcancel\b/i,
  /\bstop\b/i,
  /\bnevermind\b/i,
  /\bnever\s*mind\b/i,
  /\bforget\s+it\b/i,
  /\babort\b/i,
  /\bdon'?t\b.*\bdo\s+(?:it|that|this)\b/i,
];

/** Patterns that indicate a confirm intent */
const CONFIRM_PATTERNS = [
  /^(?:yes|yep|yeah|yup|y|ok|okay|sure|confirm|approved?|go\s*ahead|do\s*it|proceed)$/i,
  /\b(?:confirm|approve|accept)\b/i,
  /^(?:✓|✔|👍|👌)$/,
];

/** Patterns that indicate a reject intent */
const REJECT_PATTERNS = [
  /^(?:no|nope|nah|n|reject|decline|deny)$/i,
  /\b(?:reject|decline|deny|refuse)\b/i,
  /^(?:✗|✘|👎|❌)$/,
];

// ============================================================================
// Entity Extraction Patterns
// ============================================================================

/** Pattern to extract amount (e.g., "0.1", "100", "all") */
const AMOUNT_PATTERN = /(\d+\.?\d*|\.\d+|all|max|everything)\s*(?:(?:of\s+)?(?:my\s+)?)?/i;

/** Pattern to extract token symbol */
const TOKEN_PATTERN = /\b(eth|ether|ethereum|usdc|usdt|tether|weth|matic|polygon)\b/i;

/** Pattern to extract "from X to Y" chains */
const FROM_TO_PATTERN = /from\s+(\w+(?:\s+\w+)?)\s+to\s+(\w+(?:\s+\w+)?)/i;

/** Pattern to extract "X to Y" chains (without 'from') */
const TO_CHAIN_PATTERN = /to\s+(ethereum|base|optimism|polygon|arbitrum|mainnet|op|arb)/i;

/** Pattern to extract "on X" chain */
const ON_CHAIN_PATTERN = /on\s+(ethereum|base|optimism|polygon|arbitrum|mainnet|op|arb)/i;

/** Pattern to extract arrow notation "X -> Y" */
const ARROW_PATTERN = /(\w+)\s*(?:->|→|to)\s*(\w+)/i;

/** Pattern to extract "for Y" (swap target) */
const FOR_TOKEN_PATTERN = /for\s+(\w+)/i;

// ============================================================================
// Main Parser Function
// ============================================================================

/**
 * Parse a user message to extract intent and entities.
 * @param message - The raw user message
 * @returns ParseResult with the parsed request or error
 */
export function parseUserMessage(message: string): ParseResult {
  if (!message || typeof message !== 'string') {
    return {
      success: false,
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Message must be a non-empty string',
    };
  }

  const trimmedMessage = message.trim();
  if (trimmedMessage.length === 0) {
    return {
      success: false,
      errorCode: 'EMPTY_MESSAGE',
      errorMessage: 'Message cannot be empty',
    };
  }

  // Detect intent
  const intent = detectIntent(trimmedMessage);

  // Parse based on intent
  switch (intent) {
    case 'cancel':
      return parseCancelRequest(trimmedMessage);
    case 'confirm':
      return parseConfirmRequest(trimmedMessage);
    case 'reject':
      return parseRejectRequest(trimmedMessage);
    case 'help':
      return parseHelpRequest(trimmedMessage);
    case 'balance':
      return parseBalanceRequest(trimmedMessage);
    case 'swap_bridge':
      return parseSwapBridgeRequest(trimmedMessage);
    case 'bridge':
      return parseBridgeRequest(trimmedMessage);
    case 'unknown':
    default:
      return parseUnknownRequest(trimmedMessage);
  }
}

// ============================================================================
// Intent Detection
// ============================================================================

/**
 * Detect the intent from a user message.
 * @param message - The user message
 * @returns The detected intent
 */
export function detectIntent(message: string): BridgeIntent {
  const lower = message.toLowerCase();

  // Cancel takes priority (user wants to stop)
  if (matchesPatterns(lower, CANCEL_PATTERNS)) {
    return 'cancel';
  }

  // Confirm/Reject for pending actions
  if (matchesPatterns(lower, CONFIRM_PATTERNS)) {
    return 'confirm';
  }
  if (matchesPatterns(lower, REJECT_PATTERNS)) {
    return 'reject';
  }

  // Help requests - check if it's a question about how to do something
  // "how do I bridge?" is a help request, not a bridge action
  if (matchesPatterns(lower, HELP_PATTERNS)) {
    // If it's a "how do I" or "what can" question, it's always help
    if (/\bhow\s+do\s+(?:i|you)\b/i.test(lower) || /\bwhat\s+can\s+(?:i|you)\b/i.test(lower)) {
      return 'help';
    }
    // Otherwise, only treat as help if no action words present
    if (!matchesPatterns(lower, BRIDGE_PATTERNS) || /\bhelp\b/i.test(lower)) {
      return 'help';
    }
  }

  // Balance checks
  if (matchesPatterns(lower, BALANCE_PATTERNS)) {
    return 'balance';
  }

  // Swap + Bridge (must check before plain bridge)
  if (matchesPatterns(lower, SWAP_BRIDGE_PATTERNS)) {
    return 'swap_bridge';
  }

  // Bridge/transfer operations
  if (matchesPatterns(lower, BRIDGE_PATTERNS)) {
    return 'bridge';
  }

  return 'unknown';
}

/**
 * Check if a message matches any of the given patterns.
 */
function matchesPatterns(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

// ============================================================================
// Request Parsers
// ============================================================================

/**
 * Parse a bridge request.
 * Handles: 'bridge X ETH from A to B', 'move my USDC to Optimism', 'send 100 USDC from Polygon to Base'
 */
function parseBridgeRequest(message: string): ParseResult<ParsedBridgeRequest> {
  const entities = extractBridgeEntities(message);
  const missing: Array<'amount' | 'token' | 'fromChain' | 'toChain'> = [];

  if (!entities.amount) missing.push('amount');
  if (!entities.token) missing.push('token');
  if (!entities.fromChain) missing.push('fromChain');
  if (!entities.toChain) missing.push('toChain');

  const confidence = calculateOverallConfidence(entities, missing);

  const parsed: ParsedBridgeRequest = {
    intent: 'bridge',
    amount: entities.amount,
    token: entities.token,
    fromChain: entities.fromChain,
    toChain: entities.toChain,
    confidence,
    missing,
    originalMessage: message,
  };

  const needsClarification = missing.length > 0;
  const clarificationQuestion = needsClarification
    ? generateBridgeClarificationQuestion(missing, entities)
    : undefined;

  return {
    success: true,
    parsed,
    needsClarification,
    clarificationQuestion,
  };
}

/**
 * Parse a swap+bridge request.
 * Handles: 'swap ETH on Base for USDC on mainnet'
 */
function parseSwapBridgeRequest(message: string): ParseResult<ParsedSwapBridgeRequest> {
  const entities = extractSwapBridgeEntities(message);
  const missing: Array<'amount' | 'inputToken' | 'outputToken' | 'fromChain' | 'toChain'> = [];

  if (!entities.amount) missing.push('amount');
  if (!entities.inputToken) missing.push('inputToken');
  if (!entities.outputToken) missing.push('outputToken');
  if (!entities.fromChain) missing.push('fromChain');
  if (!entities.toChain) missing.push('toChain');

  const confidence = calculateOverallConfidence(entities, missing);

  const parsed: ParsedSwapBridgeRequest = {
    intent: 'swap_bridge',
    amount: entities.amount,
    inputToken: entities.inputToken,
    outputToken: entities.outputToken,
    fromChain: entities.fromChain,
    toChain: entities.toChain,
    confidence,
    missing,
    originalMessage: message,
  };

  const needsClarification = missing.length > 0;
  const clarificationQuestion = needsClarification
    ? generateSwapBridgeClarificationQuestion(missing, entities)
    : undefined;

  return {
    success: true,
    parsed,
    needsClarification,
    clarificationQuestion,
  };
}

/**
 * Parse a balance check request.
 * Handles: "what's my balance?", "how much ETH do I have on Arbitrum?"
 */
function parseBalanceRequest(message: string): ParseResult<ParsedBalanceRequest> {
  // Extract optional token and chain
  const tokenMatch = message.match(TOKEN_PATTERN);
  const chainMatch = message.match(ON_CHAIN_PATTERN) || message.match(/on\s+(\w+)/i);

  const token = tokenMatch ? normalizeToken(tokenMatch[1]!) : null;
  const chain = chainMatch ? normalizeChain(chainMatch[1]!) : null;

  const parsed: ParsedBalanceRequest = {
    intent: 'balance',
    token,
    chain,
    confidence: 'high',
    originalMessage: message,
  };

  return {
    success: true,
    parsed,
    needsClarification: false,
  };
}

/**
 * Parse a help request.
 */
function parseHelpRequest(message: string): ParseResult<ParsedHelpRequest> {
  // Try to extract a specific topic
  let topic: string | null = null;

  if (/bridge/i.test(message)) topic = 'bridge';
  else if (/swap/i.test(message)) topic = 'swap';
  else if (/balance/i.test(message)) topic = 'balance';
  else if (/fee|cost/i.test(message)) topic = 'fees';
  else if (/chain|network/i.test(message)) topic = 'chains';
  else if (/token/i.test(message)) topic = 'tokens';

  const parsed: ParsedHelpRequest = {
    intent: 'help',
    topic,
    confidence: 'high',
    originalMessage: message,
  };

  return {
    success: true,
    parsed,
    needsClarification: false,
  };
}

/**
 * Parse a cancel request.
 */
function parseCancelRequest(message: string): ParseResult<ParsedCancelRequest> {
  const parsed: ParsedCancelRequest = {
    intent: 'cancel',
    confidence: 'high',
    originalMessage: message,
  };

  return {
    success: true,
    parsed,
    needsClarification: false,
  };
}

/**
 * Parse a confirm request.
 */
function parseConfirmRequest(message: string): ParseResult<ParsedConfirmRequest> {
  const parsed: ParsedConfirmRequest = {
    intent: 'confirm',
    confidence: 'high',
    originalMessage: message,
  };

  return {
    success: true,
    parsed,
    needsClarification: false,
  };
}

/**
 * Parse a reject request.
 */
function parseRejectRequest(message: string): ParseResult<ParsedRejectRequest> {
  const parsed: ParsedRejectRequest = {
    intent: 'reject',
    confidence: 'high',
    originalMessage: message,
  };

  return {
    success: true,
    parsed,
    needsClarification: false,
  };
}

/**
 * Handle unknown/ambiguous requests.
 */
function parseUnknownRequest(message: string): ParseResult<ParsedUnknownRequest> {
  // Try to determine possible intents
  const possibleIntents: BridgeIntent[] = [];
  const lower = message.toLowerCase();

  // Check for partial matches
  if (/\b(eth|usdc|usdt|matic|token)\b/i.test(lower)) {
    possibleIntents.push('bridge', 'balance');
  }
  if (/\b(chain|network|ethereum|base|optimism|polygon|arbitrum)\b/i.test(lower)) {
    possibleIntents.push('bridge');
  }
  if (/\b\d+\.?\d*\b/.test(lower)) {
    possibleIntents.push('bridge');
  }

  // Generate appropriate clarification
  const clarificationNeeded = generateUnknownClarification(message, possibleIntents);

  const parsed: ParsedUnknownRequest = {
    intent: 'unknown',
    possibleIntents: possibleIntents.length > 0 ? possibleIntents : ['bridge', 'balance', 'help'],
    clarificationNeeded,
    confidence: 'low',
    originalMessage: message,
  };

  return {
    success: true,
    parsed,
    needsClarification: true,
    clarificationQuestion: clarificationNeeded,
  };
}

// ============================================================================
// Entity Extraction
// ============================================================================

interface BridgeEntities {
  amount: ParsedAmount | null;
  token: ParsedToken | null;
  fromChain: ParsedChain | null;
  toChain: ParsedChain | null;
}

interface SwapBridgeEntities extends BridgeEntities {
  inputToken: ParsedToken | null;
  outputToken: ParsedToken | null;
}

/**
 * Extract entities for a bridge request.
 */
function extractBridgeEntities(message: string): BridgeEntities {
  // Extract amount
  const amountMatch = message.match(AMOUNT_PATTERN);
  const amount = amountMatch ? normalizeAmount(amountMatch[1]!) : null;

  // Extract token (first token found is the one being bridged)
  const tokenMatch = message.match(TOKEN_PATTERN);
  const token = tokenMatch ? normalizeToken(tokenMatch[1]!) : null;

  // Extract chains
  let fromChain: ParsedChain | null = null;
  let toChain: ParsedChain | null = null;

  // Try "from X to Y" pattern first
  const fromToMatch = message.match(FROM_TO_PATTERN);
  if (fromToMatch) {
    fromChain = normalizeChain(fromToMatch[1]!);
    toChain = normalizeChain(fromToMatch[2]!);
  }

  // Try arrow notation "X -> Y"
  if (!fromChain || !toChain) {
    const arrowMatch = message.match(ARROW_PATTERN);
    if (arrowMatch) {
      const chain1 = normalizeChain(arrowMatch[1]!);
      const chain2 = normalizeChain(arrowMatch[2]!);
      if (chain1 && chain2) {
        fromChain = chain1;
        toChain = chain2;
      }
    }
  }

  // Try "to Y" pattern (destination only, e.g., "move my USDC to Optimism")
  if (!toChain) {
    const toMatch = message.match(TO_CHAIN_PATTERN);
    if (toMatch) {
      toChain = normalizeChain(toMatch[1]!);
    }
  }

  // If only destination is specified, amount might mean "all"
  if (!amount && !fromChain && toChain) {
    const hasMyKeyword = /\bmy\b/i.test(message);
    if (hasMyKeyword) {
      // "move my USDC to Optimism" implies all USDC
      return {
        amount: { raw: 'all', value: null, isAll: true },
        token,
        fromChain,
        toChain,
      };
    }
  }

  return { amount, token, fromChain, toChain };
}

/**
 * Extract entities for a swap+bridge request.
 */
function extractSwapBridgeEntities(message: string): SwapBridgeEntities {
  const base = extractBridgeEntities(message);

  // For swap+bridge, we need two tokens
  const tokenMatches = message.match(new RegExp(TOKEN_PATTERN.source, 'gi'));
  let inputToken: ParsedToken | null = null;
  let outputToken: ParsedToken | null = null;

  if (tokenMatches && tokenMatches.length >= 2) {
    inputToken = normalizeToken(tokenMatches[0]!);
    outputToken = normalizeToken(tokenMatches[1]!);
  } else if (tokenMatches && tokenMatches.length === 1) {
    // Check for "for Y" pattern
    const forMatch = message.match(FOR_TOKEN_PATTERN);
    if (forMatch) {
      inputToken = normalizeToken(tokenMatches[0]!);
      outputToken = normalizeToken(forMatch[1]!);
    } else {
      inputToken = normalizeToken(tokenMatches[0]!);
    }
  }

  // Extract chains - for swap+bridge, "on X" might indicate source, "on Y" destination
  const onMatches = message.match(new RegExp(ON_CHAIN_PATTERN.source, 'gi'));
  let fromChain = base.fromChain;
  let toChain = base.toChain;

  if (onMatches && onMatches.length >= 2 && !fromChain && !toChain) {
    const chain1Match = onMatches[0]!.match(ON_CHAIN_PATTERN);
    const chain2Match = onMatches[1]!.match(ON_CHAIN_PATTERN);
    if (chain1Match && chain2Match) {
      fromChain = normalizeChain(chain1Match[1]!);
      toChain = normalizeChain(chain2Match[1]!);
    }
  }

  return {
    ...base,
    inputToken,
    outputToken,
    fromChain,
    toChain,
  };
}

// ============================================================================
// Clarification Generation
// ============================================================================

/**
 * Generate a clarification question for a bridge request.
 */
function generateBridgeClarificationQuestion(
  missing: Array<'amount' | 'token' | 'fromChain' | 'toChain'>,
  entities: BridgeEntities
): string {
  const parts: string[] = [];

  if (missing.includes('amount') && missing.includes('token')) {
    parts.push('How much of which token would you like to bridge?');
  } else if (missing.includes('amount')) {
    parts.push(`How much ${entities.token?.symbol || 'tokens'} would you like to bridge?`);
  } else if (missing.includes('token')) {
    parts.push('Which token would you like to bridge?');
  }

  if (missing.includes('fromChain') && missing.includes('toChain')) {
    parts.push('Which chains should I bridge from and to?');
  } else if (missing.includes('fromChain')) {
    parts.push(`Which chain are you bridging from to ${entities.toChain?.name || 'the destination'}?`);
  } else if (missing.includes('toChain')) {
    parts.push(`Which chain would you like to bridge to from ${entities.fromChain?.name || 'the source'}?`);
  }

  if (parts.length === 0) {
    return 'Could you provide more details about your bridge request?';
  }

  return parts.join(' ');
}

/**
 * Generate a clarification question for a swap+bridge request.
 */
function generateSwapBridgeClarificationQuestion(
  missing: Array<'amount' | 'inputToken' | 'outputToken' | 'fromChain' | 'toChain'>,
  entities: SwapBridgeEntities
): string {
  const parts: string[] = [];

  if (missing.includes('amount')) {
    parts.push(
      `How much ${entities.inputToken?.symbol || 'tokens'} would you like to swap?`
    );
  }

  if (missing.includes('inputToken') || missing.includes('outputToken')) {
    if (missing.includes('inputToken') && missing.includes('outputToken')) {
      parts.push('Which token would you like to swap from and to?');
    } else if (missing.includes('outputToken')) {
      parts.push(`Which token would you like to receive for your ${entities.inputToken?.symbol}?`);
    } else {
      parts.push('Which token would you like to swap?');
    }
  }

  if (missing.includes('fromChain') || missing.includes('toChain')) {
    if (missing.includes('fromChain') && missing.includes('toChain')) {
      parts.push('Which chains should I use for this swap?');
    } else if (missing.includes('toChain')) {
      parts.push('Which chain should receive the swapped tokens?');
    } else {
      parts.push('Which chain are you swapping from?');
    }
  }

  if (parts.length === 0) {
    return 'Could you provide more details about your swap request?';
  }

  return parts.join(' ');
}

/**
 * Generate a clarification question for an unknown request.
 */
function generateUnknownClarification(_message: string, possibleIntents: BridgeIntent[]): string {
  if (possibleIntents.length === 0) {
    return "I'm not sure what you'd like to do. Would you like to bridge tokens, check your balance, or get help?";
  }

  if (possibleIntents.includes('bridge') && possibleIntents.includes('balance')) {
    return 'Would you like to bridge tokens or check your balance?';
  }

  if (possibleIntents.includes('bridge')) {
    return 'It looks like you want to bridge tokens. Could you specify the amount, token, and chains? For example: "bridge 0.1 ETH from Base to Ethereum"';
  }

  return "I'm not sure what you'd like to do. Try something like:\n• \"bridge 0.1 ETH from Base to Ethereum\"\n• \"what's my balance?\"\n• \"help\"";
}

// ============================================================================
// Confidence Calculation
// ============================================================================

/**
 * Calculate overall confidence based on extracted entities and missing fields.
 */
function calculateOverallConfidence(
  entities: BridgeEntities | SwapBridgeEntities,
  missing: string[]
): ConfidenceLevel {
  const totalFields = Object.keys(entities).length;
  const foundFields = totalFields - missing.length;
  const ratio = foundFields / totalFields;

  if (ratio >= 0.75) return 'high';
  if (ratio >= 0.5) return 'medium';
  return 'low';
}

// ============================================================================
// Exports
// ============================================================================

export {
  BRIDGE_PATTERNS,
  BALANCE_PATTERNS,
  SWAP_BRIDGE_PATTERNS,
  CANCEL_PATTERNS,
  CONFIRM_PATTERNS,
  REJECT_PATTERNS,
  HELP_PATTERNS,
};
