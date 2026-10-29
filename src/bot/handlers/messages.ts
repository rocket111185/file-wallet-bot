import { InlineKeyboard } from 'grammy';
import type { BotContext } from 'src/bot/context';
import { extractFileItem } from 'src/bot/utils';

export const handleTextMessage = async (ctx: BotContext): Promise<void> => {
  const text = ctx.message?.text?.trim();
  const userId = ctx.from?.id;

  if (!text || !userId) return;

  // Flow: Add Folder
  if (ctx.session.action === 'add-folder') {
    const res = await ctx.db.addFolder(userId, text);
    if (res.error) {
      await ctx.reply(`${res.message ?? 'Failed to create folder.'}`);
      return;
    }

    ctx.session.action = null;
    await ctx.reply(
      `Folder **${text}** created successfully!\n\nUse \`/add_files\` to add files to it.`,
      { parse_mode: 'Markdown' },
    );
  }
};

export const handleMediaMessage = async (ctx: BotContext): Promise<void> => {
  if (ctx.session.action !== 'add-files' || !ctx.session.destinationFolderId) {
    return;
  }

  const fileItem = extractFileItem(ctx);
  if (!fileItem) return;

  if (!ctx.session.tmpFiles) {
    ctx.session.tmpFiles = [];
  }

  ctx.session.tmpFiles.push(fileItem);
  const count = ctx.session.tmpFiles.length;

  const keyboard = new InlineKeyboard()
    .text(`Save (${count})`, 'af:save')
    .text('Cancel', 'af:cancel');

  // Clean up prior dynamic message to avoid chat clutter
  if (ctx.session.pendingMessageId && ctx.chat) {
    try {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.session.pendingMessageId);
    } catch {
      // Ignore if message could not be deleted
    }
  }

  const sent = await ctx.reply(
    `**${count}** file(s) ready to be saved.\nClick **Save** when you are done adding files.`,
    {
      reply_markup: keyboard,
      parse_mode: 'Markdown',
    },
  );

  ctx.session.pendingMessageId = sent.message_id;
};
