import type { BotContext } from 'src/bot/context';
import { initialSession } from 'src/types';

export const handleAddFilesSelectFolder = async (
  ctx: BotContext,
  folderId: string,
): Promise<void> => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const foldersRes = await ctx.db.listFolders(userId);
  if (foldersRes.error) {
    await ctx.answerCallbackQuery({ text: 'Failed to access folders.' });
    return;
  }

  const folder = foldersRes.data.find((f) => f.id === folderId);
  if (!folder) {
    await ctx.answerCallbackQuery({ text: 'Folder not found.' });
    return;
  }

  ctx.session.destinationFolderId = folderId;
  ctx.session.action = 'add-files';
  ctx.session.tmpFiles = [];

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `Selected folder: **${folder.name}**\n\n` +
      'Now send me the files you want to add (documents, photos, audios, stickers, videos).\n' +
      'When you are finished, click **Save** below.',
    { parse_mode: 'Markdown' },
  );
};

export const handleAddFilesSave = async (ctx: BotContext): Promise<void> => {
  const userId = ctx.from?.id;
  const folderId = ctx.session.destinationFolderId;
  const tmpFiles = ctx.session.tmpFiles ?? [];

  if (!userId || !folderId) {
    await ctx.answerCallbackQuery({ text: 'Session expired. Please start again.' });
    return;
  }

  if (tmpFiles.length === 0) {
    await ctx.answerCallbackQuery({ text: 'No files to save.' });
    return;
  }

  const res = await ctx.db.addFiles(userId, folderId, tmpFiles);
  if (res.error) {
    await ctx.answerCallbackQuery({ text: res.message ?? 'Failed to save files.' });
    return;
  }

  // Delete status message if possible
  if (ctx.session.pendingMessageId && ctx.chat) {
    try {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.session.pendingMessageId);
    } catch {
      // Ignore if message already deleted
    }
  }

  const count = tmpFiles.length;
  ctx.session = initialSession();

  await ctx.answerCallbackQuery({ text: 'Files saved successfully!' });
  await ctx.reply(`Successfully saved **${count}** file(s)!`, {
    parse_mode: 'Markdown',
  });
};

export const handleAddFilesCancel = async (ctx: BotContext): Promise<void> => {
  if (ctx.session.pendingMessageId && ctx.chat) {
    try {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.session.pendingMessageId);
    } catch {
      // Ignore if message already deleted
    }
  }

  ctx.session = initialSession();
  await ctx.answerCallbackQuery({ text: 'Action cancelled.' });
  await ctx.editMessageText('Action cancelled.');
};
