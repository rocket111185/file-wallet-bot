import type { Database } from 'src/db/db.interface';
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
  type Status,
} from 'src/types';
import { generateId, sameName } from 'src/utils';

/** No plan storage here: every user gets the default plan's limits */
const FOLDER_LIMIT = PLAN_FOLDER_LIMITS[DEFAULT_PLAN];

export class CloudflareKVDatabase implements Database {
  constructor(private readonly kv: KVNamespace) {}

  private getFoldersKey(userId: string | number): string {
    return `folders:${userId}`;
  }

  private getFilesKey(userId: string | number, folderId: string): string {
    return `files:${userId}:${folderId}`;
  }

  /** Owner of a folder, so a share link (the folder ID) can be resolved: `share:${folderId}` → user ID */
  private getShareKey(folderId: string): string {
    return `share:${folderId}`;
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

  async addFolder(userId: string | number, name: string): Promise<Status<{ id: string }>> {
    return this.run('addFolder', DB_ERROR_KEYS.DB_ADD_FOLDER, { userId }, async () => {
      const trimmedName = name.trim();
      const invalid = validateFolderName(trimmedName);
      if (invalid) return invalid;

      const folders = await this.readFolders(userId);
      if (folders.some((folder) => sameName(folder.name, trimmedName))) {
        return { error: true, key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS, params: { name: trimmedName } };
      }

      const overLimit = checkFolderLimit(folders.length, FOLDER_LIMIT);
      if (overLimit) return overLimit;

      // Folder IDs are 12-char base64url strings from 9 random bytes (72 bits of entropy)
      const id = generateId(9);
      // The owner first, so a share link to the folder resolves as soon as the folder exists
      await this.kv.put(this.getShareKey(id), String(userId));
      await this.kv.put(this.getFoldersKey(userId), JSON.stringify([...folders, { id, name: trimmedName }]));

      return { error: false, data: { id } };
    });
  }

  async renameFolder(userId: string | number, folderId: string, newName: string): Promise<Status> {
    return this.run('renameFolder', DB_ERROR_KEYS.DB_RENAME_FOLDER, { userId, folderId }, async () => {
      const trimmedName = newName.trim();
      const invalid = validateFolderName(trimmedName);
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
      await this.kv.delete(this.getShareKey(folderId));

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

      const overLimit = checkFileLimit(currentFiles.length, newFiles.length);
      if (overLimit) return overLimit;
      if (newFiles.length === 0) return { error: false };

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

  async getFolderContents(userId: string | number, folderNumber: number): Promise<Status<FolderContents | null>> {
    return this.run('getFolderContents', DB_ERROR_KEYS.DB_LIST_FILES, { userId, folderNumber }, async () => {
      // Two reads one after the other: the files key needs the folder ID from the folder list
      const folder = (await this.readFolders(userId))[folderNumber - 1];
      if (!folder) return { error: false, data: null };
      return { error: false, data: { folder, files: await this.readFiles(userId, folder.id) } };
    });
  }

  async getSharedFolder(folderId: string): Promise<Status<FolderContents | null>> {
    return this.run('getSharedFolder', DB_ERROR_KEYS.DB_GET_SHARED_FOLDER, { folderId }, async () => {
      const ownerId = await this.kv.get(this.getShareKey(folderId));
      if (ownerId === null) return { error: false, data: null };

      const folder = (await this.readFolders(ownerId)).find((f) => f.id === folderId);
      if (!folder) return { error: false, data: null };
      return { error: false, data: { folder, files: await this.readFiles(ownerId, folder.id) } };
    });
  }

  async getFolderQuota(userId: string | number): Promise<Status<FolderQuota>> {
    return this.run('getFolderQuota', DB_ERROR_KEYS.DB_GET_QUOTA, { userId }, async () => ({
      error: false,
      data: { used: (await this.readFolders(userId)).length, max: FOLDER_LIMIT },
    }));
  }

  async clearUserData(userId: string | number): Promise<Status> {
    return this.run('clearUserData', DB_ERROR_KEYS.DB_CLEAR_DATA, { userId }, async () => {
      // 1. Delete every known folder's files and the folder list itself
      const folders = await this.readFolders(userId);
      await Promise.all([
        ...folders.map((f) => this.kv.delete(this.getFilesKey(userId, f.id))),
        ...folders.map((f) => this.kv.delete(this.getShareKey(f.id))),
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
