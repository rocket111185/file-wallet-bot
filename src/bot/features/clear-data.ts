import { Composer, InlineKeyboard } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { activeFlow, cancelFlow, endFlow } from 'src/bot/flow';
import { translateError } from 'src/bot/utils';
import { initialSession } from 'src/session/session';

const handleCommand = async (ctx: BotContext): Promise<void> => {
  await endFlow(ctx);

  const keyboard = new InlineKeyboard()
    .text(ctx.tText('clear-data-button-confirm'), 'cd:confirm')
    .row()
    .text(ctx.tText('button-cancel'), 'cd:cancel');

  ctx.session.flow = { kind: 'clear-data' };
  await ctx.reply(ctx.t('clear-data-confirm'), { reply_markup: keyboard });
};

const handleConfirm = async (ctx: BotContext): Promise<void> => {
  const userId = ctx.from?.id;
  const flow = await activeFlow(ctx, 'clear-data');
  if (!userId || !flow) return;

  const res = await ctx.db.clearUserData(userId);
  if (res.error) {
    await ctx.answerCallbackQuery({ text: translateError(ctx.tText, res) });
    return;
  }

  ctx.session = initialSession();
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(ctx.t('clear-data-success'));
};

/** `/clear_data`: deletes all of the user's folders and files after confirmation */
export const clearData = new Composer<BotContext>();

clearData.command('clear_data', handleCommand);
clearData.callbackQuery('cd:confirm', handleConfirm);
clearData.callbackQuery('cd:cancel', (ctx) => cancelFlow(ctx, 'clear-data', 'clear-data-cancelled'));
