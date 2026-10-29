export const MAX_FOLDER_NAME_LENGTH = 32;

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

export type StatusSuccess<T = void> = T extends void ? { error: false } : { error: false; data: T };

export type StatusError = {
  error: true;
  key: DbErrorKey; // Translation key, rendered by the bot layer
  params?: Record<string, string | number>; // Translation variables (e.g. { name: 'Work' })
};

export type Status<T = void> = StatusSuccess<T> | StatusError;

export type TelegramFileType = 'document' | 'photo' | 'audio' | 'video' | 'voice' | 'sticker' | 'animation';

export type FileItem = {
  id: string; // Telegram file_id
  name: string; // User-facing name; empty when Telegram gave us nothing (a localized fallback is rendered instead)
  type: TelegramFileType;
};

export type FolderInfo = {
  id: string;
  name: string;
};
