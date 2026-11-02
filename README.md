# file-wallet-bot
The Telegram bot intended to organize files in a simple way

## Setup

1. Generate a webhook secret. Telegram allows 1-256 chars of `A-Z a-z 0-9 _ -`, and hex fits:
   ```sh
   openssl rand -hex 32   # 64 hex chars, 256 bits of randomness
   ```
2. Set the secrets (for local dev, copy `.dev.vars.example` to `.dev.vars` and fill it in instead).
   Each command prompts for the value, so it doesn't end up in your shell history:
   ```sh
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put BOT_WEBHOOK_SECRET   # paste the value from step 1
   ```
3. Check `wrangler.jsonc`. It's in `.gitignore`, so a fresh clone or another machine won't have your copy,
   and these two settings at its top level are required:
   ```jsonc
   // Required: the Drizzle migrations (drizzle/) are imported as text. Without it the build fails
   "rules": [{ "type": "Text", "globs": ["**/*.sql"], "fallthrough": true }],
   // Required: roughly halves the bundle and its startup time. Keep "upload_source_maps": true next to it,
   // so stack traces in the logs still point at the real source
   "minify": true,
   ```
4. Deploy: `npx wrangler deploy`
5. Register the webhook with the same secret, so the worker can reject forged updates:
   ```sh
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
     -d url=https://<worker-url>/ \
     -d secret_token=<BOT_WEBHOOK_SECRET>
   ```
   Telegram should answer `{"ok":true,"result":true,"description":"Webhook was set"}`.
   Check it with `curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"`; `last_error_message` shows failed deliveries
   (e.g. `401 Unauthorized` means the secrets don't match).
