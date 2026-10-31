import type { SessionStorage, UserSession } from 'src/session/session';

/**
 * Keeps sessions in a Durable Object's own storage (one object per user, see src/bot/user-chat.ts).
 * The official `@grammyjs/storage-cloudflare` package only offers KV and D1 adapters.
 */
export class DurableObjectSessionStorage implements SessionStorage {
  constructor(private readonly storage: DurableObjectStorage) {}

  read(key: string): Promise<UserSession | undefined> {
    return this.storage.get<UserSession>(key);
  }

  write(key: string, value: UserSession): Promise<void> {
    return this.storage.put(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.storage.delete(key);
  }
}
