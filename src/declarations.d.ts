// Secrets are not part of wrangler.jsonc, so `wrangler types` can't see them
interface Secrets {
  BOT_TOKEN: string;
  /** Must match the `secret_token` passed to setWebhook (1-256 chars of A-Z, a-z, 0-9, _ and -) */
  BOT_WEBHOOK_SECRET: string;
}
interface Env extends Secrets {}
declare namespace Cloudflare {
  interface Env extends Secrets {}
}

// ECMAScript Uint8Array toBase64 proposal, supported natively by workerd and Node 22+
interface Uint8Array {
  toBase64(options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }): string;
}
