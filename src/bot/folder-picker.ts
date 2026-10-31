import { InlineKeyboard } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { endFlow } from 'src/bot/flow';
import { translateError } from 'src/bot/utils';
import type { PlainMessageKey } from 'src/i18n/i18n';
import type { FolderInfo } from 'src/types';

/**
 * Commands that start by picking a folder share these: the command loads the folders and shows
 * `folderPicker`, and the `{prefix}:select:{folderId}` button resolves the pick with `findFolder`.
 */

/**
 * One button per folder (callback `{prefix}:select:{folderId}`) and a Cancel button (`{prefix}:cancel`)
 */
export const folderPicker = (ctx: BotContext, folders: FolderInfo[], prefix: string): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  for (const folder of folders) {
    keyboard.text(folder.name, `${prefix}:select:${folder.id}`).row();
  }
  return keyboard.text(ctx.tText('button-cancel'), `${prefix}:cancel`);
};

/**
 * Ends the current flow and loads the user's folders, replying with `emptyKey` if there are none
 *
 * @returns The folders, or null when the command can't go on (already replied)
 */
export const loadFoldersToPick = async (ctx: BotContext, emptyKey: PlainMessageKey): Promise<FolderInfo[] | null> => {
  const userId = ctx.from?.id;
  if (!userId) return null;

  await endFlow(ctx);

  const foldersRes = await ctx.db.listFolders(userId);
  if (foldersRes.error) {
    await ctx.reply(translateError(ctx.t, foldersRes));
    return null;
  }

  if (foldersRes.data.length === 0) {
    await ctx.reply(ctx.t(emptyKey));
    return null;
  }
  return foldersRes.data;
};

/**
 * Looks up a picked folder, alerting the user if it can't be loaded or no longer exists
 */
export const findFolder = async (ctx: BotContext, folderId: string): Promise<FolderInfo | null> => {
  const userId = ctx.from?.id;
  if (!userId) return null;

  const foldersRes = await ctx.db.listFolders(userId);
  if (foldersRes.error) {
    await ctx.answerCallbackQuery({ text: translateError(ctx.tText, foldersRes) });
    return null;
  }

  const folder = foldersRes.data.find((f) => f.id === folderId);
  if (!folder) {
    await ctx.answerCallbackQuery({ text: ctx.tText('error-folder-not-found') });
    return null;
  }
  return folder;
};
