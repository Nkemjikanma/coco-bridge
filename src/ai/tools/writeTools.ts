/**
 * Write Tools for Coco Bridge
 * Tools that create and send blockchain transactions for user signing.
 * These tools validate balances, build transactions, and store pending actions.
 */

import { randomUUID } from 'crypto';
import { createPublicClient, http, formatUnits, parseUnits, type Address, erc20Abi, maxUint256 } from 'viem';
import { mainnet, base, optimism, polygon, arbitrum } from 'viem/chains';

import { setSessionPendingAction } from '../sessions';
import {
  CHAIN_IDS,
  CHAIN_NAMES,
  SUPPORTED_CHAIN_IDS,
  RPC_URLS,
  type ChainId,
  getBridgeQuote,
  buildBridgeTransaction,
  buildApprovalTransaction,
  isBridgeQuoteSuccess,
  isBridgeTransactionSuccess,
  isApprovalTransactionSuccess,
} from '../../services/bridge';
import {
  SUPPORTED_TOKEN_SYMBOLS,
  getTokenAddress,
  getTokenDecimals,
  isNativeToken,
  isTokenAvailableOnChain,
  type TokenSymbol,
} from '../../services/tokens';
import type {
  ToolDefinition,
  ToolResult,
  ToolResultError,
  ToolResultPendingAction,
  AgentContext,
} from '../types';
import { filterEOAs } from './readTools';

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
 * Get native token balance for an address on a specific chain
 */
async function getNativeBalance(
  address: Address,
  chainId: ChainId
): Promise<bigint> {
  const client = createChainClient(chainId);
  return client.getBalance({ address });
}

/**
 * Get ERC20 token balance for an address on a specific chain
 */
async function getERC20Balance(
  address: Address,
  tokenAddress: Address,
  chainId: ChainId
): Promise<bigint> {
  const client = createChainClient(chainId);

  const balance = await client.readContract({
    address: tokenAddress,
    abi: [
      {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ] as const,
    functionName: 'balanceOf',
    args: [address],
  });

  return balance;
}

/**
 * Get token balance for an address on a specific chain
 */
async function getTokenBalance(
  address: Address,
  token: TokenSymbol,
  chainId: ChainId
): Promise<{ balance: bigint; formatted: string } | null> {
  const tokenAddress = getTokenAddress(token, chainId);
  if (!tokenAddress) {
    return null;
  }

  const decimals = getTokenDecimals(token);

  if (isNativeToken(tokenAddress)) {
    const balance = await getNativeBalance(address, chainId);
    return {
      balance,
      formatted: formatUnits(balance, decimals),
    };
  }

  const balance = await getERC20Balance(address, tokenAddress as Address, chainId);
  return {
    balance,
    formatted: formatUnits(balance, decimals),
  };
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

// ============================================================================
// Prepare Bridge Tool Definition
// ============================================================================

export const prepareBridgeToolDefinition: ToolDefinition = {
  name: 'prepare_bridge',
  description:
    'Prepare and send a bridge transaction for user signing. ' +
    'Validates that the user has sufficient balance before creating the transaction. ' +
    'Returns a transaction request that requires user signature via Towns interaction API. ' +
    'Use this AFTER user has confirmed the bridge action via request_confirmation.',
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
      recipient: {
        type: 'string',
        description:
          'Optional recipient address on destination chain. ' +
          'If not specified, defaults to the user\'s wallet address.',
      },
      slippageTolerance: {
        type: 'number',
        description:
          'Optional slippage tolerance as a decimal (e.g., 0.01 for 1%). ' +
          'Default is 1%.',
        minimum: 0,
        maximum: 0.5,
      },
    },
    required: ['fromChainId', 'toChainId', 'inputToken', 'amount'],
    additionalProperties: false,
  },
  requiresConfirmation: false,
  requiresSignature: true,
  category: 'write',
};

// ============================================================================
// Prepare Bridge Tool Input/Output Types
// ============================================================================

export interface PrepareBridgeInput {
  fromChainId: ChainId;
  toChainId: ChainId;
  inputToken: TokenSymbol;
  outputToken?: TokenSymbol;
  amount: string;
  recipient?: string;
  slippageTolerance?: number;
}

export interface PrepareBridgeOutput {
  transactionId: string;
  transactionType: 'bridge';
  sourceChain: {
    chainId: ChainId;
    chainName: string;
  };
  destinationChain: {
    chainId: ChainId;
    chainName: string;
  };
  inputToken: {
    symbol: TokenSymbol;
    amount: string;
    amountRaw: string;
  };
  outputToken: {
    symbol: TokenSymbol;
    amount: string;
    amountRaw: string;
  };
  fees: {
    totalFee: string;
    totalFeeUsd?: string;
  };
  estimatedTimeSeconds: number;
  estimatedTimeDisplay: string;
  depositor: string;
  recipient: string;
  transaction: {
    to: string;
    data: string;
    value: string;
    chainId: ChainId;
    gasLimit?: string;
  };
  expiresAt: number;
  timestamp: number;
}

// ============================================================================
// Prepare Bridge Tool Executor
// ============================================================================

/**
 * Execute the prepare_bridge tool.
 * Validates balance, gets a fresh quote, builds the transaction,
 * and stores it as a pending action in the session.
 *
 * @param input - Tool input parameters
 * @param context - Agent context with user and session info
 * @param toolCallId - Unique ID for this tool call
 * @returns Tool result with pending signature request or error
 */
