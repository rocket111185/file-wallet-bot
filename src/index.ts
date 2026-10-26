/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { Bot, webhookCallback } from 'grammy';
import { UserFromGetMe } from 'grammy/types';

import { tryParseJson } from 'src/utils';

export interface Env {
  BOT_INFO: string;
  BOT_TOKEN: string;
}

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const botInfo = tryParseJson<UserFromGetMe>(env.BOT_INFO);
    const bot = new Bot(env.BOT_TOKEN, { botInfo });

    bot.command('start', async (ctx) => {
      await ctx.reply('Hi there!');
    });

    return webhookCallback(bot, 'cloudflare-mod')(request);
  },
} satisfies ExportedHandler<Env>;
