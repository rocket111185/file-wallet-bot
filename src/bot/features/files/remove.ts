import { Composer, InlineKeyboard } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { activeFlow, cancelFlow, endFlow } from 'src/bot/flow';
import { findFolder, folderPicked, folderPicker, loadFoldersToPick } from 'src/bot/folder-picker';
import { fileDisplayName, translateError, uniqueFiles } from 'src/bot/utils';
import type { FlowOf } from 'src/session/session';
import type { FolderInfo } from 'src/types';

const PAGE_SIZE = 10;

type RemoveFilesFlow = FlowOf<'remove-files'>;
/** The flow once a folder is picked and its files are listed */
type FileListFlow = RemoveFilesFlow & { folder: FolderInfo };

// ---- Button checks (see activeFlow) ----

/**
 * Buttons refer to files by position, so they only act on the flow's own menu. A button left on an
 * older menu (e.g. from an earlier /remove_files) would otherwise select files in this one.
 */
const onMenu = (flow: RemoveFilesFlow, ctx: BotContext): flow is RemoveFilesFlow =>
  flow.menuMessageId === ctx.callbackQuery?.message?.message_id;

const onFileList = (flow: RemoveFilesFlow, ctx: BotContext): flow is FileListFlow =>
  onMenu(flow, ctx) && folderPicked(flow);

// ---- File list ----

const pageCount = (flow: FileListFlow): number => Math.ceil(flow.files.length / PAGE_SIZE);

/**
 * The current page of files (`rf:t:{index}`, ✅ when selected), page navigation (`rf:p:{page}`),
 * Delete (`rf:del`) and Cancel (`rf:cancel`).
 *
 * Telegram file IDs don't fit the 64-byte callback data limit, so files are referred to by their
 * position in `flow.files`: in the whole list, not on the page, so a tap that arrives right after a
 * page change still hits the file the user saw.
 */
const fileListKeyboard = (ctx: BotContext, flow: FileListFlow): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  const selected = new Set(flow.selected);
  const start = flow.page * PAGE_SIZE;

  flow.files.slice(start, start + PAGE_SIZE).forEach((file, i) => {
    const name = fileDisplayName(ctx.tText, file);
    keyboard.text(selected.has(file.id) ? `✅ ${name}` : name, `rf:t:${start + i}`).row();
  });

  const pages = pageCount(flow);
  if (pages > 1) {
    if (flow.page > 0) keyboard.text(ctx.tText('remove-files-button-prev'), `rf:p:${flow.page - 1}`);
    if (flow.page < pages - 1) keyboard.text(ctx.tText('remove-files-button-next'), `rf:p:${flow.page + 1}`);
    keyboard.row();
  }

  return keyboard
    .text(ctx.tText('remove-files-button-delete', { count: flow.selected.length }), 'rf:del')
    .text(ctx.tText('button-cancel'), 'rf:cancel');
};

/** Turns the menu into the current page of the file list */
const showPage = (ctx: BotContext, flow: FileListFlow) =>
  ctx.editMessageText(
    ctx.t('remove-files-choose-files', { name: flow.folder.name, page: flow.page + 1, pages: pageCount(flow) }),
    { reply_markup: fileListKeyboard(ctx, flow) },
  );

// ---- Handlers ----

export const startRemoveFiles = async (ctx: BotContext): Promise<void> => {
  const folders = await loadFoldersToPick(ctx, 'remove-files-no-folders');
  if (!folders) return;

  const menu = await ctx.reply(ctx.t('remove-files-choose-folder'), { reply_markup: folderPicker(ctx, folders, 'rf') });
  ctx.session.flow = {
    kind: 'remove-files',
    menuMessageId: menu.message_id,
    folder: null,
    files: [],
    selected: [],
    page: 0,
  };
};

const handleSelectFolder = async (ctx: BotContext, folderId: string): Promise<void> => {
  const userId = ctx.from?.id;
  const flow = await activeFlow(ctx, 'remove-files', onMenu);
  if (!userId || !flow) return;

  const folder = await findFolder(ctx, folderId);
  if (!folder) return;

  const filesRes = await ctx.db.listFiles(userId, folder.id);
  if (filesRes.error) {
    await ctx.answerCallbackQuery({ text: translateError(ctx.tText, filesRes) });
    return;
  }

  const files = uniqueFiles(filesRes.data);
  await ctx.answerCallbackQuery();

  if (files.length === 0) {
    await endFlow(ctx);
    await ctx.editMessageText(ctx.t('remove-files-empty', { name: folder.name }));
    return;
  }

  // Kept as is until the flow ends, since buttons refer to files by position in it
  const fileList = { ...flow, folder, files };
  ctx.session.flow = fileList;
  await showPage(ctx, fileList);
};

const handleToggle = async (ctx: BotContext, index: number): Promise<void> => {
  const flow = await activeFlow(ctx, 'remove-files', onFileList);
  if (!flow) return;

  await ctx.answerCallbackQuery();
  // The list doesn't change during the flow, so only forged callback data can point past its end
  const file = flow.files[index];
  if (!file) return;

  flow.selected = flow.selected.includes(file.id)
    ? flow.selected.filter((id) => id !== file.id)
    : [...flow.selected, file.id];
  await ctx.editMessageReplyMarkup({ reply_markup: fileListKeyboard(ctx, flow) });
};

const handlePage = async (ctx: BotContext, page: number): Promise<void> => {
  const flow = await activeFlow(ctx, 'remove-files', onFileList);
  if (!flow) return;

  await ctx.answerCallbackQuery();
  // Same page: the button was tapped twice, and Telegram rejects an edit that changes nothing.
  // Past the end: forged callback data.
  if (page === flow.page || page >= pageCount(flow)) return;

  flow.page = page;
  await showPage(ctx, flow);
};

const handleDelete = async (ctx: BotContext): Promise<void> => {
  const userId = ctx.from?.id;
  const flow = await activeFlow(ctx, 'remove-files', onFileList);
  if (!userId || !flow) return;

  const { folder, selected } = flow;
  if (selected.length === 0) {
    await ctx.answerCallbackQuery({ text: ctx.tText('remove-files-nothing-selected') });
    return;
  }

  const res = await ctx.db.removeFiles(userId, folder.id, selected);
  if (res.error) {
    await ctx.answerCallbackQuery({ text: translateError(ctx.tText, res) });
    return;
  }

  await endFlow(ctx);
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(ctx.t('remove-files-success', { count: selected.length, name: folder.name }));
};

/** `/remove_files`: pick a folder, select files page by page, then delete them */
export const removeFiles = new Composer<BotContext>();

removeFiles.callbackQuery(/^rf:select:(.+)$/, (ctx) => handleSelectFolder(ctx, ctx.match[1]));
removeFiles.callbackQuery(/^rf:t:(\d+)$/, (ctx) => handleToggle(ctx, Number(ctx.match[1])));
removeFiles.callbackQuery(/^rf:p:(\d+)$/, (ctx) => handlePage(ctx, Number(ctx.match[1])));
removeFiles.callbackQuery('rf:del', handleDelete);
removeFiles.callbackQuery('rf:cancel', (ctx) => cancelFlow(ctx, 'remove-files', 'action-cancelled', onMenu));
