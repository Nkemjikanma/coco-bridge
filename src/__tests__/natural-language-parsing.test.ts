/**
 * Natural Language Parsing Tests
 * User Story: US-022 - Natural Language Parsing
 * Release: v0.8
 * Ticket: NLP-001
 *
 * Acceptance Criteria:
 * - Handles: 'bridge X ETH from A to B'
 * - Handles: 'move my USDC to Optimism'
 * - Handles: 'send 100 USDC from Polygon to Base'
 * - Handles: 'swap ETH on Base for USDC on mainnet'
 * - Handles: 'what's my balance?'
 * - Agent asks for clarification when intent is unclear
 */

import { describe, it, expect } from 'vitest';
import {
  parseUserMessage,
  detectIntent,
  normalizeChain,
  normalizeToken,
  normalizeAmount,
  isParseResultSuccess,
  isParsedBridgeRequest,
  isParsedSwapBridgeRequest,
  isParsedBalanceRequest,
  isParsedHelpRequest,
  isParsedCancelRequest,
  isParsedConfirmRequest,
  isParsedRejectRequest,
  isParsedUnknownRequest,
} from '../ai/parsing';
import { CHAIN_IDS } from '../services/bridge/bridgeConstants';
import { TOKEN_SYMBOLS } from '../services/tokens';

/**
 * Test Suite: Natural Language Parsing
 */
