import type { Database } from 'src/db/db.interface';
import { logger } from 'src/logger';
import {
  DB_ERROR_KEYS,
  MAX_FOLDER_NAME_LENGTH,
  type DbErrorKey,
  type FileItem,
  type FolderInfo,
  type Status,
  type StatusError,
} from 'src/types';
import { generateId, graphemeLength, sameName } from 'src/utils';

export class CloudflareKVDatabase implements Database {
  constructor(private readonly kv: KVNamespace) {}

  private getFoldersKey(userId: string | number): string {
    return `folders:${userId}`;
  }

  private getFilesKey(userId: string | number, folderId: string): string {
    return `files:${userId}:${folderId}`;
  }

  private async readFolders(userId: string | number): Promise<FolderInfo[]> {
    return (await this.kv.get<FolderInfo[]>(this.getFoldersKey(userId), 'json')) ?? [];
  }

  private async readFiles(userId: string | number, folderId: string): Promise<FileItem[]> {
    return (await this.kv.get<FileItem[]>(this.getFilesKey(userId, folderId), 'json')) ?? [];
  }

  /**
   * Runs a storage operation, turning unexpected exceptions into a logged `StatusError`.
   * The details stay in the logs; callers only get a translation key.
   */
  private async run<T>(
    op: string,
    key: DbErrorKey,
    context: Record<string, unknown>,
    fn: () => Promise<Status<T>>,
  ): Promise<Status<T>> {
    try {
      return await fn();
    } catch (err) {
      logger.error(`db.${op}.failed`, { ...context, err });
      return { error: true, key };
    }
  }

  private validateFolderName(name: string): StatusError | null {
    const length = graphemeLength(name);
    if (length === 0 || length > MAX_FOLDER_NAME_LENGTH) {
      return { error: true, key: DB_ERROR_KEYS.FOLDER_NAME_LENGTH, params: { max: MAX_FOLDER_NAME_LENGTH } };
    }
    return null;
  }

  async addFolder(userId: string | number, name: string): Promise<Status<{ id: string }>> {
    return this.run('addFolder', DB_ERROR_KEYS.DB_ADD_FOLDER, { userId }, async () => {
      const trimmedName = name.trim();
      const invalid = this.validateFolderName(trimmedName);
      if (invalid) return invalid;

      const folders = await this.readFolders(userId);
      if (folders.some((folder) => sameName(folder.name, trimmedName))) {
        return { error: true, key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS, params: { name: trimmedName } };
      }

      // Folder IDs are 12-char base64url strings from 9 random bytes (72 bits of entropy)
      const id = generateId(9);
      await this.kv.put(this.getFoldersKey(userId), JSON.stringify([...folders, { id, name: trimmedName }]));

      return { error: false, data: { id } };
    });
  }

  async renameFolder(userId: string | number, folderId: string, newName: string): Promise<Status> {
    return this.run('renameFolder', DB_ERROR_KEYS.DB_RENAME_FOLDER, { userId, folderId }, async () => {
      const trimmedName = newName.trim();
      const invalid = this.validateFolderName(trimmedName);
      if (invalid) return invalid;

      const folders = await this.readFolders(userId);
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) {
        return { error: true, key: DB_ERROR_KEYS.FOLDER_NOT_FOUND };
      }

      if (folders.some((f) => f.id !== folderId && sameName(f.name, trimmedName))) {
        return { error: true, key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS, params: { name: trimmedName } };
      }

      folder.name = trimmedName;
      await this.kv.put(this.getFoldersKey(userId), JSON.stringify(folders));

      return { error: false };
    });
  }

  async removeFolder(userId: string | number, folderId: string): Promise<Status> {
    return this.run('removeFolder', DB_ERROR_KEYS.DB_REMOVE_FOLDER, { userId, folderId }, async () => {
      const folders = await this.readFolders(userId);
      const updatedFolders = folders.filter((f) => f.id !== folderId);
      if (updatedFolders.length === folders.length) {
        return { error: true, key: DB_ERROR_KEYS.FOLDER_NOT_FOUND };
      }

      await this.kv.put(this.getFoldersKey(userId), JSON.stringify(updatedFolders));
      await this.kv.delete(this.getFilesKey(userId, folderId));

      return { error: false };
    });
  }

  async listFolders(userId: string | number): Promise<Status<FolderInfo[]>> {
    return this.run('listFolders', DB_ERROR_KEYS.DB_LIST_FOLDERS, { userId }, async () => ({
      error: false,
      data: await this.readFolders(userId),
    }));
  }

  async addFiles(userId: string | number, folderId: string, files: FileItem[]): Promise<Status> {
    return this.run('addFiles', DB_ERROR_KEYS.DB_ADD_FILES, { userId, folderId, count: files.length }, async () => {
      if (files.length === 0) {
        return { error: false };
      }

      const currentFiles = await this.readFiles(userId, folderId);
      const existingIds = new Set(currentFiles.map((file) => file.id));
      // Also skips repeats within the batch itself (e.g. the same sticker sent twice in one session)
      const newFiles = files.filter((file) => {
        if (existingIds.has(file.id)) return false;
        existingIds.add(file.id);
        return true;
      });

      await this.kv.put(this.getFilesKey(userId, folderId), JSON.stringify([...currentFiles, ...newFiles]));

      return { error: false };
    });
  }

  async removeFiles(userId: string | number, folderId: string, fileIds: string[]): Promise<Status> {
    return this.run(
      'removeFiles',
      DB_ERROR_KEYS.DB_REMOVE_FILES,
      { userId, folderId, count: fileIds.length },
      async () => {
        if (fileIds.length === 0) {
          return { error: false };
        }

        const idsToRemove = new Set(fileIds);
        const currentFiles = await this.readFiles(userId, folderId);
        const updatedFiles = currentFiles.filter((file) => !idsToRemove.has(file.id));

        await this.kv.put(this.getFilesKey(userId, folderId), JSON.stringify(updatedFiles));

        return { error: false };
      },
    );
  }

  async listFiles(userId: string | number, folderId: string): Promise<Status<FileItem[]>> {
    return this.run('listFiles', DB_ERROR_KEYS.DB_LIST_FILES, { userId, folderId }, async () => ({
      error: false,
      data: await this.readFiles(userId, folderId),
    }));
  }

  async clearUserData(userId: string | number): Promise<Status> {
    return this.run('clearUserData', DB_ERROR_KEYS.DB_CLEAR_DATA, { userId }, async () => {
      // 1. Delete every known folder's files and the folder list itself
      const folders = await this.readFolders(userId);
      await Promise.all([
        ...folders.map((f) => this.kv.delete(this.getFilesKey(userId, f.id))),
        this.kv.delete(this.getFoldersKey(userId)),
      ]);

      // 2. Fallback sweep: delete any orphaned keys under files:{userId}:
      const prefix = `files:${userId}:`;
      let cursor: string | undefined;
      do {
        const listed = await this.kv.list({ prefix, cursor });
        await Promise.all(listed.keys.map((k) => this.kv.delete(k.name)));
        cursor = listed.list_complete ? undefined : listed.cursor;
      } while (cursor);

      return { error: false };
    });
  }
}
