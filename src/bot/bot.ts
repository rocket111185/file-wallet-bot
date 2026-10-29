import { Bot, session } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { KvAdapter } from '@grammyjs/storage-cloudflare';

import type { BotContext } from 'src/bot/context';
import { handleAddFilesCancel, handleAddFilesSave, handleAddFilesSelectFolder } from 'src/bot/handlers/callbacks';
import { handleAddFilesCommand, handleAddFolderCommand, handleCancel, handleStart } from 'src/bot/handlers/commands';
import { handleInlineQuery } from 'src/bot/handlers/inline';
import { handleMediaMessage, handleTextMessage } from 'src/bot/handlers/messages';
import { initialSession, type UserSession } from 'src/bot/session';
import type { Database } from 'src/db/db.interface';
import { createTranslator, resolveLocale } from 'src/i18n/i18n';
import { logger } from 'src/logger';

const HTML_METHODS = new Set(['sendMessage', 'editMessageText']);

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

  // All translations are HTML (see src/i18n), so make it the default instead of repeating it on every call
  bot.api.config.use((prev, method, payload, signal) =>
    HTML_METHODS.has(method) ? prev(method, { parse_mode: 'HTML', ...payload }, signal) : prev(method, payload, signal),
  );

  bot.use(async (ctx, next) => {
    ctx.db = options.db;

    ctx.locale = resolveLocale(ctx.from?.language_code);
    const { html, text } = createTranslator(ctx.locale);
    ctx.t = html;
    ctx.tText = text;

    await next();
  });

  bot.use(
    session({
      initial: initialSession,
      storage: options.kv ? new KvAdapter<UserSession>(options.kv) : undefined,
      // IMPORTANT! Read session key every time, no matter what. It will help
      // to avoid errors in the future
      getSessionKey: (ctx) => ctx.from?.id.toString(),
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

  bot.catch(({ error, ctx }) => {
    logger.error('bot.unhandled', { updateId: ctx.update.update_id, userId: ctx.from?.id, err: error });
  });

  return bot;
};
