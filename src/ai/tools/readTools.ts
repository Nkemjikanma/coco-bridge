/**
 * Read Tools for Coco Bridge
 * Tools that query blockchain state without creating transactions.
 */

import { createPublicClient, http, formatUnits, parseUnits, type Address, erc20Abi } from 'viem';
import { mainnet, base, optimism, polygon, arbitrum } from 'viem/chains';
import {
  CHAIN_IDS,
  SUPPORTED_CHAIN_IDS,
  CHAIN_NAMES,
  RPC_URLS,
  NATIVE_TOKENS,
  EXPLORER_URLS,
  type ChainId,
} from '../../services/bridge';
import {
  TOKEN_SYMBOLS,
  SUPPORTED_TOKEN_SYMBOLS,
  getTokenAddress,
  getTokenDecimals,
  isNativeToken,
  isTokenAvailableOnChain,
  getSupportedTokensOnChain,
  type TokenSymbol,
} from '../../services/tokens';
import type {
  ToolDefinition,
  ToolResult,
  ToolResultSuccess,
  ToolResultError,
  TokenBalance,
  AgentContext,
  BridgeQuoteContext,
} from '../types';

// ============================================================================
// Viem Chain Mapping
// ============================================================================

const VIEM_CHAINS = {
  [CHAIN_IDS.ETHEREUM]: mainnet,
  [CHAIN_IDS.BASE]: base,
  [CHAIN_IDS.OPTIMISM]: optimism,
  [CHAIN_IDS.POLYGON]: polygon,
  [CHAIN_IDS.ARBITRUM]: arbitrum,
} as const;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Filter and validate EOA (Externally Owned Account) addresses.
 * Returns user's linked wallet addresses for balance checking.
 *
 * @param context - Agent context containing user information
 * @returns Array of valid wallet addresses
 */
export function filterEOAs(context: AgentContext): Address[] {
  const wallets: Address[] = [];

  // Primary wallet from user context
  if (context.user.walletAddress) {
    const address = context.user.walletAddress as Address;
    if (isValidAddress(address)) {
      wallets.push(address);
    }
  }

  // Additional wallets from extra context (if linked wallets feature is added)
  if (context.extra?.linkedWallets && Array.isArray(context.extra.linkedWallets)) {
    for (const wallet of context.extra.linkedWallets) {
      if (typeof wallet === 'string' && isValidAddress(wallet as Address)) {
        wallets.push(wallet as Address);
      }
    }
  }

  // Remove duplicates
  return [...new Set(wallets)];
}

/**
 * Basic address validation
 */
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Create a public client for a specific chain
 */
function createChainClient(chainId: ChainId) {
  const chain = VIEM_CHAINS[chainId];
  const rpcUrl = RPC_URLS[chainId];

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}

/**
 * Fetch current USD prices for tokens from CoinGecko API
 * Returns a map of token symbol to USD price
 */
async function fetchTokenPrices(): Promise<Record<string, number>> {
  const coinGeckoIds: Record<TokenSymbol, string> = {
    [TOKEN_SYMBOLS.ETH]: 'ethereum',
    [TOKEN_SYMBOLS.USDC]: 'usd-coin',
    [TOKEN_SYMBOLS.USDT]: 'tether',
    [TOKEN_SYMBOLS.WETH]: 'weth',
    [TOKEN_SYMBOLS.MATIC]: 'matic-network',
  };

  try {
    const ids = Object.values(coinGeckoIds).join(',');
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = (await response.json()) as Record<string, { usd: number }>;

    // Map back to token symbols
    const prices: Record<string, number> = {};
    for (const [symbol, geckoId] of Object.entries(coinGeckoIds)) {
      if (data[geckoId]?.usd) {
        prices[symbol] = data[geckoId].usd;
      }
    }

    return prices;
  } catch (error) {
    // Return empty prices on error - USD values will be omitted
    console.error('Failed to fetch token prices:', error);
    return {};
  }
}

/**
 * Format USD value with proper formatting
 */
function formatUsdValue(amount: number): string {
  if (amount < 0.01) {
    return '<$0.01';
  }
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format balance with appropriate decimal places
 */
function formatBalance(balance: string, _decimals: number): string {
  const num = parseFloat(balance);
  if (num === 0) return '0';
  if (num < 0.0001) return '<0.0001';

  // Use more decimals for small balances
  const displayDecimals = num < 1 ? 6 : num < 100 ? 4 : 2;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: displayDecimals,
  });
}

// ============================================================================
// Balance Fetching Functions
// ============================================================================

/**
 * Get native token (ETH/MATIC) balance for an address on a specific chain
 */
async function getNativeBalance(
  address: Address,
  chainId: ChainId
): Promise<{ raw: bigint; formatted: string }> {
  const client = createChainClient(chainId);
  const balance = await client.getBalance({ address });
  const formatted = formatUnits(balance, 18);

  return { raw: balance, formatted };
}

/**
 * Get ERC20 token balance for an address on a specific chain
 */
async function getERC20Balance(
  address: Address,
  tokenAddress: Address,
  decimals: number,
  chainId: ChainId
): Promise<{ raw: bigint; formatted: string }> {
  const client = createChainClient(chainId);

  const balance = await client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });

  const formatted = formatUnits(balance, decimals);

  return { raw: balance, formatted };
}

/**
 * Check balance for a specific token on a specific chain
 */
async function checkTokenBalanceOnChain(
  address: Address,
  token: TokenSymbol,
  chainId: ChainId
): Promise<TokenBalance | null> {
  // Check if token is available on this chain
  if (!isTokenAvailableOnChain(token, chainId)) {
    return null;
  }

  const tokenAddress = getTokenAddress(token, chainId);
  if (!tokenAddress) {
    return null;
  }

  try {
    let balance: { raw: bigint; formatted: string };

    if (isNativeToken(tokenAddress)) {
      balance = await getNativeBalance(address, chainId);
    } else {
      const decimals = getTokenDecimals(token);
      balance = await getERC20Balance(address, tokenAddress as Address, decimals, chainId);
    }

    return {
      symbol: token,
      address: tokenAddress,
      balanceRaw: balance.raw.toString(),
      balanceFormatted: balance.formatted,
      chainId,
    };
  } catch (error) {
    console.error(`Error fetching ${token} balance on chain ${chainId}:`, error);
    return null;
  }
}

// ============================================================================
// Check Balance Tool Definition
// ============================================================================

export const checkBalanceToolDefinition: ToolDefinition = {
  name: 'check_balance',
  description:
    'Check token balances across all supported chains for the user\'s wallet(s). ' +
    'Returns ETH/native token balances on all 5 chains by default. ' +
    'When a specific token is provided, returns that token\'s balance on all chains where it\'s available. ' +
    'Results include formatted balances and USD equivalents.',
  inputSchema: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description:
          'Optional token symbol to check (ETH, USDC, USDT, WETH, MATIC). ' +
          'If not specified, checks native token (ETH/MATIC) on all chains.',
        enum: SUPPORTED_TOKEN_SYMBOLS as unknown as readonly string[],
      },
      chainId: {
        type: 'number',
        description:
          'Optional chain ID to check balance on a specific chain only. ' +
          'Supported: 1 (Ethereum), 8453 (Base), 10 (Optimism), 137 (Polygon), 42161 (Arbitrum).',
        enum: SUPPORTED_CHAIN_IDS as unknown as readonly string[],
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiresConfirmation: false,
  requiresSignature: false,
  category: 'read',
};

// ============================================================================
// Check Balance Tool Input/Output Types
// ============================================================================

