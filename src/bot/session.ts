import type { FileItem } from 'src/types';

/**
 * The multi-step conversation the user is currently in. Each flow carries only the state it needs,
 * so starting or cancelling a flow is a single assignment and can't leave stale fields behind.
 */
export type Flow =
  | { kind: 'add-folder' }
  | {
      kind: 'add-files';
      folder: { id: string; name: string } | null; // null until a folder is picked
      files: FileItem[]; // Received files waiting to be saved
      statusMessageId?: number; // The "N files ready / Save" message, replaced on every new file
    };

export type UserSession = {
  flow: Flow | null;
};

export const initialSession = (): UserSession => ({ flow: null });
