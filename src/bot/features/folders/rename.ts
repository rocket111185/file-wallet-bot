import { Composer } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { activeFlow, awaitingInput, cancelFlow, endFlow, type FlowContext } from 'src/bot/flow';
import { findFolder, folderPicker, loadFoldersToPick } from 'src/bot/folder-picker';
import { translateError } from 'src/bot/utils';
import { MAX_FOLDER_NAME_LENGTH } from 'src/types';

const handleCommand = async (ctx: BotContext): Promise<void> => {
  const folders = await loadFoldersToPick(ctx, 'rename-folder-no-folders');
  if (!folders) return;

  ctx.session.flow = { kind: 'rename-folder', folder: null };
  await ctx.reply(ctx.t('rename-folder-choose-folder'), { reply_markup: folderPicker(ctx, folders, 'rnf') });
};

const handleSelectFolder = async (ctx: BotContext, folderId: string): Promise<void> => {
  const flow = await activeFlow(ctx, 'rename-folder');
  if (!flow) return;

  const folder = await findFolder(ctx, folderId);
  if (!folder) return;

  // The new name arrives as a text message, see handleName
  flow.folder = folder;

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(ctx.t('rename-folder-prompt', { name: folder.name, max: MAX_FOLDER_NAME_LENGTH }));
};

const handleName = async (ctx: FlowContext<'rename-folder'>, name: string): Promise<void> => {
  const userId = ctx.from?.id;
  const { folder } = ctx.session.flow;
  // Text sent before a folder is picked is ignored
  if (!name || !userId || !folder) return;

  const res = await ctx.db.renameFolder(userId, folder.id, name);
  if (res.error) {
    await ctx.reply(translateError(ctx.t, res));
    return;
  }

  await endFlow(ctx);
  await ctx.reply(ctx.t('rename-folder-success', { oldName: folder.name, newName: name }));
};

const handleNotText = async (ctx: FlowContext<'rename-folder'>): Promise<void> => {
  if (ctx.session.flow.folder) {
    await ctx.reply(ctx.t('folder-name-text-required'));
  }
};

/** `/rename_folder`: pick a folder, then send its new name */
export const renameFolder = new Composer<BotContext>();

renameFolder.command('rename_folder', handleCommand);
renameFolder.callbackQuery(/^rnf:select:(.+)$/, (ctx) => handleSelectFolder(ctx, ctx.match[1]));
renameFolder.callbackQuery('rnf:cancel', (ctx) => cancelFlow(ctx, 'rename-folder', 'action-cancelled'));

const input = renameFolder.filter(awaitingInput('rename-folder'));
input.on('message:text', (ctx) => handleName(ctx, ctx.msg.text.trim()));
input.on('message', handleNotText);
