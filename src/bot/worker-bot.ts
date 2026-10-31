import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';

import { createBaseBot, type BaseBotOptions } from 'src/bot/base';
import type { BaseContext } from 'src/bot/context';
import { createInline } from 'src/bot/features/inline';

export interface WorkerBotOptions extends BaseBotOptions {
  /** Hands a private-chat update to the user's Durable Object (see src/bot/chat-bot.ts) */
  forwardPrivateChat: (chatId: number, update: Update) => Promise<void>;
  /** How long Telegram may cache inline answers, in seconds */
  inlineCacheSeconds?: number;
}

/**
 * The bot that runs in the Worker, on every webhook request. It has no session:
 * - private-chat updates are forwarded to the user's Durable Object, which runs the chat bot
 * - inline queries are answered right here, from KV
 */
export const createWorkerBot = (options: WorkerBotOptions): Bot<BaseContext> => {
  const bot = createBaseBot<BaseContext>(options, {
    // Inline answers go back in the webhook response itself, saving a separate request to Telegram.
    // Telegram doesn't report errors for these, so a rejected answer is lost without a trace.
    canUseWebhookReply: (method) => method === 'answerInlineQuery',
  });

  bot.chatType('private').use((ctx) => options.forwardPrivateChat(ctx.chat.id, ctx.update));

  bot.use(createInline(options.inlineCacheSeconds));

  return bot;
};
