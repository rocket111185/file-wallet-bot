import { Bot, type ApiClientOptions } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';

import type { BaseContext } from 'src/bot/context';
import type { Database } from 'src/db/db.interface';
import { createTranslator, resolveLocale } from 'src/i18n/i18n';
import { logger } from 'src/logger';

const HTML_METHODS = new Set(['sendMessage', 'editMessageText']);

export interface BaseBotOptions {
  token: string;
  db: Database;
  botInfo?: UserFromGetMe;
}

/**
 * Setup shared by the Worker bot and the chat bot: HTML by default, `ctx.db`, translations and the
 * error handler. Handlers are added by the caller.
 */
export const createBaseBot = <C extends BaseContext>(options: BaseBotOptions, client?: ApiClientOptions): Bot<C> => {
  const bot = new Bot<C>(options.token, {
    botInfo: options.botInfo,
    client,
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

  bot.catch(({ error, ctx }) => {
    logger.error('bot.unhandled', { updateId: ctx.update.update_id, userId: ctx.from?.id, err: error });
  });

  return bot;
};
