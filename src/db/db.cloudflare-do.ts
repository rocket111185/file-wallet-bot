import { DurableObject } from 'cloudflare:workers';
import { and, asc, count, eq, inArray, max } from 'drizzle-orm';
import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';

import migrations from '../../drizzle/user-vault/migrations';
import type { Database } from 'src/db/db.interface';
import type { ShareRegistry } from 'src/db/share-registry';
import { DurableObjectShareRegistry } from 'src/db/share-registry.durable-object';
import { account, files, folders, type FileRow, type FolderRow } from 'src/db/schemas/user-vault';
import { checkFileLimit, checkFolderLimit, validateFolderName } from 'src/db/validation';
import { logger } from 'src/logger';
import {
  DB_ERROR_KEYS,
  DEFAULT_PLAN,
  PLAN_FOLDER_LIMITS,
  type DbErrorKey,
  type FileItem,
  type FolderContents,
  type FolderInfo,
  type FolderQuota,
  type Plan,
  type Status,
  type StatusError,
  type TelegramFileType,
} from 'src/types';
import { chunk, generateId, sameName } from 'src/utils';

type UserId = string | number;

type VaultDb = DrizzleSqliteDODatabase;
/** What `db.transaction` hands its callback; queries on it must use the synchronous `.all/.get/.run` */
type VaultTx = Parameters<Parameters<VaultDb['transaction']>[0]>[0];

/**
 * A SQLite-backed Durable Object accepts at most 100 bound parameters per statement
 * (https://developers.cloudflare.com/durable-objects/platform/limits/), so bulk writes go in batches.
 * The size is fixed with a wide margin instead of computed to sit right at the limit.
 *
 * - Insert into `files`: a row binds one parameter per column, so 10 rows fit for up to 10 columns
 *   (5 today). The multi-batch tests in test/db.cloudflare-do.test.ts fail if that ever stops holding.
 * - `DELETE ... WHERE folder_id = ? AND file_id IN (...)`: binds 1 + 10 parameters.
 */
const FILE_WRITE_BATCH = 10;

/**
 * Folder IDs to try before giving up when another user already owns them (see `ShareRegistry.register`).
 * With 72-bit random IDs a single collision is already astronomically unlikely.
 */
const FOLDER_ID_ATTEMPTS = 3;

/** Set in the vault's own key-value storage once its folders from before sharing are registered */
const SHARES_REGISTERED_KEY = 'shares-registered';

const toFileItem = (row: Pick<FileRow, 'fileId' | 'name' | 'type'>): FileItem => ({
  id: row.fileId,
  name: row.name,
  type: row.type as TelegramFileType,
});

/**
 * One instance per user (named by the user ID) holding their folders and files in its own SQLite
 * database (schema: src/db/schemas/user-vault.ts, migrations: drizzle/user-vault). It's deliberately
 * not UserChat: that object owns the session, this one owns the permanent data, and neither touches
 * the other's storage.
 *
 * Both the Worker (inline mode) and the user's UserChat (chat commands) call it over RPC. The object
 * already belongs to one user, so methods take no user ID.
 *
 * Concurrency: every check-then-write runs inside `db.transaction`, whose callback must stay
 * synchronous (the Drizzle types reject an async one). That keeps the check and the write atomic and
 * free of interleaving calls, even if a method later awaits something other than storage (a fetch,
 * another object), which would let another call run at that point.
 */
