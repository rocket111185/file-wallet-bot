import { InlineKeyboard } from 'grammy';
import type { BotContext } from 'src/bot/context';
import { endFlow, translateError } from 'src/bot/utils';
import { MAX_FOLDER_NAME_LENGTH } from 'src/types';

export const handleStart = async (ctx: BotContext): Promise<void> => {
  await endFlow(ctx);
  await ctx.reply(ctx.t('start-welcome', { botUsername: ctx.me.username }));
};

export const handleCancel = async (ctx: BotContext): Promise<void> => {
  await endFlow(ctx);
  await ctx.reply(ctx.t('action-cancelled'));
};

export const handleAddFolderCommand = async (ctx: BotContext): Promise<void> => {
  await endFlow(ctx);
  ctx.session.flow = { kind: 'add-folder' };
  await ctx.reply(ctx.t('add-folder-prompt', { max: MAX_FOLDER_NAME_LENGTH }));
};

export const handleAddFilesCommand = async (ctx: BotContext): Promise<void> => {
  const userId = ctx.from?.id;
  if (!userId) return;

  await endFlow(ctx);

  const foldersRes = await ctx.db.listFolders(userId);
  if (foldersRes.error) {
    await ctx.reply(translateError(ctx.t, foldersRes));
    return;
  }

  const folders = foldersRes.data;
  if (folders.length === 0) {
    await ctx.reply(ctx.t('add-files-no-folders'));
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const folder of folders) {
    keyboard.text(folder.name, `af:select:${folder.id}`).row();
  }
  keyboard.text(ctx.tText('button-cancel'), 'af:cancel');

  ctx.session.flow = { kind: 'add-files', folder: null, files: [] };
  await ctx.reply(ctx.t('add-files-choose-folder'), { reply_markup: keyboard });
};
