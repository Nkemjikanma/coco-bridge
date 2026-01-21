/**
 * Token Registry
 * Supported tokens: ETH, USDC, USDT, WETH, MATIC
 * Supported chains: Ethereum, Base, Optimism, Polygon, Arbitrum
 */

import { CHAIN_IDS, type ChainId } from '../bridge/bridgeConstants';

/** Native token address placeholder used by bridges/aggregators */
export const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;

export const TOKEN_SYMBOLS = {
  ETH: 'ETH',
  USDC: 'USDC',
  USDT: 'USDT',
  WETH: 'WETH',
  MATIC: 'MATIC',
} as const;

export type TokenSymbol = (typeof TOKEN_SYMBOLS)[keyof typeof TOKEN_SYMBOLS];

export const SUPPORTED_TOKEN_SYMBOLS: readonly TokenSymbol[] = [
  TOKEN_SYMBOLS.ETH,
  TOKEN_SYMBOLS.USDC,
  TOKEN_SYMBOLS.USDT,
  TOKEN_SYMBOLS.WETH,
  TOKEN_SYMBOLS.MATIC,
] as const;

/** Token decimals by symbol */
export const TOKEN_DECIMALS: Record<TokenSymbol, number> = {
  [TOKEN_SYMBOLS.ETH]: 18,
  [TOKEN_SYMBOLS.USDC]: 6,
  [TOKEN_SYMBOLS.USDT]: 6,
  [TOKEN_SYMBOLS.WETH]: 18,
  [TOKEN_SYMBOLS.MATIC]: 18,
};

/** Token addresses per chain */
export const TOKEN_ADDRESSES: Record<TokenSymbol, Partial<Record<ChainId, string>>> = {
  [TOKEN_SYMBOLS.ETH]: {
    [CHAIN_IDS.ETHEREUM]: NATIVE_TOKEN_ADDRESS,
    [CHAIN_IDS.BASE]: NATIVE_TOKEN_ADDRESS,
    [CHAIN_IDS.OPTIMISM]: NATIVE_TOKEN_ADDRESS,
    [CHAIN_IDS.ARBITRUM]: NATIVE_TOKEN_ADDRESS,
    // ETH is not native on Polygon
  },
  [TOKEN_SYMBOLS.USDC]: {
    [CHAIN_IDS.ETHEREUM]: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    [CHAIN_IDS.BASE]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    [CHAIN_IDS.OPTIMISM]: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    [CHAIN_IDS.POLYGON]: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    [CHAIN_IDS.ARBITRUM]: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  [TOKEN_SYMBOLS.USDT]: {
    [CHAIN_IDS.ETHEREUM]: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    [CHAIN_IDS.BASE]: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    [CHAIN_IDS.OPTIMISM]: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    [CHAIN_IDS.POLYGON]: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    [CHAIN_IDS.ARBITRUM]: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  [TOKEN_SYMBOLS.WETH]: {
    [CHAIN_IDS.ETHEREUM]: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    [CHAIN_IDS.BASE]: '0x4200000000000000000000000000000000000006',
    [CHAIN_IDS.OPTIMISM]: '0x4200000000000000000000000000000000000006',
    [CHAIN_IDS.POLYGON]: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    [CHAIN_IDS.ARBITRUM]: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  },
  [TOKEN_SYMBOLS.MATIC]: {
    [CHAIN_IDS.ETHEREUM]: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0',
    [CHAIN_IDS.POLYGON]: NATIVE_TOKEN_ADDRESS,
    // MATIC is not commonly available on Base, Optimism, Arbitrum
  },
};

/**
 * Get token address for a given symbol and chain
 * @param symbol - Token symbol (ETH, USDC, USDT, WETH, MATIC)
 * @param chainId - Chain ID
 * @returns Token address or undefined if not available on chain
 */
export function getTokenAddress(symbol: TokenSymbol, chainId: ChainId): string | undefined {
  return TOKEN_ADDRESSES[symbol]?.[chainId];
}

/**
 * Get token decimals for a given symbol
 * @param symbol - Token symbol (ETH, USDC, USDT, WETH, MATIC)
 * @returns Token decimals
 */
export function getTokenDecimals(symbol: TokenSymbol): number {
  return TOKEN_DECIMALS[symbol];
}

/**
 * Check if a token is available on a specific chain
 * @param symbol - Token symbol
 * @param chainId - Chain ID
 * @returns true if token is available on chain
 */
export function isTokenAvailableOnChain(symbol: TokenSymbol, chainId: ChainId): boolean {
  return getTokenAddress(symbol, chainId) !== undefined;
}

/**
 * Check if an address is the native token address
 * @param address - Address to check
 * @returns true if address is the native token placeholder
 */
export function isNativeToken(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
}

/**
 * Get all supported tokens on a specific chain
 * @param chainId - Chain ID
 * @returns Array of token symbols available on the chain
 */
export function getSupportedTokensOnChain(chainId: ChainId): TokenSymbol[] {
  return SUPPORTED_TOKEN_SYMBOLS.filter((symbol) => isTokenAvailableOnChain(symbol, chainId));
}