export interface CheckBalanceInput {
  token?: TokenSymbol;
  chainId?: ChainId;
}

export interface ChainBalance {
  chainId: ChainId;
  chainName: string;
  symbol: TokenSymbol;
  address: string;
  balanceRaw: string;
  balanceFormatted: string;
  balanceDisplay: string;
  balanceUsd?: string;
}

export interface CheckBalanceOutput {
  wallets: Address[];
  balances: ChainBalance[];
  totalUsd?: string;
  timestamp: number;
}

// ============================================================================
// Check Balance Tool Executor
// ============================================================================

/**
 * Execute the check_balance tool
 *
 * @param input - Tool input parameters
 * @param context - Agent context with user info
 * @param toolCallId - Unique ID for this tool call
 * @returns Tool result with balances or error
 */
export async function executeCheckBalance(
  input: CheckBalanceInput,
  context: AgentContext,
  toolCallId: string
): Promise<ToolResult> {
  const timestamp = Date.now();

  try {
    // Get user's wallet addresses
    const wallets = filterEOAs(context);

    if (wallets.length === 0) {
      return createErrorResult(
        toolCallId,
        'NO_WALLET',
        'No wallet address found. Please connect your wallet first.',
        timestamp
      );
    }

    // Determine which chains to check
    const chainsToCheck: ChainId[] = input.chainId
      ? [input.chainId]
      : [...SUPPORTED_CHAIN_IDS];

    // Determine which token(s) to check
    // If no token specified, check native tokens (ETH on most chains, MATIC on Polygon)
    const checkNativeOnly = !input.token;

    // Fetch token prices in parallel with balance checks
    const pricesPromise = fetchTokenPrices();

    // Collect all balance check promises
    const balancePromises: Promise<TokenBalance | null>[] = [];

    for (const wallet of wallets) {
      for (const chainId of chainsToCheck) {
        if (checkNativeOnly) {
          // Check native token for this chain (ETH or MATIC)
          const nativeToken = NATIVE_TOKENS[chainId] as TokenSymbol;
          balancePromises.push(checkTokenBalanceOnChain(wallet, nativeToken, chainId));
        } else if (input.token) {
          // Check specific token
          balancePromises.push(checkTokenBalanceOnChain(wallet, input.token, chainId));
        }
      }
    }

    // Execute all balance checks in parallel
    const [balanceResults, prices] = await Promise.all([
      Promise.all(balancePromises),
      pricesPromise,
    ]);

    // Filter out null results and format
    const balances: ChainBalance[] = [];
    let totalUsdValue = 0;

    for (const result of balanceResults) {
      if (!result) continue;

      const balanceNum = parseFloat(result.balanceFormatted);
      const usdPrice = prices[result.symbol];
      const usdValue = usdPrice ? balanceNum * usdPrice : undefined;

      if (usdValue !== undefined) {
        totalUsdValue += usdValue;
      }

      balances.push({
        chainId: result.chainId,
        chainName: CHAIN_NAMES[result.chainId],
        symbol: result.symbol,
        address: result.address,
        balanceRaw: result.balanceRaw,
        balanceFormatted: result.balanceFormatted,
        balanceDisplay: formatBalance(result.balanceFormatted, getTokenDecimals(result.symbol)),
        balanceUsd: usdValue !== undefined ? formatUsdValue(usdValue) : undefined,
      });
    }

    // Sort balances by chain ID for consistent ordering
    balances.sort((a, b) => a.chainId - b.chainId);

    const output: CheckBalanceOutput = {
      wallets,
      balances,
      totalUsd: totalUsdValue > 0 ? formatUsdValue(totalUsdValue) : undefined,
      timestamp,
    };

    return createSuccessResult(toolCallId, output, timestamp, formatBalanceMessage(output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return createErrorResult(
      toolCallId,
      'BALANCE_CHECK_FAILED',
      `Technical issue checking balances. Please try again.`,
      timestamp,
      { originalError: errorMessage }
    );
  }
}

// ============================================================================
// Result Helpers
// ============================================================================

function createSuccessResult(
  toolCallId: string,
  data: CheckBalanceOutput,
  timestamp: number,
  message?: string
): ToolResultSuccess {
  return {
    success: true,
    toolCallId,
    toolName: 'check_balance',
    timestamp,
    data: data as unknown as Record<string, unknown>,
    message,
  };
}

function createErrorResult(
  toolCallId: string,
  errorCode: string,
  errorMessage: string,
  timestamp: number,
  errorDetails?: Record<string, unknown>
): ToolResultError {
  return {
    success: false,
    toolCallId,
    toolName: 'check_balance',
    timestamp,
    errorCode,
    errorMessage,
    errorDetails,
  };
}

/**
 * Format balance results into a human-readable message
 */
function formatBalanceMessage(output: CheckBalanceOutput): string {
  if (output.balances.length === 0) {
    return 'No balances found on supported chains.';
  }

  const lines: string[] = ['**Balances**'];

  // Group by chain
  const byChain = new Map<ChainId, ChainBalance[]>();
  for (const balance of output.balances) {
    const existing = byChain.get(balance.chainId) || [];
    existing.push(balance);
    byChain.set(balance.chainId, existing);
  }

  for (const [chainId, chainBalances] of byChain) {
    lines.push(`\n**${CHAIN_NAMES[chainId]}**`);
    for (const balance of chainBalances) {
      const usdPart = balance.balanceUsd ? ` (${balance.balanceUsd})` : '';
      lines.push(`- ${balance.balanceDisplay} ${balance.symbol}${usdPart}`);
    }
  }

  if (output.totalUsd) {
    lines.push(`\n**Total:** ${output.totalUsd}`);
  }

  return lines.join('\n');
}

// ============================================================================
// Get Bridge Quote Tool Definition
// ============================================================================

export const getBridgeQuoteToolDefinition: ToolDefinition = {
  name: 'get_bridge_quote',
  description:
    'Get a quote for bridging tokens between chains. ' +
    'Returns input amount, output amount, bridge fees, estimated time, and whether token approval is needed. ' +
    'Supports native tokens (ETH/MATIC) and ERC20 tokens (USDC, USDT, WETH). ' +
    'Uses Across Protocol as the bridge aggregator for optimal routes and fees.',
  inputSchema: {
    type: 'object',
    properties: {
      fromChainId: {
        type: 'number',
        description:
          'Source chain ID. Supported: 1 (Ethereum), 8453 (Base), 10 (Optimism), 137 (Polygon), 42161 (Arbitrum).',
        enum: SUPPORTED_CHAIN_IDS as unknown as readonly string[],
      },
      toChainId: {
        type: 'number',
        description:
          'Destination chain ID. Supported: 1 (Ethereum), 8453 (Base), 10 (Optimism), 137 (Polygon), 42161 (Arbitrum).',
        enum: SUPPORTED_CHAIN_IDS as unknown as readonly string[],
      },
      inputToken: {
        type: 'string',
        description: 'Token symbol to bridge from (ETH, USDC, USDT, WETH, MATIC).',
        enum: SUPPORTED_TOKEN_SYMBOLS as unknown as readonly string[],
      },
      outputToken: {
        type: 'string',
        description:
          'Token symbol to receive on destination (ETH, USDC, USDT, WETH, MATIC). ' +
          'If not specified, same as inputToken.',
        enum: SUPPORTED_TOKEN_SYMBOLS as unknown as readonly string[],
      },
      amount: {
        type: 'string',
        description: 'Amount to bridge in human-readable format (e.g., "0.1" for 0.1 ETH).',
      },
    },
    required: ['fromChainId', 'toChainId', 'inputToken', 'amount'],
    additionalProperties: false,
  },
  requiresConfirmation: false,
  requiresSignature: false,
  category: 'read',
};

// ============================================================================
// Get Bridge Quote Tool Input/Output Types
// ============================================================================

export interface GetBridgeQuoteInput {
  fromChainId: ChainId;
  toChainId: ChainId;
  inputToken: TokenSymbol;
  outputToken?: TokenSymbol;
  amount: string;
}

export interface GetBridgeQuoteOutput {
  /** Source chain information */
  sourceChain: {
    chainId: ChainId;
    chainName: string;
  };
  /** Destination chain information */
  destinationChain: {
    chainId: ChainId;
    chainName: string;
  };
  /** Input token details */
  inputToken: {
    symbol: TokenSymbol;
    address: string;
    amount: string;
    amountRaw: string;
    amountUsd?: string;
  };
  /** Output token details */
  outputToken: {
    symbol: TokenSymbol;
    address: string;
    amount: string;
    amountRaw: string;
    amountUsd?: string;
  };
  /** Bridge fee breakdown */
  fees: {
    /** Total fee in output token */
    totalFee: string;
    totalFeeUsd?: string;
    /** LP fee from bridge provider */
    lpFee: string;
    /** Relayer gas fee */
    relayerGasFee: string;
    /** Capital fee (if any) */
    capitalFee?: string;
  };
  /** Estimated bridge completion time in seconds */
  estimatedTimeSeconds: number;
  /** Estimated time formatted for display */
  estimatedTimeDisplay: string;
  /** Whether token approval is required before bridging */
  requiresApproval: boolean;
  /** Minimum amount that can be bridged */
  minimumAmount?: string;
  /** Quote expiration timestamp */
  expiresAt: number;
  /** Bridge provider name */
  provider: string;
  /** Quote timestamp */
  timestamp: number;
  /** Full quote context for session storage */
  quoteContext: BridgeQuoteContext;
}

// ============================================================================
// Across Protocol API Types
// ============================================================================

interface AcrossSuggestedFeesResponse {
  totalRelayFee: {
    pct: string;
    total: string;
  };
  relayerCapitalFee: {
    pct: string;
    total: string;
  };
  relayerGasFee: {
    pct: string;
    total: string;
  };
  lpFee: {
    pct: string;
    total: string;
  };
  timestamp: string;
  isAmountTooLow: boolean;
  quoteBlock: string;
  spokePoolAddress: string;
  exclusiveRelayer: string;
  exclusivityDeadline: string;
  expectedFillTimeSec: string;
}

interface AcrossLimitsResponse {
  minDeposit: string;
  maxDeposit: string;
  maxDepositInstant: string;
  maxDepositShortDelay: string;
}

// ============================================================================
// Get Bridge Quote Tool Executor
// ============================================================================

/**
 * Fetch bridge quote from Across Protocol API
 */
async function fetchAcrossQuote(
  inputTokenAddress: string,
  outputTokenAddress: string,
  fromChainId: ChainId,
  toChainId: ChainId,
  amountRaw: string
): Promise<AcrossSuggestedFeesResponse> {
  const params = new URLSearchParams({
    inputToken: inputTokenAddress,
    outputToken: outputTokenAddress,
    originChainId: fromChainId.toString(),
    destinationChainId: toChainId.toString(),
    amount: amountRaw,
  });

  const response = await fetch(`https://app.across.to/api/suggested-fees?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Across API error (${response.status}): ${errorText}`);
  }

  return (await response.json()) as AcrossSuggestedFeesResponse;
}

/**
 * Fetch bridge limits from Across Protocol API
 */
async function fetchAcrossLimits(
  inputTokenAddress: string,
  outputTokenAddress: string,
  fromChainId: ChainId,
  toChainId: ChainId
): Promise<AcrossLimitsResponse> {
  const params = new URLSearchParams({
    inputToken: inputTokenAddress,
    outputToken: outputTokenAddress,
    originChainId: fromChainId.toString(),
    destinationChainId: toChainId.toString(),
  });

  const response = await fetch(`https://app.across.to/api/limits?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Across limits API error (${response.status}): ${errorText}`);
  }

  return (await response.json()) as AcrossLimitsResponse;
}

