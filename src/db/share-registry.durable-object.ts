import { DurableObject } from 'cloudflare:workers';

import type { ShareRegistry } from 'src/db/share-registry';

const OWNER_KEY = 'owner';

/**
 * One instance per folder, named by the folder ID, holding the owner's user ID in its synchronous
 * key-value storage. Reached only through `DurableObjectShareRegistry`.
 */
export class FolderShare extends DurableObject<Env> {
  /** @returns false if another user already owns this ID */
  register(userId: string): boolean {
    const owner = this.owner();
    if (owner !== null && owner !== userId) return false;
    if (owner === null) this.ctx.storage.kv.put(OWNER_KEY, userId);
    return true;
  }

  owner(): string | null {
    return this.ctx.storage.kv.get<string>(OWNER_KEY) ?? null;
  }

  /** Only the owner can drop the entry, so a stale call can't drop someone else's */
  async unregister(userId: string): Promise<void> {
    if (this.owner() === userId) await this.ctx.storage.deleteAll();
  }
}

/**
 * `ShareRegistry` with one `FolderShare` Durable Object per folder: strongly consistent (a link works
 * the moment it's sent, unlike with KV), and no single object every share goes through.
 */
export class DurableObjectShareRegistry implements ShareRegistry {
  constructor(private readonly namespace: DurableObjectNamespace<FolderShare>) {}

  private entry(folderId: string) {
    return this.namespace.getByName(folderId);
  }

  register(folderId: string, userId: string): Promise<boolean> {
    return this.entry(folderId).register(userId);
  }

  owner(folderId: string): Promise<string | null> {
    return this.entry(folderId).owner();
  }

  unregister(folderId: string, userId: string): Promise<void> {
    return this.entry(folderId).unregister(userId);
  }
}
