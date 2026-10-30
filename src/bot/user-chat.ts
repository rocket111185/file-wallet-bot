import { DurableObject } from 'cloudflare:workers';
import type { Bot, StorageAdapter } from 'grammy';
import type { Update } from 'grammy/types';

import { createChatBot } from 'src/bot/chat-bot';
import type { BotContext } from 'src/bot/context';
import type { UserSession } from 'src/bot/session';
import { CloudflareKVDatabase } from 'src/db/db.cloudflare';
import { createSerialQueue } from 'src/utils';

/**
 * One instance per user (named by the private chat ID): handles every update from the user's private
 * chat with the bot and keeps their session in its own storage.
 *
 * Telegram delivers updates in parallel (an album is several updates at once), and grammY reads the
 * session when an update starts and writes it back when it ends. Parallel updates would overwrite each
 * other's changes, so they are queued here, the one place that sees all of a user's updates.
 */
export class UserChat extends DurableObject<Env> {
  // Input gates don't cover this: awaiting a Telegram API call lets the next update start
  private readonly enqueue = createSerialQueue();
  private bot?: Bot<BotContext>;

  async handleUpdate(update: Update): Promise<void> {
    await this.enqueue(() => this.getBot().handleUpdate(update));
  }

  private getBot(): Bot<BotContext> {
    const storage: StorageAdapter<UserSession> = {
      read: (key) => this.ctx.storage.get<UserSession>(key),
      write: (key, value) => this.ctx.storage.put(key, value),
      delete: async (key) => {
        await this.ctx.storage.delete(key);
      },
    };

    this.bot ??= createChatBot({
      token: this.env.BOT_TOKEN,
      db: new CloudflareKVDatabase(this.env.BOT_KV_VAULT),
      botInfo: this.env.BOT_INFO,
      sessionStorage: storage,
    });

    return this.bot;
  }
}
