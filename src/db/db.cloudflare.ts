import type { Database } from 'src/db/db.interface';
import { DB_ERROR_KEYS, type FileItem, type FolderInfo, type Status } from 'src/types';
import { generateId } from 'src/utils';

export class CloudflareKVDatabase implements Database {
  constructor(private readonly kv: KVNamespace) {}

  private getFoldersKey(userId: string | number): string {
    return `folders:${userId}`;
  }

  private getFilesKey(userId: string | number, folderId: string): string {
    return `files:${userId}:${folderId}`;
  }

  private generateFolderId(): string {
    // Generate a compact 12-character URL-safe Base64URL ID from 9 random bytes (72 bits of entropy)
    return generateId(9);
  }

  async addFolder(userId: string | number, name: string): Promise<Status<{ id: string }>> {
    try {
      const trimmedName = name.trim();
      if (!trimmedName || trimmedName.length > 32) {
        return {
          error: true,
          key: DB_ERROR_KEYS.FOLDER_NAME_LENGTH,
          message: 'Folder name must be between 1 and 32 characters long.',
        };
      }

      const folders = (await this.kv.get<FolderInfo[]>(this.getFoldersKey(userId), 'json')) ?? [];

      const exists = folders.some(
        (folder) => folder.name.toLowerCase() === trimmedName.toLowerCase(),
      );
      if (exists) {
        return {
          error: true,
          key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS,
          params: { name: trimmedName },
          message: `A folder named '${trimmedName}' already exists.`,
        };
      }

      const id = this.generateFolderId();
      const updatedFolders: FolderInfo[] = [...folders, { id, name: trimmedName }];

      await this.kv.put(this.getFoldersKey(userId), JSON.stringify(updatedFolders));
      await this.kv.put(this.getFilesKey(userId, id), JSON.stringify([]));

      return { error: false, data: { id } };
    } catch (err) {
      return {
        error: true,
        key: DB_ERROR_KEYS.DB_ADD_FOLDER,
        message: err instanceof Error ? err.message : 'Failed to add folder.',
      };
    }
  }

  async renameFolder(userId: string | number, folderId: string, newName: string): Promise<Status> {
    try {
      const trimmedName = newName.trim();

      if (!trimmedName || trimmedName.length > 32) {
        return {
          error: true,
          key: DB_ERROR_KEYS.FOLDER_NAME_LENGTH,
          message: 'Folder name must be between 1 and 32 characters long.',
        };
      }

      const folders = (await this.kv.get<FolderInfo[]>(this.getFoldersKey(userId), 'json')) ?? [];
      const folderIndex = folders.findIndex((f) => f.id === folderId);

      if (folderIndex === -1) {
        return {
          error: true,
          key: DB_ERROR_KEYS.FOLDER_NOT_FOUND,
          message: 'Folder not found.',
        };
      }

      const nameConflict = folders.some(
        (f) => f.id !== folderId && f.name.toLowerCase() === trimmedName.toLowerCase(),
      );

      if (nameConflict) {
        return {
          error: true,
          key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS,
          params: { name: trimmedName },
          message: `A folder named '${trimmedName}' already exists.`,
        };
      }

      folders[folderIndex].name = trimmedName;
      await this.kv.put(this.getFoldersKey(userId), JSON.stringify(folders));

      return { error: false };
    } catch (err) {
      return {
        error: true,
        key: DB_ERROR_KEYS.DB_RENAME_FOLDER,
        message: err instanceof Error ? err.message : 'Failed to rename folder.',
      };
    }
  }

  async removeFolder(userId: string | number, folderId: string): Promise<Status> {
    try {
      const folders = (await this.kv.get<FolderInfo[]>(this.getFoldersKey(userId), 'json')) ?? [];
      const updatedFolders = folders.filter((f) => f.id !== folderId);

      await this.kv.put(this.getFoldersKey(userId), JSON.stringify(updatedFolders));
      await this.kv.delete(this.getFilesKey(userId, folderId));

      return { error: false };
    } catch (err) {
      return {
        error: true,
        key: DB_ERROR_KEYS.DB_REMOVE_FOLDER,
        message: err instanceof Error ? err.message : 'Failed to remove folder.',
      };
    }
  }