/**
 * Check if token requires approval for bridging (ERC20 tokens need approval)
 */
async function checkRequiresApproval(
  tokenAddress: string,
  ownerAddress: Address,
  spenderAddress: Address,
  amountRaw: bigint,
  chainId: ChainId
): Promise<boolean> {
  // Native tokens don't require approval
  if (isNativeToken(tokenAddress)) {
    return false;
  }

  try {
    const client = createChainClient(chainId);
    const allowance = await client.readContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [ownerAddress, spenderAddress],
    });

    return allowance < amountRaw;
  } catch (error) {
    // If we can't check, assume approval is needed for safety
    console.error('Error checking allowance:', error);
    return true;
  }
}

/**
 * Format estimated time in human-readable format
 */
function formatEstimatedTime(seconds: number): string {
  if (seconds < 60) {
    return `~${seconds} seconds`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes === 1) {
    return '~1 minute';
  }
  return `~${minutes} minutes`;
}

/**
 * Execute the get_bridge_quote tool
 *
 * @param input - Tool input parameters
 * @param context - Agent context with user info
 * @param toolCallId - Unique ID for this tool call
 * @returns Tool result with bridge quote or error
 */
export async function executeGetBridgeQuote(
  input: GetBridgeQuoteInput,
  context: AgentContext,
  toolCallId: string
): Promise<ToolResult> {
  const timestamp = Date.now();

  try {
    const { fromChainId, toChainId, inputToken, amount } = input;
    const outputToken = input.outputToken || inputToken;

    // Validate chains are different
    if (fromChainId === toChainId) {
      return createBridgeQuoteErrorResult(
        toolCallId,
        'SAME_CHAIN',
        'Source and destination chains must be different. Use a DEX for same-chain swaps.',
        timestamp
      );
    }

    // Validate token availability on source chain
    if (!isTokenAvailableOnChain(inputToken, fromChainId)) {
      return createBridgeQuoteErrorResult(
        toolCallId,
        'TOKEN_NOT_AVAILABLE',
        `${inputToken} is not available on ${CHAIN_NAMES[fromChainId]}.`,
        timestamp
      );
    }

    // Validate token availability on destination chain
    if (!isTokenAvailableOnChain(outputToken, toChainId)) {
      return createBridgeQuoteErrorResult(
        toolCallId,
        'TOKEN_NOT_AVAILABLE',
        `${outputToken} is not available on ${CHAIN_NAMES[toChainId]}.`,
        timestamp
      );
    }

    // Get token addresses
    const inputTokenAddress = getTokenAddress(inputToken, fromChainId)!;
    const outputTokenAddress = getTokenAddress(outputToken, toChainId)!;

    // Parse amount to raw units
    const inputDecimals = getTokenDecimals(inputToken);
    const outputDecimals = getTokenDecimals(outputToken);
    let amountRaw: bigint;

    try {
      amountRaw = parseUnits(amount, inputDecimals);
    } catch {
      return createBridgeQuoteErrorResult(
        toolCallId,
        'INVALID_AMOUNT',
        `Invalid amount format: "${amount}". Please provide a valid number.`,
        timestamp
      );
    }

    if (amountRaw <= 0n) {
      return createBridgeQuoteErrorResult(
        toolCallId,
        'INVALID_AMOUNT',
        'Amount must be greater than 0.',
        timestamp
      );
    }

    // Fetch quote and limits in parallel with prices
    const [quoteResult, limitsResult, prices] = await Promise.all([
      fetchAcrossQuote(
        inputTokenAddress,
        outputTokenAddress,
        fromChainId,
        toChainId,
        amountRaw.toString()
      ),
      fetchAcrossLimits(inputTokenAddress, outputTokenAddress, fromChainId, toChainId),
      fetchTokenPrices(),
    ]);

    // Check if amount is too low
    if (quoteResult.isAmountTooLow) {
      const minAmount = formatUnits(BigInt(limitsResult.minDeposit), inputDecimals);
      return createBridgeQuoteErrorResult(
        toolCallId,
        'AMOUNT_TOO_LOW',
        `Amount too low. Minimum bridgeable amount is ${minAmount} ${inputToken}.`,
        timestamp,
        { minimumAmount: minAmount }
      );
    }

    // Calculate output amount (input - total fees)
    const totalFee = BigInt(quoteResult.totalRelayFee.total);
    const outputAmountRaw = amountRaw - totalFee;

    if (outputAmountRaw <= 0n) {
      return createBridgeQuoteErrorResult(
        toolCallId,
        'FEE_EXCEEDS_AMOUNT',
        'Bridge fee exceeds the input amount. Please increase the amount.',
        timestamp
      );
    }

    // Format amounts
    const inputAmountFormatted = formatBalance(amount, inputDecimals);
    const outputAmountFormatted = formatBalance(
      formatUnits(outputAmountRaw, outputDecimals),
      outputDecimals
    );
    const totalFeeFormatted = formatBalance(
      formatUnits(totalFee, outputDecimals),
      outputDecimals
    );
    const lpFeeFormatted = formatBalance(
      formatUnits(BigInt(quoteResult.lpFee.total), outputDecimals),
      outputDecimals
    );
    const relayerGasFeeFormatted = formatBalance(
      formatUnits(BigInt(quoteResult.relayerGasFee.total), outputDecimals),
      outputDecimals
    );
    const capitalFeeFormatted = quoteResult.relayerCapitalFee.total !== '0'
      ? formatBalance(
          formatUnits(BigInt(quoteResult.relayerCapitalFee.total), outputDecimals),
          outputDecimals
        )
      : undefined;

    // Calculate USD values if prices available
    const inputPrice = prices[inputToken];
    const outputPrice = prices[outputToken];
    const inputAmountUsd = inputPrice
      ? formatUsdValue(parseFloat(amount) * inputPrice)
      : undefined;
    const outputAmountUsd = outputPrice
      ? formatUsdValue(parseFloat(formatUnits(outputAmountRaw, outputDecimals)) * outputPrice)
      : undefined;
    const totalFeeUsd = outputPrice
      ? formatUsdValue(parseFloat(formatUnits(totalFee, outputDecimals)) * outputPrice)
      : undefined;

    // Check if approval is required
    const wallets = filterEOAs(context);
    let requiresApproval = false;

    if (wallets.length > 0 && wallets[0]) {
      requiresApproval = await checkRequiresApproval(
        inputTokenAddress,
        wallets[0],
        quoteResult.spokePoolAddress as Address,
        amountRaw,
        fromChainId
      );
    } else {
      // If no wallet connected, assume approval needed for ERC20s
      requiresApproval = !isNativeToken(inputTokenAddress);
    }

    // Parse estimated time
    const estimatedTimeSeconds = parseInt(quoteResult.expectedFillTimeSec, 10) || 120;
    const estimatedTimeDisplay = formatEstimatedTime(estimatedTimeSeconds);

    // Quote expires in 2 minutes
    const expiresAt = timestamp + 120000;

    // Format minimum amount
    const minimumAmount = formatBalance(
      formatUnits(BigInt(limitsResult.minDeposit), inputDecimals),
      inputDecimals
    );

    // Build quote context for session storage
    const quoteContext: BridgeQuoteContext = {
      sourceChain: fromChainId,
      destinationChain: toChainId,
      inputToken,
      outputToken,
      inputAmount: amount,
      outputAmount: formatUnits(outputAmountRaw, outputDecimals),
      fee: formatUnits(totalFee, outputDecimals),
      estimatedTimeSeconds,
      expiresAt,
      provider: 'Across',
    };

    const output: GetBridgeQuoteOutput = {
      sourceChain: {
        chainId: fromChainId,
        chainName: CHAIN_NAMES[fromChainId],
      },
      destinationChain: {
        chainId: toChainId,
        chainName: CHAIN_NAMES[toChainId],
      },
      inputToken: {
        symbol: inputToken,
        address: inputTokenAddress,
        amount: inputAmountFormatted,
        amountRaw: amountRaw.toString(),
        amountUsd: inputAmountUsd,
      },
      outputToken: {
        symbol: outputToken,
        address: outputTokenAddress,
        amount: outputAmountFormatted,
        amountRaw: outputAmountRaw.toString(),
        amountUsd: outputAmountUsd,
      },
      fees: {
        totalFee: totalFeeFormatted,
        totalFeeUsd,
        lpFee: lpFeeFormatted,
        relayerGasFee: relayerGasFeeFormatted,
        capitalFee: capitalFeeFormatted,
      },
      estimatedTimeSeconds,
      estimatedTimeDisplay,
      requiresApproval,
      minimumAmount,
      expiresAt,
      provider: 'Across',
      timestamp,
      quoteContext,
    };

    return createBridgeQuoteSuccessResult(
      toolCallId,
      output,
      timestamp,
      formatBridgeQuoteMessage(output)
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Handle specific Across API errors
    if (errorMessage.includes('No route found') || errorMessage.includes('Route not supported')) {
      return createBridgeQuoteErrorResult(
        toolCallId,
        'ROUTE_NOT_AVAILABLE',
        'This bridge route is not available. Try a different token or chain pair.',
        timestamp
      );
    }

    return createBridgeQuoteErrorResult(
      toolCallId,
      'QUOTE_FAILED',
      'Technical issue getting bridge quote. Please try again.',
      timestamp,
      { originalError: errorMessage }
    );
  }
}

// ============================================================================
// Bridge Quote Result Helpers
// ============================================================================

function createBridgeQuoteSuccessResult(
  toolCallId: string,
  data: GetBridgeQuoteOutput,
  timestamp: number,
  message?: string
): ToolResultSuccess {
  return {
    success: true,
    toolCallId,
    toolName: 'get_bridge_quote',
    timestamp,
    data: data as unknown as Record<string, unknown>,
    message,
  };
}

function createBridgeQuoteErrorResult(
  toolCallId: string,
  errorCode: string,
  errorMessage: string,
  timestamp: number,
  errorDetails?: Record<string, unknown>
): ToolResultError {
  return {
    success: false,
    toolCallId,
    toolName: 'get_bridge_quote',
    timestamp,
    errorCode,
    errorMessage,
    errorDetails,
  };
}

/**
 * Format bridge quote into a human-readable message
 */
function formatBridgeQuoteMessage(output: GetBridgeQuoteOutput): string {
  const lines: string[] = ['**Bridge Quote**'];

  lines.push(
    `\n**Route:** ${output.sourceChain.chainName} → ${output.destinationChain.chainName}`
  );

  const inputUsd = output.inputToken.amountUsd ? ` (${output.inputToken.amountUsd})` : '';
  lines.push(`**Send:** ${output.inputToken.amount} ${output.inputToken.symbol}${inputUsd}`);

  const outputUsd = output.outputToken.amountUsd ? ` (${output.outputToken.amountUsd})` : '';
  lines.push(`**Receive:** ${output.outputToken.amount} ${output.outputToken.symbol}${outputUsd}`);

  const feeUsd = output.fees.totalFeeUsd ? ` (${output.fees.totalFeeUsd})` : '';
  lines.push(`**Fee:** ~${output.fees.totalFee} ${output.outputToken.symbol}${feeUsd}`);

  lines.push(`**Est. time:** ${output.estimatedTimeDisplay}`);

  if (output.requiresApproval) {
    lines.push(`\n⚠️ Token approval required before bridging`);
  }

  lines.push(`\n_Quote via ${output.provider}_`);

  return lines.join('\n');
}

// ============================================================================
// Get Transaction Status Tool Definition
// ============================================================================

export const getTransactionStatusToolDefinition: ToolDefinition = {
  name: 'get_transaction_status',
  description:
    'Check the status of a pending bridge transaction. ' +
    'Returns the current status (pending, completed, failed), estimated completion time for pending transactions, ' +
    'and the destination transaction hash when completed. ' +
    'Requires the source transaction hash from when the bridge was initiated.',
  inputSchema: {
    type: 'object',
    properties: {
      txHash: {
        type: 'string',
        description: 'The source chain transaction hash of the bridge deposit.',
      },
      sourceChainId: {
        type: 'number',
        description:
          'Source chain ID where the bridge was initiated. ' +
          'Supported: 1 (Ethereum), 8453 (Base), 10 (Optimism), 137 (Polygon), 42161 (Arbitrum).',
        enum: SUPPORTED_CHAIN_IDS as unknown as readonly string[],
      },
    },
    required: ['txHash', 'sourceChainId'],
    additionalProperties: false,
  },
  requiresConfirmation: false,
  requiresSignature: false,
  category: 'read',
};

// ============================================================================
// Get Transaction Status Tool Input/Output Types
// ============================================================================

export interface GetTransactionStatusInput {
  txHash: string;
  sourceChainId: ChainId;
}

/** Transaction status values */
export type TransactionStatusValue = 'pending' | 'completed' | 'failed';

export interface GetTransactionStatusOutput {
  /** Source transaction hash */
  sourceTxHash: string;
  /** Source chain information */
  sourceChain: {
    chainId: ChainId;
    chainName: string;
  };
  /** Destination chain information */
  destinationChain: {
    chainId: ChainId;
    chainName: string;
  };
  /** Current transaction status */
  status: TransactionStatusValue;
  /** Status display message */
  statusMessage: string;
  /** Estimated completion time in seconds (for pending transactions) */
  estimatedTimeSeconds?: number;
  /** Estimated time formatted for display */
  estimatedTimeDisplay?: string;
  /** Destination chain transaction hash (when completed) */
  destinationTxHash?: string;
  /** Block explorer URL for destination transaction */
  destinationExplorerUrl?: string;
  /** Block explorer URL for source transaction */
  sourceExplorerUrl: string;
  /** Input token details (if available) */
  inputToken?: {
    symbol: string;
    amount: string;
  };
  /** Output token details (if available) */
  outputToken?: {
    symbol: string;
    amount: string;
  };
  /** Fill deadline timestamp */
  fillDeadline?: number;
  /** Deposit ID from the bridge */
  depositId?: number;
  /** When the deposit was made */
  depositTime?: number;
  /** Query timestamp */
  timestamp: number;
}

// ============================================================================
// Across Protocol Deposit Status API Types
// ============================================================================

interface AcrossDepositStatusResponse {
  status: 'pending' | 'filled' | 'expired';
  fillTx?: string;
  destinationChainId?: number;
  depositTxHash: string;
  originChainId: number;
  depositId?: number;
  depositor?: string;
  recipient?: string;
  inputToken?: string;
  outputToken?: string;
  inputAmount?: string;
  outputAmount?: string;
  fillDeadline?: number;
  message?: string;
  depositTime?: number;
}

// ============================================================================
// Get Transaction Status Tool Executor
// ============================================================================

/**
 * Fetch deposit status from Across Protocol API
 */
async function fetchAcrossDepositStatus(
  txHash: string,
  originChainId: ChainId
): Promise<AcrossDepositStatusResponse> {
  const params = new URLSearchParams({
    depositTxHash: txHash,
    originChainId: originChainId.toString(),
  });

  const response = await fetch(`https://app.across.to/api/deposit/status?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Across deposit status API error (${response.status}): ${errorText}`);
  }

  return (await response.json()) as AcrossDepositStatusResponse;
}

