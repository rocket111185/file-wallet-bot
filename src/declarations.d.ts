declare module '@grammyjs/storage-cloudflare' {
  export class KvAdapter<T = unknown> {
    constructor(kv_namespace: KVNamespace);
    read(key: string): Promise<T | undefined>;
    write(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    has(key: string): Promise<boolean>;
  }
}

// Secrets are not part of wrangler.jsonc, so `wrangler types` can't see them
interface Secrets {
  BOT_TOKEN: string;
}
interface Env extends Secrets {}
declare namespace Cloudflare {
  interface Env extends Secrets {}
}

// ECMAScript Uint8Array toBase64 proposal, supported natively by workerd and Node 22+
interface Uint8Array {
  toBase64(options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }): string;
}