export async function executePrepareBridge(
  input: PrepareBridgeInput,
  context: AgentContext,
  toolCallId: string
): Promise<ToolResult> {
  const timestamp = Date.now();

  try {
    const { fromChainId, toChainId, inputToken, amount, slippageTolerance } = input;
    const outputToken = input.outputToken || inputToken;

    // Get user's wallet addresses
    const wallets = filterEOAs(context);

    if (wallets.length === 0) {
      return createBridgeErrorResult(
        toolCallId,
        'NO_WALLET',
        'No wallet address found. Please connect your wallet first.',
        timestamp
      );
    }

    const depositor = wallets[0]!;
    const recipient = input.recipient || depositor;

    // Validate chains are different
    if (fromChainId === toChainId) {
      return createBridgeErrorResult(
        toolCallId,
        'SAME_CHAIN',
        'Source and destination chains must be different. Use a DEX for same-chain swaps.',
        timestamp
      );
    }

    // Validate chain IDs
    if (!SUPPORTED_CHAIN_IDS.includes(fromChainId)) {
      return createBridgeErrorResult(
        toolCallId,
        'INVALID_CHAIN',
        `Source chain ID ${fromChainId} is not supported. Supported chains: Ethereum (1), Base (8453), Optimism (10), Polygon (137), Arbitrum (42161).`,
        timestamp
      );
    }

    if (!SUPPORTED_CHAIN_IDS.includes(toChainId)) {
      return createBridgeErrorResult(
        toolCallId,
        'INVALID_CHAIN',
        `Destination chain ID ${toChainId} is not supported. Supported chains: Ethereum (1), Base (8453), Optimism (10), Polygon (137), Arbitrum (42161).`,
        timestamp
      );
    }

    // Validate token availability on source chain
    if (!isTokenAvailableOnChain(inputToken, fromChainId)) {
      return createBridgeErrorResult(
        toolCallId,
        'TOKEN_NOT_AVAILABLE',
        `${inputToken} is not available on ${CHAIN_NAMES[fromChainId]}.`,
        timestamp
      );
    }

    // Validate token availability on destination chain
    if (!isTokenAvailableOnChain(outputToken, toChainId)) {
      return createBridgeErrorResult(
        toolCallId,
        'TOKEN_NOT_AVAILABLE',
        `${outputToken} is not available on ${CHAIN_NAMES[toChainId]}.`,
        timestamp
      );
    }

    // Parse amount to validate format
    const inputDecimals = getTokenDecimals(inputToken);
    let amountRaw: bigint;

    try {
      amountRaw = parseUnits(amount, inputDecimals);
    } catch {
      return createBridgeErrorResult(
        toolCallId,
        'INVALID_AMOUNT',
        `Invalid amount format: "${amount}". Please provide a valid number.`,
        timestamp
      );
    }

    if (amountRaw <= 0n) {
      return createBridgeErrorResult(
        toolCallId,
        'INVALID_AMOUNT',
        'Amount must be greater than 0.',
        timestamp
      );
    }

    // =========================================================================
    // BALANCE VALIDATION - Critical step before creating transaction
    // =========================================================================

    let userBalance: { balance: bigint; formatted: string } | null;

    try {
      userBalance = await getTokenBalance(depositor, inputToken, fromChainId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return createBridgeErrorResult(
        toolCallId,
        'BALANCE_CHECK_FAILED',
        'Failed to check balance. Please try again.',
        timestamp,
        { originalError: errorMessage }
      );
    }

    if (!userBalance) {
      return createBridgeErrorResult(
        toolCallId,
        'BALANCE_CHECK_FAILED',
        `Could not check ${inputToken} balance on ${CHAIN_NAMES[fromChainId]}.`,
        timestamp
      );
    }

    // Check if user has enough balance
    if (userBalance.balance < amountRaw) {
      const formattedBalance = formatBalance(userBalance.formatted, inputDecimals);
      const formattedAmount = formatBalance(amount, inputDecimals);
      return createBridgeErrorResult(
        toolCallId,
        'INSUFFICIENT_BALANCE',
        `Insufficient balance. You have ${formattedBalance} ${inputToken} but need ${formattedAmount} ${inputToken}.`,
        timestamp,
        {
          available: userBalance.formatted,
          required: amount,
          token: inputToken,
          chainId: fromChainId,
        }
      );
    }

    // For native token bridges, also check gas buffer (0.005 ETH/MATIC)
    const tokenAddress = getTokenAddress(inputToken, fromChainId)!;
    if (isNativeToken(tokenAddress)) {
      const gasBuffer = parseUnits('0.005', 18); // 0.005 ETH/MATIC for gas
      const requiredWithGas = amountRaw + gasBuffer;

      if (userBalance.balance < requiredWithGas) {
        const formattedBalance = formatBalance(userBalance.formatted, inputDecimals);
        return createBridgeErrorResult(
          toolCallId,
          'INSUFFICIENT_BALANCE_WITH_GAS',
          `Insufficient balance for bridge + gas. You have ${formattedBalance} ${inputToken} but need ${amount} ${inputToken} + ~0.005 ${inputToken} for gas.`,
          timestamp,
          {
            available: userBalance.formatted,
            required: amount,
            gasBuffer: '0.005',
            token: inputToken,
            chainId: fromChainId,
          }
        );
      }
    }

    // =========================================================================
    // GET FRESH QUOTE
    // =========================================================================

    const quoteResponse = await getBridgeQuote(
      {
        fromChainId,
        toChainId,
        inputToken,
        outputToken,
        amount,
        slippageTolerance,
      },
      depositor
    );

    if (!isBridgeQuoteSuccess(quoteResponse)) {
      return createBridgeErrorResult(
        toolCallId,
        quoteResponse.errorCode,
        quoteResponse.errorMessage,
        timestamp,
        quoteResponse.errorDetails
      );
    }

    const quote = quoteResponse.quote;

    // =========================================================================
    // BUILD BRIDGE TRANSACTION
    // =========================================================================

    const transactionResponse = await buildBridgeTransaction({
      quote,
      depositor,
      recipient,
      slippageTolerance,
    });

    if (!isBridgeTransactionSuccess(transactionResponse)) {
      return createBridgeErrorResult(
        toolCallId,
        transactionResponse.errorCode,
        transactionResponse.errorMessage,
        timestamp,
        transactionResponse.errorDetails
      );
    }

    const bridgeTransaction = transactionResponse.transaction;

    // =========================================================================
    // STORE PENDING ACTION IN SESSION
    // =========================================================================

    const transactionId = randomUUID();
    const expiresAt = timestamp + 300000; // 5 minutes

    const description = `Bridge ${quote.inputToken.amount} ${quote.inputToken.symbol} from ${CHAIN_NAMES[fromChainId]} to ${CHAIN_NAMES[toChainId]}`;

    const pendingActionResult = await setSessionPendingAction(context.session.sessionId, {
      type: 'signature',
      actionId: transactionId,
      toolName: 'prepare_bridge',
      data: {
        transactionType: 'bridge',
        description,
        transactionId: bridgeTransaction.transactionId,
        quoteId: quote.quoteId,
        sourceChainId: fromChainId,
        sourceChainName: CHAIN_NAMES[fromChainId],
        destinationChainId: toChainId,
        destinationChainName: CHAIN_NAMES[toChainId],
        inputToken: {
          symbol: quote.inputToken.symbol,
          amount: quote.inputToken.amount,
          amountRaw: quote.inputToken.amountRaw,
          amountUsd: quote.inputToken.amountUsd,
        },
        outputToken: {
          symbol: quote.outputToken.symbol,
          amount: quote.outputToken.amount,
          amountRaw: quote.outputToken.amountRaw,
          amountUsd: quote.outputToken.amountUsd,
        },
        fees: {
          totalFee: quote.fees.totalFee,
          totalFeeUsd: quote.fees.totalFeeUsd,
        },
        estimatedTimeSeconds: quote.estimatedTimeSeconds,
        estimatedTimeDisplay: quote.estimatedTimeDisplay,
        depositor,
        recipient,
        transaction: bridgeTransaction.transaction,
      },
      message: description,
      expiresAt,
    });

    if (!pendingActionResult) {
      return createBridgeErrorResult(
        toolCallId,
        'SESSION_NOT_FOUND',
        'Session not found. Please try again.',
        timestamp
      );
    }

    // =========================================================================
    // BUILD OUTPUT AND RETURN PENDING ACTION RESULT
    // =========================================================================

    const output: PrepareBridgeOutput = {
      transactionId,
      transactionType: 'bridge',
      sourceChain: {
        chainId: fromChainId,
        chainName: CHAIN_NAMES[fromChainId],
      },
      destinationChain: {
        chainId: toChainId,
        chainName: CHAIN_NAMES[toChainId],
      },
      inputToken: {
        symbol: quote.inputToken.symbol,
        amount: quote.inputToken.amount,
        amountRaw: quote.inputToken.amountRaw,
      },
      outputToken: {
        symbol: quote.outputToken.symbol,
        amount: quote.outputToken.amount,
        amountRaw: quote.outputToken.amountRaw,
      },
      fees: {
        totalFee: quote.fees.totalFee,
        totalFeeUsd: quote.fees.totalFeeUsd,
      },
      estimatedTimeSeconds: quote.estimatedTimeSeconds,
      estimatedTimeDisplay: quote.estimatedTimeDisplay,
      depositor,
      recipient,
      transaction: {
        to: bridgeTransaction.transaction.to,
        data: bridgeTransaction.transaction.data,
        value: bridgeTransaction.transaction.value,
        chainId: bridgeTransaction.transaction.chainId,
        gasLimit: bridgeTransaction.transaction.gasLimit,
      },
      expiresAt,
      timestamp,
    };

    // Return pending action result with requiresUserAction: true
    return createBridgePendingResult(
      toolCallId,
      output,
      description,
      timestamp,
      expiresAt
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return createBridgeErrorResult(
      toolCallId,
      'BRIDGE_PREPARATION_FAILED',
      'Technical issue preparing bridge transaction. Please try again.',
      timestamp,
      { originalError: errorMessage }
    );
  }
}

// ============================================================================
// Result Helpers
// ============================================================================

function createBridgePendingResult(
  toolCallId: string,
  data: PrepareBridgeOutput,
  message: string,
  timestamp: number,
  expiresAt: number
): ToolResultPendingAction {
  return {
    success: true,
    toolCallId,
    toolName: 'prepare_bridge',
    timestamp,
    pendingAction: true,
    actionType: 'signature',
    actionMessage: message,
    actionData: {
      ...data,
      requiresUserAction: true,
    } as unknown as Record<string, unknown>,
    expiresAt,
  };
}

function createBridgeErrorResult(
  toolCallId: string,
  errorCode: string,
  errorMessage: string,
  timestamp: number,
  errorDetails?: Record<string, unknown>
): ToolResultError {
  return {
    success: false,
    toolCallId,
    toolName: 'prepare_bridge',
    timestamp,
    errorCode,
    errorMessage,
    errorDetails,
  };
}

// ============================================================================
// Prepare Token Approval Tool Definition
// ============================================================================

export const prepareTokenApprovalToolDefinition: ToolDefinition = {
  name: 'prepare_token_approval',
  description:
    'Prepare a token approval transaction for ERC20 tokens before bridging. ' +
    'Checks the current allowance first - if already approved for sufficient amount, returns early. ' +
    'Supports both exact amount approval (more secure) and unlimited approval (more convenient). ' +
    'Returns a transaction request that requires user signature via Towns interaction API. ' +
    'Use this BEFORE prepare_bridge when the bridge quote indicates approval is required.',
  inputSchema: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description: 'Token symbol to approve (USDC, USDT, WETH, MATIC). ETH does not require approval.',
        enum: SUPPORTED_TOKEN_SYMBOLS as unknown as readonly string[],
      },
      chainId: {
        type: 'number',
        description:
          'Chain ID where the token approval will be made. ' +
          'Supported: 1 (Ethereum), 8453 (Base), 10 (Optimism), 137 (Polygon), 42161 (Arbitrum).',
        enum: SUPPORTED_CHAIN_IDS as unknown as readonly string[],
      },
      amount: {
        type: 'string',
        description:
          'Amount to approve in human-readable format (e.g., "100" for 100 USDC). ' +
          'Use "unlimited" for max uint256 approval (convenient but less secure).',
      },
      spender: {
        type: 'string',
        description:
          'Address of the spender contract (bridge spoke pool). ' +
          'This should come from the bridge quote\'s spokePoolAddress.',
      },
    },
    required: ['token', 'chainId', 'amount', 'spender'],
    additionalProperties: false,
  },
  requiresConfirmation: false,
  requiresSignature: true,
  category: 'write',
};

