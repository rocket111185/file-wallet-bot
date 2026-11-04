import { Composer } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { activeFlow, awaitingInput, cancelFlow, endFlow, type FlowContext } from 'src/bot/flow';
import { findFolder, folderPicker, loadFoldersToPick } from 'src/bot/folder-picker';
import { hasFolderRoom, translateError } from 'src/bot/utils';
import { DB_ERROR_KEYS, MAX_FOLDER_NAME_LENGTH } from 'src/types';

export const startCopyFolder = async (ctx: BotContext): Promise<void> => {
  const folders = await loadFoldersToPick(ctx, 'copy-folder-no-folders');
  if (!folders) return;
  if (!(await hasFolderRoom(ctx))) return;

  ctx.session.flow = { kind: 'copy-folder', folder: null };
  await ctx.reply(ctx.t('copy-folder-choose-folder'), { reply_markup: folderPicker(ctx, folders, 'cpf') });
};

const handleSelectFolder = async (ctx: BotContext, folderId: string): Promise<void> => {
  const flow = await activeFlow(ctx, 'copy-folder');
  if (!flow) return;

  const folder = await findFolder(ctx, folderId);
  if (!folder) return;

  // The copy's name arrives as a text message, see handleName
  flow.folder = folder;

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(ctx.t('copy-folder-prompt', { name: folder.name, max: MAX_FOLDER_NAME_LENGTH }));
};

const handleName = async (ctx: FlowContext<'copy-folder'>, name: string): Promise<void> => {
  const userId = ctx.from?.id;
  const { folder } = ctx.session.flow;
  // Text sent before a folder is picked is ignored
  if (!name || !userId || !folder) return;

  // Read the files first: if that fails, no empty folder is left behind
  const filesRes = await ctx.db.listFiles(userId, folder.id);
  if (filesRes.error) {
    await ctx.reply(translateError(ctx.t, filesRes));
    return;
  }

  // A taken or invalid name keeps the flow going, so the user can just send another one
  const addRes = await ctx.db.addFolder(userId, name);
  if (addRes.error) {
    // Another name won't help once the limit is reached
    if (addRes.key === DB_ERROR_KEYS.FOLDER_LIMIT_REACHED) await endFlow(ctx);
    await ctx.reply(translateError(ctx.t, addRes));
    return;
  }

  const copyRes = await ctx.db.addFiles(userId, addRes.data.id, filesRes.data);
  if (copyRes.error) {
    // Don't leave a half-made copy around; the original is untouched either way
    await ctx.db.removeFolder(userId, addRes.data.id);
    await ctx.reply(translateError(ctx.t, copyRes));
    return;
  }

  await endFlow(ctx);
  await ctx.reply(ctx.t('copy-folder-success', { name: folder.name, newName: name, count: filesRes.data.length }));
};

const handleNotText = async (ctx: FlowContext<'copy-folder'>): Promise<void> => {
  if (ctx.session.flow.folder) {
    await ctx.reply(ctx.t('folder-name-text-required'));
  }
};

/**
 * `/copy_folder`: pick a folder, then send a name; a new folder with that name gets all its files
 */
export const copyFolder = new Composer<BotContext>();

copyFolder.callbackQuery(/^cpf:select:(.+)$/, (ctx) => handleSelectFolder(ctx, ctx.match[1]));
copyFolder.callbackQuery('cpf:cancel', (ctx) => cancelFlow(ctx, 'copy-folder', 'action-cancelled'));

const input = copyFolder.filter(awaitingInput('copy-folder'));
input.on('message:text', (ctx) => handleName(ctx, ctx.msg.text.trim()));
input.on('message', handleNotText);