/**
 * Map Across status to our status values
 */
function mapAcrossStatus(acrossStatus: string): TransactionStatusValue {
  switch (acrossStatus) {
    case 'filled':
      return 'completed';
    case 'expired':
      return 'failed';
    case 'pending':
    default:
      return 'pending';
  }
}

/**
 * Get status message based on status
 */
function getStatusMessage(status: TransactionStatusValue, acrossStatus: string): string {
  switch (status) {
    case 'completed':
      return 'Bridge completed successfully';
    case 'failed':
      return acrossStatus === 'expired'
        ? 'Bridge transaction expired - fill deadline passed'
        : 'Bridge transaction failed';
    case 'pending':
      return 'Bridge in progress - waiting for relayer to fill';
    default:
      return 'Unknown status';
  }
}

/**
 * Calculate estimated remaining time for pending transactions
 */
function calculateEstimatedTime(
  depositTime?: number,
  fillDeadline?: number
): { seconds?: number; display?: string } {
  if (!depositTime) {
    // Default estimate if we don't have deposit time
    return { seconds: 120, display: '~2 minutes' };
  }

  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - depositTime;

  // Typical Across fill time is 1-5 minutes
  // If less than 2 minutes elapsed, estimate 2-3 minutes remaining
  if (elapsed < 60) {
    return { seconds: 120, display: '~2 minutes' };
  } else if (elapsed < 120) {
    return { seconds: 60, display: '~1 minute' };
  } else if (elapsed < 300) {
    return { seconds: 30, display: '~30 seconds' };
  } else {
    // If it's taking longer than expected
    if (fillDeadline && now < fillDeadline) {
      const remaining = fillDeadline - now;
      const minutes = Math.ceil(remaining / 60);
      return {
        seconds: remaining,
        display: minutes > 1 ? `up to ${minutes} minutes` : '~1 minute',
      };
    }
    return { seconds: undefined, display: 'completing soon' };
  }
}