  async listFolders(userId: string | number): Promise<Status<FolderInfo[]>> {
    try {
      const folders = (await this.kv.get<FolderInfo[]>(this.getFoldersKey(userId), 'json')) ?? [];
      return { error: false, data: folders };
    } catch (err) {
      return {
        error: true,
        key: DB_ERROR_KEYS.DB_LIST_FOLDERS,
        message: err instanceof Error ? err.message : 'Failed to list folders.',
      };
    }
  }

  async addFiles(userId: string | number, folderId: string, files: FileItem[]): Promise<Status> {
    try {
      if (files.length === 0) {
        return { error: false };
      }

      const currentFiles =
        (await this.kv.get<FileItem[]>(this.getFilesKey(userId, folderId), 'json')) ?? [];

      const existingIds = new Set(currentFiles.map((file) => file.id));
      const newFiles = files.filter((file) => !existingIds.has(file.id));

      const updatedFiles: FileItem[] = [...currentFiles, ...newFiles];
      await this.kv.put(this.getFilesKey(userId, folderId), JSON.stringify(updatedFiles));

      return { error: false };
    } catch (err) {
      return {
        error: true,
        key: DB_ERROR_KEYS.DB_ADD_FILES,
        message: err instanceof Error ? err.message : 'Failed to add files.',
      };
    }
  }

  async removeFiles(userId: string | number, folderId: string, fileIds: string[]): Promise<Status> {
    try {
      if (fileIds.length === 0) {
        return { error: false };
      }

      const currentFiles =
        (await this.kv.get<FileItem[]>(this.getFilesKey(userId, folderId), 'json')) ?? [];

      const idsToRemove = new Set(fileIds);
      const updatedFiles = currentFiles.filter((file) => !idsToRemove.has(file.id));

      await this.kv.put(this.getFilesKey(userId, folderId), JSON.stringify(updatedFiles));

      return { error: false };
    } catch (err) {
      return {
        error: true,
        key: DB_ERROR_KEYS.DB_REMOVE_FILES,
        message: err instanceof Error ? err.message : 'Failed to remove files.',
      };
    }
  }

  async listFiles(userId: string | number, folderId: string): Promise<Status<FileItem[]>> {
    try {
      const files =
        (await this.kv.get<FileItem[]>(this.getFilesKey(userId, folderId), 'json')) ?? [];
      return { error: false, data: files };
    } catch (err) {
      return {
        error: true,
        key: DB_ERROR_KEYS.DB_LIST_FILES,
        message: err instanceof Error ? err.message : 'Failed to list files.',
      };
    }
  }

  async clearUserData(userId: string | number): Promise<Status> {
    try {
      // 1. Fetch folders to delete their file collections
      const folders = (await this.kv.get<FolderInfo[]>(this.getFoldersKey(userId), 'json')) ?? [];
      const fileDeletePromises = folders.map((f) =>
        this.kv.delete(this.getFilesKey(userId, f.id)),
      );

      // 2. Delete all folder file entries and the main folders list
      await Promise.all([
        ...fileDeletePromises,
        this.kv.delete(this.getFoldersKey(userId)),
      ]);

      // 3. Fallback sweep: delete any remaining/orphaned keys under files:{userId}:
      const prefix = `files:${userId}:`;
      const listed = await this.kv.list({ prefix });
      if (listed.keys.length > 0) {
        await Promise.all(listed.keys.map((k) => this.kv.delete(k.name)));
      }

      return { error: false };
    } catch (err) {
      return {
        error: true,
        key: DB_ERROR_KEYS.DB_CLEAR_DATA,
        message: err instanceof Error ? err.message : 'Failed to clear user data.',
      };
    }
  }
}
