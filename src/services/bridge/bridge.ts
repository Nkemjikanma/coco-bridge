/**
 * Bridge Service
 * Integrates with Across Protocol to get quotes and build bridge transactions.
 */

import {
  createPublicClient,
  http,
  formatUnits,
  parseUnits,
  encodeFunctionData,
  type Address,
  erc20Abi,
  maxUint256,
} from 'viem';
import { mainnet, base, optimism, polygon, arbitrum } from 'viem/chains';
import crypto from 'crypto';

import {
  CHAIN_IDS,
  CHAIN_NAMES,
  RPC_URLS,
  isValidChainId,
  getExplorerTxUrl,
  type ChainId,
} from './bridgeConstants';
import {
  getTokenAddress,
  getTokenDecimals,
  isNativeToken,
  isTokenAvailableOnChain,
  type TokenSymbol,
} from '../tokens';
import type {
  BridgeQuote,
  BridgeQuoteToken,
  BridgeQuoteFees,
  BridgeTransaction,
  ApprovalTransaction,
  TransactionData,
  GetBridgeQuoteInput,
  BuildBridgeTransactionInput,
  BuildApprovalTransactionInput,
  BridgeQuoteResponse,
  BridgeTransactionResponse,
  ApprovalTransactionResponse,
  AcrossSuggestedFeesResponse,
  AcrossLimitsResponse,
} from './types';

// ============================================================================
// Constants
// ============================================================================

/** Across Protocol API base URL */
const ACROSS_API_BASE = 'https://app.across.to/api';

/** Default slippage tolerance (1%) */
const DEFAULT_SLIPPAGE_TOLERANCE = 0.01;

/** Quote expiration time (2 minutes) */
const QUOTE_EXPIRATION_MS = 120000;

/** Fill deadline buffer (4 hours from now) */
const FILL_DEADLINE_BUFFER_SECONDS = 4 * 60 * 60;

/** CoinGecko ID mapping for price fetching */
const COINGECKO_IDS: Record<TokenSymbol, string> = {
  ETH: 'ethereum',
  USDC: 'usd-coin',
  USDT: 'tether',
  WETH: 'weth',
  MATIC: 'matic-network',
};

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
// Across Protocol Spoke Pool ABI (minimal)
// ============================================================================

const SPOKE_POOL_ABI = [
  {
    name: 'depositV3',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'depositor', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'inputToken', type: 'address' },
      { name: 'outputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'outputAmount', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'exclusiveRelayer', type: 'address' },
      { name: 'quoteTimestamp', type: 'uint32' },
      { name: 'fillDeadline', type: 'uint32' },
      { name: 'exclusivityDeadline', type: 'uint32' },
      { name: 'message', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

// ============================================================================
// Utility Functions
// ============================================================================

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
 */
async function fetchTokenPrices(): Promise<Record<string, number>> {
  try {
    const ids = Object.values(COINGECKO_IDS).join(',');
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = (await response.json()) as Record<string, { usd: number }>;

    const prices: Record<string, number> = {};
    for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
      if (data[geckoId]?.usd) {
        prices[symbol] = data[geckoId].usd;
      }
    }

    return prices;
  } catch (error) {
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

  const displayDecimals = num < 1 ? 6 : num < 100 ? 4 : 2;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: displayDecimals,
  });
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
 * Generate a unique quote ID
 */
function generateQuoteId(): string {
  return `quote_${crypto.randomUUID()}`;
}

/**
 * Generate a unique transaction ID
 */
function generateTransactionId(): string {
  return `tx_${crypto.randomUUID()}`;
}

/**
 * Calculate fee percentage from raw values
 */
function calculateFeePercentage(feeRaw: bigint, inputRaw: bigint): string {
  if (inputRaw === 0n) return '0';
  const percentage = (Number(feeRaw) / Number(inputRaw)) * 100;
  return percentage.toFixed(4);
}

/**
 * Apply slippage to output amount
 */
function applySlippage(amount: bigint, slippageTolerance: number): bigint {
  const slippageMultiplier = BigInt(Math.floor((1 - slippageTolerance) * 10000));
  return (amount * slippageMultiplier) / 10000n;
}

// ============================================================================
// Across Protocol API Functions
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

  const response = await fetch(`${ACROSS_API_BASE}/suggested-fees?${params.toString()}`);

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

  const response = await fetch(`${ACROSS_API_BASE}/limits?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Across limits API error (${response.status}): ${errorText}`);
  }

  return (await response.json()) as AcrossLimitsResponse;
}

