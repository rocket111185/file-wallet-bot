import type { BotContext } from 'src/bot/context';
import { endFlow, translateError } from 'src/bot/utils';

export const handleAddFilesSelectFolder = async (ctx: BotContext, folderId: string): Promise<void> => {
  const userId = ctx.from?.id;
  const flow = ctx.session.flow;
  if (!userId) return;

  // The keyboard may be left over from an earlier /add_files that was cancelled or replaced
  if (flow?.kind !== 'add-files') {
    await ctx.answerCallbackQuery({ text: ctx.tText('session-expired') });
    return;
  }

  const foldersRes = await ctx.db.listFolders(userId);
  if (foldersRes.error) {
    await ctx.answerCallbackQuery({ text: translateError(ctx.tText, foldersRes) });
    return;
  }

  const folder = foldersRes.data.find((f) => f.id === folderId);
  if (!folder) {
    await ctx.answerCallbackQuery({ text: ctx.tText('error-folder-not-found') });
    return;
  }

  flow.folder = folder;
  flow.files = [];

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(ctx.t('add-files-folder-selected', { name: folder.name }));
};

export const handleAddFilesSave = async (ctx: BotContext): Promise<void> => {
  const userId = ctx.from?.id;
  const flow = ctx.session.flow;

  if (!userId || flow?.kind !== 'add-files' || !flow.folder) {
    await ctx.answerCallbackQuery({ text: ctx.tText('session-expired') });
    return;
  }

  if (flow.files.length === 0) {
    await ctx.answerCallbackQuery({ text: ctx.tText('add-files-nothing-to-save') });
    return;
  }

  const res = await ctx.db.addFiles(userId, flow.folder.id, flow.files);
  if (res.error) {
    await ctx.answerCallbackQuery({ text: translateError(ctx.tText, res) });
    return;
  }

  await endFlow(ctx);
  await ctx.answerCallbackQuery();
  await ctx.reply(ctx.t('add-files-saved', { count: flow.files.length, name: flow.folder.name }));
};

export const handleAddFilesCancel = async (ctx: BotContext): Promise<void> => {
  const deletedMessageId = await endFlow(ctx);
  await ctx.answerCallbackQuery();

  // Cancel lives both on the folder picker and on the status message. The status message was just
  // deleted by endFlow, so there is nothing left to edit — reply instead.
  if (deletedMessageId !== undefined && deletedMessageId === ctx.callbackQuery?.message?.message_id) {
    await ctx.reply(ctx.t('action-cancelled'));
  } else {
    await ctx.editMessageText(ctx.t('action-cancelled'));
  }
};
