import { Composer, InlineKeyboard } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { activeFlow, cancelFlow, endFlow } from 'src/bot/flow';
import { findFolder, folderPicker, loadFoldersToPick } from 'src/bot/folder-picker';
import { translateError } from 'src/bot/utils';

const handleCommand = async (ctx: BotContext): Promise<void> => {
  const folders = await loadFoldersToPick(ctx, 'remove-folder-no-folders');
  if (!folders) return;

  ctx.session.flow = { kind: 'remove-folder', folder: null };
  await ctx.reply(ctx.t('remove-folder-choose-folder'), { reply_markup: folderPicker(ctx, folders, 'rmf') });
};

const handleSelectFolder = async (ctx: BotContext, folderId: string): Promise<void> => {
  const userId = ctx.from?.id;
  const flow = await activeFlow(ctx, 'remove-folder');
  if (!userId || !flow) return;

  const folder = await findFolder(ctx, folderId);
  if (!folder) return;

  const filesRes = await ctx.db.listFiles(userId, folder.id);
  if (filesRes.error) {
    await ctx.answerCallbackQuery({ text: translateError(ctx.tText, filesRes) });
    return;
  }

  // Nothing is deleted yet: the user confirms first
  flow.folder = folder;

  const keyboard = new InlineKeyboard()
    .text(ctx.tText('remove-folder-button-confirm'), 'rmf:confirm')
    .row()
    .text(ctx.tText('button-cancel'), 'rmf:cancel');

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(ctx.t('remove-folder-confirm', { name: folder.name, count: filesRes.data.length }), {
    reply_markup: keyboard,
  });
};

const handleConfirm = async (ctx: BotContext): Promise<void> => {
  const userId = ctx.from?.id;
  const flow = await activeFlow(ctx, 'remove-folder');
  if (!userId || !flow) return;

  const { folder } = flow;
  if (!folder) {
    await ctx.answerCallbackQuery({ text: ctx.tText('session-expired') });
    return;
  }

  const res = await ctx.db.removeFolder(userId, folder.id);
  if (res.error) {
    await ctx.answerCallbackQuery({ text: translateError(ctx.tText, res) });
    return;
  }

  await endFlow(ctx);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(ctx.t('remove-folder-success', { name: folder.name }));
};

/** `/remove_folder`: pick a folder, confirm, and it is deleted with its files */
export const removeFolder = new Composer<BotContext>();

removeFolder.command('remove_folder', handleCommand);
removeFolder.callbackQuery(/^rmf:select:(.+)$/, (ctx) => handleSelectFolder(ctx, ctx.match[1]));
removeFolder.callbackQuery('rmf:confirm', handleConfirm);
removeFolder.callbackQuery('rmf:cancel', (ctx) => cancelFlow(ctx, 'remove-folder', 'remove-folder-cancelled'));
