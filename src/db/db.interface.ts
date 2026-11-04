import type { FileItem, FolderContents, FolderInfo, FolderQuota, Status } from 'src/types';

export interface Database {
  // Folder operations
  addFolder(userId: string | number, name: string): Promise<Status<{ id: string }>>;
  renameFolder(userId: string | number, folderId: string, newName: string): Promise<Status>;
  removeFolder(userId: string | number, folderId: string): Promise<Status>;
  listFolders(userId: string | number): Promise<Status<FolderInfo[]>>;

  // File operations
  addFiles(userId: string | number, folderId: string, files: FileItem[]): Promise<Status>;
  removeFiles(userId: string | number, folderId: string, fileIds: string[]): Promise<Status>;
  listFiles(userId: string | number, folderId: string): Promise<Status<FileItem[]>>;

  /**
   * The folder at 1-based position `folderNumber` in `listFolders` order, with its files: what inline
   * mode needs to open a folder by number, in one call. `null` when there is no such folder.
   */
  getFolderContents(userId: string | number, folderNumber: number): Promise<Status<FolderContents | null>>;

  /** Folders the user has and how many their plan allows */
  getFolderQuota(userId: string | number): Promise<Status<FolderQuota>>;

  // User teardown
  clearUserData(userId: string | number): Promise<Status>;
}
