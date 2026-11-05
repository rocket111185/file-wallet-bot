import { Composer, type CommandContext } from 'grammy';

import { menuCommandList } from 'src/bot/commands';
import type { BotContext } from 'src/bot/context';
import { endFlow } from 'src/bot/flow';

/** `/start` payload of the help button above inline results; the chat bot answers it with a guide */
export const HELP_START_PARAMETER = 'help';

/** `/start help`: the help button above inline results. The flow is kept, so tapping it mid-flow loses nothing. */
const handleHelp = async (ctx: BotContext): Promise<void> => {
  await ctx.reply(ctx.t('inline-guide', { botUsername: ctx.me.username }));
};

/** Plain `/start`: ends the current flow and lists the commands */
const handleWelcome = async (ctx: BotContext): Promise<void> => {
  await endFlow(ctx);
  await ctx.reply(ctx.t('start-welcome', { botUsername: ctx.me.username, commands: menuCommandList(ctx) }));
};

/**
 * `/start`, optionally with a deep-link payload (`t.me/<bot>?start=<payload>`). A deep link may bring a
 * user who never talked to the bot, so every reply must work on a fresh session and an empty vault.
 * Unknown payloads get the plain welcome.
 */
const handleStart = async (ctx: CommandContext<BotContext>): Promise<void> => {
  switch (ctx.match.trim()) {
    case HELP_START_PARAMETER:
      return handleHelp(ctx);
    default:
      return handleWelcome(ctx);
  }
};

/** `/start`, kept out of the command menu as Telegram shows its own Start button */
export const start = new Composer<BotContext>();

start.command('start', handleStart);
