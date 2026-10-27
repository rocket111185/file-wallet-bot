export type StatusSuccess<T = void> = T extends void
  ? { error: false }
  : { error: false; data: T };

export type StatusError = {
  error: true;
  message: string;
};

export type Status<T = void> = StatusSuccess<T> | StatusError;

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


