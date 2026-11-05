import type { StorageAdapter } from 'grammy';

import type { FileItem, FolderInfo } from 'src/types';

/**
 * The multi-step conversation the user is currently in. Each flow carries only the state it needs,
 * so starting or cancelling a flow is a single assignment and can't leave stale fields behind.
 *
 * A flow may keep a `statusMessageId`: a message that belongs to the flow and is deleted when it ends.
 */
export type Flow =
  | { kind: 'add-folder' }
  | {
      kind: 'add-files';
      folder: FolderInfo | null; // null until a folder is picked
      files: FileItem[]; // Received files waiting to be saved
      existingCount?: number; // Files the folder had when picked; missing in sessions from older versions
      statusMessageId?: number; // The "N files ready / Save" message, replaced on every new file
      rejectedGroupId?: string; // Last album warned about, so each album gets one warning
    }
  | {
      kind: 'rename-folder';
      folder: FolderInfo | null; // null until a folder is picked
    }
  | {
      kind: 'copy-folder';
      folder: FolderInfo | null; // Folder to copy; null until picked
    }
  | {
      kind: 'remove-folder';
      folder: FolderInfo | null; // null until a folder is picked
    }
  | {
      kind: 'remove-files';
      menuMessageId: number; // The folder picker, then the file list: buttons on any other message are stale
      folder: FolderInfo | null; // null until a folder is picked
      files: FileItem[]; // The folder's files when it was picked; buttons refer to them by position
      selected: string[]; // IDs of the files marked for removal
      page: number; // 0-based page of the file list
    }
  | {
      kind: 'import-folder';
      folderId: string; // The shared folder (another user's, or the user's own); its files are read when saving
      menuMessageId: number; // The preview with Save / Cancel: buttons on any other message are stale
      naming: boolean; // The user already has a folder with that name, so a new name is awaited as text
    }
  | { kind: 'clear-data' };

export type FlowKind = Flow['kind'];
export type FlowOf<K extends FlowKind> = Extract<Flow, { kind: K }>;

export type UserSession = {
  flow: Flow | null;
};

export const initialSession = (): UserSession => ({ flow: null });

/**
 * Where sessions are kept, keyed by chat ID. grammY's adapter interface is used as-is, so any of its
 * storages work too (e.g. `MemorySessionStorage` for tests or long polling).
 *
 * Sessions are only safe if a user's updates are handled one at a time: grammY reads the session
 * when an update starts and writes it back when it ends. On Cloudflare the user's Durable Object
 * takes care of that (see src/bot/user-chat.ts); elsewhere use grammY's `sequentialize`.
 */
export type SessionStorage = StorageAdapter<UserSession>;
