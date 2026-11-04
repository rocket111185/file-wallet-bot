import { Composer } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { awaitingInput, endFlow, type FlowContext } from 'src/bot/flow';
import { hasFolderRoom, translateError } from 'src/bot/utils';
import { DB_ERROR_KEYS, MAX_FOLDER_NAME_LENGTH } from 'src/types';

export const startAddFolder = async (ctx: BotContext): Promise<void> => {
  await endFlow(ctx);
  if (!(await hasFolderRoom(ctx))) return;

  ctx.session.flow = { kind: 'add-folder' };
  await ctx.reply(ctx.t('add-folder-prompt', { max: MAX_FOLDER_NAME_LENGTH }));
};

const handleName = async (ctx: FlowContext<'add-folder'>, name: string): Promise<void> => {
  const userId = ctx.from?.id;
  if (!name || !userId) return;

  const res = await ctx.db.addFolder(userId, name);
  if (res.error) {
    // Another name won't help once the limit is reached
    if (res.key === DB_ERROR_KEYS.FOLDER_LIMIT_REACHED) await endFlow(ctx);
    await ctx.reply(translateError(ctx.t, res));
    return;
  }

  await endFlow(ctx);
  await ctx.reply(ctx.t('add-folder-success', { name }));
};

/** `/add_folder`: asks for a name and creates the folder */
export const addFolder = new Composer<BotContext>();

const input = addFolder.filter(awaitingInput('add-folder'));
input.on('message:text', (ctx) => handleName(ctx, ctx.msg.text.trim()));
input.on('message', (ctx) => ctx.reply(ctx.t('folder-name-text-required')));
