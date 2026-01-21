/**
 * AI Tools for Coco Bridge
 * Tool registry and index providing access to all tools and helper functions.
 *
 * @module ai/tools
 */

import type { ToolDefinition, ToolResult, AgentContext } from '../types';

// ============================================================================
// Re-exports from tool modules
// ============================================================================

export {
  // Check Balance Tool
  checkBalanceToolDefinition,
  executeCheckBalance,
  type CheckBalanceInput,
  type CheckBalanceOutput,
  type ChainBalance,
  // Get Bridge Quote Tool
  getBridgeQuoteToolDefinition,
  executeGetBridgeQuote,
  type GetBridgeQuoteInput,
  type GetBridgeQuoteOutput,
  // Get Transaction Status Tool
  getTransactionStatusToolDefinition,
  executeGetTransactionStatus,
  type GetTransactionStatusInput,
  type GetTransactionStatusOutput,
  type TransactionStatusValue,
  // Get Supported Routes Tool
  getSupportedRoutesToolDefinition,
  executeGetSupportedRoutes,
  type GetSupportedRoutesInput,
  type GetSupportedRoutesOutput,
  type BridgeRoute,
  // Get Chain Info Tool
  getChainInfoToolDefinition,
  executeGetChainInfo,
  type GetChainInfoInput,
  type GetChainInfoOutput,
  type ChainInfo,
  // Get Token Price Tool
  getTokenPriceToolDefinition,
  executeGetTokenPrice,
  type GetTokenPriceInput,
  type GetTokenPriceOutput,
  type TokenPriceInfo,
  // Utilities
  filterEOAs,
  // Tool collection
  readTools,
} from './readTools';

export {
  // Request Confirmation Tool
  requestConfirmationToolDefinition,
  executeRequestConfirmation,
  type RequestConfirmationInput,
  type RequestConfirmationOutput,
  type ActionType,
  // Send Message Tool
  sendMessageToolDefinition,
  executeSendMessage,
  type SendMessageInput,
  type SendMessageOutput,
  type MessageType,
  // Send Transaction Tool
  sendTransactionToolDefinition,
  executeSendTransaction,
  type SendTransactionInput,
  type SendTransactionOutput,
  type TransactionType,
  // Tool collection
  actionTools,
} from './actionTools';

export {
  // Prepare Bridge Tool
  prepareBridgeToolDefinition,
  executePrepareBridge,
  type PrepareBridgeInput,
  type PrepareBridgeOutput,
  // Prepare Token Approval Tool
  prepareTokenApprovalToolDefinition,
  executePrepareTokenApproval,
  type PrepareTokenApprovalInput,
  type PrepareTokenApprovalOutput,
  // Prepare Swap Bridge Tool
  prepareSwapBridgeToolDefinition,
  executePrepareSwapBridge,
  type PrepareSwapBridgeInput,
  type PrepareSwapBridgeOutput,
  // Tool collection
  writeTools,
} from './writeTools';

// ============================================================================
// Imports for tool registry
// ============================================================================

import { readTools } from './readTools';
import { writeTools } from './writeTools';
import { actionTools } from './actionTools';

// ============================================================================
// Tool Registry Types
// ============================================================================

/** Tool entry containing definition and executor */
export interface ToolEntry {
  definition: ToolDefinition;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (input: any, context: AgentContext, toolCallId: string) => Promise<ToolResult>;
}

/** Anthropic API tool format */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: readonly string[];
  };
}

// ============================================================================
// All Tools Registry
// ============================================================================

/**
 * Combined registry of all tools from read, write, and action categories.
 * Provides a single source of truth for all available tools.
 *
 * Tools included:
 * - Read tools: check_balance, get_bridge_quote, get_transaction_status,
 *               get_supported_routes, get_chain_info, get_token_price
 * - Write tools: prepare_bridge, prepare_token_approval, prepare_swap_bridge
 * - Action tools: request_confirmation, send_message, send_transaction
 */
export const allTools: Record<string, ToolEntry> = {
  // Read tools (no state changes)
  ...readTools,
  // Write tools (create transactions)
  ...writeTools,
  // Action tools (user interactions)
  ...actionTools,
} as const;

/**
 * Array of all tool names for iteration and validation.
 */
export const allToolNames = Object.keys(allTools) as readonly string[];

/**
 * Total number of registered tools.
 */
export const toolCount = allToolNames.length;

// ============================================================================
// Tool Lookup Functions
// ============================================================================

/**
 * Get a tool by name from the registry.
 *
 * @param name - The tool name (e.g., 'check_balance', 'prepare_bridge')
 * @returns The tool entry containing definition and executor, or undefined if not found
 *
 * @example
 * ```typescript
 * const balanceTool = getTool('check_balance');
 * if (balanceTool) {
 *   const result = await balanceTool.execute(input, context, toolCallId);
 * }
 * ```
 */
