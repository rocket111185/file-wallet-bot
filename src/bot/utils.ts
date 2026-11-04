import type { BotContext } from 'src/bot/context';
import { checkFolderLimit } from 'src/db/validation';
import type { MessageKey, Translate } from 'src/i18n/i18n';
import type { FileItem, StatusError } from 'src/types';

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
