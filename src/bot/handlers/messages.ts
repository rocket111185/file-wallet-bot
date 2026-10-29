import { InlineKeyboard } from 'grammy';
import type { BotContext } from 'src/bot/context';
import { extractFileItem, translateError } from 'src/bot/utils';

export const handleTextMessage = async (ctx: BotContext): Promise<void> => {
  const text = ctx.message?.text?.trim();
  const userId = ctx.from?.id;

  if (!text || !userId) return;

  // Flow: Add Folder
  if (ctx.session.flow?.kind === 'add-folder') {
    const res = await ctx.db.addFolder(userId, text);
    if (res.error) {
      await ctx.reply(translateError(ctx.t, res));
      return;
    }

    ctx.session.flow = null;
    await ctx.reply(ctx.t('add-folder-success', { name: text }));
  }
};

export const handleMediaMessage = async (ctx: BotContext): Promise<void> => {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'add-files' || !flow.folder) {
    return;
  }

  const fileItem = extractFileItem(ctx);
  if (!fileItem) return;

  flow.files.push(fileItem);
  const count = flow.files.length;

  const keyboard = new InlineKeyboard()
    .text(ctx.tText('add-files-button-save', { count }), 'af:save')
    .text(ctx.tText('button-cancel'), 'af:cancel');

  // Clean up prior status message to avoid chat clutter
  if (flow.statusMessageId && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, flow.statusMessageId).catch(() => {
      // Ignore if message could not be deleted
    });
  }

  const sent = await ctx.reply(ctx.t('add-files-pending', { count, name: flow.folder.name }), {
    reply_markup: keyboard,
  });

  flow.statusMessageId = sent.message_id;
};
