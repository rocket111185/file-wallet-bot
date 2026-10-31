import { Composer, InlineKeyboard } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { activeFlow, awaitingInput, endFlow, type FlowContext } from 'src/bot/flow';
import { findFolder, folderPicker, loadFoldersToPick } from 'src/bot/folder-picker';
import { translateError } from 'src/bot/utils';
import type { FileItem } from 'src/types';

/**
 * Extracts file metadata (id, name, type) from an incoming Telegram message.
 * `name` is left empty when Telegram gives us nothing, so it can be localized at display time.
 */
export const extractFileItem = (ctx: BotContext): FileItem | null => {
  const msg = ctx.message;
  if (!msg) return null;

  const caption = msg.caption?.trim() ?? '';

  // Must come before `document`: Telegram also sets `document` on animations for backward compatibility
  if (msg.animation) {
    return { id: msg.animation.file_id, name: msg.animation.file_name ?? caption, type: 'animation' };
  }

  if (msg.document) {
    return { id: msg.document.file_id, name: msg.document.file_name ?? caption, type: 'document' };
  }

  if (msg.photo && msg.photo.length > 0) {
    // Last element is the highest resolution photo
    const photo = msg.photo[msg.photo.length - 1];
    return { id: photo.file_id, name: caption, type: 'photo' };
  }

  if (msg.audio) {
    return { id: msg.audio.file_id, name: msg.audio.title ?? msg.audio.file_name ?? caption, type: 'audio' };
  }

  if (msg.video) {
    return { id: msg.video.file_id, name: caption || (msg.video.file_name ?? ''), type: 'video' };
  }

  if (msg.voice) {
    return { id: msg.voice.file_id, name: caption, type: 'voice' };
  }

  if (msg.sticker) {
    return { id: msg.sticker.file_id, name: msg.sticker.emoji ?? '', type: 'sticker' };
  }

  return null;
};

const handleCommand = async (ctx: BotContext): Promise<void> => {
  const folders = await loadFoldersToPick(ctx, 'add-files-no-folders');
  if (!folders) return;

  ctx.session.flow = { kind: 'add-files', folder: null, files: [] };
  await ctx.reply(ctx.t('add-files-choose-folder'), { reply_markup: folderPicker(ctx, folders, 'af') });
};

const handleSelectFolder = async (ctx: BotContext, folderId: string): Promise<void> => {
  const flow = await activeFlow(ctx, 'add-files');
  if (!flow) return;

  const folder = await findFolder(ctx, folderId);
  if (!folder) return;

  flow.folder = folder;
  flow.files = [];

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(ctx.t('add-files-folder-selected', { name: folder.name }));
};

const handleFile = async (ctx: FlowContext<'add-files'>): Promise<void> => {
  const flow = ctx.session.flow;
  // Files sent before a folder is picked are ignored
  if (!flow.folder) return;

  // Album items arrive as separate updates that race on the session, so albums aren't supported yet
  const groupId = ctx.message?.media_group_id;
  if (groupId) {
    if (flow.rejectedGroupId !== groupId) {
      flow.rejectedGroupId = groupId;
      await ctx.reply(ctx.t('add-files-album-unsupported'));
    }
    return;
  }

  const fileItem = extractFileItem(ctx);
  if (!fileItem) return;

  flow.files.push(fileItem);
  const count = flow.files.length;

  const keyboard = new InlineKeyboard()
    .text(ctx.tText('add-files-button-save', { count }), 'af:save')
    .text(ctx.tText('button-cancel'), 'af:cancel');

  // Clean up prior status message to avoid chat clutter
  if (flow.statusMessageId && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, flow.statusMessageId).catch(() => {
      // Ignore if message could not be deleted
    });
  }

  const sent = await ctx.reply(ctx.t('add-files-pending', { count, name: flow.folder.name }), {
    reply_markup: keyboard,
  });

  flow.statusMessageId = sent.message_id;
};

const handleSave = async (ctx: BotContext): Promise<void> => {
  const userId = ctx.from?.id;
  const flow = await activeFlow(ctx, 'add-files');
  if (!userId || !flow) return;

  const { folder, files } = flow;
  if (!folder) {
    await ctx.answerCallbackQuery({ text: ctx.tText('session-expired') });
    return;
  }

  if (files.length === 0) {
    await ctx.answerCallbackQuery({ text: ctx.tText('add-files-nothing-to-save') });
    return;
  }

  const res = await ctx.db.addFiles(userId, folder.id, files);
  if (res.error) {
    await ctx.answerCallbackQuery({ text: translateError(ctx.tText, res) });
    return;
  }

  await endFlow(ctx);
  await ctx.answerCallbackQuery();
  await ctx.reply(ctx.t('add-files-saved', { count: files.length, name: folder.name }));
};

const handleCancel = async (ctx: BotContext): Promise<void> => {
  const deletedMessageId = ctx.session.flow?.kind === 'add-files' ? await endFlow(ctx) : undefined;
  await ctx.answerCallbackQuery();

  // Cancel lives both on the folder picker and on the status message. The status message was just
  // deleted by endFlow, so there is nothing left to edit — reply instead.
  if (deletedMessageId !== undefined && deletedMessageId === ctx.callbackQuery?.message?.message_id) {
    await ctx.reply(ctx.t('action-cancelled'));
  } else {
    await ctx.editMessageText(ctx.t('action-cancelled'));
  }
};

/** `/add_files`: pick a folder, send files one by one, then save them */
export const addFiles = new Composer<BotContext>();

addFiles.command('add_files', handleCommand);
addFiles.callbackQuery(/^af:select:(.+)$/, (ctx) => handleSelectFolder(ctx, ctx.match[1]));
addFiles.callbackQuery('af:save', handleSave);
addFiles.callbackQuery('af:cancel', handleCancel);

addFiles
  .filter(awaitingInput('add-files'))
  .on(
    [
      'message:document',
      'message:photo',
      'message:audio',
      'message:video',
      'message:voice',
      'message:sticker',
      'message:animation',
    ],
    handleFile,
  );
