import { session, type Bot } from 'grammy';

import { createBaseBot, type BaseBotOptions } from 'src/bot/base';
import type { BotContext } from 'src/bot/context';
import { menuCommands } from 'src/bot/commands';
import { clearData } from 'src/bot/features/clear-data';
import { files } from 'src/bot/features/files';
import { folders } from 'src/bot/features/folders';
import { start } from 'src/bot/features/start';
import { initialSession, type SessionStorage } from 'src/session/session';

export interface ChatBotOptions extends BaseBotOptions {
  /** Where sessions are kept (on Cloudflare: the user's Durable Object storage) */
  sessionStorage: SessionStorage;
}

/**
 * The bot that handles the user's private chat: commands, buttons and uploaded files. The session
 * is read from `sessionStorage` before each update and written back after it.
 *
 * Each feature registers its own handlers (src/bot/features). Their order doesn't matter: messages
 * reach a flow only while the user is in it, and commands never count as flow input.
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

  bot.use(menuCommands, start, folders, files, clearData);

  return bot;
};
