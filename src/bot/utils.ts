import type { FileItem, TelegramFileType } from 'src/types';
import type { BotContext } from './context';

/**
 * Extracts file metadata (id, name, type) from an incoming Telegram message.
 */
export const extractFileItem = (ctx: BotContext): FileItem | null => {
  const msg = ctx.message;
  if (!msg) return null;

  if (msg.document) {
    return {
      id: msg.document.file_id,
      name: msg.document.file_name ?? 'Document',
      type: 'document',
    };
  }

  if (msg.photo && msg.photo.length > 0) {
    // Last element is the highest resolution photo
    const photo = msg.photo[msg.photo.length - 1];
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    return {
      id: photo.file_id,
      name: msg.caption?.slice(0, 32) || `Photo ${timestamp}`,
      type: 'photo',
    };
  }

  if (msg.audio) {
    const title = msg.audio.title ?? msg.audio.file_name ?? 'Audio';
    return {
      id: msg.audio.file_id,
      name: title,
      type: 'audio',
    };
  }

  if (msg.video) {
    const name = msg.caption?.slice(0, 32) || msg.video.file_name || 'Video';
    return {
      id: msg.video.file_id,
      name,
      type: 'video',
    };
  }

  if (msg.voice) {
    return {
      id: msg.voice.file_id,
      name: `Voice (${msg.voice.duration}s)`,
      type: 'voice',
    };
  }

  if (msg.sticker) {
    const emoji = msg.sticker.emoji ? ` ${msg.sticker.emoji}` : '';
    return {
      id: msg.sticker.file_id,
      name: `Sticker${emoji}`,
      type: 'sticker',
    };
  }

  if (msg.animation) {
    return {
      id: msg.animation.file_id,
      name: msg.animation.file_name ?? 'GIF',
      type: 'animation',
    };
  }

  return null;
};