// ============================================================================
// Prepare Token Approval Tool Input/Output Types
// ============================================================================

export interface PrepareTokenApprovalInput {
  token: TokenSymbol;
  chainId: ChainId;
  amount: string;
  spender: string;
}

export interface PrepareTokenApprovalOutput {
  transactionId: string;
  transactionType: 'approval';
  chainId: ChainId;
  chainName: string;
  token: {
    symbol: TokenSymbol;
    address: string;
    decimals: number;
  };
  spender: string;
  approvalAmount: string;
  approvalAmountRaw: string;
  isUnlimitedApproval: boolean;
  currentAllowance: string;
  currentAllowanceRaw: string;
  transaction: {
    to: string;
    data: string;
    value: string;
    chainId: ChainId;
    gasLimit?: string;
  };
  expiresAt: number;
  timestamp: number;
}

// ============================================================================
// Prepare Token Approval Tool Executor
// ============================================================================

/**
 * Execute the prepare_token_approval tool.
 * Checks current allowance, and if insufficient, creates an approval transaction.
 *
 * @param input - Tool input parameters
 * @param context - Agent context with user and session info
 * @param toolCallId - Unique ID for this tool call
 * @returns Tool result with pending signature request or error
 */
export async function executePrepareTokenApproval(
  input: PrepareTokenApprovalInput,
  context: AgentContext,
  toolCallId: string
): Promise<ToolResult> {
  const timestamp = Date.now();

  try {
    const { token, chainId, amount, spender } = input;

    // Get user's wallet addresses
    const wallets = filterEOAs(context);

    if (wallets.length === 0) {
      return createApprovalErrorResult(
        toolCallId,
        'NO_WALLET',
        'No wallet address found. Please connect your wallet first.',
        timestamp
      );
    }

    const owner = wallets[0]!;

    // Validate chain ID
    if (!SUPPORTED_CHAIN_IDS.includes(chainId)) {
      return createApprovalErrorResult(
        toolCallId,
        'INVALID_CHAIN',
        `Chain ID ${chainId} is not supported. Supported chains: Ethereum (1), Base (8453), Optimism (10), Polygon (137), Arbitrum (42161).`,
        timestamp
      );
    }

    // Validate token is available on chain
    if (!isTokenAvailableOnChain(token, chainId)) {
      return createApprovalErrorResult(
        toolCallId,
        'TOKEN_NOT_AVAILABLE',
        `${token} is not available on ${CHAIN_NAMES[chainId]}.`,
        timestamp
      );
    }

    // Get token address
    const tokenAddress = getTokenAddress(token, chainId)!;

    // Native tokens don't need approval
    if (isNativeToken(tokenAddress)) {
      return createApprovalErrorResult(
        toolCallId,
        'APPROVAL_NOT_NEEDED',
        `${token} is a native token and does not require approval.`,
        timestamp
      );
    }

    // Validate spender address
    if (!isValidAddress(spender)) {
      return createApprovalErrorResult(
        toolCallId,
        'INVALID_ADDRESS',
        'Invalid spender address provided.',
        timestamp
      );
    }

    const tokenDecimals = getTokenDecimals(token);

    // Determine approval amount
    const isUnlimitedApproval = amount.toLowerCase() === 'unlimited' || amount.toLowerCase() === 'max';
    let approvalAmountRaw: bigint;
    let approvalAmountFormatted: string;

    if (isUnlimitedApproval) {
      approvalAmountRaw = maxUint256;
      approvalAmountFormatted = 'unlimited';
    } else {
      try {
        approvalAmountRaw = parseUnits(amount, tokenDecimals);
        approvalAmountFormatted = amount;
      } catch {
        return createApprovalErrorResult(
          toolCallId,
          'INVALID_AMOUNT',
          `Invalid amount format: "${amount}". Please provide a valid number or "unlimited".`,
          timestamp
        );
      }

      if (approvalAmountRaw <= 0n) {
        return createApprovalErrorResult(
          toolCallId,
          'INVALID_AMOUNT',
          'Approval amount must be greater than 0.',
          timestamp
        );
      }
    }

    // =========================================================================
    // CHECK CURRENT ALLOWANCE
    // =========================================================================

    let currentAllowance: bigint;

    try {
      currentAllowance = await getCurrentAllowance(owner, tokenAddress, spender, chainId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return createApprovalErrorResult(
        toolCallId,
        'ALLOWANCE_CHECK_FAILED',
        'Failed to check current allowance. Please try again.',
        timestamp,
        { originalError: errorMessage }
      );
    }

    // If current allowance is sufficient, return early
    if (currentAllowance >= approvalAmountRaw) {
      const currentAllowanceFormatted = currentAllowance === maxUint256
        ? 'unlimited'
        : formatBalance(formatUnits(currentAllowance, tokenDecimals), tokenDecimals);

      return {
        success: true,
        toolCallId,
        toolName: 'prepare_token_approval',
        timestamp,
        data: {
          alreadyApproved: true,
          token: token,
          chainId: chainId,
          chainName: CHAIN_NAMES[chainId],
          spender: spender,
          currentAllowance: currentAllowanceFormatted,
          currentAllowanceRaw: currentAllowance.toString(),
          requestedAmount: approvalAmountFormatted,
          message: `Token already approved. Current allowance: ${currentAllowanceFormatted} ${token}.`,
        },
        message: `Token already approved. Current allowance: ${currentAllowanceFormatted} ${token}.`,
      };
    }

    // =========================================================================
    // BUILD APPROVAL TRANSACTION
    // =========================================================================

    const approvalResponse = await buildApprovalTransaction({
      token,
      chainId,
      spender,
      amount: isUnlimitedApproval ? 'max' : amount,
      owner,
    });

    if (!isApprovalTransactionSuccess(approvalResponse)) {
      return createApprovalErrorResult(
        toolCallId,
        approvalResponse.errorCode,
        approvalResponse.errorMessage,
        timestamp,
        approvalResponse.errorDetails
      );
    }

    const approvalTransaction = approvalResponse.transaction;

    // =========================================================================
    // STORE PENDING ACTION IN SESSION
    // =========================================================================

    const transactionId = randomUUID();
    const expiresAt = timestamp + 300000; // 5 minutes

    const approvalAmountDisplay = isUnlimitedApproval ? 'unlimited' : `${amount} ${token}`;
    const description = `Approve ${approvalAmountDisplay} on ${CHAIN_NAMES[chainId]} for bridging`;

    const currentAllowanceFormatted = currentAllowance === maxUint256
      ? 'unlimited'
      : formatBalance(formatUnits(currentAllowance, tokenDecimals), tokenDecimals);

    const pendingActionResult = await setSessionPendingAction(context.session.sessionId, {
      type: 'signature',
      actionId: transactionId,
      toolName: 'prepare_token_approval',
      data: {
        transactionType: 'approval',
        description,
        transactionId: approvalTransaction.transactionId,
        chainId,
        chainName: CHAIN_NAMES[chainId],
        token: {
          symbol: token,
          address: tokenAddress,
          decimals: tokenDecimals,
        },
        spender,
        approvalAmount: approvalAmountFormatted,
        approvalAmountRaw: approvalAmountRaw.toString(),
        isUnlimitedApproval,
        currentAllowance: currentAllowanceFormatted,
        currentAllowanceRaw: currentAllowance.toString(),
        transaction: approvalTransaction.transaction,
      },
      message: description,
      expiresAt,
    });

    if (!pendingActionResult) {
      return createApprovalErrorResult(
        toolCallId,
        'SESSION_NOT_FOUND',
        'Session not found. Please try again.',
        timestamp
      );
    }

    // =========================================================================
    // BUILD OUTPUT AND RETURN PENDING ACTION RESULT
    // =========================================================================

    const output: PrepareTokenApprovalOutput = {
      transactionId,
      transactionType: 'approval',
      chainId,
      chainName: CHAIN_NAMES[chainId],
      token: {
        symbol: token,
        address: tokenAddress,
        decimals: tokenDecimals,
      },
      spender,
      approvalAmount: approvalAmountFormatted,
      approvalAmountRaw: approvalAmountRaw.toString(),
      isUnlimitedApproval,
      currentAllowance: currentAllowanceFormatted,
      currentAllowanceRaw: currentAllowance.toString(),
      transaction: {
        to: approvalTransaction.transaction.to,
        data: approvalTransaction.transaction.data,
        value: approvalTransaction.transaction.value,
        chainId: approvalTransaction.transaction.chainId,
        gasLimit: approvalTransaction.transaction.gasLimit,
      },
      expiresAt,
      timestamp,
    };

    return createApprovalPendingResult(
      toolCallId,
      output,
      description,
      timestamp,
      expiresAt
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return createApprovalErrorResult(
      toolCallId,
      'APPROVAL_PREPARATION_FAILED',
      'Technical issue preparing approval transaction. Please try again.',
      timestamp,
      { originalError: errorMessage }
    );
  }
}

// ============================================================================
// Token Approval Helper Functions
// ============================================================================

/**
 * Get current allowance for a token
 */
async function getCurrentAllowance(
  owner: Address,
  tokenAddress: string,
  spender: string,
  chainId: ChainId
): Promise<bigint> {
  const client = createChainClient(chainId);

  const allowance = await client.readContract({
    address: tokenAddress as Address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender as Address],
  });

  return allowance;
}

/**
 * Basic address validation
 */
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// ============================================================================
// Token Approval Result Helpers
// ============================================================================

function createApprovalPendingResult(
  toolCallId: string,
  data: PrepareTokenApprovalOutput,
  message: string,
  timestamp: number,
  expiresAt: number
): ToolResultPendingAction {
  return {
    success: true,
    toolCallId,
    toolName: 'prepare_token_approval',
    timestamp,
    pendingAction: true,
    actionType: 'signature',
    actionMessage: message,
    actionData: {
      ...data,
      requiresUserAction: true,
    } as unknown as Record<string, unknown>,
    expiresAt,
  };
}

function createApprovalErrorResult(
  toolCallId: string,
  errorCode: string,
  errorMessage: string,
  timestamp: number,
  errorDetails?: Record<string, unknown>
): ToolResultError {
  return {
    success: false,
    toolCallId,
    toolName: 'prepare_token_approval',
    timestamp,
    errorCode,
    errorMessage,
    errorDetails,
  };
}

// ============================================================================
// Prepare Swap Bridge Tool Definition
// ============================================================================

export const prepareSwapBridgeToolDefinition: ToolDefinition = {
  name: 'prepare_swap_bridge',
  description:
    'Prepare a combined swap and bridge transaction for user signing. ' +
    'Swaps the input token to a different output token while bridging cross-chain. ' +
    'For example: ETH on Base -> USDC on Ethereum. ' +
    'Gets combined quote with swap rate and bridge fee, then creates a single transaction. ' +
    'Returns a transaction request that requires user signature via Towns interaction API. ' +
    'Use this AFTER user has confirmed the swap+bridge action via request_confirmation.',
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
        description: 'Token symbol to swap from (ETH, USDC, USDT, WETH, MATIC).',
        enum: SUPPORTED_TOKEN_SYMBOLS as unknown as readonly string[],
      },
      outputToken: {
        type: 'string',
        description:
          'Token symbol to receive on destination chain (ETH, USDC, USDT, WETH, MATIC). ' +
          'Must be different from inputToken for swap+bridge.',
        enum: SUPPORTED_TOKEN_SYMBOLS as unknown as readonly string[],
      },
      amount: {
        type: 'string',
        description: 'Amount of input token to swap in human-readable format (e.g., "0.1" for 0.1 ETH).',
      },
      recipient: {
        type: 'string',
        description:
          'Optional recipient address on destination chain. ' +
          'If not specified, defaults to the user\'s wallet address.',
      },
      slippageTolerance: {
        type: 'number',
        description:
          'Optional slippage tolerance as a decimal (e.g., 0.01 for 1%). ' +
          'For swap+bridge, a higher slippage (2-3%) may be recommended. ' +
          'Default is 2%.',
        minimum: 0,
        maximum: 0.5,
      },
    },
    required: ['fromChainId', 'toChainId', 'inputToken', 'outputToken', 'amount'],
    additionalProperties: false,
  },
  requiresConfirmation: false,
  requiresSignature: true,
  category: 'write',
};

