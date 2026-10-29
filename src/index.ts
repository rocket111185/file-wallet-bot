import { webhookCallback } from 'grammy';

import { createBot } from 'src/bot/bot';
import { CloudflareKVDatabase } from 'src/db/db.cloudflare';

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const db = new CloudflareKVDatabase(env.BOT_KV_VAULT);

    const bot = createBot({
      token: env.BOT_TOKEN,
      db,
      kv: env.BOT_KV_VAULT,
      // A JSON object var in wrangler.jsonc arrives as an object, no parsing needed
      botInfo: env.BOT_INFO,
    });

    return webhookCallback(bot, 'cloudflare-mod')(request);
  },
} satisfies ExportedHandler<Env>;
