import { Bot, session } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { KvAdapter } from '@grammyjs/storage-cloudflare';

import type { Database } from 'src/db/db.interface';
import { initialSession, type UserSession } from 'src/types';
import type { BotContext } from './context';
import {
  handleAddFilesCancel,
  handleAddFilesSave,
  handleAddFilesSelectFolder,
} from './handlers/callbacks';
import {
  handleAddFilesCommand,
  handleAddFolderCommand,
  handleCancel,
  handleStart,
} from './handlers/commands';
import { handleInlineQuery } from './handlers/inline';
import { handleMediaMessage, handleTextMessage } from './handlers/messages';

export interface CreateBotOptions {
  token: string;
  db: Database;
  kv?: KVNamespace;
  botInfo?: UserFromGetMe;
}

/**
 * Creates and configures the File Wallet Bot instance.
 */
export const createBot = (options: CreateBotOptions): Bot<BotContext> => {
  const bot = new Bot<BotContext>(options.token, {
    botInfo: options.botInfo,
  });

  bot.use(async (ctx, next) => {
    ctx.db = options.db;
    await next();
  });

  const storage = options.kv
    ? new KvAdapter<UserSession>(options.kv)
    : undefined;

  bot.use(
    session({
      initial: initialSession,
      storage,
      getSessionKey: (ctx) => ctx.from?.id.toString(),
    }),
  );

  bot.command('start', handleStart);
  bot.command('cancel', handleCancel);
  bot.command(['add_folder', 'add-folder'], handleAddFolderCommand);
  bot.command(['add_files', 'add-files'], handleAddFilesCommand);

  bot.callbackQuery(/^af:select:(.+)$/, (ctx) =>
    handleAddFilesSelectFolder(ctx, ctx.match[1]),
  );
  bot.callbackQuery('af:save', handleAddFilesSave);
  bot.callbackQuery('af:cancel', handleAddFilesCancel);

  bot.on('message:text', handleTextMessage);
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

  bot.on('inline_query', handleInlineQuery);

  bot.catch((err) => {
    console.error('Unhandled bot error:', err);
  });

  return bot;
};
