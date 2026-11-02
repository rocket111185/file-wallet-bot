/**
 * SQLite schema of the UserVault Durable Object (src/db/db.cloudflare-do.ts): one database per user,
 * holding only their folders and files. The session lives in a different object (UserChat).
 *
 * Tables are WITHOUT ROWID, so the primary key is the table itself and no extra index has to be
 * maintained: every inserted or deleted row is billed as exactly one row written.
 *
 * Applied on every object start; `IF NOT EXISTS` makes that a no-op once the tables are there.
 */
export const USER_VAULT_SCHEMA = `
CREATE TABLE IF NOT EXISTS folders (
  id       TEXT    NOT NULL PRIMARY KEY,
  name     TEXT    NOT NULL,
  position INTEGER NOT NULL -- Display order; folder number in inline mode = rank by position
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS files (
  folder_id TEXT    NOT NULL,
  file_id   TEXT    NOT NULL, -- Telegram file_id
  position  INTEGER NOT NULL, -- Order within the folder (insertion order)
  name      TEXT    NOT NULL,
  type      TEXT    NOT NULL,
  PRIMARY KEY (folder_id, file_id) -- Also rejects the same file twice in one folder
) WITHOUT ROWID;
`;

/** Row shapes as returned by `sql.exec` */
export type FolderRow = { id: string; name: string; position: number };
export type FileRow = { file_id: string; name: string; type: string };
