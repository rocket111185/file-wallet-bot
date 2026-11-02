import { DurableObject } from 'cloudflare:workers';

import type { Database } from 'src/db/db.interface';
import { USER_VAULT_SCHEMA, type FileRow, type FolderRow } from 'src/db/schemas/user-vault';
import { validateFolderName } from 'src/db/validation';
import { logger } from 'src/logger';
import {
  DB_ERROR_KEYS,
  type DbErrorKey,
  type FileItem,
  type FolderContents,
  type FolderInfo,
  type Status,
  type TelegramFileType,
} from 'src/types';
import { generateId, sameName } from 'src/utils';

type UserId = string | number;

const toFileItem = (row: FileRow): FileItem => ({
  id: row.file_id,
  name: row.name,
  type: row.type as TelegramFileType,
});

/**
 * One instance per user (named by the user ID) holding their folders and files in its own SQLite
 * database (schema: src/db/schemas/user-vault.ts). It's deliberately not UserChat: that object owns
 * the session, this one owns the permanent data, and neither touches the other's storage.
 *
 * Both the Worker (inline mode) and the user's UserChat (chat commands) call it over RPC. The object
 * already belongs to one user, so methods take no user ID. Every method is synchronous: it can't
 * interleave with another call, and its writes are committed atomically.
 */
export class UserVault extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(USER_VAULT_SCHEMA);
  }

  // ---- Folders ----

  addFolder(name: string): Status<{ id: string }> {
    const trimmedName = name.trim();
    const invalid = validateFolderName(trimmedName);
    if (invalid) return invalid;

    const folders = this.readFolders();
    if (folders.some((folder) => sameName(folder.name, trimmedName))) {
      return { error: true, key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS, params: { name: trimmedName } };
    }

    // Folder IDs are 12-char base64url strings from 9 random bytes (72 bits of entropy)
    const id = generateId(9);
    const position = (folders.at(-1)?.position ?? -1) + 1; // Rows come sorted by position
    this.sql.exec('INSERT INTO folders (id, name, position) VALUES (?, ?, ?)', id, trimmedName, position);

    return { error: false, data: { id } };
  }

  renameFolder(folderId: string, newName: string): Status {
    const trimmedName = newName.trim();
    const invalid = validateFolderName(trimmedName);
    if (invalid) return invalid;

    const folders = this.readFolders();
    if (!folders.some((f) => f.id === folderId)) {
      return { error: true, key: DB_ERROR_KEYS.FOLDER_NOT_FOUND };
    }
    if (folders.some((f) => f.id !== folderId && sameName(f.name, trimmedName))) {
      return { error: true, key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS, params: { name: trimmedName } };
    }

    this.sql.exec('UPDATE folders SET name = ? WHERE id = ?', trimmedName, folderId);
    return { error: false };
  }

  removeFolder(folderId: string): Status {
    if (!this.folderExists(folderId)) {
      return { error: true, key: DB_ERROR_KEYS.FOLDER_NOT_FOUND };
    }

    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM files WHERE folder_id = ?', folderId);
      this.sql.exec('DELETE FROM folders WHERE id = ?', folderId);
    });
    return { error: false };
  }

  listFolders(): Status<FolderInfo[]> {
    return { error: false, data: this.readFolders().map(({ id, name }) => ({ id, name })) };
  }

  // ---- Files ----

  addFiles(folderId: string, files: FileItem[]): Status {
    if (files.length === 0) return { error: false };

    // Files can't end up in a folder that was removed in the meantime
    if (!this.folderExists(folderId)) {
      return { error: true, key: DB_ERROR_KEYS.FOLDER_NOT_FOUND };
    }

    this.ctx.storage.transactionSync(() => this.insertFiles(folderId, files));
    return { error: false };
  }

  removeFiles(folderId: string, fileIds: string[]): Status {
    if (fileIds.length === 0) return { error: false };

    // One statement per file instead of `IN (...)`: SQLite caps the number of bound parameters
    this.ctx.storage.transactionSync(() => {
      for (const fileId of fileIds) {
        this.sql.exec('DELETE FROM files WHERE folder_id = ? AND file_id = ?', folderId, fileId);
      }
    });
    return { error: false };
  }

  listFiles(folderId: string): Status<FileItem[]> {
    return { error: false, data: this.readFiles(folderId) };
  }

  getFolderContents(folderNumber: number): Status<FolderContents | null> {
    if (!Number.isInteger(folderNumber) || folderNumber < 1) return { error: false, data: null };

    const [folder] = this.sql
      .exec<Pick<FolderRow, 'id' | 'name'>>(
        'SELECT id, name FROM folders ORDER BY position LIMIT 1 OFFSET ?',
        folderNumber - 1,
      )
      .toArray();
    if (!folder) return { error: false, data: null };

    return { error: false, data: { folder: { id: folder.id, name: folder.name }, files: this.readFiles(folder.id) } };
  }

  // ---- Teardown ----

  clearUserData(): Status {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM files');
      this.sql.exec('DELETE FROM folders');
    });
    return { error: false };
  }

  // ---- Helpers ----

  private readFolders(): FolderRow[] {
    return this.sql.exec<FolderRow>('SELECT id, name, position FROM folders ORDER BY position').toArray();
  }

  private folderExists(folderId: string): boolean {
    return this.sql.exec('SELECT 1 FROM folders WHERE id = ?', folderId).toArray().length > 0;
  }

  private readFiles(folderId: string): FileItem[] {
    return this.sql
      .exec<FileRow>('SELECT file_id, name, type FROM files WHERE folder_id = ? ORDER BY position', folderId)
      .toArray()
      .map(toFileItem);
  }

  /** Appends files to a folder, skipping ones it already has (also repeats within `files`) */
  private insertFiles(folderId: string, files: FileItem[]): void {
    let position = this.sql
      .exec<{ last: number }>('SELECT COALESCE(MAX(position), -1) AS last FROM files WHERE folder_id = ?', folderId)
      .one().last;
    for (const file of files) {
      this.sql.exec(
        'INSERT OR IGNORE INTO files (folder_id, file_id, position, name, type) VALUES (?, ?, ?, ?, ?)',
        folderId,
        file.id,
        ++position,
        file.name,
        file.type,
      );
    }
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

  clearUserData(userId: UserId): Promise<Status> {
    return this.call('clearUserData', DB_ERROR_KEYS.DB_CLEAR_DATA, { userId }, () =>
      this.vault(userId).clearUserData(),
    );
  }
}
