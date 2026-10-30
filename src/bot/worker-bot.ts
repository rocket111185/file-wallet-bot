import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';

import { createBaseBot, type BaseBotOptions } from 'src/bot/base';
import type { BaseContext } from 'src/bot/context';
import { handleInlineQuery } from 'src/bot/handlers/inline';

export interface WorkerBotOptions extends BaseBotOptions {
  /** Hands a private-chat update to the user's Durable Object (see src/bot/chat-bot.ts) */
  forwardPrivateChat: (chatId: number, update: Update) => Promise<void>;
}

/**
 * The bot that runs in the Worker, on every webhook request. It has no session:
 * - private-chat updates are forwarded to the user's Durable Object, which runs the chat bot
 * - inline queries are answered right here, from KV
 */
export const createWorkerBot = (options: WorkerBotOptions): Bot<BaseContext> => {
  const bot = createBaseBot<BaseContext>(options);

  bot.chatType('private').use((ctx) => options.forwardPrivateChat(ctx.chat.id, ctx.update));

  bot.on('inline_query', handleInlineQuery);

  return bot;
};