/**
 * Execute the get_transaction_status tool
 *
 * @param input - Tool input parameters
 * @param _context - Agent context (unused for this tool)
 * @param toolCallId - Unique ID for this tool call
 * @returns Tool result with transaction status or error
 */
export async function executeGetTransactionStatus(
  input: GetTransactionStatusInput,
  _context: AgentContext,
  toolCallId: string
): Promise<ToolResult> {
  const timestamp = Date.now();

  try {
    const { txHash, sourceChainId } = input;

    // Validate transaction hash format
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return createTransactionStatusErrorResult(
        toolCallId,
        'INVALID_TX_HASH',
        'Invalid transaction hash format. Must be a 66-character hex string starting with 0x.',
        timestamp
      );
    }

    // Validate chain ID
    if (!SUPPORTED_CHAIN_IDS.includes(sourceChainId)) {
      return createTransactionStatusErrorResult(
        toolCallId,
        'INVALID_CHAIN',
        `Invalid source chain ID: ${sourceChainId}. Supported chains: Ethereum (1), Base (8453), Optimism (10), Polygon (137), Arbitrum (42161).`,
        timestamp
      );
    }

    // Fetch deposit status from Across API
    const depositStatus = await fetchAcrossDepositStatus(txHash, sourceChainId);

    // Map status
    const status = mapAcrossStatus(depositStatus.status);
    const statusMessage = getStatusMessage(status, depositStatus.status);

    // Get destination chain ID (use the one from response or default to different chain)
    const destinationChainId = (depositStatus.destinationChainId || sourceChainId) as ChainId;

    // Calculate estimated time for pending transactions
    let estimatedTimeSeconds: number | undefined;
    let estimatedTimeDisplay: string | undefined;

    if (status === 'pending') {
      const timeEstimate = calculateEstimatedTime(
        depositStatus.depositTime,
        depositStatus.fillDeadline
      );
      estimatedTimeSeconds = timeEstimate.seconds;
      estimatedTimeDisplay = timeEstimate.display;
    }

    // Build explorer URLs
    const sourceExplorerUrl = `${EXPLORER_URLS[sourceChainId]}/tx/${txHash}`;
    const destinationExplorerUrl = depositStatus.fillTx
      ? `${EXPLORER_URLS[destinationChainId]}/tx/${depositStatus.fillTx}`
      : undefined;

    // Format token amounts if available
    let inputToken: { symbol: string; amount: string } | undefined;
    let outputToken: { symbol: string; amount: string } | undefined;

    if (depositStatus.inputAmount) {
      // Try to identify the token symbol from address (simplified - in production would use token registry)
      inputToken = {
        symbol: 'tokens', // Simplified - would look up from token registry
        amount: depositStatus.inputAmount,
      };
    }

    if (depositStatus.outputAmount) {
      outputToken = {
        symbol: 'tokens',
        amount: depositStatus.outputAmount,
      };
    }

    const output: GetTransactionStatusOutput = {
      sourceTxHash: txHash,
      sourceChain: {
        chainId: sourceChainId,
        chainName: CHAIN_NAMES[sourceChainId],
      },
      destinationChain: {
        chainId: destinationChainId,
        chainName: CHAIN_NAMES[destinationChainId] || `Chain ${destinationChainId}`,
      },
      status,
      statusMessage,
      estimatedTimeSeconds,
      estimatedTimeDisplay,
      destinationTxHash: depositStatus.fillTx,
      destinationExplorerUrl,
      sourceExplorerUrl,
      inputToken,
      outputToken,
      fillDeadline: depositStatus.fillDeadline,
      depositId: depositStatus.depositId,
      depositTime: depositStatus.depositTime,
      timestamp,
    };

    return createTransactionStatusSuccessResult(
      toolCallId,
      output,
      timestamp,
      formatTransactionStatusMessage(output)
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Handle specific API errors
    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      return createTransactionStatusErrorResult(
        toolCallId,
        'DEPOSIT_NOT_FOUND',
        'Bridge deposit not found. Please verify the transaction hash and source chain are correct.',
        timestamp
      );
    }

    return createTransactionStatusErrorResult(
      toolCallId,
      'STATUS_CHECK_FAILED',
      'Technical issue checking transaction status. Please try again.',
      timestamp,
      { originalError: errorMessage }
    );
  }
}

