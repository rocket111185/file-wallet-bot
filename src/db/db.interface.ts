import type { FileItem, FolderInfo, Status } from 'src/types';

export interface Database {
  // Folder operations
  addFolder(userId: string | number, name: string): Promise<Status<{ id: string }>>;
  renameFolder?(userId: string | number, folderId: string, newName: string): Promise<Status>;
  removeFolder(userId: string | number, folderId: string): Promise<Status>;
  listFolders(userId: string | number): Promise<Status<FolderInfo[]>>;

  // File operations
  addFiles(userId: string | number, folderId: string, files: FileItem[]): Promise<Status>;
  removeFiles(userId: string | number, folderId: string, fileIds: string[]): Promise<Status>;
  listFiles(userId: string | number, folderId: string): Promise<Status<FileItem[]>>;

  // User teardown
  clearUserData(userId: string | number): Promise<Status>;
}
