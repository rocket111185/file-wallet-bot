export type StatusSuccess<T = void> = T extends void
  ? { error: false }
  : { error: false; data: T };

export const DB_ERROR_KEYS = {
  FOLDER_NAME_LENGTH: 'error-folder-name-length',
  FOLDER_ALREADY_EXISTS: 'error-folder-already-exists',
  FOLDER_NOT_FOUND: 'error-folder-not-found',
  DB_ADD_FOLDER: 'error-db-add-folder',
  DB_RENAME_FOLDER: 'error-db-rename-folder',
  DB_REMOVE_FOLDER: 'error-db-remove-folder',
  DB_LIST_FOLDERS: 'error-db-list-folders',
  DB_ADD_FILES: 'error-db-add-files',
  DB_REMOVE_FILES: 'error-db-remove-files',
  DB_LIST_FILES: 'error-db-list-files',
  DB_CLEAR_DATA: 'error-db-clear-data',
} as const;

export type DbErrorKey = (typeof DB_ERROR_KEYS)[keyof typeof DB_ERROR_KEYS];

export type StatusError = {
  error: true;
  key: string;
  params?: Record<string, string | number>;
  message?: string; // Optional English fallback / debug details
};

export type Status<T = void> = StatusSuccess<T> | StatusError;

// Global type declaration for ECMAScript Uint8Array toBase64 proposal supported natively by workerd and Node 22+
declare global {
  interface Uint8Array {
    toBase64(options?: {
      alphabet?: 'base64' | 'base64url';
      omitPadding?: boolean;
    }): string;
  }
}




export type TelegramFileType =
  | 'document'
  | 'photo'
  | 'audio'
  | 'video'
  | 'voice'
  | 'sticker'
  | 'animation';

export type FileItem = {
  id: string; // Telegram file_id
  name: string;
  type: TelegramFileType;
};

// Aliases for backwards compatibility
export type File = FileItem;
export type Folder = FileItem[];

export type FolderInfo = {
  id: string;
  name: string;
};

export type BotAction =
  | 'add-folder'
  | 'add-files'
  | 'remove-folder'
  | 'remove-files'
  | 'confirm-clear-data'
  | null;

export type UserSession = {
  language: string;
  action: BotAction;
  destinationFolderId: string | null;
  selectedFolderId: string | null;
  filesToRemove: string[]; // List of file IDs marked for deletion
  tmpFiles: FileItem[]; // Files uploaded in current session waiting to be saved
  currentPage?: number; // Current page index for file pagination
  pendingMessageId?: number; // Telegram message ID for active prompt/counter message
};

export const initialSession = (): UserSession => ({
  language: 'en',
  action: null,
  destinationFolderId: null,
  selectedFolderId: null,
  filesToRemove: [],
  tmpFiles: [],
  currentPage: 0,
});


