import { session, type Bot, type StorageAdapter } from 'grammy';

import { createBaseBot, type BaseBotOptions } from 'src/bot/base';
import type { BotContext } from 'src/bot/context';
import { handleAddFilesCancel, handleAddFilesSave, handleAddFilesSelectFolder } from 'src/bot/handlers/callbacks';
import { handleAddFilesCommand, handleAddFolderCommand, handleCancel, handleStart } from 'src/bot/handlers/commands';
import { handleMediaMessage, handleNonTextMessage, handleTextMessage } from 'src/bot/handlers/messages';
import { initialSession, type UserSession } from 'src/bot/session';

export interface ChatBotOptions extends BaseBotOptions {
  /** Where sessions are kept: the user's Durable Object storage */
  sessionStorage: StorageAdapter<UserSession>;
}

/**
 * The bot that runs inside the user's Durable Object (src/bot/user-chat.ts) and handles their private
 * chat: commands, buttons and uploaded files. The session is read from `sessionStorage` before each
 * update and written back after it.
 */
export const createChatBot = (options: ChatBotOptions): Bot<BotContext> => {
  const bot = createBaseBot<BotContext>(options);

  bot.use(
    session({
      initial: initialSession,
      storage: options.sessionStorage,
      getSessionKey: (ctx) => ctx.chat?.id.toString(),
    }),
  );

  bot.command('start', handleStart);
  bot.command('cancel', handleCancel);
  bot.command('add_folder', handleAddFolderCommand);
  bot.command('add_files', handleAddFilesCommand);

  bot.callbackQuery(/^af:select:(.+)$/, (ctx) => handleAddFilesSelectFolder(ctx, ctx.match[1]));
  bot.callbackQuery('af:save', handleAddFilesSave);
  bot.callbackQuery('af:cancel', handleAddFilesCancel);

  bot.on('message:text', handleTextMessage);
  // Text is handled above, so anything reaching this is a non-text message
  bot.on('message', handleNonTextMessage);
  bot.on(
    [
      'message:document',
      'message:photo',
      'message:audio',
      'message:video',
      'message:voice',
      'message:sticker',
      'message:animation',
    ],
    handleMediaMessage,
  );

  return bot;
};
