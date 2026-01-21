/**
 * Coco Bridge Bot Slash Commands
 * Defines all slash commands available for the bridge bot.
 *
 * @module commands
 */

import type { BotCommand } from '@towns-protocol/bot';

/**
 * Bot slash commands for Coco Bridge
 */
export const BOT_COMMANDS = [
  {
    name: 'bridge',
    description: 'Bridge tokens between chains',
  },
  {
    name: 'balance',
    description: 'Check your balances across chains',
  },
  {
    name: 'help',
    description: 'Show available commands and usage information',
  },
] as const satisfies BotCommand[];

/** Command names type for type-safe command handling */
export type CommandName = (typeof BOT_COMMANDS)[number]['name'];