export class UserVault extends DurableObject<Env> {
  private readonly db: VaultDb;
  /** Built here rather than passed in: a Durable Object only gets `env` */
  private readonly shares: ShareRegistry;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.shares = new DurableObjectShareRegistry(env.FOLDER_SHARE);
    this.db = drizzle(ctx.storage);
    // Synchronous and in one transaction, so it's done before the object takes its first call
    migrate(this.db, migrations);
    // In the background: calls don't wait for it, and a failed run is retried on the next start
    void this.registerExistingFolders();
  }

  // ---- Folders ----

  async addFolder(name: string): Promise<Status<{ id: string }>> {
    const trimmedName = name.trim();
    const invalid = validateFolderName(trimmedName);
    if (invalid) return invalid;

    // Checked before the ID is registered, so a taken name or a full plan costs no call to the share registry
    const refused = this.db.transaction((tx) => this.checkNewFolder(tx, trimmedName));
    if (refused) return refused;

    // Registered before the folder exists, so a share link to any existing folder resolves
    const id = await this.reserveFolderId();

    // Checked again: other calls could run while the ID was being registered
    const res = this.db.transaction((tx): Status<{ id: string }> => {
      const refusedNow = this.checkNewFolder(tx, trimmedName);
      if (refusedNow) return refusedNow;

      const position = (this.readFolders(tx).at(-1)?.position ?? -1) + 1; // Rows come sorted by position
      tx.insert(folders).values({ id, name: trimmedName, position }).run();

      return { error: false, data: { id } };
    });

    if (res.error) await this.unregisterShares([id]);
    return res;
  }

  async renameFolder(folderId: string, newName: string): Promise<Status> {
    const trimmedName = newName.trim();
    const invalid = validateFolderName(trimmedName);
    if (invalid) return invalid;

    return this.db.transaction((tx): Status => {
      const existing = this.readFolders(tx);
      if (!existing.some((f) => f.id === folderId)) {
        return { error: true, key: DB_ERROR_KEYS.FOLDER_NOT_FOUND };
      }
      if (existing.some((f) => f.id !== folderId && sameName(f.name, trimmedName))) {
        return { error: true, key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS, params: { name: trimmedName } };
      }

      tx.update(folders).set({ name: trimmedName }).where(eq(folders.id, folderId)).run();
      return { error: false };
    });
  }

  async removeFolder(folderId: string): Promise<Status> {
    const res = this.db.transaction((tx): Status => {
      if (!this.folderExists(tx, folderId)) {
        return { error: true, key: DB_ERROR_KEYS.FOLDER_NOT_FOUND };
      }

      tx.delete(files).where(eq(files.folderId, folderId)).run();
      tx.delete(folders).where(eq(folders.id, folderId)).run();
      return { error: false };
    });

    if (!res.error) await this.unregisterShares([folderId]);
    return res;
  }

  async listFolders(): Promise<Status<FolderInfo[]>> {
    const rows = await this.db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .orderBy(asc(folders.position));
    return { error: false, data: rows };
  }

  // ---- Files ----

  async addFiles(folderId: string, newFiles: FileItem[]): Promise<Status> {
    if (newFiles.length === 0) return { error: false };

    return this.db.transaction((tx): Status => {
      // Files can't end up in a folder that was removed in the meantime
      if (!this.folderExists(tx, folderId)) {
        return { error: true, key: DB_ERROR_KEYS.FOLDER_NOT_FOUND };
      }

      return this.insertFiles(tx, folderId, newFiles) ?? { error: false };
    });
  }

  async removeFiles(folderId: string, fileIds: string[]): Promise<Status> {
    if (fileIds.length === 0) return { error: false };

    this.db.transaction((tx) => {
      for (const ids of chunk(fileIds, FILE_WRITE_BATCH)) {
        tx.delete(files)
          .where(and(eq(files.folderId, folderId), inArray(files.fileId, ids)))
          .run();
      }
    });
    return { error: false };
  }

  async listFiles(folderId: string): Promise<Status<FileItem[]>> {
    return { error: false, data: await this.readFiles(folderId) };
  }

  async getFolderContents(folderNumber: number): Promise<Status<FolderContents | null>> {
    if (!Number.isInteger(folderNumber) || folderNumber < 1) return { error: false, data: null };

    const [folder] = await this.db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .orderBy(asc(folders.position))
      .limit(1)
      .offset(folderNumber - 1);
    if (!folder) return { error: false, data: null };

    return { error: false, data: { folder, files: await this.readFiles(folder.id) } };
  }

  /** A folder by its ID, with its files: what a share link opens. `null` when there is no such folder. */
  async getFolder(folderId: string): Promise<Status<FolderContents | null>> {
    const [folder] = await this.db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(eq(folders.id, folderId));
    if (!folder) return { error: false, data: null };

    return { error: false, data: { folder, files: await this.readFiles(folder.id) } };
  }

  // ---- Plan ----

  async getFolderQuota(): Promise<Status<FolderQuota>> {
    return this.db.transaction((tx): Status<FolderQuota> => {
      const row = tx.select({ used: count() }).from(folders).get();
      return { error: false, data: { used: row?.used ?? 0, max: this.folderLimit(tx) } };
    });
  }

  /**
   * Switches the user to `plan`. Not part of `Database` yet: the purchase flow will call it.
   */
  async setPlan(plan: Plan): Promise<void> {
    await this.db.insert(account).values({ id: 1, plan }).onConflictDoUpdate({ target: account.id, set: { plan } });
  }

  // ---- Teardown ----

  /** Removes folders and files; the plan stays, since upgrades are paid for */
  async clearUserData(): Promise<Status> {
    const removed = this.db.transaction((tx) => {
      const ids = tx.select({ id: folders.id }).from(folders).all();
      tx.delete(files).run();
      tx.delete(folders).run();
      return ids.map((row) => row.id);
    });

    await this.unregisterShares(removed);
    return { error: false };
  }

  // ---- Sharing ----

  /** The user this vault belongs to: vaults are always reached by name (`getByName(userId)`) */
  private get ownerId(): string {
    const name = this.ctx.id.name;
    if (!name) throw new Error('UserVault must be reached by name, the user ID');
    return name;
  }

  /**
   * A new random folder ID, registered to this user in the share registry
   *
   * Folder IDs are 12-char base64url strings from 9 random bytes (72 bits of entropy). They are global
   * now (a share link is the folder ID), so one owned by another user is skipped.
   */
  private async reserveFolderId(): Promise<string> {
    for (let attempt = 0; attempt < FOLDER_ID_ATTEMPTS; attempt++) {
      const id = generateId(9);
      if (await this.shares.register(id, this.ownerId)) return id;
      logger.warn('vault.folderId.collision', { userId: this.ownerId, folderId: id });
    }
    throw new Error(`No free folder ID after ${FOLDER_ID_ATTEMPTS} attempts`);
  }

  /**
   * Drops the share registry entries of removed folders. Best effort: an entry left behind is harmless,
   * as its link finds no folder in this vault anymore.
   */
  private async unregisterShares(folderIds: string[]): Promise<void> {
    await Promise.all(
      folderIds.map((folderId) =>
        this.shares
          .unregister(folderId, this.ownerId)
          .catch((err: unknown) => logger.warn('vault.share.unregister.failed', { folderId, err })),
      ),
    );
  }

  /**
   * Registers folders created before sharing existed, once per vault. New folders are registered by
   * `addFolder`. A failed run leaves the flag unset, so the next start of the vault tries again.
   */
  private async registerExistingFolders(): Promise<void> {
    if (this.ctx.storage.kv.get(SHARES_REGISTERED_KEY)) return;

    try {
      const rows = await this.db.select({ id: folders.id }).from(folders);
      const registered = await Promise.all(rows.map((row) => this.shares.register(row.id, this.ownerId)));
      registered.forEach((ok, i) => {
        // Can't be fixed here, the ID is already in use: the folder just can't be shared
        if (!ok) logger.error('vault.share.collision', { userId: this.ownerId, folderId: rows[i].id });
      });
      this.ctx.storage.kv.put(SHARES_REGISTERED_KEY, true);
    } catch (err) {
      logger.error('vault.share.backfill.failed', { err });
    }
  }

  // ---- Helpers ----

  private readFolders(tx: VaultTx): FolderRow[] {
    return tx.select().from(folders).orderBy(asc(folders.position)).all();
  }

  /** Why a folder named `name` can't be added (name taken, plan's folder limit), or null if it can */
  private checkNewFolder(tx: VaultTx, name: string): StatusError | null {
    const existing = this.readFolders(tx);
    if (existing.some((folder) => sameName(folder.name, name))) {
      return { error: true, key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS, params: { name } };
    }
    return checkFolderLimit(existing.length, this.folderLimit(tx));
  }

  private readPlan(tx: VaultTx): Plan {
    const row = tx.select({ plan: account.plan }).from(account).where(eq(account.id, 1)).get();
    const plan = row?.plan as Plan | undefined;
    return plan && plan in PLAN_FOLDER_LIMITS ? plan : DEFAULT_PLAN;
  }

  private folderLimit(tx: VaultTx): number {
    return PLAN_FOLDER_LIMITS[this.readPlan(tx)];
  }

  private folderExists(tx: VaultTx, folderId: string): boolean {
    return tx.select({ id: folders.id }).from(folders).where(eq(folders.id, folderId)).get() !== undefined;
  }

  private async readFiles(folderId: string): Promise<FileItem[]> {
    const rows = await this.db
      .select({ fileId: files.fileId, name: files.name, type: files.type })
      .from(files)
      .where(eq(files.folderId, folderId))
      .orderBy(asc(files.position));
    return rows.map(toFileItem);
  }

  /**
   * Appends files to a folder, skipping ones it already has (also repeats within `newFiles`).
   * Inserts nothing if the new ones don't all fit (MAX_FILES_PER_FOLDER).
   *
   * @returns The limit error, or null when the files were added
   */
  private insertFiles(tx: VaultTx, folderId: string, newFiles: FileItem[]): StatusError | null {
    const stored = tx.select({ fileId: files.fileId }).from(files).where(eq(files.folderId, folderId)).all();
    const seen = new Set(stored.map((row) => row.fileId));
    const fresh = newFiles.filter((file) => !seen.has(file.id) && seen.add(file.id));

    const overLimit = checkFileLimit(stored.length, fresh.length);
    if (overLimit) return overLimit;
    if (fresh.length === 0) return null;

    const last = tx
      .select({ last: max(files.position) })
      .from(files)
      .where(eq(files.folderId, folderId))
      .get();
    const start = (last?.last ?? -1) + 1;

    const rows = fresh.map((file, i) => ({
      folderId,
      fileId: file.id,
      position: start + i,
      name: file.name,
      type: file.type,
    }));
    for (const batch of chunk(rows, FILE_WRITE_BATCH)) {
      tx.insert(files).values(batch).onConflictDoNothing().run();
    }
    return null;
  }
}