// ============================================================================
// Prepare Swap Bridge Tool Input/Output Types
// ============================================================================

export interface PrepareSwapBridgeInput {
  fromChainId: ChainId;
  toChainId: ChainId;
  inputToken: TokenSymbol;
  outputToken: TokenSymbol;
  amount: string;
  recipient?: string;
  slippageTolerance?: number;
}

export interface PrepareSwapBridgeOutput {
  transactionId: string;
  transactionType: 'swap_bridge';
  sourceChain: {
    chainId: ChainId;
    chainName: string;
  };
  destinationChain: {
    chainId: ChainId;
    chainName: string;
  };
  inputToken: {
    symbol: TokenSymbol;
    amount: string;
    amountRaw: string;
    amountUsd?: string;
  };
  outputToken: {
    symbol: TokenSymbol;
    amount: string;
    amountRaw: string;
    amountUsd?: string;
  };
  conversionRate: {
    rate: string;
    rateDisplay: string;
  };
  fees: {
    bridgeFee: string;
    bridgeFeeUsd?: string;
    totalFee: string;
    totalFeeUsd?: string;
    feePercentage: string;
  };
  estimatedTimeSeconds: number;
  estimatedTimeDisplay: string;
  depositor: string;
  recipient: string;
  transaction: {
    to: string;
    data: string;
    value: string;
    chainId: ChainId;
    gasLimit?: string;
  };
  expiresAt: number;
  timestamp: number;
}