// ============================================================================
// Transaction Status Result Helpers
// ============================================================================

function createTransactionStatusSuccessResult(
  toolCallId: string,
  data: GetTransactionStatusOutput,
  timestamp: number,
  message?: string
): ToolResultSuccess {
  return {
    success: true,
    toolCallId,
    toolName: 'get_transaction_status',
    timestamp,
    data: data as unknown as Record<string, unknown>,
    message,
  };
}

function createTransactionStatusErrorResult(
  toolCallId: string,
  errorCode: string,
  errorMessage: string,
  timestamp: number,
  errorDetails?: Record<string, unknown>
): ToolResultError {
  return {
    success: false,
    toolCallId,
    toolName: 'get_transaction_status',
    timestamp,
    errorCode,
    errorMessage,
    errorDetails,
  };
}

/**
 * Format transaction status into a human-readable message
 */
function formatTransactionStatusMessage(output: GetTransactionStatusOutput): string {
  const lines: string[] = ['**Transaction Status**'];

  // Status with emoji indicator
  const statusEmoji =
    output.status === 'completed' ? '✅' : output.status === 'failed' ? '❌' : '⏳';
  lines.push(`\n${statusEmoji} **Status:** ${output.statusMessage}`);

  // Route
  lines.push(`**Route:** ${output.sourceChain.chainName} → ${output.destinationChain.chainName}`);

  // Estimated time for pending
  if (output.status === 'pending' && output.estimatedTimeDisplay) {
    lines.push(`**Est. completion:** ${output.estimatedTimeDisplay}`);
  }

  // Destination tx hash for completed
  if (output.status === 'completed' && output.destinationTxHash) {
    lines.push(`**Destination tx:** \`${output.destinationTxHash.slice(0, 10)}...${output.destinationTxHash.slice(-8)}\``);
    if (output.destinationExplorerUrl) {
      lines.push(`**Track:** ${output.destinationExplorerUrl}`);
    }
  }

  // Source tx link
  lines.push(`\n**Source tx:** ${output.sourceExplorerUrl}`);

  return lines.join('\n');
}

// ============================================================================
// Get Supported Routes Tool Definition
// ============================================================================

