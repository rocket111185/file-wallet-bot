import { Composer } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { endFlow } from 'src/bot/flow';

const handleStart = async (ctx: BotContext): Promise<void> => {
  await endFlow(ctx);
  await ctx.reply(ctx.t('start-welcome', { botUsername: ctx.me.username }));
};

const handleCancel = async (ctx: BotContext): Promise<void> => {
  await endFlow(ctx);
  await ctx.reply(ctx.t('action-cancelled'));
};

/** `/start` and `/cancel` */
export const common = new Composer<BotContext>();

common.command('start', handleStart);
common.command('cancel', handleCancel);
