import { InlineKeyboard, type NextFunction } from 'grammy';
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

/**
 * Warns when the bot expects a folder name but got something else; otherwise passes the
 * message on (e.g. to the media handler)
 */
export const handleNonTextMessage = async (ctx: BotContext, next: NextFunction): Promise<void> => {
  if (ctx.session.flow?.kind === 'add-folder') {
    await ctx.reply(ctx.t('add-folder-text-required'));
    return;
  }
  await next();
};

export const handleMediaMessage =async (ctx: BotContext): Promise<void> => {
  const flow = ctx.session.flow;
  if (flow?.kind !== 'add-files' || !flow.folder) {
    return;
  }

  // Album items arrive as separate updates that race on the session, so albums aren't supported yet
  const groupId = ctx.message?.media_group_id;
  if (groupId) {
    if (flow.rejectedGroupId !== groupId) {
      flow.rejectedGroupId = groupId;
      await ctx.reply(ctx.t('add-files-album-unsupported'));
    }
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
