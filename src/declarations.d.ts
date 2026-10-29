declare module '@grammyjs/storage-cloudflare' {
  export class KvAdapter<T = unknown> {
    constructor(kv_namespace: KVNamespace);
    read(key: string): Promise<T | undefined>;
    write(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    has(key: string): Promise<boolean>;
  }
}
