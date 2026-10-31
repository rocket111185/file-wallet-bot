import type { StorageAdapter } from 'grammy';

import type { FileItem } from 'src/types';

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
      folder: { id: string; name: string } | null; // null until a folder is picked
      files: FileItem[]; // Received files waiting to be saved
      statusMessageId?: number; // The "N files ready / Save" message, replaced on every new file
      rejectedGroupId?: string; // Last album warned about, so each album gets one warning
    }
  | {
      kind: 'rename-folder';
      folder: { id: string; name: string } | null; // null until a folder is picked
    }
  | {
      kind: 'remove-folder';
      folder: { id: string; name: string } | null; // null until a folder is picked
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
