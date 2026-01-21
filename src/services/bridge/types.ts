/**
 * Bridge Service Types
 * Type definitions for bridge quotes and transactions.
 */

import type { ChainId } from './bridgeConstants';
import type { TokenSymbol } from '../tokens';

// ============================================================================
// Bridge Quote Types
// ============================================================================

/** Fee breakdown for a bridge quote */
export interface BridgeQuoteFees {
  /** Total fee in the output token (raw units as string) */
  totalFeeRaw: string;
  /** Total fee formatted for display */
  totalFee: string;
  /** Total fee in USD (optional) */
  totalFeeUsd?: string;
  /** LP fee in raw units */
  lpFeeRaw: string;
  /** LP fee formatted */
  lpFee: string;
  /** Relayer gas fee in raw units */
  relayerGasFeeRaw: string;
  /** Relayer gas fee formatted */
  relayerGasFee: string;
  /** Capital fee in raw units (if any) */
  capitalFeeRaw?: string;
  /** Capital fee formatted (if any) */
  capitalFee?: string;
  /** Fee percentage (e.g., "0.05" for 0.05%) */
  feePercentage: string;
}

/** Token details in a bridge quote */
export interface BridgeQuoteToken {
  /** Token symbol */
  symbol: TokenSymbol;
  /** Token contract address */
  address: string;
  /** Chain ID the token is on */
  chainId: ChainId;
  /** Chain name for display */
  chainName: string;
  /** Amount in human-readable format */
  amount: string;
  /** Amount in raw units (wei) */
  amountRaw: string;
  /** Token decimals */
  decimals: number;
  /** USD value (optional) */
  amountUsd?: string;
}

/** Bridge quote from aggregator */
export interface BridgeQuote {
  /** Unique quote identifier */
  quoteId: string;
  /** Source token details */
  inputToken: BridgeQuoteToken;
  /** Destination token details */
  outputToken: BridgeQuoteToken;
  /** Fee breakdown */
  fees: BridgeQuoteFees;
  /** Estimated bridge completion time in seconds */
  estimatedTimeSeconds: number;
  /** Estimated time formatted for display */
  estimatedTimeDisplay: string;
  /** Whether token approval is required */
  requiresApproval: boolean;
  /** Spoke pool contract address for deposits */
  spokePoolAddress: string;
  /** Exclusive relayer address */
  exclusiveRelayer: string;
  /** Exclusivity deadline timestamp */
  exclusivityDeadline: number;
  /** Quote block number */
  quoteBlock: string;
  /** Quote timestamp from provider */
  quoteTimestamp: number;
  /** Minimum deposit amount */
  minDeposit: string;
  /** Maximum deposit amount */
  maxDeposit: string;
  /** Slippage tolerance applied (percentage as decimal, e.g., 0.01 = 1%) */
  slippageTolerance: number;
  /** Output amount after slippage */
  minOutputAmount: string;
  /** When the quote expires */
  expiresAt: number;
  /** Quote provider name */
  provider: string;
  /** Quote creation timestamp */
  createdAt: number;
}

// ============================================================================
// Bridge Transaction Types
// ============================================================================

/** Transaction type for bridge operations */
export type BridgeTransactionType = 'approval' | 'bridge' | 'swap_bridge';

/** Status of a bridge transaction */
export type BridgeTransactionStatus =
  | 'pending_signature'
  | 'pending_confirmation'
  | 'confirmed'
  | 'bridging'
  | 'completed'
  | 'failed';

/** EVM transaction data */
export interface TransactionData {
  /** Target contract address */
  to: string;
  /** Transaction data (calldata) */
  data: string;
  /** Value in wei (for ETH transfers) */
  value: string;
  /** Chain ID for the transaction */
  chainId: ChainId;
  /** Gas limit estimate */
  gasLimit?: string;
  /** Max fee per gas (EIP-1559) */
  maxFeePerGas?: string;
  /** Max priority fee per gas (EIP-1559) */
  maxPriorityFeePerGas?: string;
}

/** Bridge transaction for user to sign */
export interface BridgeTransaction {
  /** Unique transaction identifier */
  transactionId: string;
  /** Transaction type */
  type: BridgeTransactionType;
  /** Current status */
  status: BridgeTransactionStatus;
  /** Source chain */
  sourceChainId: ChainId;
  /** Source chain name */
  sourceChainName: string;
  /** Destination chain */
  destinationChainId: ChainId;
  /** Destination chain name */
  destinationChainName: string;
  /** Input token being bridged */
  inputToken: BridgeQuoteToken;
  /** Output token to receive */
  outputToken: BridgeQuoteToken;
  /** Fees for this bridge */
  fees: BridgeQuoteFees;
  /** Slippage tolerance (percentage as decimal) */
  slippageTolerance: number;
  /** Minimum output amount after slippage */
  minOutputAmount: string;
  /** Transaction data to sign */
  transaction: TransactionData;
  /** Associated quote ID */
  quoteId: string;
  /** Depositor address */
  depositor: string;
  /** Recipient address on destination chain */
  recipient: string;
  /** Spoke pool address */
  spokePoolAddress: string;
  /** Deposit deadline (timestamp) */
  fillDeadline: number;
  /** Exclusivity deadline (timestamp) */
  exclusivityDeadline: number;
  /** Exclusive relayer address */
  exclusiveRelayer: string;
  /** Deposit message (usually empty for standard bridges) */
  message: string;
  /** Estimated bridge completion time in seconds */
  estimatedTimeSeconds: number;
  /** Estimated time formatted for display */
  estimatedTimeDisplay: string;
  /** Transaction hash (set after submission) */
  txHash?: string;
  /** Block explorer URL for tracking */
  explorerUrl?: string;
  /** When the transaction was created */
  createdAt: number;
  /** When the transaction was last updated */
  updatedAt: number;
}

