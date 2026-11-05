import type { BotContext } from 'src/bot/context';
import type { Database } from 'src/db/db.interface';
import { checkFolderLimit } from 'src/db/validation';
import type { MessageKey, Translate } from 'src/i18n/i18n';
import type { FileItem, Status, StatusError } from 'src/types';

/**
 * Translates an error returned by the DB layer
 */
export const translateError = (t: Translate, err: StatusError): string => {
  const key: MessageKey = err.key; // Fails to compile if a DB error key has no translation
  return (t as (key: MessageKey, params?: StatusError['params']) => string)(key, err.params);
};

/**
 * Name to show for a file, falling back to a localized default when it has none
 */
export const fileDisplayName = (t: Translate, file: FileItem): string => file.name || t(`file-default-${file.type}`);

/**
 * Drops repeated files (same Telegram file_id), which older versions could have stored
 */
export const uniqueFiles = (files: FileItem[]): FileItem[] => [
  ...new Map(files.map((file) => [file.id, file])).values(),
];

/**
 * Checks that the user can create one more folder, replying with why not otherwise
 *
 * @returns Whether a folder can be created (if not, the user was already told)
 */
export const hasFolderRoom = async (ctx: BotContext): Promise<boolean> => {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const quotaRes = await ctx.db.getFolderQuota(userId);
  if (quotaRes.error) {
    await ctx.reply(translateError(ctx.t, quotaRes));
    return false;
  }

  const overLimit = checkFolderLimit(quotaRes.data.used, quotaRes.data.max);
  if (overLimit) {
    await ctx.reply(translateError(ctx.t, overLimit));
    return false;
  }
  return true;
};

/**
 * Creates a folder named `name` holding `files`, in their order (`/copy_folder`, a shared folder).
 * If the files can't be added (e.g. a folder from before the limits holds too many), the new folder
 * is removed again, so no half-made copy is left behind.
 *
 * @returns The new folder's ID, or the error of the step that failed
 */
export const addFolderWithFiles = async (
  db: Database,
  userId: number,
  name: string,
  files: FileItem[],
): Promise<Status<{ id: string }>> => {
  const addRes = await db.addFolder(userId, name);
  if (addRes.error) return addRes;

  const filesRes = await db.addFiles(userId, addRes.data.id, files);
  if (filesRes.error) {
    await db.removeFolder(userId, addRes.data.id);
    return filesRes;
  }
  return addRes;
};