// ============================================================================
// Approval Check Functions
// ============================================================================

/**
 * Check current allowance for a token
 */
async function checkAllowance(
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  chainId: ChainId
): Promise<bigint> {
  if (isNativeToken(tokenAddress)) {
    return maxUint256;
  }

  const client = createChainClient(chainId);
  const allowance = await client.readContract({
    address: tokenAddress as Address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [ownerAddress as Address, spenderAddress as Address],
  });

  return allowance;
}

/**
 * Check if token requires approval for bridging
 */
async function checkRequiresApproval(
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  amountRaw: bigint,
  chainId: ChainId
): Promise<boolean> {
  if (isNativeToken(tokenAddress)) {
    return false;
  }

  try {
    const allowance = await checkAllowance(tokenAddress, ownerAddress, spenderAddress, chainId);
    return allowance < amountRaw;
  } catch (error) {
    console.error('Error checking allowance:', error);
    return true;
  }
}

// ============================================================================
// Get Bridge Quote
// ============================================================================

/**
 * Get a bridge quote from Across Protocol.
 * Fetches quotes, fees, and limits for a cross-chain bridge.
 *
 * @param input - Quote input parameters
 * @param userAddress - Optional user address for approval checking
 * @returns Bridge quote or error
 */
export async function getBridgeQuote(
  input: GetBridgeQuoteInput,
  userAddress?: string
): Promise<BridgeQuoteResponse> {
  const timestamp = Date.now();

  try {
    const { fromChainId, toChainId, inputToken, amount } = input;
    const outputToken = input.outputToken || inputToken;
    const slippageTolerance = input.slippageTolerance ?? DEFAULT_SLIPPAGE_TOLERANCE;

    // Validate chain IDs
    if (!isValidChainId(fromChainId)) {
      return {
        success: false,
        errorCode: 'INVALID_CHAIN',
        errorMessage: `Invalid source chain ID: ${fromChainId}`,
      };
    }

    if (!isValidChainId(toChainId)) {
      return {
        success: false,
        errorCode: 'INVALID_CHAIN',
        errorMessage: `Invalid destination chain ID: ${toChainId}`,
      };
    }

    // Validate chains are different
    if (fromChainId === toChainId) {
      return {
        success: false,
        errorCode: 'SAME_CHAIN',
        errorMessage: 'Source and destination chains must be different. Use a DEX for same-chain swaps.',
      };
    }

    // Validate token availability on source chain
    if (!isTokenAvailableOnChain(inputToken, fromChainId)) {
      return {
        success: false,
        errorCode: 'TOKEN_NOT_AVAILABLE',
        errorMessage: `${inputToken} is not available on ${CHAIN_NAMES[fromChainId]}.`,
      };
    }

    // Validate token availability on destination chain
    if (!isTokenAvailableOnChain(outputToken, toChainId)) {
      return {
        success: false,
        errorCode: 'TOKEN_NOT_AVAILABLE',
        errorMessage: `${outputToken} is not available on ${CHAIN_NAMES[toChainId]}.`,
      };
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
      return {
        success: false,
        errorCode: 'INVALID_AMOUNT',
        errorMessage: `Invalid amount format: "${amount}". Please provide a valid number.`,
      };
    }

    if (amountRaw <= 0n) {
      return {
        success: false,
        errorCode: 'INVALID_AMOUNT',
        errorMessage: 'Amount must be greater than 0.',
      };
    }

    // Validate slippage tolerance
    if (slippageTolerance < 0 || slippageTolerance > 0.5) {
      return {
        success: false,
        errorCode: 'INVALID_SLIPPAGE',
        errorMessage: 'Slippage tolerance must be between 0 and 50%.',
      };
    }

    // Fetch quote, limits, and prices in parallel
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
      return {
        success: false,
        errorCode: 'AMOUNT_TOO_LOW',
        errorMessage: `Amount too low. Minimum bridgeable amount is ${minAmount} ${inputToken}.`,
        errorDetails: { minimumAmount: minAmount },
      };
    }

    // Calculate fees
    const totalFeeRaw = BigInt(quoteResult.totalRelayFee.total);
    const lpFeeRaw = BigInt(quoteResult.lpFee.total);
    const relayerGasFeeRaw = BigInt(quoteResult.relayerGasFee.total);
    const capitalFeeRaw = BigInt(quoteResult.relayerCapitalFee.total);

    // Calculate output amount (input - total fees)
    const outputAmountRaw = amountRaw - totalFeeRaw;

    if (outputAmountRaw <= 0n) {
      return {
        success: false,
        errorCode: 'FEE_EXCEEDS_AMOUNT',
        errorMessage: 'Bridge fee exceeds the input amount. Please increase the amount.',
      };
    }

    // Apply slippage tolerance
    const minOutputAmountRaw = applySlippage(outputAmountRaw, slippageTolerance);

    // Format amounts
    const inputAmountFormatted = formatBalance(amount, inputDecimals);
    const outputAmountFormatted = formatBalance(
      formatUnits(outputAmountRaw, outputDecimals),
      outputDecimals
    );
    const totalFeeFormatted = formatBalance(
      formatUnits(totalFeeRaw, outputDecimals),
      outputDecimals
    );
    const lpFeeFormatted = formatBalance(
      formatUnits(lpFeeRaw, outputDecimals),
      outputDecimals
    );
    const relayerGasFeeFormatted = formatBalance(
      formatUnits(relayerGasFeeRaw, outputDecimals),
      outputDecimals
    );
    const capitalFeeFormatted = capitalFeeRaw > 0n
      ? formatBalance(formatUnits(capitalFeeRaw, outputDecimals), outputDecimals)
      : undefined;
    const minOutputFormatted = formatBalance(
      formatUnits(minOutputAmountRaw, outputDecimals),
      outputDecimals
    );

    // Calculate USD values
    const inputPrice = prices[inputToken];
    const outputPrice = prices[outputToken];
    const inputAmountUsd = inputPrice
      ? formatUsdValue(parseFloat(amount) * inputPrice)
      : undefined;
    const outputAmountUsd = outputPrice
      ? formatUsdValue(parseFloat(formatUnits(outputAmountRaw, outputDecimals)) * outputPrice)
      : undefined;
    const totalFeeUsd = outputPrice
      ? formatUsdValue(parseFloat(formatUnits(totalFeeRaw, outputDecimals)) * outputPrice)
      : undefined;

    // Check if approval is required
    let requiresApproval = !isNativeToken(inputTokenAddress);
    if (userAddress && !isNativeToken(inputTokenAddress)) {
      requiresApproval = await checkRequiresApproval(
        inputTokenAddress,
        userAddress,
        quoteResult.spokePoolAddress,
        amountRaw,
        fromChainId
      );
    }

    // Parse times
    const estimatedTimeSeconds = parseInt(quoteResult.expectedFillTimeSec, 10) || 120;
    const estimatedTimeDisplay = formatEstimatedTime(estimatedTimeSeconds);
    const quoteTimestamp = parseInt(quoteResult.timestamp, 10);
    const exclusivityDeadline = parseInt(quoteResult.exclusivityDeadline, 10);
    const expiresAt = timestamp + QUOTE_EXPIRATION_MS;

    // Calculate fee percentage
    const feePercentage = calculateFeePercentage(totalFeeRaw, amountRaw);

    // Build input token details
    const inputTokenDetails: BridgeQuoteToken = {
      symbol: inputToken,
      address: inputTokenAddress,
      chainId: fromChainId,
      chainName: CHAIN_NAMES[fromChainId],
      amount: inputAmountFormatted,
      amountRaw: amountRaw.toString(),
      decimals: inputDecimals,
      amountUsd: inputAmountUsd,
    };

    // Build output token details
    const outputTokenDetails: BridgeQuoteToken = {
      symbol: outputToken,
      address: outputTokenAddress,
      chainId: toChainId,
      chainName: CHAIN_NAMES[toChainId],
      amount: outputAmountFormatted,
      amountRaw: outputAmountRaw.toString(),
      decimals: outputDecimals,
      amountUsd: outputAmountUsd,
    };

    // Build fees breakdown
    const fees: BridgeQuoteFees = {
      totalFeeRaw: totalFeeRaw.toString(),
      totalFee: totalFeeFormatted,
      totalFeeUsd,
      lpFeeRaw: lpFeeRaw.toString(),
      lpFee: lpFeeFormatted,
      relayerGasFeeRaw: relayerGasFeeRaw.toString(),
      relayerGasFee: relayerGasFeeFormatted,
      capitalFeeRaw: capitalFeeRaw > 0n ? capitalFeeRaw.toString() : undefined,
      capitalFee: capitalFeeFormatted,
      feePercentage,
    };

    // Build quote
    const quote: BridgeQuote = {
      quoteId: generateQuoteId(),
      inputToken: inputTokenDetails,
      outputToken: outputTokenDetails,
      fees,
      estimatedTimeSeconds,
      estimatedTimeDisplay,
      requiresApproval,
      spokePoolAddress: quoteResult.spokePoolAddress,
      exclusiveRelayer: quoteResult.exclusiveRelayer,
      exclusivityDeadline,
      quoteBlock: quoteResult.quoteBlock,
      quoteTimestamp,
      minDeposit: formatUnits(BigInt(limitsResult.minDeposit), inputDecimals),
      maxDeposit: formatUnits(BigInt(limitsResult.maxDeposit), inputDecimals),
      slippageTolerance,
      minOutputAmount: minOutputFormatted,
      expiresAt,
      provider: 'Across',
      createdAt: timestamp,
    };

    return {
      success: true,
      quote,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Handle specific Across API errors
    if (errorMessage.includes('No route found') || errorMessage.includes('Route not supported')) {
      return {
        success: false,
        errorCode: 'ROUTE_NOT_AVAILABLE',
        errorMessage: 'This bridge route is not available. Try a different token or chain pair.',
      };
    }

    return {
      success: false,
      errorCode: 'QUOTE_FAILED',
      errorMessage: 'Technical issue getting bridge quote. Please try again.',
      errorDetails: { originalError: errorMessage },
    };
  }
}