// ============================================================================
// Prepare Swap Bridge Tool Executor
// ============================================================================

/** Default slippage for swap+bridge (2%) */
const DEFAULT_SWAP_BRIDGE_SLIPPAGE = 0.02;

/**
 * Execute the prepare_swap_bridge tool.
 * Validates balance, gets a combined swap+bridge quote, builds the transaction,
 * and stores it as a pending action in the session.
 *
 * @param input - Tool input parameters
 * @param context - Agent context with user and session info
 * @param toolCallId - Unique ID for this tool call
 * @returns Tool result with pending signature request or error
 */
export async function executePrepareSwapBridge(
  input: PrepareSwapBridgeInput,
  context: AgentContext,
  toolCallId: string
): Promise<ToolResult> {
  const timestamp = Date.now();

  try {
    const { fromChainId, toChainId, inputToken, outputToken, amount } = input;
    const slippageTolerance = input.slippageTolerance ?? DEFAULT_SWAP_BRIDGE_SLIPPAGE;

    // Get user's wallet addresses
    const wallets = filterEOAs(context);

    if (wallets.length === 0) {
      return createSwapBridgeErrorResult(
        toolCallId,
        'NO_WALLET',
        'No wallet address found. Please connect your wallet first.',
        timestamp
      );
    }

    const depositor = wallets[0]!;
    const recipient = input.recipient || depositor;

    // Validate chains are different
    if (fromChainId === toChainId) {
      return createSwapBridgeErrorResult(
        toolCallId,
        'SAME_CHAIN',
        'Source and destination chains must be different. Use a DEX for same-chain swaps.',
        timestamp
      );
    }

    // Validate tokens are different for swap+bridge
    if (inputToken === outputToken) {
      return createSwapBridgeErrorResult(
        toolCallId,
        'SAME_TOKEN',
        'Input and output tokens must be different for swap+bridge. Use prepare_bridge for same-token bridging.',
        timestamp
      );
    }

    // Validate chain IDs
    if (!SUPPORTED_CHAIN_IDS.includes(fromChainId)) {
      return createSwapBridgeErrorResult(
        toolCallId,
        'INVALID_CHAIN',
        `Source chain ID ${fromChainId} is not supported. Supported chains: Ethereum (1), Base (8453), Optimism (10), Polygon (137), Arbitrum (42161).`,
        timestamp
      );
    }

    if (!SUPPORTED_CHAIN_IDS.includes(toChainId)) {
      return createSwapBridgeErrorResult(
        toolCallId,
        'INVALID_CHAIN',
        `Destination chain ID ${toChainId} is not supported. Supported chains: Ethereum (1), Base (8453), Optimism (10), Polygon (137), Arbitrum (42161).`,
        timestamp
      );
    }

    // Validate token availability on source chain
    if (!isTokenAvailableOnChain(inputToken, fromChainId)) {
      return createSwapBridgeErrorResult(
        toolCallId,
        'TOKEN_NOT_AVAILABLE',
        `${inputToken} is not available on ${CHAIN_NAMES[fromChainId]}.`,
        timestamp
      );
    }

    // Validate token availability on destination chain
    if (!isTokenAvailableOnChain(outputToken, toChainId)) {
      return createSwapBridgeErrorResult(
        toolCallId,
        'TOKEN_NOT_AVAILABLE',
        `${outputToken} is not available on ${CHAIN_NAMES[toChainId]}.`,
        timestamp
      );
    }

    // Parse amount to validate format
    const inputDecimals = getTokenDecimals(inputToken);
    let amountRaw: bigint;

    try {
      amountRaw = parseUnits(amount, inputDecimals);
    } catch {
      return createSwapBridgeErrorResult(
        toolCallId,
        'INVALID_AMOUNT',
        `Invalid amount format: "${amount}". Please provide a valid number.`,
        timestamp
      );
    }

    if (amountRaw <= 0n) {
      return createSwapBridgeErrorResult(
        toolCallId,
        'INVALID_AMOUNT',
        'Amount must be greater than 0.',
        timestamp
      );
    }

    // =========================================================================
    // BALANCE VALIDATION - Critical step before creating transaction
    // =========================================================================

    let userBalance: { balance: bigint; formatted: string } | null;

    try {
      userBalance = await getTokenBalance(depositor, inputToken, fromChainId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return createSwapBridgeErrorResult(
        toolCallId,
        'BALANCE_CHECK_FAILED',
        'Failed to check balance. Please try again.',
        timestamp,
        { originalError: errorMessage }
      );
    }

    if (!userBalance) {
      return createSwapBridgeErrorResult(
        toolCallId,
        'BALANCE_CHECK_FAILED',
        `Could not check ${inputToken} balance on ${CHAIN_NAMES[fromChainId]}.`,
        timestamp
      );
    }

    // Check if user has enough balance
    if (userBalance.balance < amountRaw) {
      const formattedBalance = formatBalance(userBalance.formatted, inputDecimals);
      const formattedAmount = formatBalance(amount, inputDecimals);
      return createSwapBridgeErrorResult(
        toolCallId,
        'INSUFFICIENT_BALANCE',
        `Insufficient balance. You have ${formattedBalance} ${inputToken} but need ${formattedAmount} ${inputToken}.`,
        timestamp,
        {
          available: userBalance.formatted,
          required: amount,
          token: inputToken,
          chainId: fromChainId,
        }
      );
    }

    // For native token bridges, also check gas buffer (0.005 ETH/MATIC)
    const inputTokenAddress = getTokenAddress(inputToken, fromChainId)!;
    if (isNativeToken(inputTokenAddress)) {
      const gasBuffer = parseUnits('0.005', 18); // 0.005 ETH/MATIC for gas
      const requiredWithGas = amountRaw + gasBuffer;

      if (userBalance.balance < requiredWithGas) {
        const formattedBalance = formatBalance(userBalance.formatted, inputDecimals);
        return createSwapBridgeErrorResult(
          toolCallId,
          'INSUFFICIENT_BALANCE_WITH_GAS',
          `Insufficient balance for swap+bridge + gas. You have ${formattedBalance} ${inputToken} but need ${amount} ${inputToken} + ~0.005 ${inputToken} for gas.`,
          timestamp,
          {
            available: userBalance.formatted,
            required: amount,
            gasBuffer: '0.005',
            token: inputToken,
            chainId: fromChainId,
          }
        );
      }
    }

    // =========================================================================
    // GET COMBINED SWAP+BRIDGE QUOTE
    // =========================================================================

    const quoteResponse = await getBridgeQuote(
      {
        fromChainId,
        toChainId,
        inputToken,
        outputToken,
        amount,
        slippageTolerance,
      },
      depositor
    );

    if (!isBridgeQuoteSuccess(quoteResponse)) {
      return createSwapBridgeErrorResult(
        toolCallId,
        quoteResponse.errorCode,
        quoteResponse.errorMessage,
        timestamp,
        quoteResponse.errorDetails
      );
    }

    const quote = quoteResponse.quote;

    // =========================================================================
    // CALCULATE CONVERSION RATE
    // =========================================================================

    const outputDecimals = getTokenDecimals(outputToken);
    const inputAmountNum = parseFloat(amount);
    const outputAmountNum = parseFloat(formatUnits(BigInt(quote.outputToken.amountRaw), outputDecimals));

    // Calculate conversion rate (how much output you get per 1 input)
    const conversionRate = inputAmountNum > 0 ? outputAmountNum / inputAmountNum : 0;
    const rateDisplay = `1 ${inputToken} ≈ ${conversionRate.toFixed(6)} ${outputToken}`;

    // =========================================================================
    // BUILD SWAP+BRIDGE TRANSACTION
    // =========================================================================

    const transactionResponse = await buildBridgeTransaction({
      quote,
      depositor,
      recipient,
      slippageTolerance,
    });

    if (!isBridgeTransactionSuccess(transactionResponse)) {
      return createSwapBridgeErrorResult(
        toolCallId,
        transactionResponse.errorCode,
        transactionResponse.errorMessage,
        timestamp,
        transactionResponse.errorDetails
      );
    }

    const bridgeTransaction = transactionResponse.transaction;

    // =========================================================================
    // STORE PENDING ACTION IN SESSION
    // =========================================================================

    const transactionId = randomUUID();
    const expiresAt = timestamp + 300000; // 5 minutes

    const description = `Swap ${quote.inputToken.amount} ${inputToken} to ${quote.outputToken.amount} ${outputToken} (${CHAIN_NAMES[fromChainId]} → ${CHAIN_NAMES[toChainId]})`;

    const pendingActionResult = await setSessionPendingAction(context.session.sessionId, {
      type: 'signature',
      actionId: transactionId,
      toolName: 'prepare_swap_bridge',
      data: {
        transactionType: 'swap_bridge',
        description,
        transactionId: bridgeTransaction.transactionId,
        quoteId: quote.quoteId,
        sourceChainId: fromChainId,
        sourceChainName: CHAIN_NAMES[fromChainId],
        destinationChainId: toChainId,
        destinationChainName: CHAIN_NAMES[toChainId],
        inputToken: {
          symbol: quote.inputToken.symbol,
          amount: quote.inputToken.amount,
          amountRaw: quote.inputToken.amountRaw,
          amountUsd: quote.inputToken.amountUsd,
        },
        outputToken: {
          symbol: quote.outputToken.symbol,
          amount: quote.outputToken.amount,
          amountRaw: quote.outputToken.amountRaw,
          amountUsd: quote.outputToken.amountUsd,
        },
        conversionRate: {
          rate: conversionRate.toFixed(8),
          rateDisplay,
        },
        fees: {
          bridgeFee: quote.fees.totalFee,
          bridgeFeeUsd: quote.fees.totalFeeUsd,
          totalFee: quote.fees.totalFee,
          totalFeeUsd: quote.fees.totalFeeUsd,
          feePercentage: quote.fees.feePercentage,
        },
        estimatedTimeSeconds: quote.estimatedTimeSeconds,
        estimatedTimeDisplay: quote.estimatedTimeDisplay,
        depositor,
        recipient,
        transaction: bridgeTransaction.transaction,
      },
      message: description,
      expiresAt,
    });

    if (!pendingActionResult) {
      return createSwapBridgeErrorResult(
        toolCallId,
        'SESSION_NOT_FOUND',
        'Session not found. Please try again.',
        timestamp
      );
    }

    // =========================================================================
    // BUILD OUTPUT AND RETURN PENDING ACTION RESULT
    // =========================================================================

    const output: PrepareSwapBridgeOutput = {
      transactionId,
      transactionType: 'swap_bridge',
      sourceChain: {
        chainId: fromChainId,
        chainName: CHAIN_NAMES[fromChainId],
      },
      destinationChain: {
        chainId: toChainId,
        chainName: CHAIN_NAMES[toChainId],
      },
      inputToken: {
        symbol: quote.inputToken.symbol,
        amount: quote.inputToken.amount,
        amountRaw: quote.inputToken.amountRaw,
        amountUsd: quote.inputToken.amountUsd,
      },
      outputToken: {
        symbol: quote.outputToken.symbol,
        amount: quote.outputToken.amount,
        amountRaw: quote.outputToken.amountRaw,
        amountUsd: quote.outputToken.amountUsd,
      },
      conversionRate: {
        rate: conversionRate.toFixed(8),
        rateDisplay,
      },
      fees: {
        bridgeFee: quote.fees.totalFee,
        bridgeFeeUsd: quote.fees.totalFeeUsd,
        totalFee: quote.fees.totalFee,
        totalFeeUsd: quote.fees.totalFeeUsd,
        feePercentage: quote.fees.feePercentage,
      },
      estimatedTimeSeconds: quote.estimatedTimeSeconds,
      estimatedTimeDisplay: quote.estimatedTimeDisplay,
      depositor,
      recipient,
      transaction: {
        to: bridgeTransaction.transaction.to,
        data: bridgeTransaction.transaction.data,
        value: bridgeTransaction.transaction.value,
        chainId: bridgeTransaction.transaction.chainId,
        gasLimit: bridgeTransaction.transaction.gasLimit,
      },
      expiresAt,
      timestamp,
    };

    // Return pending action result with requiresUserAction: true
    return createSwapBridgePendingResult(
      toolCallId,
      output,
      description,
      timestamp,
      expiresAt
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return createSwapBridgeErrorResult(
      toolCallId,
      'SWAP_BRIDGE_PREPARATION_FAILED',
      'Technical issue preparing swap+bridge transaction. Please try again.',
      timestamp,
      { originalError: errorMessage }
    );
  }
}

// ============================================================================
// Swap Bridge Result Helpers
// ============================================================================

function createSwapBridgePendingResult(
  toolCallId: string,
  data: PrepareSwapBridgeOutput,
  message: string,
  timestamp: number,
  expiresAt: number
): ToolResultPendingAction {
  return {
    success: true,
    toolCallId,
    toolName: 'prepare_swap_bridge',
    timestamp,
    pendingAction: true,
    actionType: 'signature',
    actionMessage: message,
    actionData: {
      ...data,
      requiresUserAction: true,
    } as unknown as Record<string, unknown>,
    expiresAt,
  };
}

function createSwapBridgeErrorResult(
  toolCallId: string,
  errorCode: string,
  errorMessage: string,
  timestamp: number,
  errorDetails?: Record<string, unknown>
): ToolResultError {
  return {
    success: false,
    toolCallId,
    toolName: 'prepare_swap_bridge',
    timestamp,
    errorCode,
    errorMessage,
    errorDetails,
  };
}

// ============================================================================
// Exports
// ============================================================================

export const writeTools = {
  prepare_bridge: {
    definition: prepareBridgeToolDefinition,
    execute: executePrepareBridge,
  },
  prepare_token_approval: {
    definition: prepareTokenApprovalToolDefinition,
    execute: executePrepareTokenApproval,
  },
  prepare_swap_bridge: {
    definition: prepareSwapBridgeToolDefinition,
    execute: executePrepareSwapBridge,
  },
} as const;
