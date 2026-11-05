import { Composer, InlineKeyboard } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { activeFlow, awaitingInput, cancelFlow, endFlow, type FlowContext } from 'src/bot/flow';
import { addFolderWithFiles, hasFolderRoom, translateError } from 'src/bot/utils';
import type { FlowOf } from 'src/session/session';
import { DB_ERROR_KEYS, MAX_FOLDER_NAME_LENGTH } from 'src/types';

type ImportFlow = FlowOf<'import-folder'>;

/** The preview's buttons only act on the flow's own preview, not on one left from an older link */
const onMenu = (flow: ImportFlow, ctx: BotContext): flow is ImportFlow =>
  flow.menuMessageId === ctx.callbackQuery?.message?.message_id;

/** Save works until a name clash turns the flow into waiting for a name */
const canSave = (flow: ImportFlow, ctx: BotContext): flow is ImportFlow => onMenu(flow, ctx) && !flow.naming;

/**
 * `/start s_<folderId>`: someone tapped "Save a copy" under a folder shared from inline mode. Shows
 * the folder with Save / Cancel. It may be the user's very first message, so it works on a fresh
 * session and an empty vault.
 */
export const startImportFolder = async (ctx: BotContext, folderId: string): Promise<void> => {
  // Opening a link starts over, like any command
  await endFlow(ctx);

  const sharedRes = await ctx.db.getSharedFolder(folderId);
  if (sharedRes.error) {
    await ctx.reply(translateError(ctx.t, sharedRes));
    return;
  }
  if (!sharedRes.data) {
    await ctx.reply(ctx.t('import-folder-not-found'));
    return;
  }
  if (!(await hasFolderRoom(ctx))) return;

  const { folder, files } = sharedRes.data;
  const menu = await ctx.reply(ctx.t('import-folder-preview', { name: folder.name, count: files.length }), {
    reply_markup: new InlineKeyboard()
      .text(ctx.tText('import-folder-button-save'), 'imf:save')
      .text(ctx.tText('button-cancel'), 'imf:cancel'),
  });

  ctx.session.flow = { kind: 'import-folder', folderId, menuMessageId: menu.message_id, naming: false };
};

/**
 * Copies the shared folder into the user's vault: under its own name from the Save button, or under
 * `newName` sent after a name clash. The folder is read again, so the copy has what it holds now.
 *
 * Outcomes that end this step (saved, link dead, name taken, limit) replace the preview when Save was
 * pressed (`fromButton`). Errors the user can retry from are sent as new messages, keeping the preview.
 */
const saveCopy = async (ctx: BotContext, flow: ImportFlow, newName?: string): Promise<void> => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const fromButton = newName === undefined;
  const finish = (text: string) => (fromButton ? ctx.editMessageText(text) : ctx.reply(text));

  const sharedRes = await ctx.db.getSharedFolder(flow.folderId);
  if (sharedRes.error) {
    await ctx.reply(translateError(ctx.t, sharedRes));
    return;
  }
  if (!sharedRes.data) {
    // Removed by its owner after the preview was shown
    await endFlow(ctx);
    await finish(ctx.t('import-folder-not-found'));
    return;
  }

  const { folder, files } = sharedRes.data;
  const name = newName ?? folder.name;

  const copyRes = await addFolderWithFiles(ctx.db, userId, name, files);
  if (copyRes.error) {
    if (copyRes.key === DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS && fromButton) {
      // Same as /copy_folder: the copy's name arrives as a text message, see handleName
      flow.naming = true;
      await finish(ctx.t('import-folder-name-taken', { name, max: MAX_FOLDER_NAME_LENGTH }));
      return;
    }

    // Another name won't help once the limit is reached. Anything else (a taken or invalid new name,
    // a failed write) keeps the flow, so the user can try again.
    if (copyRes.key === DB_ERROR_KEYS.FOLDER_LIMIT_REACHED) {
      await endFlow(ctx);
      await finish(translateError(ctx.t, copyRes));
      return;
    }
    await ctx.reply(translateError(ctx.t, copyRes));
    return;
  }

  await endFlow(ctx);
  await finish(ctx.t('import-folder-success', { name, count: files.length, botUsername: ctx.me.username }));
};

const handleSave = async (ctx: BotContext): Promise<void> => {
  const flow = await activeFlow(ctx, 'import-folder', canSave);
  if (!flow) return;

  await ctx.answerCallbackQuery();
  await saveCopy(ctx, flow);
};

const handleName = async (ctx: FlowContext<'import-folder'>, name: string): Promise<void> => {
  const flow = ctx.session.flow;
  // Text sent while the preview is up is ignored: the buttons decide
  if (!flow.naming || !name) return;

  await saveCopy(ctx, flow, name);
};

const handleNotText = async (ctx: FlowContext<'import-folder'>): Promise<void> => {
  if (ctx.session.flow.naming) {
    await ctx.reply(ctx.t('folder-name-text-required'));
  }
};

/**
 * Shared folders: a folder tapped in inline mode sends a "Save a copy" link (`/start s_<folderId>`,
 * see src/bot/features/start.ts). Whoever opens it gets a copy in their own vault, by value: later
 * changes on either side don't affect the other.
 */
export const importFolder = new Composer<BotContext>();

importFolder.callbackQuery('imf:save', handleSave);
importFolder.callbackQuery('imf:cancel', (ctx) => cancelFlow(ctx, 'import-folder', 'action-cancelled', onMenu));

const input = importFolder.filter(awaitingInput('import-folder'));
input.on('message:text', (ctx) => handleName(ctx, ctx.msg.text.trim()));
input.on('message', handleNotText);
