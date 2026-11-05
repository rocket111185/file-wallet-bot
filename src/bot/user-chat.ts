import { DurableObject } from 'cloudflare:workers';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';

import { createChatBot } from 'src/bot/chat-bot';
import type { BotContext } from 'src/bot/context';
import { CloudflareDODatabase } from 'src/db/db.cloudflare-do';
import { DurableObjectShareRegistry } from 'src/db/share-registry.durable-object';
import { DurableObjectSessionStorage } from 'src/session/session.durable-object';
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
    this.bot ??= createChatBot({
      token: this.env.BOT_TOKEN,
      // Folders and files live in the user's UserVault, never in this object: it only keeps the session
      db: new CloudflareDODatabase(this.env.USER_VAULT, new DurableObjectShareRegistry(this.env.FOLDER_SHARE)),
      botInfo: this.env.BOT_INFO,
      sessionStorage: new DurableObjectSessionStorage(this.ctx.storage),
    });

    return this.bot;
  }
}