/** Approval transaction for ERC20 tokens */
export interface ApprovalTransaction {
  /** Unique transaction identifier */
  transactionId: string;
  /** Transaction type */
  type: 'approval';
  /** Current status */
  status: BridgeTransactionStatus;
  /** Chain ID */
  chainId: ChainId;
  /** Chain name */
  chainName: string;
  /** Token being approved */
  token: BridgeQuoteToken;
  /** Spender address (spoke pool) */
  spender: string;
  /** Amount to approve (raw units) */
  amount: string;
  /** Transaction data to sign */
  transaction: TransactionData;
  /** Whether this is a max approval (type(uint256).max) */
  isMaxApproval: boolean;
  /** Transaction hash (set after submission) */
  txHash?: string;
  /** Block explorer URL */
  explorerUrl?: string;
  /** When the transaction was created */
  createdAt: number;
}

// ============================================================================
// Bridge Service Input Types
// ============================================================================

/** Input for getting a bridge quote */
export interface GetBridgeQuoteInput {
  /** Source chain ID */
  fromChainId: ChainId;
  /** Destination chain ID */
  toChainId: ChainId;
  /** Input token symbol */
  inputToken: TokenSymbol;
  /** Output token symbol (defaults to inputToken if not specified) */
  outputToken?: TokenSymbol;
  /** Amount to bridge in human-readable format */
  amount: string;
  /** Slippage tolerance percentage (default: 1%) */
  slippageTolerance?: number;
}

/** Input for building a bridge transaction */
export interface BuildBridgeTransactionInput {
  /** Bridge quote to use */
  quote: BridgeQuote;
  /** Depositor wallet address */
  depositor: string;
  /** Recipient address on destination chain (defaults to depositor) */
  recipient?: string;
  /** Custom slippage tolerance (overrides quote slippage) */
  slippageTolerance?: number;
}

/** Input for building an approval transaction */
export interface BuildApprovalTransactionInput {
  /** Token to approve */
  token: TokenSymbol;
  /** Chain ID */
  chainId: ChainId;
  /** Spender address (spoke pool) */
  spender: string;
  /** Amount to approve (use 'max' for unlimited) */
  amount: string | 'max';
  /** Owner address */
  owner: string;
}

// ============================================================================
// Bridge Service Result Types
// ============================================================================

/** Success result for bridge quote */
export interface BridgeQuoteResult {
  success: true;
  quote: BridgeQuote;
}

/** Error result for bridge quote */
export interface BridgeQuoteError {
  success: false;
  errorCode: string;
  errorMessage: string;
  errorDetails?: Record<string, unknown>;
}

/** Bridge quote result union */
export type BridgeQuoteResponse = BridgeQuoteResult | BridgeQuoteError;

/** Success result for bridge transaction */
export interface BridgeTransactionResult {
  success: true;
  transaction: BridgeTransaction;
}

/** Success result for approval transaction */
export interface ApprovalTransactionResult {
  success: true;
  transaction: ApprovalTransaction;
}

/** Error result for transaction building */
export interface TransactionBuildError {
  success: false;
  errorCode: string;
  errorMessage: string;
  errorDetails?: Record<string, unknown>;
}

/** Bridge transaction result union */
export type BridgeTransactionResponse = BridgeTransactionResult | TransactionBuildError;

/** Approval transaction result union */
export type ApprovalTransactionResponse = ApprovalTransactionResult | TransactionBuildError;

// ============================================================================
// Across Protocol API Types
// ============================================================================

/** Across Protocol suggested fees API response */
export interface AcrossSuggestedFeesResponse {
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

/** Across Protocol limits API response */
export interface AcrossLimitsResponse {
  minDeposit: string;
  maxDeposit: string;
  maxDepositInstant: string;
  maxDepositShortDelay: string;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a bridge quote response is successful
 */
export function isBridgeQuoteSuccess(response: BridgeQuoteResponse): response is BridgeQuoteResult {
  return response.success === true;
}

/**
 * Check if a bridge quote response is an error
 */
export function isBridgeQuoteError(response: BridgeQuoteResponse): response is BridgeQuoteError {
  return response.success === false;
}

/**
 * Check if a bridge transaction response is successful
 */
export function isBridgeTransactionSuccess(
  response: BridgeTransactionResponse
): response is BridgeTransactionResult {
  return response.success === true;
}

/**
 * Check if an approval transaction response is successful
 */
export function isApprovalTransactionSuccess(
  response: ApprovalTransactionResponse
): response is ApprovalTransactionResult {
  return response.success === true;
}