export function getTool(name: string): ToolEntry | undefined {
  return allTools[name];
}

/**
 * Get a tool definition by name.
 *
 * @param name - The tool name
 * @returns The tool definition, or undefined if not found
 *
 * @example
 * ```typescript
 * const definition = getToolDefinition('get_bridge_quote');
 * console.log(definition?.description);
 * ```
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return allTools[name]?.definition;
}

/**
 * Check if a tool exists in the registry.
 *
 * @param name - The tool name to check
 * @returns True if the tool exists, false otherwise
 *
 * @example
 * ```typescript
 * if (hasTool('prepare_bridge')) {
 *   // Tool is available
 * }
 * ```
 */
export function hasTool(name: string): boolean {
  return name in allTools;
}

/**
 * Get all tool definitions as an array.
 *
 * @returns Array of all tool definitions
 *
 * @example
 * ```typescript
 * const definitions = getAllToolDefinitions();
 * definitions.forEach(def => console.log(def.name));
 * ```
 */
export function getAllToolDefinitions(): ToolDefinition[] {
  return Object.values(allTools).map((tool) => tool.definition);
}

/**
 * Get tools filtered by category.
 *
 * @param category - The category to filter by ('read', 'write', or 'utility')
 * @returns Array of tool entries in the specified category
 *
 * @example
 * ```typescript
 * const readOnlyTools = getToolsByCategory('read');
 * ```
 */
export function getToolsByCategory(
  category: 'read' | 'write' | 'utility'
): ToolEntry[] {
  return Object.values(allTools).filter(
    (tool) => tool.definition.category === category
  );
}

/**
 * Get tools that require user signature.
 *
 * @returns Array of tool entries that require signature
 */
export function getSignatureRequiredTools(): ToolEntry[] {
  return Object.values(allTools).filter(
    (tool) => tool.definition.requiresSignature === true
  );
}

// ============================================================================
// Anthropic API Conversion
// ============================================================================

/**
 * Convert a single tool definition to Anthropic API format.
 *
 * @param definition - The tool definition to convert
 * @returns The tool in Anthropic API format
 */
function toAnthropicTool(definition: ToolDefinition): AnthropicTool {
  return {
    name: definition.name,
    description: definition.description,
    input_schema: {
      type: 'object',
      properties: definition.inputSchema.properties as Record<string, unknown>,
      required: definition.inputSchema.required,
    },
  };
}

/**
 * Convert all tools to Anthropic API format for use with Claude.
 *
 * This function transforms the internal tool definitions into the format
 * expected by the Anthropic Messages API. Use this when initializing
 * the AI agent with available tools.
 *
 * @returns Array of tools in Anthropic API format
 *
 * @example
 * ```typescript
 * import Anthropic from '@anthropic-ai/sdk';
 * import { toAnthropicTools } from './tools';
 *
 * const client = new Anthropic();
 * const response = await client.messages.create({
 *   model: 'claude-sonnet-4-20250514',
 *   max_tokens: 4096,
 *   tools: toAnthropicTools(),
 *   messages: [{ role: 'user', content: 'Check my balance' }],
 * });
 * ```
 */
export function toAnthropicTools(): AnthropicTool[] {
  return getAllToolDefinitions().map(toAnthropicTool);
}

/**
 * Convert specific tools to Anthropic API format.
 *
 * @param toolNames - Array of tool names to convert
 * @returns Array of specified tools in Anthropic API format
 * @throws Error if any tool name is not found
 *
 * @example
 * ```typescript
 * // Only include read tools for a balance check session
 * const tools = toAnthropicToolsSubset(['check_balance', 'get_bridge_quote']);
 * ```
 */
export function toAnthropicToolsSubset(toolNames: string[]): AnthropicTool[] {
  return toolNames.map((name) => {
    const tool = getTool(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return toAnthropicTool(tool.definition);
  });
}

// ============================================================================
// Tool Execution Helper
// ============================================================================

/**
 * Execute a tool by name with the provided input and context.
 *
 * @param toolName - Name of the tool to execute
 * @param input - Input parameters for the tool
 * @param context - Agent context
 * @param toolCallId - Unique ID for this tool call
 * @returns Promise resolving to the tool result
 * @throws Error if the tool is not found
 *
 * @example
 * ```typescript
 * const result = await executeTool(
 *   'check_balance',
 *   { token: 'ETH', chainId: 1 },
 *   context,
 *   'call-123'
 * );
 * ```
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  context: AgentContext,
  toolCallId: string
): Promise<ToolResult> {
  const tool = getTool(toolName);

  if (!tool) {
    return {
      success: false,
      toolCallId,
      toolName,
      timestamp: Date.now(),
      errorCode: 'TOOL_NOT_FOUND',
      errorMessage: `Tool "${toolName}" not found in registry.`,
    };
  }

  return tool.execute(input, context, toolCallId);
}
