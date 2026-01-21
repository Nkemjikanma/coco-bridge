/**
 * Chain and Token Normalizer
 * Handles aliases, variations, and common misspellings for chain and token names.
 * User Story: US-022 - Natural Language Parsing
 */

import { CHAIN_IDS, CHAIN_NAMES, type ChainId } from '../../services/bridge/bridgeConstants';
import { TOKEN_SYMBOLS, type TokenSymbol } from '../../services/tokens';
import type { ConfidenceLevel, ParsedChain, ParsedToken } from './types';

// ============================================================================
// Chain Aliases
// ============================================================================

/**
 * Map of chain aliases to chain IDs.
 * Includes common variations, abbreviations, and alternative names.
 */
const CHAIN_ALIASES: Record<string, ChainId> = {
  // Ethereum
  ethereum: CHAIN_IDS.ETHEREUM,
  eth: CHAIN_IDS.ETHEREUM,
  mainnet: CHAIN_IDS.ETHEREUM,
  'ethereum mainnet': CHAIN_IDS.ETHEREUM,
  'eth mainnet': CHAIN_IDS.ETHEREUM,
  l1: CHAIN_IDS.ETHEREUM,

  // Base
  base: CHAIN_IDS.BASE,
  'base mainnet': CHAIN_IDS.BASE,
  'coinbase base': CHAIN_IDS.BASE,

  // Optimism
  optimism: CHAIN_IDS.OPTIMISM,
  op: CHAIN_IDS.OPTIMISM,
  'op mainnet': CHAIN_IDS.OPTIMISM,
  'optimism mainnet': CHAIN_IDS.OPTIMISM,

  // Polygon
  polygon: CHAIN_IDS.POLYGON,
  matic: CHAIN_IDS.POLYGON,
  'polygon mainnet': CHAIN_IDS.POLYGON,
  'polygon pos': CHAIN_IDS.POLYGON,

  // Arbitrum
  arbitrum: CHAIN_IDS.ARBITRUM,
  arb: CHAIN_IDS.ARBITRUM,
  'arbitrum one': CHAIN_IDS.ARBITRUM,
  'arbitrum mainnet': CHAIN_IDS.ARBITRUM,
};

/**
 * Map of chain IDs by number (as string) for numeric input.
 */
const CHAIN_BY_ID: Record<string, ChainId> = {
  '1': CHAIN_IDS.ETHEREUM,
  '8453': CHAIN_IDS.BASE,
  '10': CHAIN_IDS.OPTIMISM,
  '137': CHAIN_IDS.POLYGON,
  '42161': CHAIN_IDS.ARBITRUM,
};

// ============================================================================
// Token Aliases
// ============================================================================

/**
 * Map of token aliases to token symbols.
 * Includes common variations and alternative names.
 */
const TOKEN_ALIASES: Record<string, TokenSymbol> = {
  // ETH
  eth: TOKEN_SYMBOLS.ETH,
  ether: TOKEN_SYMBOLS.ETH,
  ethereum: TOKEN_SYMBOLS.ETH,

  // USDC
  usdc: TOKEN_SYMBOLS.USDC,
  'usd coin': TOKEN_SYMBOLS.USDC,
  'usd-c': TOKEN_SYMBOLS.USDC,

  // USDT
  usdt: TOKEN_SYMBOLS.USDT,
  tether: TOKEN_SYMBOLS.USDT,
  'usd-t': TOKEN_SYMBOLS.USDT,

  // WETH
  weth: TOKEN_SYMBOLS.WETH,
  'wrapped eth': TOKEN_SYMBOLS.WETH,
  'wrapped ether': TOKEN_SYMBOLS.WETH,
  'wrapped ethereum': TOKEN_SYMBOLS.WETH,

  // MATIC
  matic: TOKEN_SYMBOLS.MATIC,
  pol: TOKEN_SYMBOLS.MATIC,
  polygon: TOKEN_SYMBOLS.MATIC,
};

// ============================================================================
// Normalization Functions
// ============================================================================

/**
 * Normalize a chain name/alias to a ChainId.
 * @param input - The raw chain reference from user input
 * @returns ParsedChain with resolved chainId, or null if not found
 */
export function normalizeChain(input: string): ParsedChain | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const normalized = input.trim().toLowerCase();

  // Check numeric chain ID first
  if (CHAIN_BY_ID[normalized]) {
    const chainId = CHAIN_BY_ID[normalized]!;
    return {
      raw: input,
      chainId,
      name: CHAIN_NAMES[chainId],
      confidence: 'high',
    };
  }

  // Check exact alias match
  if (CHAIN_ALIASES[normalized]) {
    const chainId = CHAIN_ALIASES[normalized]!;
    return {
      raw: input,
      chainId,
      name: CHAIN_NAMES[chainId],
      confidence: 'high',
    };
  }

  // Check partial match (fuzzy)
  const fuzzyMatch = findFuzzyChainMatch(normalized);
  if (fuzzyMatch) {
    return fuzzyMatch;
  }

  return null;
}

/**
 * Normalize a token name/alias to a TokenSymbol.
 * @param input - The raw token reference from user input
 * @returns ParsedToken with resolved symbol, or null if not found
 */
