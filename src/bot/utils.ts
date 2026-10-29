import type { BotContext } from 'src/bot/context';
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
export const fileDisplayName = (t: Translate, file: FileItem): string =>
  file.name || t(`file-default-${file.type}`);

/**
 * Ends the current flow and deletes its status message, if any.
 *
 * @returns ID of the deleted status message, so callers can tell whether the message
 *          a button was pressed on still exists
 */
export const endFlow = async (ctx: BotContext): Promise<number | undefined> => {
  const flow = ctx.session.flow;
  ctx.session.flow = null;

  if (flow?.kind === 'add-files' && flow.statusMessageId && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, flow.statusMessageId).catch(() => {
      // Already deleted by the user, or too old to delete
    });
    return flow.statusMessageId;
  }
  return undefined;
};

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