/**
 * Database backed by one UserVault Durable Object per user. Each call is a single RPC; storage work
 * happens inside the object, next to its SQLite database. `shares` finds the owner of a shared folder
 * (`getSharedFolder`); the vaults keep it up to date themselves.
 */
export class CloudflareDODatabase implements Database {
  constructor(
    private readonly namespace: DurableObjectNamespace<UserVault>,
    private readonly shares: ShareRegistry,
  ) {}

  private vault(userId: UserId) {
    return this.namespace.getByName(String(userId));
  }

  /**
   * Runs an RPC, turning exceptions (the object failed, storage errors) into a logged `StatusError`.
   * The details stay in the logs; callers only get a translation key.
   */
  private async call<T>(
    op: string,
    key: DbErrorKey,
    context: Record<string, unknown>,
    fn: () => Promise<Status<T>>,
  ): Promise<Status<T>> {
    try {
      return await fn();
    } catch (err) {
      logger.error(`db.do.${op}.failed`, { ...context, err });
      return { error: true, key };
    }
  }

  addFolder(userId: UserId, name: string): Promise<Status<{ id: string }>> {
    return this.call('addFolder', DB_ERROR_KEYS.DB_ADD_FOLDER, { userId }, () => this.vault(userId).addFolder(name));
  }