export const getSupportedRoutesToolDefinition: ToolDefinition = {
  name: 'get_supported_routes',
  description:
    'Get available bridge routes for a token pair. ' +
    'Returns all supported routes between chains for the specified input and output tokens. ' +
    'Useful for discovering which chains support bridging a specific token combination. ' +
    'If no tokens specified, returns all available bridge routes.',
  inputSchema: {
    type: 'object',
    properties: {
      inputToken: {
        type: 'string',
        description:
          'Input token symbol to filter routes (ETH, USDC, USDT, WETH, MATIC). ' +
          'If not specified, shows routes for all tokens.',
        enum: SUPPORTED_TOKEN_SYMBOLS as unknown as readonly string[],
      },
      outputToken: {
        type: 'string',
        description:
          'Output token symbol to filter routes (ETH, USDC, USDT, WETH, MATIC). ' +
          'If not specified, defaults to same as inputToken (same-token bridge).',
        enum: SUPPORTED_TOKEN_SYMBOLS as unknown as readonly string[],
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiresConfirmation: false,
  requiresSignature: false,
  category: 'read',
};

// ============================================================================
// Get Supported Routes Tool Input/Output Types
// ============================================================================

export interface GetSupportedRoutesInput {
  inputToken?: TokenSymbol;
  outputToken?: TokenSymbol;
}

export interface BridgeRoute {
  /** Source chain ID */
  sourceChainId: ChainId;
  /** Source chain name */
  sourceChainName: string;
  /** Destination chain ID */
  destinationChainId: ChainId;
  /** Destination chain name */
  destinationChainName: string;
  /** Input token symbol */
  inputToken: TokenSymbol;
  /** Output token symbol */
  outputToken: TokenSymbol;
  /** Whether this is a swap+bridge route (different input/output tokens) */
  isSwapBridge: boolean;
}

export interface GetSupportedRoutesOutput {
  /** Array of available bridge routes */
  routes: BridgeRoute[];
  /** Total number of routes found */
  totalRoutes: number;
  /** Filter applied (if any) */
  filter?: {
    inputToken?: TokenSymbol;
    outputToken?: TokenSymbol;
  };
  /** Query timestamp */
  timestamp: number;
}

// ============================================================================
// Get Supported Routes Tool Executor
// ============================================================================

/**
 * Execute the get_supported_routes tool
 *
 * @param input - Tool input parameters
 * @param _context - Agent context (unused for this tool)
 * @param toolCallId - Unique ID for this tool call
 * @returns Tool result with supported routes or error
 */
export async function executeGetSupportedRoutes(
  input: GetSupportedRoutesInput,
  _context: AgentContext,
  toolCallId: string
): Promise<ToolResult> {
  const timestamp = Date.now();

  try {
    const routes: BridgeRoute[] = [];

    // Determine which tokens to check
    const inputTokens: TokenSymbol[] = input.inputToken
      ? [input.inputToken]
      : [...SUPPORTED_TOKEN_SYMBOLS];

    for (const inputToken of inputTokens) {
      // If outputToken specified, only check that; otherwise check same-token bridges
      const outputTokens: TokenSymbol[] = input.outputToken
        ? [input.outputToken]
        : [inputToken]; // Default to same-token bridge

      for (const outputToken of outputTokens) {
        // Find all chains where input token is available
        const sourceChainsWithToken = SUPPORTED_CHAIN_IDS.filter((chainId) =>
          isTokenAvailableOnChain(inputToken, chainId)
        );

        // Find all chains where output token is available
        const destChainsWithToken = SUPPORTED_CHAIN_IDS.filter((chainId) =>
          isTokenAvailableOnChain(outputToken, chainId)
        );

        // Create routes for each valid source -> destination pair
        for (const sourceChainId of sourceChainsWithToken) {
          for (const destChainId of destChainsWithToken) {
            // Skip same-chain routes (those would be swaps, not bridges)
            if (sourceChainId === destChainId) continue;

            routes.push({
              sourceChainId,
              sourceChainName: CHAIN_NAMES[sourceChainId],
              destinationChainId: destChainId,
              destinationChainName: CHAIN_NAMES[destChainId],
              inputToken,
              outputToken,
              isSwapBridge: inputToken !== outputToken,
            });
          }
        }
      }
    }

    const output: GetSupportedRoutesOutput = {
      routes,
      totalRoutes: routes.length,
      filter:
        input.inputToken || input.outputToken
          ? {
              inputToken: input.inputToken,
              outputToken: input.outputToken,
            }
          : undefined,
      timestamp,
    };

    return createSupportedRoutesSuccessResult(
      toolCallId,
      output,
      timestamp,
      formatSupportedRoutesMessage(output)
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return createSupportedRoutesErrorResult(
      toolCallId,
      'ROUTES_FETCH_FAILED',
      'Technical issue fetching supported routes. Please try again.',
      timestamp,
      { originalError: errorMessage }
    );
  }
}

// ============================================================================
// Supported Routes Result Helpers
// ============================================================================

function createSupportedRoutesSuccessResult(
  toolCallId: string,
  data: GetSupportedRoutesOutput,
  timestamp: number,
  message?: string
): ToolResultSuccess {
  return {
    success: true,
    toolCallId,
    toolName: 'get_supported_routes',
    timestamp,
    data: data as unknown as Record<string, unknown>,
    message,
  };
}

function createSupportedRoutesErrorResult(
  toolCallId: string,
  errorCode: string,
  errorMessage: string,
  timestamp: number,
  errorDetails?: Record<string, unknown>
): ToolResultError {
  return {
    success: false,
    toolCallId,
    toolName: 'get_supported_routes',
    timestamp,
    errorCode,
    errorMessage,
    errorDetails,
  };
}

/**
 * Format supported routes into a human-readable message
 */
function formatSupportedRoutesMessage(output: GetSupportedRoutesOutput): string {
  if (output.routes.length === 0) {
    const filterDesc = output.filter
      ? ` for ${output.filter.inputToken || 'any token'}${output.filter.outputToken ? ` → ${output.filter.outputToken}` : ''}`
      : '';
    return `No bridge routes found${filterDesc}.`;
  }

  const lines: string[] = ['**Supported Bridge Routes**'];

  if (output.filter) {
    const filterParts: string[] = [];
    if (output.filter.inputToken) filterParts.push(`Input: ${output.filter.inputToken}`);
    if (output.filter.outputToken) filterParts.push(`Output: ${output.filter.outputToken}`);
    lines.push(`_Filter: ${filterParts.join(', ')}_`);
  }

  lines.push(`\n**${output.totalRoutes} routes available**\n`);

  // Group by input token for clearer display
  const byInputToken = new Map<TokenSymbol, BridgeRoute[]>();
  for (const route of output.routes) {
    const existing = byInputToken.get(route.inputToken) || [];
    existing.push(route);
    byInputToken.set(route.inputToken, existing);
  }

  for (const [token, tokenRoutes] of byInputToken) {
    lines.push(`**${token}**`);

    // Show unique chain pairs
    const uniquePairs = new Set<string>();
    for (const route of tokenRoutes) {
      const pairKey = `${route.sourceChainName} → ${route.destinationChainName}`;
      if (!uniquePairs.has(pairKey)) {
        uniquePairs.add(pairKey);
        const swapNote = route.isSwapBridge ? ` (→ ${route.outputToken})` : '';
        lines.push(`- ${pairKey}${swapNote}`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Get Chain Info Tool Definition
// ============================================================================

export const getChainInfoToolDefinition: ToolDefinition = {
  name: 'get_chain_info',
  description:
    'Get detailed information about a supported blockchain. ' +
    'Returns chain name, native token, block explorer URL, and supported tokens. ' +
    'If no chain specified, returns info for all supported chains.',
  inputSchema: {
    type: 'object',
    properties: {
      chainId: {
        type: 'number',
        description:
          'Chain ID to get info for. ' +
          'Supported: 1 (Ethereum), 8453 (Base), 10 (Optimism), 137 (Polygon), 42161 (Arbitrum). ' +
          'If not specified, returns info for all supported chains.',
        enum: SUPPORTED_CHAIN_IDS as unknown as readonly string[],
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiresConfirmation: false,
  requiresSignature: false,
  category: 'read',
};

// ============================================================================
// Get Chain Info Tool Input/Output Types
// ============================================================================

export interface GetChainInfoInput {
  chainId?: ChainId;
}

export interface ChainInfo {
  /** Chain ID */
  chainId: ChainId;
  /** Human-readable chain name */
  name: string;
  /** Native token symbol (e.g., ETH, MATIC) */
  nativeToken: string;
  /** Block explorer base URL */
  explorerUrl: string;
  /** RPC endpoint URL */
  rpcUrl: string;
  /** List of supported tokens on this chain */
  supportedTokens: TokenSymbol[];
}

export interface GetChainInfoOutput {
  /** Array of chain information */
  chains: ChainInfo[];
  /** Query timestamp */
  timestamp: number;
}

// ============================================================================
// Get Chain Info Tool Executor
// ============================================================================

/**
 * Execute the get_chain_info tool
 *
 * @param input - Tool input parameters
 * @param _context - Agent context (unused for this tool)
 * @param toolCallId - Unique ID for this tool call
 * @returns Tool result with chain info or error
 */
export async function executeGetChainInfo(
  input: GetChainInfoInput,
  _context: AgentContext,
  toolCallId: string
): Promise<ToolResult> {
  const timestamp = Date.now();

  try {
    // Determine which chains to return info for
    const chainIds: ChainId[] = input.chainId
      ? [input.chainId]
      : [...SUPPORTED_CHAIN_IDS];

    // Validate chain ID if provided
    if (input.chainId && !SUPPORTED_CHAIN_IDS.includes(input.chainId)) {
      return createChainInfoErrorResult(
        toolCallId,
        'INVALID_CHAIN',
        `Invalid chain ID: ${input.chainId}. Supported chains: Ethereum (1), Base (8453), Optimism (10), Polygon (137), Arbitrum (42161).`,
        timestamp
      );
    }

    const chains: ChainInfo[] = chainIds.map((chainId) => ({
      chainId,
      name: CHAIN_NAMES[chainId],
      nativeToken: NATIVE_TOKENS[chainId],
      explorerUrl: EXPLORER_URLS[chainId],
      rpcUrl: RPC_URLS[chainId],
      supportedTokens: getSupportedTokensOnChain(chainId),
    }));

    const output: GetChainInfoOutput = {
      chains,
      timestamp,
    };

    return createChainInfoSuccessResult(
      toolCallId,
      output,
      timestamp,
      formatChainInfoMessage(output)
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return createChainInfoErrorResult(
      toolCallId,
      'CHAIN_INFO_FAILED',
      'Technical issue fetching chain info. Please try again.',
      timestamp,
      { originalError: errorMessage }
    );
  }
}

// ============================================================================
// Chain Info Result Helpers
// ============================================================================

function createChainInfoSuccessResult(
  toolCallId: string,
  data: GetChainInfoOutput,
  timestamp: number,
  message?: string
): ToolResultSuccess {
  return {
    success: true,
    toolCallId,
    toolName: 'get_chain_info',
    timestamp,
    data: data as unknown as Record<string, unknown>,
    message,
  };
}

function createChainInfoErrorResult(
  toolCallId: string,
  errorCode: string,
  errorMessage: string,
  timestamp: number,
  errorDetails?: Record<string, unknown>
): ToolResultError {
  return {
    success: false,
    toolCallId,
    toolName: 'get_chain_info',
    timestamp,
    errorCode,
    errorMessage,
    errorDetails,
  };
}

/**
 * Format chain info into a human-readable message
 */
function formatChainInfoMessage(output: GetChainInfoOutput): string {
  const lines: string[] = ['**Supported Chains**'];

  for (const chain of output.chains) {
    lines.push(`\n**${chain.name}** (Chain ID: ${chain.chainId})`);
    lines.push(`- Native Token: ${chain.nativeToken}`);
    lines.push(`- Explorer: ${chain.explorerUrl}`);
    lines.push(`- Tokens: ${chain.supportedTokens.join(', ')}`);
  }

  return lines.join('\n');
}

// ============================================================================
// Get Token Price Tool Definition
// ============================================================================

export const getTokenPriceToolDefinition: ToolDefinition = {
  name: 'get_token_price',
  description:
    'Get the current USD price for a supported token. ' +
    'Returns real-time price data from CoinGecko. ' +
    'If no token specified, returns prices for all supported tokens.',
  inputSchema: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description:
          'Token symbol to get price for (ETH, USDC, USDT, WETH, MATIC). ' +
          'If not specified, returns prices for all supported tokens.',
        enum: SUPPORTED_TOKEN_SYMBOLS as unknown as readonly string[],
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiresConfirmation: false,
  requiresSignature: false,
  category: 'read',
};

// ============================================================================
// Get Token Price Tool Input/Output Types
// ============================================================================

export interface GetTokenPriceInput {
  token?: TokenSymbol;
}

export interface TokenPriceInfo {
  /** Token symbol */
  symbol: TokenSymbol;
  /** Current USD price */
  priceUsd: number;
  /** Formatted USD price for display */
  priceUsdDisplay: string;
}

export interface GetTokenPriceOutput {
  /** Array of token prices */
  prices: TokenPriceInfo[];
  /** Data source */
  source: string;
  /** Query timestamp */
  timestamp: number;
}

// ============================================================================
// Get Token Price Tool Executor
// ============================================================================

/**
 * Execute the get_token_price tool
 *
 * @param input - Tool input parameters
 * @param _context - Agent context (unused for this tool)
 * @param toolCallId - Unique ID for this tool call
 * @returns Tool result with token prices or error
 */
export async function executeGetTokenPrice(
  input: GetTokenPriceInput,
  _context: AgentContext,
  toolCallId: string
): Promise<ToolResult> {
  const timestamp = Date.now();

  try {
    // Fetch all prices (we'll filter later if needed)
    const allPrices = await fetchTokenPrices();

    if (Object.keys(allPrices).length === 0) {
      return createTokenPriceErrorResult(
        toolCallId,
        'PRICE_FETCH_FAILED',
        'Unable to fetch token prices. Please try again.',
        timestamp
      );
    }

    // Determine which tokens to include
    const tokensToInclude: TokenSymbol[] = input.token
      ? [input.token]
      : [...SUPPORTED_TOKEN_SYMBOLS];

    const prices: TokenPriceInfo[] = [];

    for (const token of tokensToInclude) {
      const price = allPrices[token];
      if (price !== undefined) {
        prices.push({
          symbol: token,
          priceUsd: price,
          priceUsdDisplay: formatUsdValue(price),
        });
      }
    }

    if (prices.length === 0 && input.token) {
      return createTokenPriceErrorResult(
        toolCallId,
        'TOKEN_PRICE_NOT_FOUND',
        `Price not available for ${input.token}. Please try again.`,
        timestamp
      );
    }

    const output: GetTokenPriceOutput = {
      prices,
      source: 'CoinGecko',
      timestamp,
    };

    return createTokenPriceSuccessResult(
      toolCallId,
      output,
      timestamp,
      formatTokenPriceMessage(output)
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return createTokenPriceErrorResult(
      toolCallId,
      'PRICE_FETCH_FAILED',
      'Technical issue fetching token prices. Please try again.',
      timestamp,
      { originalError: errorMessage }
    );
  }
}

// ============================================================================
// Token Price Result Helpers
// ============================================================================

function createTokenPriceSuccessResult(
  toolCallId: string,
  data: GetTokenPriceOutput,
  timestamp: number,
  message?: string
): ToolResultSuccess {
  return {
    success: true,
    toolCallId,
    toolName: 'get_token_price',
    timestamp,
    data: data as unknown as Record<string, unknown>,
    message,
  };
}

function createTokenPriceErrorResult(
  toolCallId: string,
  errorCode: string,
  errorMessage: string,
  timestamp: number,
  errorDetails?: Record<string, unknown>
): ToolResultError {
  return {
    success: false,
    toolCallId,
    toolName: 'get_token_price',
    timestamp,
    errorCode,
    errorMessage,
    errorDetails,
  };
}

/**
 * Format token prices into a human-readable message
 */
function formatTokenPriceMessage(output: GetTokenPriceOutput): string {
  if (output.prices.length === 0) {
    return 'No price data available.';
  }

  const lines: string[] = ['**Token Prices**'];

  for (const price of output.prices) {
    lines.push(`- **${price.symbol}:** ${price.priceUsdDisplay}`);
  }

  lines.push(`\n_Source: ${output.source}_`);

  return lines.join('\n');
}

// ============================================================================
// Exports
// ============================================================================

export const readTools = {
  check_balance: {
    definition: checkBalanceToolDefinition,
    execute: executeCheckBalance,
  },
  get_bridge_quote: {
    definition: getBridgeQuoteToolDefinition,
    execute: executeGetBridgeQuote,
  },
  get_transaction_status: {
    definition: getTransactionStatusToolDefinition,
    execute: executeGetTransactionStatus,
  },
  get_supported_routes: {
    definition: getSupportedRoutesToolDefinition,
    execute: executeGetSupportedRoutes,
  },
  get_chain_info: {
    definition: getChainInfoToolDefinition,
    execute: executeGetChainInfo,
  },
  get_token_price: {
    definition: getTokenPriceToolDefinition,
    execute: executeGetTokenPrice,
  },
} as const;