describe('US-022: Natural Language Parsing', () => {
  // ==========================================================================
  // AC1: Handles 'bridge X ETH from A to B'
  // ==========================================================================
  describe('AC1: Bridge X ETH from A to B', () => {
    it('should parse "bridge 0.1 ETH from Base to Ethereum"', () => {
      const result = parseUserMessage('bridge 0.1 ETH from Base to Ethereum');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBridgeRequest(result.parsed)).toBe(true);
      if (!isParsedBridgeRequest(result.parsed)) return;

      expect(result.parsed.amount?.value).toBe(0.1);
      expect(result.parsed.token?.symbol).toBe(TOKEN_SYMBOLS.ETH);
      expect(result.parsed.fromChain?.chainId).toBe(CHAIN_IDS.BASE);
      expect(result.parsed.toChain?.chainId).toBe(CHAIN_IDS.ETHEREUM);
      expect(result.parsed.missing).toHaveLength(0);
      expect(result.needsClarification).toBe(false);
    });

    it('should parse "Bridge 1.5 ETH from Arbitrum to Optimism"', () => {
      const result = parseUserMessage('Bridge 1.5 ETH from Arbitrum to Optimism');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBridgeRequest(result.parsed)).toBe(true);
      if (!isParsedBridgeRequest(result.parsed)) return;

      expect(result.parsed.amount?.value).toBe(1.5);
      expect(result.parsed.token?.symbol).toBe(TOKEN_SYMBOLS.ETH);
      expect(result.parsed.fromChain?.chainId).toBe(CHAIN_IDS.ARBITRUM);
      expect(result.parsed.toChain?.chainId).toBe(CHAIN_IDS.OPTIMISM);
    });

    it('should parse "transfer 0.5 ETH Base -> Ethereum"', () => {
      const result = parseUserMessage('transfer 0.5 ETH Base -> Ethereum');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBridgeRequest(result.parsed)).toBe(true);
      if (!isParsedBridgeRequest(result.parsed)) return;

      expect(result.parsed.amount?.value).toBe(0.5);
      expect(result.parsed.token?.symbol).toBe(TOKEN_SYMBOLS.ETH);
      expect(result.parsed.fromChain?.chainId).toBe(CHAIN_IDS.BASE);
      expect(result.parsed.toChain?.chainId).toBe(CHAIN_IDS.ETHEREUM);
    });
  });

  // ==========================================================================
  // AC2: Handles 'move my USDC to Optimism'
  // ==========================================================================
  describe('AC2: Move my USDC to Optimism', () => {
    it('should parse "move my USDC to Optimism"', () => {
      const result = parseUserMessage('move my USDC to Optimism');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBridgeRequest(result.parsed)).toBe(true);
      if (!isParsedBridgeRequest(result.parsed)) return;

      expect(result.parsed.token?.symbol).toBe(TOKEN_SYMBOLS.USDC);
      expect(result.parsed.toChain?.chainId).toBe(CHAIN_IDS.OPTIMISM);
      // Should infer "all" for amount when "my" is used without explicit amount
      expect(result.parsed.amount?.isAll).toBe(true);
    });

    it('should parse "move my ETH to Base"', () => {
      const result = parseUserMessage('move my ETH to Base');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBridgeRequest(result.parsed)).toBe(true);
      if (!isParsedBridgeRequest(result.parsed)) return;

      expect(result.parsed.token?.symbol).toBe(TOKEN_SYMBOLS.ETH);
      expect(result.parsed.toChain?.chainId).toBe(CHAIN_IDS.BASE);
    });

    it('should parse "send my WETH to mainnet"', () => {
      const result = parseUserMessage('send my WETH to mainnet');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBridgeRequest(result.parsed)).toBe(true);
      if (!isParsedBridgeRequest(result.parsed)) return;

      expect(result.parsed.token?.symbol).toBe(TOKEN_SYMBOLS.WETH);
      expect(result.parsed.toChain?.chainId).toBe(CHAIN_IDS.ETHEREUM);
    });
  });

  // ==========================================================================
  // AC3: Handles 'send 100 USDC from Polygon to Base'
  // ==========================================================================
  describe('AC3: Send 100 USDC from Polygon to Base', () => {
    it('should parse "send 100 USDC from Polygon to Base"', () => {
      const result = parseUserMessage('send 100 USDC from Polygon to Base');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBridgeRequest(result.parsed)).toBe(true);
      if (!isParsedBridgeRequest(result.parsed)) return;

      expect(result.parsed.amount?.value).toBe(100);
      expect(result.parsed.token?.symbol).toBe(TOKEN_SYMBOLS.USDC);
      expect(result.parsed.fromChain?.chainId).toBe(CHAIN_IDS.POLYGON);
      expect(result.parsed.toChain?.chainId).toBe(CHAIN_IDS.BASE);
      expect(result.parsed.missing).toHaveLength(0);
    });

    it('should parse "send 50 USDT from Arbitrum to Ethereum"', () => {
      const result = parseUserMessage('send 50 USDT from Arbitrum to Ethereum');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBridgeRequest(result.parsed)).toBe(true);
      if (!isParsedBridgeRequest(result.parsed)) return;

      expect(result.parsed.amount?.value).toBe(50);
      expect(result.parsed.token?.symbol).toBe(TOKEN_SYMBOLS.USDT);
      expect(result.parsed.fromChain?.chainId).toBe(CHAIN_IDS.ARBITRUM);
      expect(result.parsed.toChain?.chainId).toBe(CHAIN_IDS.ETHEREUM);
    });

    it('should parse "transfer 1000 USDC Polygon -> Base"', () => {
      const result = parseUserMessage('transfer 1000 USDC Polygon -> Base');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBridgeRequest(result.parsed)).toBe(true);
      if (!isParsedBridgeRequest(result.parsed)) return;

      expect(result.parsed.amount?.value).toBe(1000);
      expect(result.parsed.token?.symbol).toBe(TOKEN_SYMBOLS.USDC);
    });
  });

  // ==========================================================================
  // AC4: Handles 'swap ETH on Base for USDC on mainnet'
  // ==========================================================================
  describe('AC4: Swap ETH on Base for USDC on mainnet', () => {
    it('should parse "swap ETH on Base for USDC on mainnet"', () => {
      const result = parseUserMessage('swap ETH on Base for USDC on mainnet');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedSwapBridgeRequest(result.parsed)).toBe(true);
      if (!isParsedSwapBridgeRequest(result.parsed)) return;

      expect(result.parsed.inputToken?.symbol).toBe(TOKEN_SYMBOLS.ETH);
      expect(result.parsed.outputToken?.symbol).toBe(TOKEN_SYMBOLS.USDC);
      expect(result.parsed.fromChain?.chainId).toBe(CHAIN_IDS.BASE);
      expect(result.parsed.toChain?.chainId).toBe(CHAIN_IDS.ETHEREUM);
    });

    it('should parse "swap 0.5 ETH for USDC"', () => {
      const result = parseUserMessage('swap 0.5 ETH for USDC');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedSwapBridgeRequest(result.parsed)).toBe(true);
      if (!isParsedSwapBridgeRequest(result.parsed)) return;

      expect(result.parsed.amount?.value).toBe(0.5);
      expect(result.parsed.inputToken?.symbol).toBe(TOKEN_SYMBOLS.ETH);
      expect(result.parsed.outputToken?.symbol).toBe(TOKEN_SYMBOLS.USDC);
    });

    it('should parse "convert my ETH to USDC on Ethereum"', () => {
      const result = parseUserMessage('convert my ETH to USDC on Ethereum');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedSwapBridgeRequest(result.parsed)).toBe(true);
    });

    it('should parse "exchange MATIC for ETH on Base"', () => {
      const result = parseUserMessage('exchange MATIC for ETH on Base');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedSwapBridgeRequest(result.parsed)).toBe(true);
      if (!isParsedSwapBridgeRequest(result.parsed)) return;

      expect(result.parsed.inputToken?.symbol).toBe(TOKEN_SYMBOLS.MATIC);
      expect(result.parsed.outputToken?.symbol).toBe(TOKEN_SYMBOLS.ETH);
    });
  });

  // ==========================================================================
  // AC5: Handles "what's my balance?"
  // ==========================================================================
  describe('AC5: Balance queries', () => {
    it('should parse "what\'s my balance?"', () => {
      const result = parseUserMessage("what's my balance?");

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBalanceRequest(result.parsed)).toBe(true);
      expect(result.needsClarification).toBe(false);
    });

    it('should parse "check my balance"', () => {
      const result = parseUserMessage('check my balance');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBalanceRequest(result.parsed)).toBe(true);
    });

    it('should parse "how much ETH do I have on Arbitrum?"', () => {
      const result = parseUserMessage('how much ETH do I have on Arbitrum?');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBalanceRequest(result.parsed)).toBe(true);
      if (!isParsedBalanceRequest(result.parsed)) return;

      expect(result.parsed.token?.symbol).toBe(TOKEN_SYMBOLS.ETH);
      expect(result.parsed.chain?.chainId).toBe(CHAIN_IDS.ARBITRUM);
    });

    it('should parse "show me my balances"', () => {
      const result = parseUserMessage('show me my balances');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBalanceRequest(result.parsed)).toBe(true);
    });

    it('should parse "do I have any USDC?"', () => {
      const result = parseUserMessage('do I have any USDC?');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBalanceRequest(result.parsed)).toBe(true);
      if (!isParsedBalanceRequest(result.parsed)) return;

      expect(result.parsed.token?.symbol).toBe(TOKEN_SYMBOLS.USDC);
    });
  });

  // ==========================================================================
  // AC6: Agent asks for clarification when intent is unclear
  // ==========================================================================
  describe('AC6: Clarification requests for unclear intents', () => {
    it('should request clarification for ambiguous "ETH to Base"', () => {
      const result = parseUserMessage('ETH to Base');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      // May be parsed as bridge with missing fields
      if (isParsedBridgeRequest(result.parsed)) {
        expect(result.parsed.missing.length).toBeGreaterThan(0);
        expect(result.needsClarification).toBe(true);
        expect(result.clarificationQuestion).toBeDefined();
      } else {
        expect(isParsedUnknownRequest(result.parsed)).toBe(true);
        expect(result.needsClarification).toBe(true);
      }
    });

    it('should request clarification for "hello"', () => {
      const result = parseUserMessage('hello');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedUnknownRequest(result.parsed)).toBe(true);
      expect(result.needsClarification).toBe(true);
      expect(result.clarificationQuestion).toBeDefined();
    });

    it('should request clarification for missing amount', () => {
      const result = parseUserMessage('bridge ETH from Base to Ethereum');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBridgeRequest(result.parsed)).toBe(true);
      if (!isParsedBridgeRequest(result.parsed)) return;

      expect(result.parsed.missing).toContain('amount');
      expect(result.needsClarification).toBe(true);
      expect(result.clarificationQuestion).toContain('How much');
    });

    it('should request clarification for missing destination', () => {
      const result = parseUserMessage('bridge 0.1 ETH');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      if (isParsedBridgeRequest(result.parsed)) {
        expect(result.parsed.missing).toContain('toChain');
        expect(result.needsClarification).toBe(true);
      }
    });

    it('should provide helpful suggestion for unknown requests', () => {
      const result = parseUserMessage('something random');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedUnknownRequest(result.parsed)).toBe(true);
      if (!isParsedUnknownRequest(result.parsed)) return;

      expect(result.parsed.clarificationNeeded).toBeDefined();
      expect(result.parsed.clarificationNeeded.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Intent Detection Tests
  // ==========================================================================
  describe('Intent Detection', () => {
    it('should detect bridge intent', () => {
      expect(detectIntent('bridge 0.1 ETH from Base to Ethereum')).toBe('bridge');
      expect(detectIntent('move my USDC to Optimism')).toBe('bridge');
      expect(detectIntent('send 100 USDC from Polygon to Base')).toBe('bridge');
      expect(detectIntent('transfer ETH to mainnet')).toBe('bridge');
    });

    it('should detect swap_bridge intent', () => {
      expect(detectIntent('swap ETH on Base for USDC on mainnet')).toBe('swap_bridge');
      expect(detectIntent('convert my ETH to USDC')).toBe('swap_bridge');
      expect(detectIntent('exchange MATIC for ETH')).toBe('swap_bridge');
    });

    it('should detect balance intent', () => {
      expect(detectIntent("what's my balance?")).toBe('balance');
      expect(detectIntent('check my balance')).toBe('balance');
      expect(detectIntent('how much ETH do I have')).toBe('balance');
      expect(detectIntent('show me my balances')).toBe('balance');
    });

    it('should detect cancel intent', () => {
      expect(detectIntent('cancel')).toBe('cancel');
      expect(detectIntent('stop')).toBe('cancel');
      expect(detectIntent('nevermind')).toBe('cancel');
      expect(detectIntent('never mind')).toBe('cancel');
      expect(detectIntent('forget it')).toBe('cancel');
      expect(detectIntent('abort')).toBe('cancel');
    });

    it('should detect confirm intent', () => {
      expect(detectIntent('yes')).toBe('confirm');
      expect(detectIntent('ok')).toBe('confirm');
      expect(detectIntent('confirm')).toBe('confirm');
      expect(detectIntent('sure')).toBe('confirm');
      expect(detectIntent('go ahead')).toBe('confirm');
    });

    it('should detect reject intent', () => {
      expect(detectIntent('no')).toBe('reject');
      expect(detectIntent('nope')).toBe('reject');
      expect(detectIntent('reject')).toBe('reject');
      expect(detectIntent('decline')).toBe('reject');
    });

    it('should detect help intent', () => {
      expect(detectIntent('help')).toBe('help');
      expect(detectIntent('how do I bridge?')).toBe('help');
      expect(detectIntent('what can you do?')).toBe('help');
    });

    it('should return unknown for ambiguous messages', () => {
      expect(detectIntent('hello')).toBe('unknown');
      expect(detectIntent('what time is it?')).toBe('unknown');
    });
  });

  // ==========================================================================
  // Chain Normalization Tests
  // ==========================================================================
  describe('Chain Normalization', () => {
    it('should normalize Ethereum variations', () => {
      expect(normalizeChain('ethereum')?.chainId).toBe(CHAIN_IDS.ETHEREUM);
      expect(normalizeChain('eth')?.chainId).toBe(CHAIN_IDS.ETHEREUM);
      expect(normalizeChain('mainnet')?.chainId).toBe(CHAIN_IDS.ETHEREUM);
      expect(normalizeChain('L1')?.chainId).toBe(CHAIN_IDS.ETHEREUM);
      expect(normalizeChain('Ethereum Mainnet')?.chainId).toBe(CHAIN_IDS.ETHEREUM);
    });

    it('should normalize Base variations', () => {
      expect(normalizeChain('base')?.chainId).toBe(CHAIN_IDS.BASE);
      expect(normalizeChain('Base')?.chainId).toBe(CHAIN_IDS.BASE);
      expect(normalizeChain('coinbase base')?.chainId).toBe(CHAIN_IDS.BASE);
    });

    it('should normalize Optimism variations', () => {
      expect(normalizeChain('optimism')?.chainId).toBe(CHAIN_IDS.OPTIMISM);
      expect(normalizeChain('op')?.chainId).toBe(CHAIN_IDS.OPTIMISM);
      expect(normalizeChain('OP Mainnet')?.chainId).toBe(CHAIN_IDS.OPTIMISM);
    });

    it('should normalize Polygon variations', () => {
      expect(normalizeChain('polygon')?.chainId).toBe(CHAIN_IDS.POLYGON);
      expect(normalizeChain('matic')?.chainId).toBe(CHAIN_IDS.POLYGON);
      expect(normalizeChain('Polygon POS')?.chainId).toBe(CHAIN_IDS.POLYGON);
    });

    it('should normalize Arbitrum variations', () => {
      expect(normalizeChain('arbitrum')?.chainId).toBe(CHAIN_IDS.ARBITRUM);
      expect(normalizeChain('arb')?.chainId).toBe(CHAIN_IDS.ARBITRUM);
      expect(normalizeChain('Arbitrum One')?.chainId).toBe(CHAIN_IDS.ARBITRUM);
    });

    it('should handle chain IDs as strings', () => {
      expect(normalizeChain('1')?.chainId).toBe(CHAIN_IDS.ETHEREUM);
      expect(normalizeChain('8453')?.chainId).toBe(CHAIN_IDS.BASE);
      expect(normalizeChain('10')?.chainId).toBe(CHAIN_IDS.OPTIMISM);
      expect(normalizeChain('137')?.chainId).toBe(CHAIN_IDS.POLYGON);
      expect(normalizeChain('42161')?.chainId).toBe(CHAIN_IDS.ARBITRUM);
    });

    it('should return null for unknown chains', () => {
      expect(normalizeChain('unknown')).toBeNull();
      expect(normalizeChain('solana')).toBeNull();
      expect(normalizeChain('')).toBeNull();
    });
  });

  // ==========================================================================
  // Token Normalization Tests
  // ==========================================================================
  describe('Token Normalization', () => {
    it('should normalize ETH variations', () => {
      expect(normalizeToken('eth')?.symbol).toBe(TOKEN_SYMBOLS.ETH);
      expect(normalizeToken('ETH')?.symbol).toBe(TOKEN_SYMBOLS.ETH);
      expect(normalizeToken('ether')?.symbol).toBe(TOKEN_SYMBOLS.ETH);
      expect(normalizeToken('ethereum')?.symbol).toBe(TOKEN_SYMBOLS.ETH);
    });

    it('should normalize USDC variations', () => {
      expect(normalizeToken('usdc')?.symbol).toBe(TOKEN_SYMBOLS.USDC);
      expect(normalizeToken('USDC')?.symbol).toBe(TOKEN_SYMBOLS.USDC);
      expect(normalizeToken('usd coin')?.symbol).toBe(TOKEN_SYMBOLS.USDC);
    });

    it('should normalize USDT variations', () => {
      expect(normalizeToken('usdt')?.symbol).toBe(TOKEN_SYMBOLS.USDT);
      expect(normalizeToken('USDT')?.symbol).toBe(TOKEN_SYMBOLS.USDT);
      expect(normalizeToken('tether')?.symbol).toBe(TOKEN_SYMBOLS.USDT);
    });

    it('should normalize WETH variations', () => {
      expect(normalizeToken('weth')?.symbol).toBe(TOKEN_SYMBOLS.WETH);
      expect(normalizeToken('WETH')?.symbol).toBe(TOKEN_SYMBOLS.WETH);
      expect(normalizeToken('wrapped eth')?.symbol).toBe(TOKEN_SYMBOLS.WETH);
      expect(normalizeToken('wrapped ether')?.symbol).toBe(TOKEN_SYMBOLS.WETH);
    });

    it('should normalize MATIC variations', () => {
      expect(normalizeToken('matic')?.symbol).toBe(TOKEN_SYMBOLS.MATIC);
      expect(normalizeToken('MATIC')?.symbol).toBe(TOKEN_SYMBOLS.MATIC);
      expect(normalizeToken('pol')?.symbol).toBe(TOKEN_SYMBOLS.MATIC);
    });

    it('should return null for unknown tokens', () => {
      expect(normalizeToken('unknown')).toBeNull();
      expect(normalizeToken('btc')).toBeNull();
      expect(normalizeToken('')).toBeNull();
    });
  });

  // ==========================================================================
  // Amount Normalization Tests
  // ==========================================================================
  describe('Amount Normalization', () => {
    it('should parse numeric amounts', () => {
      expect(normalizeAmount('0.1')?.value).toBe(0.1);
      expect(normalizeAmount('100')?.value).toBe(100);
      expect(normalizeAmount('1.5')?.value).toBe(1.5);
      expect(normalizeAmount('.5')?.value).toBe(0.5);
    });

    it('should parse "all" variations', () => {
      expect(normalizeAmount('all')?.isAll).toBe(true);
      expect(normalizeAmount('all')?.value).toBeNull();
      expect(normalizeAmount('max')?.isAll).toBe(true);
      expect(normalizeAmount('everything')?.isAll).toBe(true);
    });

    it('should return null for invalid amounts', () => {
      expect(normalizeAmount('abc')).toBeNull();
      expect(normalizeAmount('')).toBeNull();
      expect(normalizeAmount('-5')).toBeNull();
    });
  });

  // ==========================================================================
  // Cancel/Confirm/Reject Handling Tests
  // ==========================================================================
  describe('Control Message Handling', () => {
    it('should parse cancel messages', () => {
      const messages = ['cancel', 'stop', 'nevermind', 'never mind', 'forget it', 'abort'];

      messages.forEach((msg) => {
        const result = parseUserMessage(msg);
        expect(isParseResultSuccess(result)).toBe(true);
        if (isParseResultSuccess(result)) {
          expect(isParsedCancelRequest(result.parsed)).toBe(true);
        }
      });
    });

    it('should parse confirm messages', () => {
      const messages = ['yes', 'yep', 'ok', 'okay', 'confirm', 'sure', 'go ahead'];

      messages.forEach((msg) => {
        const result = parseUserMessage(msg);
        expect(isParseResultSuccess(result)).toBe(true);
        if (isParseResultSuccess(result)) {
          expect(isParsedConfirmRequest(result.parsed)).toBe(true);
        }
      });
    });

    it('should parse reject messages', () => {
      const messages = ['no', 'nope', 'reject', 'decline'];

      messages.forEach((msg) => {
        const result = parseUserMessage(msg);
        expect(isParseResultSuccess(result)).toBe(true);
        if (isParseResultSuccess(result)) {
          expect(isParsedRejectRequest(result.parsed)).toBe(true);
        }
      });
    });
  });

  // ==========================================================================
  // Help Request Tests
  // ==========================================================================
  describe('Help Request Handling', () => {
    it('should parse help messages', () => {
      const messages = ['help', 'how do I bridge?', 'what can you do?', 'commands'];

      messages.forEach((msg) => {
        const result = parseUserMessage(msg);
        expect(isParseResultSuccess(result)).toBe(true);
        if (isParseResultSuccess(result)) {
          expect(isParsedHelpRequest(result.parsed)).toBe(true);
        }
      });
    });

    it('should extract help topic when present', () => {
      const result = parseUserMessage('help with bridge');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedHelpRequest(result.parsed)).toBe(true);
      if (!isParsedHelpRequest(result.parsed)) return;

      expect(result.parsed.topic).toBe('bridge');
    });
  });

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================
  describe('Edge Cases and Error Handling', () => {
    it('should handle empty messages', () => {
      const result = parseUserMessage('');
      expect(isParseResultSuccess(result)).toBe(false);
    });

    it('should handle whitespace-only messages', () => {
      const result = parseUserMessage('   ');
      expect(isParseResultSuccess(result)).toBe(false);
    });

    it('should handle case-insensitive input', () => {
      const result1 = parseUserMessage('BRIDGE 0.1 ETH FROM BASE TO ETHEREUM');
      const result2 = parseUserMessage('bridge 0.1 eth from base to ethereum');

      expect(isParseResultSuccess(result1)).toBe(true);
      expect(isParseResultSuccess(result2)).toBe(true);

      if (isParseResultSuccess(result1) && isParseResultSuccess(result2)) {
        expect(result1.parsed.intent).toBe(result2.parsed.intent);
      }
    });

    it('should preserve original message in parsed result', () => {
      const originalMessage = 'bridge 0.1 ETH from Base to Ethereum';
      const result = parseUserMessage(originalMessage);

      expect(isParseResultSuccess(result)).toBe(true);
      if (isParseResultSuccess(result)) {
        expect(result.parsed.originalMessage).toBe(originalMessage);
      }
    });

    it('should handle messages with extra whitespace', () => {
      const result = parseUserMessage('  bridge  0.1  ETH  from  Base  to  Ethereum  ');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(isParsedBridgeRequest(result.parsed)).toBe(true);
    });
  });

  // ==========================================================================
  // Confidence Level Tests
  // ==========================================================================
  describe('Confidence Levels', () => {
    it('should have high confidence for complete bridge requests', () => {
      const result = parseUserMessage('bridge 0.1 ETH from Base to Ethereum');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(result.parsed.confidence).toBe('high');
    });

    it('should have lower confidence for partial requests', () => {
      const result = parseUserMessage('bridge ETH');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      if (isParsedBridgeRequest(result.parsed)) {
        expect(['low', 'medium']).toContain(result.parsed.confidence);
      }
    });

    it('should have low confidence for unknown requests', () => {
      const result = parseUserMessage('hello world');

      expect(isParseResultSuccess(result)).toBe(true);
      if (!isParseResultSuccess(result)) return;

      expect(result.parsed.confidence).toBe('low');
    });
  });
});