  renameFolder(userId: UserId, folderId: string, newName: string): Promise<Status> {
    return this.call('renameFolder', DB_ERROR_KEYS.DB_RENAME_FOLDER, { userId, folderId }, () =>
      this.vault(userId).renameFolder(folderId, newName),
    );
  }

  removeFolder(userId: UserId, folderId: string): Promise<Status> {
    return this.call('removeFolder', DB_ERROR_KEYS.DB_REMOVE_FOLDER, { userId, folderId }, () =>
      this.vault(userId).removeFolder(folderId),
    );
  }

  listFolders(userId: UserId): Promise<Status<FolderInfo[]>> {
    return this.call('listFolders', DB_ERROR_KEYS.DB_LIST_FOLDERS, { userId }, () => this.vault(userId).listFolders());
  }

  addFiles(userId: UserId, folderId: string, files: FileItem[]): Promise<Status> {
    return this.call('addFiles', DB_ERROR_KEYS.DB_ADD_FILES, { userId, folderId, count: files.length }, () =>
      this.vault(userId).addFiles(folderId, files),
    );
  }

  removeFiles(userId: UserId, folderId: string, fileIds: string[]): Promise<Status> {
    return this.call('removeFiles', DB_ERROR_KEYS.DB_REMOVE_FILES, { userId, folderId, count: fileIds.length }, () =>
      this.vault(userId).removeFiles(folderId, fileIds),
    );
  }

  listFiles(userId: UserId, folderId: string): Promise<Status<FileItem[]>> {
    return this.call('listFiles', DB_ERROR_KEYS.DB_LIST_FILES, { userId, folderId }, () =>
      this.vault(userId).listFiles(folderId),
    );
  }

  getFolderContents(userId: UserId, folderNumber: number): Promise<Status<FolderContents | null>> {
    return this.call('getFolderContents', DB_ERROR_KEYS.DB_LIST_FILES, { userId, folderNumber }, () =>
      this.vault(userId).getFolderContents(folderNumber),
    );
  }

  getSharedFolder(folderId: string): Promise<Status<FolderContents | null>> {
    return this.call('getSharedFolder', DB_ERROR_KEYS.DB_GET_SHARED_FOLDER, { folderId }, async () => {
      const ownerId = await this.shares.owner(folderId);
      if (ownerId === null) return { error: false, data: null };
      return this.vault(ownerId).getFolder(folderId);
    });
  }

  getFolderQuota(userId: UserId): Promise<Status<FolderQuota>> {
    return this.call('getFolderQuota', DB_ERROR_KEYS.DB_GET_QUOTA, { userId }, () =>
      this.vault(userId).getFolderQuota(),
    );
  }

  clearUserData(userId: UserId): Promise<Status> {
    return this.call('clearUserData', DB_ERROR_KEYS.DB_CLEAR_DATA, { userId }, () =>
      this.vault(userId).clearUserData(),
    );
  }
}
