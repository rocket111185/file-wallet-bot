/**
 * Who owns each shared folder, so a share link (`/start s_<folderId>`) can be resolved without the
 * owner's user ID in it. Folder IDs are random (72 bits): unguessable, and they say nothing about the
 * owner.
 *
 * An entry must exist before its folder does, so a link to an existing folder always resolves. An
 * entry left behind by a removed folder is harmless: the owner simply has no such folder anymore.
 *
 * Implemented over Durable Objects in src/db/share-registry.durable-object.ts.
 */
export interface ShareRegistry {
  /**
   * Records `userId` as the owner of `folderId`. Repeating it for the same owner is fine.
   *
   * @returns false if another user already owns this ID (a random ID collision): pick a new one
   */
  register(folderId: string, userId: string): Promise<boolean>;

  /** The owner's user ID, or null if the ID was never registered (or was unregistered) */
  owner(folderId: string): Promise<string | null>;

  /** Forgets the owner of `folderId`, but only if it is `userId` */
  unregister(folderId: string, userId: string): Promise<void>;
}
