import { webhookCallback } from 'grammy';

import { createWorkerBot } from 'src/bot/worker-bot';
import { CloudflareKVDatabase } from 'src/db/db.cloudflare';
import { logger } from 'src/logger';

// Durable Object classes must be exported from the main module
export { UserChat } from 'src/bot/user-chat';

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    // Fail closed: without a secret anyone who knows the worker URL could forge updates
    if (!env.BOT_WEBHOOK_SECRET) {
      logger.error('webhook.secret.missing');
      return new Response('Server misconfigured', { status: 500 });
    }

    const db = new CloudflareKVDatabase(env.BOT_KV_VAULT);

    const bot = createWorkerBot({
      token: env.BOT_TOKEN,
      db,
      // A JSON object var in wrangler.jsonc arrives as an object, no parsing needed
      botInfo: env.BOT_INFO,
      forwardPrivateChat: (chatId, update) => env.USER_CHAT.getByName(String(chatId)).handleUpdate(update),
    });

    // Rejects requests whose X-Telegram-Bot-Api-Secret-Token header doesn't match (401)
    return webhookCallback(bot, 'cloudflare-mod', { secretToken: env.BOT_WEBHOOK_SECRET })(request);
  },
} satisfies ExportedHandler<Env>;
