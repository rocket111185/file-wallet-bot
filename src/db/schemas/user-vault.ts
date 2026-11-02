import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Drizzle schema of the UserVault Durable Object (src/db/db.cloudflare-do.ts): one SQLite database per
 * user, holding only their folders and files. The session lives in a different object (UserChat).
 *
 * After changing it, run `npm run db:generate` and commit the new migration under drizzle/user-vault;
 * every vault applies pending migrations itself when it starts. Migrations stay exactly as drizzle-kit
 * generates them: no hand edits.
 *
 * Both are ordinary rowid tables, not WITHOUT ROWID. That costs an extra row written per insert or
 * delete (SQLite keeps a separate index for a text or composite primary key), but file names (captions)
 * can be kilobytes long, and WITHOUT ROWID tables get bigger and slower to search with rows that large.
 */

export const folders = sqliteTable('folders', {
  id: text().notNull().primaryKey(),
  name: text().notNull(),
  /** Display order; folder number in inline mode = rank by position */
  position: integer().notNull(),
});

export const files = sqliteTable(
  'files',
  {
    folderId: text('folder_id').notNull(),
    /** Telegram file_id */
    fileId: text('file_id').notNull(),
    /** Order within the folder (insertion order) */
    position: integer().notNull(),
    name: text().notNull(),
    type: text().notNull(),
  },
  // Also rejects the same file twice in one folder
  (t) => [primaryKey({ columns: [t.folderId, t.fileId] })],
);

export type FolderRow = typeof folders.$inferSelect;
export type FileRow = typeof files.$inferSelect;
