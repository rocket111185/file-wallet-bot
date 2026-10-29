import { webhookCallback } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';

import { createBot } from 'src/bot/bot';
import { CloudflareKVDatabase } from 'src/db/db.cloudflare';
import { tryParseJson } from 'src/utils';

export interface Env {
  BOT_INFO: string;
  BOT_TOKEN: string;
  BOT_KV_VAULT: KVNamespace;
}

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const botInfo = tryParseJson<UserFromGetMe>(env.BOT_INFO);
    const db = new CloudflareKVDatabase(env.BOT_KV_VAULT);

    const bot = createBot({
      token: env.BOT_TOKEN,
      db,
      kv: env.BOT_KV_VAULT,
      botInfo,
    });

    return webhookCallback(bot, 'cloudflare-mod')(request);
  },
} satisfies ExportedHandler<Env>;