// ============================================================================
// Build Bridge Transaction
// ============================================================================

/**
 * Build a bridge transaction from a quote.
 * Creates the transaction data ready for user signature.
 *
 * @param input - Transaction build input
 * @returns Bridge transaction or error
 */
export async function buildBridgeTransaction(
  input: BuildBridgeTransactionInput
): Promise<BridgeTransactionResponse> {
  const timestamp = Date.now();

  try {
    const { quote, depositor, recipient: inputRecipient, slippageTolerance: customSlippage } = input;
    const recipient = inputRecipient || depositor;
    const slippageTolerance = customSlippage ?? quote.slippageTolerance;

    // Validate addresses
    if (!isValidAddress(depositor)) {
      return {
        success: false,
        errorCode: 'INVALID_ADDRESS',
        errorMessage: 'Invalid depositor address.',
      };
    }

    if (!isValidAddress(recipient)) {
      return {
        success: false,
        errorCode: 'INVALID_ADDRESS',
        errorMessage: 'Invalid recipient address.',
      };
    }

    // Check if quote has expired
    if (timestamp > quote.expiresAt) {
      return {
        success: false,
        errorCode: 'QUOTE_EXPIRED',
        errorMessage: 'Quote has expired. Please get a fresh quote.',
      };
    }

    // Calculate fill deadline (4 hours from now)
    const fillDeadline = Math.floor(timestamp / 1000) + FILL_DEADLINE_BUFFER_SECONDS;

    // Recalculate min output with custom slippage if provided
    let minOutputAmountRaw: bigint;
    if (customSlippage !== undefined) {
      const outputAmountRaw = BigInt(quote.outputToken.amountRaw);
      minOutputAmountRaw = applySlippage(outputAmountRaw, slippageTolerance);
    } else {
      minOutputAmountRaw = parseUnits(quote.minOutputAmount, quote.outputToken.decimals);
    }

    // Get the output token address on the destination chain
    const outputTokenAddress = quote.outputToken.address;

    // Encode depositV3 call data
    const callData = encodeFunctionData({
      abi: SPOKE_POOL_ABI,
      functionName: 'depositV3',
      args: [
        depositor as Address,
        recipient as Address,
        quote.inputToken.address as Address,
        outputTokenAddress as Address,
        BigInt(quote.inputToken.amountRaw),
        minOutputAmountRaw,
        BigInt(quote.outputToken.chainId),
        quote.exclusiveRelayer as Address,
        quote.quoteTimestamp,
        fillDeadline,
        quote.exclusivityDeadline,
        '0x' as `0x${string}`, // Empty message for standard bridges
      ],
    });

    // Determine value (ETH amount for native token bridges)
    const isNativeBridge = isNativeToken(quote.inputToken.address);
    const value = isNativeBridge ? quote.inputToken.amountRaw : '0';

    // Build transaction data
    const transactionData: TransactionData = {
      to: quote.spokePoolAddress,
      data: callData,
      value,
      chainId: quote.inputToken.chainId,
    };

    // Estimate gas
    try {
      const client = createChainClient(quote.inputToken.chainId);
      const gasEstimate = await client.estimateGas({
        account: depositor as Address,
        to: quote.spokePoolAddress as Address,
        data: callData as `0x${string}`,
        value: BigInt(value),
      });
      // Add 20% buffer to gas estimate
      transactionData.gasLimit = ((gasEstimate * 120n) / 100n).toString();
    } catch (gasError) {
      console.error('Gas estimation failed:', gasError);
      // Use a reasonable default if estimation fails
      transactionData.gasLimit = isNativeBridge ? '100000' : '150000';
    }

    // Build bridge transaction
    const bridgeTransaction: BridgeTransaction = {
      transactionId: generateTransactionId(),
      type: 'bridge',
      status: 'pending_signature',
      sourceChainId: quote.inputToken.chainId,
      sourceChainName: quote.inputToken.chainName,
      destinationChainId: quote.outputToken.chainId,
      destinationChainName: quote.outputToken.chainName,
      inputToken: quote.inputToken,
      outputToken: quote.outputToken,
      fees: quote.fees,
      slippageTolerance,
      minOutputAmount: formatUnits(minOutputAmountRaw, quote.outputToken.decimals),
      transaction: transactionData,
      quoteId: quote.quoteId,
      depositor,
      recipient,
      spokePoolAddress: quote.spokePoolAddress,
      fillDeadline,
      exclusivityDeadline: quote.exclusivityDeadline,
      exclusiveRelayer: quote.exclusiveRelayer,
      message: '0x',
      estimatedTimeSeconds: quote.estimatedTimeSeconds,
      estimatedTimeDisplay: quote.estimatedTimeDisplay,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return {
      success: true,
      transaction: bridgeTransaction,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return {
      success: false,
      errorCode: 'TRANSACTION_BUILD_FAILED',
      errorMessage: 'Failed to build bridge transaction. Please try again.',
      errorDetails: { originalError: errorMessage },
    };
  }
}

// ============================================================================
// Build Approval Transaction
// ============================================================================

/**
 * Build an approval transaction for ERC20 tokens.
 * Creates the transaction data ready for user signature.
 *
 * @param input - Approval transaction input
 * @returns Approval transaction or error
 */
export async function buildApprovalTransaction(
  input: BuildApprovalTransactionInput
): Promise<ApprovalTransactionResponse> {
  const timestamp = Date.now();

  try {
    const { token, chainId, spender, amount, owner } = input;

    // Validate chain ID
    if (!isValidChainId(chainId)) {
      return {
        success: false,
        errorCode: 'INVALID_CHAIN',
        errorMessage: `Invalid chain ID: ${chainId}`,
      };
    }

    // Validate addresses
    if (!isValidAddress(spender)) {
      return {
        success: false,
        errorCode: 'INVALID_ADDRESS',
        errorMessage: 'Invalid spender address.',
      };
    }

    if (!isValidAddress(owner)) {
      return {
        success: false,
        errorCode: 'INVALID_ADDRESS',
        errorMessage: 'Invalid owner address.',
      };
    }

    // Get token address
    const tokenAddress = getTokenAddress(token, chainId);
    if (!tokenAddress) {
      return {
        success: false,
        errorCode: 'TOKEN_NOT_AVAILABLE',
        errorMessage: `${token} is not available on ${CHAIN_NAMES[chainId]}.`,
      };
    }

    // Native tokens don't need approval
    if (isNativeToken(tokenAddress)) {
      return {
        success: false,
        errorCode: 'APPROVAL_NOT_NEEDED',
        errorMessage: 'Native tokens (ETH/MATIC) do not require approval.',
      };
    }

    const tokenDecimals = getTokenDecimals(token);

    // Determine approval amount
    const isMaxApproval = amount === 'max';
    let approvalAmount: bigint;

    if (isMaxApproval) {
      approvalAmount = maxUint256;
    } else {
      try {
        approvalAmount = parseUnits(amount, tokenDecimals);
      } catch {
        return {
          success: false,
          errorCode: 'INVALID_AMOUNT',
          errorMessage: `Invalid amount format: "${amount}".`,
        };
      }
    }

    // Encode approve call data
    const callData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender as Address, approvalAmount],
    });

    // Build transaction data
    const transactionData: TransactionData = {
      to: tokenAddress,
      data: callData,
      value: '0',
      chainId,
    };

    // Estimate gas
    try {
      const client = createChainClient(chainId);
      const gasEstimate = await client.estimateGas({
        account: owner as Address,
        to: tokenAddress as Address,
        data: callData as `0x${string}`,
      });
      // Add 20% buffer
      transactionData.gasLimit = ((gasEstimate * 120n) / 100n).toString();
    } catch {
      // Use reasonable default for approval
      transactionData.gasLimit = '60000';
    }

    // Build token details
    const tokenDetails: BridgeQuoteToken = {
      symbol: token,
      address: tokenAddress,
      chainId,
      chainName: CHAIN_NAMES[chainId],
      amount: isMaxApproval ? 'unlimited' : amount,
      amountRaw: approvalAmount.toString(),
      decimals: tokenDecimals,
    };

    // Build approval transaction
    const approvalTransaction: ApprovalTransaction = {
      transactionId: generateTransactionId(),
      type: 'approval',
      status: 'pending_signature',
      chainId,
      chainName: CHAIN_NAMES[chainId],
      token: tokenDetails,
      spender,
      amount: approvalAmount.toString(),
      transaction: transactionData,
      isMaxApproval,
      createdAt: timestamp,
    };

    return {
      success: true,
      transaction: approvalTransaction,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return {
      success: false,
      errorCode: 'APPROVAL_BUILD_FAILED',
      errorMessage: 'Failed to build approval transaction. Please try again.',
      errorDetails: { originalError: errorMessage },
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Basic address validation
 */
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Update transaction with hash and explorer URL
 */
export function updateTransactionWithHash(
  transaction: BridgeTransaction | ApprovalTransaction,
  txHash: string
): BridgeTransaction | ApprovalTransaction {
  const chainId = 'sourceChainId' in transaction ? transaction.sourceChainId : transaction.chainId;
  return {
    ...transaction,
    status: 'pending_confirmation',
    txHash,
    explorerUrl: getExplorerTxUrl(chainId, txHash),
    updatedAt: Date.now(),
  };
}

/**
 * Check if a quote is still valid
 */
export function isQuoteValid(quote: BridgeQuote): boolean {
  return Date.now() < quote.expiresAt;
}

/**
 * Format a bridge quote for display
 */
export function formatBridgeQuoteMessage(quote: BridgeQuote): string {
  const lines: string[] = ['**Bridge Quote**'];

  lines.push(`\n**Route:** ${quote.inputToken.chainName} → ${quote.outputToken.chainName}`);

  const inputUsd = quote.inputToken.amountUsd ? ` (${quote.inputToken.amountUsd})` : '';
  lines.push(`**Send:** ${quote.inputToken.amount} ${quote.inputToken.symbol}${inputUsd}`);

  const outputUsd = quote.outputToken.amountUsd ? ` (${quote.outputToken.amountUsd})` : '';
  lines.push(`**Receive:** ${quote.outputToken.amount} ${quote.outputToken.symbol}${outputUsd}`);

  const feeUsd = quote.fees.totalFeeUsd ? ` (${quote.fees.totalFeeUsd})` : '';
  lines.push(`**Fee:** ~${quote.fees.totalFee} ${quote.outputToken.symbol}${feeUsd}`);

  lines.push(`**Est. time:** ${quote.estimatedTimeDisplay}`);

  if (quote.requiresApproval) {
    lines.push(`\n⚠️ Token approval required before bridging`);
  }

  lines.push(`\n_Quote via ${quote.provider}_`);

  return lines.join('\n');
}

/**
 * Format a bridge transaction for display
 */
export function formatBridgeTransactionMessage(tx: BridgeTransaction): string {
  const lines: string[] = ['**Bridge Transaction**'];

  lines.push(`\n**Route:** ${tx.sourceChainName} → ${tx.destinationChainName}`);
  lines.push(`**Send:** ${tx.inputToken.amount} ${tx.inputToken.symbol}`);
  lines.push(`**Min receive:** ${tx.minOutputAmount} ${tx.outputToken.symbol}`);
  lines.push(`**Slippage:** ${(tx.slippageTolerance * 100).toFixed(1)}%`);
  lines.push(`**Est. time:** ${tx.estimatedTimeDisplay}`);

  if (tx.txHash) {
    lines.push(`\n**Status:** ${formatStatus(tx.status)}`);
    if (tx.explorerUrl) {
      lines.push(`**Track:** ${tx.explorerUrl}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format transaction status for display
 */
function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    pending_signature: 'Awaiting signature',
    pending_confirmation: 'Confirming...',
    confirmed: 'Confirmed',
    bridging: 'Bridging...',
    completed: 'Completed',
    failed: 'Failed',
  };
  return statusMap[status] || status;
}