export function normalizeToken(input: string): ParsedToken | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const normalized = input.trim().toLowerCase();

  // Check exact alias match
  if (TOKEN_ALIASES[normalized]) {
    return {
      raw: input,
      symbol: TOKEN_ALIASES[normalized]!,
      confidence: 'high',
    };
  }

  // Check uppercase match against TOKEN_SYMBOLS
  const upperInput = input.trim().toUpperCase();
  if (isValidTokenSymbol(upperInput)) {
    return {
      raw: input,
      symbol: upperInput as TokenSymbol,
      confidence: 'high',
    };
  }

  // Check fuzzy match
  const fuzzyMatch = findFuzzyTokenMatch(normalized);
  if (fuzzyMatch) {
    return fuzzyMatch;
  }

  return null;
}

/**
 * Parse amount from user input.
 * Handles numeric values, "all", "max", "everything", etc.
 * @param input - The raw amount string
 * @returns ParsedAmount or null
 */
export function normalizeAmount(input: string): { raw: string; value: number | null; isAll: boolean } | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const normalized = input.trim().toLowerCase();

  // Check for "all" variations
  const allPatterns = ['all', 'max', 'everything', 'entire', 'full'];
  if (allPatterns.some((p) => normalized === p || normalized.includes(`${p} my`))) {
    return {
      raw: input,
      value: null,
      isAll: true,
    };
  }

  // Parse numeric value
  const numericMatch = normalized.match(/^(\d+\.?\d*|\.\d+)$/);
  if (numericMatch) {
    const value = parseFloat(numericMatch[1]!);
    if (!isNaN(value) && value > 0) {
      return {
        raw: input,
        value,
        isAll: false,
      };
    }
  }

  return null;
}

// ============================================================================
// Fuzzy Matching Helpers
// ============================================================================

/**
 * Find a fuzzy chain match for partial/misspelled input.
 */
function findFuzzyChainMatch(input: string): ParsedChain | null {
  const allAliases = Object.keys(CHAIN_ALIASES);

  // Check if input starts with or contains a known alias
  for (const alias of allAliases) {
    if (input.includes(alias) || alias.includes(input)) {
      const chainId = CHAIN_ALIASES[alias]!;
      return {
        raw: input,
        chainId,
        name: CHAIN_NAMES[chainId],
        confidence: calculateConfidence(input, alias),
      };
    }
  }

  // Check Levenshtein distance for close matches
  for (const alias of allAliases) {
    if (levenshteinDistance(input, alias) <= 2) {
      const chainId = CHAIN_ALIASES[alias]!;
      return {
        raw: input,
        chainId,
        name: CHAIN_NAMES[chainId],
        confidence: 'medium',
      };
    }
  }

  return null;
}

/**
 * Find a fuzzy token match for partial/misspelled input.
 */
function findFuzzyTokenMatch(input: string): ParsedToken | null {
  const allAliases = Object.keys(TOKEN_ALIASES);

  // Only do fuzzy matching for inputs that are reasonably long (>=4 chars)
  // This prevents false positives like "btc" matching "eth"
  if (input.length < 4) {
    return null;
  }

  // Check if input starts with or contains a known alias (for longer aliases only)
  for (const alias of allAliases) {
    // Only check containment for aliases of 4+ chars to avoid false positives
    if (alias.length >= 4 && (input.includes(alias) || alias.includes(input))) {
      return {
        raw: input,
        symbol: TOKEN_ALIASES[alias]!,
        confidence: calculateConfidence(input, alias),
      };
    }
  }

  // Check Levenshtein distance for close matches (stricter threshold)
  for (const alias of allAliases) {
    const distance = levenshteinDistance(input, alias);
    // Only match if distance is <= 1 for short aliases, or <= 2 for longer aliases
    const maxDistance = alias.length <= 4 ? 1 : 2;
    if (distance <= maxDistance && distance < input.length / 2) {
      return {
        raw: input,
        symbol: TOKEN_ALIASES[alias]!,
        confidence: 'medium',
      };
    }
  }

  return null;
}

/**
 * Calculate confidence based on match quality.
 */
function calculateConfidence(input: string, matched: string): ConfidenceLevel {
  if (input === matched) {
    return 'high';
  }
  if (input.includes(matched) || matched.includes(input)) {
    const lengthRatio = Math.min(input.length, matched.length) / Math.max(input.length, matched.length);
    return lengthRatio > 0.7 ? 'high' : 'medium';
  }
  return 'low';
}

/**
 * Calculate Levenshtein distance between two strings.
 * Used for fuzzy matching of misspelled chain/token names.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // substitution
          matrix[i]![j - 1]! + 1, // insertion
          matrix[i - 1]![j]! + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

/**
 * Check if a string is a valid token symbol.
 */
function isValidTokenSymbol(input: string): boolean {
  return Object.values(TOKEN_SYMBOLS).includes(input as TokenSymbol);
}

// ============================================================================
// Exports
// ============================================================================

export { CHAIN_ALIASES, CHAIN_BY_ID, TOKEN_ALIASES };
