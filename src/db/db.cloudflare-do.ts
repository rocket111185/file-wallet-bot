import { DurableObject } from 'cloudflare:workers';
import { and, asc, count, eq, inArray, max } from 'drizzle-orm';
import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';

import migrations from '../../drizzle/user-vault/migrations';
import type { Database } from 'src/db/db.interface';
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage);
    // Synchronous and in one transaction, so it's done before the object takes its first call
    migrate(this.db, migrations);
  }

  // ---- Folders ----

  async addFolder(name: string): Promise<Status<{ id: string }>> {
    const trimmedName = name.trim();
    const invalid = validateFolderName(trimmedName);
    if (invalid) return invalid;

    return this.db.transaction((tx): Status<{ id: string }> => {
      const existing = this.readFolders(tx);
      if (existing.some((folder) => sameName(folder.name, trimmedName))) {
        return { error: true, key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS, params: { name: trimmedName } };
      }

      const overLimit = checkFolderLimit(existing.length, this.folderLimit(tx));
      if (overLimit) return overLimit;

      // Folder IDs are 12-char base64url strings from 9 random bytes (72 bits of entropy)
      const id = generateId(9);
      const position = (existing.at(-1)?.position ?? -1) + 1; // Rows come sorted by position
      tx.insert(folders).values({ id, name: trimmedName, position }).run();

      return { error: false, data: { id } };
    });
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
    return this.db.transaction((tx): Status => {
      if (!this.folderExists(tx, folderId)) {
        return { error: true, key: DB_ERROR_KEYS.FOLDER_NOT_FOUND };
      }

      tx.delete(files).where(eq(files.folderId, folderId)).run();
      tx.delete(folders).where(eq(folders.id, folderId)).run();
      return { error: false };
    });
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
    this.db.transaction((tx) => {
      tx.delete(files).run();
      tx.delete(folders).run();
    });
    return { error: false };
  }

  // ---- Helpers ----

  private readFolders(tx: VaultTx): FolderRow[] {
    return tx.select().from(folders).orderBy(asc(folders.position)).all();
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
 * happens inside the object, next to its SQLite database.
 */
export class CloudflareDODatabase implements Database {
  constructor(private readonly namespace: DurableObjectNamespace<UserVault>) {}

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
