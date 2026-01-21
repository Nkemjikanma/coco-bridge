/**
 * Bridge Constants and Chain Configuration
 * Supported chains: Ethereum, Base, Optimism, Polygon, Arbitrum
 */

export const CHAIN_IDS = {
  ETHEREUM: 1,
  BASE: 8453,
  OPTIMISM: 10,
  POLYGON: 137,
  ARBITRUM: 42161,
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

export const SUPPORTED_CHAIN_IDS: readonly ChainId[] = [
  CHAIN_IDS.ETHEREUM,
  CHAIN_IDS.BASE,
  CHAIN_IDS.OPTIMISM,
  CHAIN_IDS.POLYGON,
  CHAIN_IDS.ARBITRUM,
] as const;

export const CHAIN_NAMES: Record<ChainId, string> = {
  [CHAIN_IDS.ETHEREUM]: 'Ethereum',
  [CHAIN_IDS.BASE]: 'Base',
  [CHAIN_IDS.OPTIMISM]: 'Optimism',
  [CHAIN_IDS.POLYGON]: 'Polygon',
  [CHAIN_IDS.ARBITRUM]: 'Arbitrum',
};

export const NATIVE_TOKENS: Record<ChainId, string> = {
  [CHAIN_IDS.ETHEREUM]: 'ETH',
  [CHAIN_IDS.BASE]: 'ETH',
  [CHAIN_IDS.OPTIMISM]: 'ETH',
  [CHAIN_IDS.POLYGON]: 'MATIC',
  [CHAIN_IDS.ARBITRUM]: 'ETH',
};

export const RPC_URLS: Record<ChainId, string> = {
  [CHAIN_IDS.ETHEREUM]: 'https://eth.llamarpc.com',
  [CHAIN_IDS.BASE]: 'https://mainnet.base.org',
  [CHAIN_IDS.OPTIMISM]: 'https://mainnet.optimism.io',
  [CHAIN_IDS.POLYGON]: 'https://polygon-rpc.com',
  [CHAIN_IDS.ARBITRUM]: 'https://arb1.arbitrum.io/rpc',
};

export const EXPLORER_URLS: Record<ChainId, string> = {
  [CHAIN_IDS.ETHEREUM]: 'https://etherscan.io',
  [CHAIN_IDS.BASE]: 'https://basescan.org',
  [CHAIN_IDS.OPTIMISM]: 'https://optimistic.etherscan.io',
  [CHAIN_IDS.POLYGON]: 'https://polygonscan.com',
  [CHAIN_IDS.ARBITRUM]: 'https://arbiscan.io',
};

export function isValidChainId(chainId: number): chainId is ChainId {
  return SUPPORTED_CHAIN_IDS.includes(chainId as ChainId);
}

export function getChainName(chainId: ChainId): string {
  return CHAIN_NAMES[chainId];
}

export function getNativeToken(chainId: ChainId): string {
  return NATIVE_TOKENS[chainId];
}

export function getRpcUrl(chainId: ChainId): string {
  return RPC_URLS[chainId];
}

export function getExplorerUrl(chainId: ChainId): string {
  return EXPLORER_URLS[chainId];
}

export function getExplorerTxUrl(chainId: ChainId, txHash: string): string {
  return `${EXPLORER_URLS[chainId]}/tx/${txHash}`;
}

export function getExplorerAddressUrl(chainId: ChainId, address: string): string {
  return `${EXPLORER_URLS[chainId]}/address/${address}`;
}
