import { describe, expect, it } from 'vitest';

import { CloudflareKVDatabase } from 'src/db/db.cloudflare';
import { DB_ERROR_KEYS, type FileItem } from 'src/types';
import { generateId } from 'src/utils';

const createMockKV = () => {
  const store = new Map<string, string>();

  return {
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (val === undefined) return null;
      if (type === 'json') return JSON.parse(val);
      return val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? '';
      const keys = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: '' };
    },
    _raw: store,
  } as unknown as KVNamespace;
};

describe('generateId', () => {
  it('generates URL-safe base64url IDs', () => {
    const id = generateId(9);
    expect(id).toHaveLength(12);
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);

    const elementAmount = 50;
    const set = new Set(Array.from({ length: elementAmount }, () => generateId(9)));
    expect(set.size).toBe(elementAmount);
  });
});

describe('CloudflareKVDatabase', () => {
  const userId = 123456789;

  it('adds and lists folders', async () => {
    const kv = createMockKV();
    const db = new CloudflareKVDatabase(kv);

    const addRes = await db.addFolder(userId, 'Documents');
    expect(addRes.error).toBe(false);
    if (!addRes.error) {
      expect(addRes.data.id).toBeDefined();
      expect(addRes.data.id).toHaveLength(12);
      expect(addRes.data.id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    }

    const listRes = await db.listFolders(userId);

    expect(listRes.error).toBe(false);
    if (!listRes.error) {
      expect(listRes.data).toHaveLength(1);
      expect(listRes.data[0].name).toBe('Documents');
    }
  });

  it('rejects duplicate folder names (case-insensitive)', async () => {
    const kv = createMockKV();
    const db = new CloudflareKVDatabase(kv);

    await db.addFolder(userId, 'Photos');
    const duplicateRes = await db.addFolder(userId, 'photos');

    expect(duplicateRes.error).toBe(true);
    if (duplicateRes.error) {
      expect(duplicateRes.key).toBe(DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS);
      expect(duplicateRes.params).toEqual({ name: 'photos' });
      expect(duplicateRes.message).toContain('already exists');
    }
  });

  it('rejects invalid folder names', async () => {
    const kv = createMockKV();
    const db = new CloudflareKVDatabase(kv);

    const emptyRes = await db.addFolder(userId, '   ');
    expect(emptyRes.error).toBe(true);
    if (emptyRes.error) {
      expect(emptyRes.key).toBe(DB_ERROR_KEYS.FOLDER_NAME_LENGTH);
    }

    const longRes = await db.addFolder(userId, 'a'.repeat(33));
    expect(longRes.error).toBe(true);
    if (longRes.error) {
      expect(longRes.key).toBe(DB_ERROR_KEYS.FOLDER_NAME_LENGTH);
    }
  });

  it('renames folders with conflict and validation checks', async () => {
    const kv = createMockKV();
    const db = new CloudflareKVDatabase(kv);

    const f1 = await db.addFolder(userId, 'Folder 1');
    await db.addFolder(userId, 'Folder 2');

    if (!f1.error) {
      // Name conflict
      const conflict = await db.renameFolder(userId, f1.data.id, 'Folder 2');
      expect(conflict.error).toBe(true);
      if (conflict.error) {
        expect(conflict.key).toBe(DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS);
        expect(conflict.params).toEqual({ name: 'Folder 2' });
      }

      // Non-existent folder
      const notFound = await db.renameFolder(userId, 'nonexistent', 'New Name');
      expect(notFound.error).toBe(true);
      if (notFound.error) {
        expect(notFound.key).toBe(DB_ERROR_KEYS.FOLDER_NOT_FOUND);
      }

      // Successful rename
      const ok = await db.renameFolder(userId, f1.data.id, 'Renamed Folder');
      expect(ok.error).toBe(false);

      const list = await db.listFolders(userId);
      if (!list.error) {
        expect(list.data.find((f) => f.id === f1.data.id)?.name).toBe('Renamed Folder');
      }
    }
  });

  it('removes folder and deletes associated files key', async () => {
    const kv = createMockKV();
    const db = new CloudflareKVDatabase(kv);

    const f1 = await db.addFolder(userId, 'Temp');
    if (!f1.error) {
      const folderId = f1.data.id;
      const file: FileItem = { id: 'file_1', name: 'test.pdf', type: 'document' };
      await db.addFiles(userId, folderId, [file]);

      // Remove folder
      const rem = await db.removeFolder(userId, folderId);
      expect(rem.error).toBe(false);

      // Verify folder list is empty
      const list = await db.listFolders(userId);
      if (!list.error) {
        expect(list.data).toHaveLength(0);
      }

      // Verify file list is empty
      const files = await db.listFiles(userId, folderId);
      if (!files.error) {
        expect(files.data).toHaveLength(0);
      }
    }
  });

  it('adds, dedupes, and removes files', async () => {
    const kv = createMockKV();
    const db = new CloudflareKVDatabase(kv);

    const f1 = await db.addFolder(userId, 'Files');
    if (!f1.error) {
      const folderId = f1.data.id;
      const files: FileItem[] = [
        { id: 'tg_1', name: 'photo1.jpg', type: 'photo' },
        { id: 'tg_2', name: 'song.mp3', type: 'audio' },
      ];

      await db.addFiles(userId, folderId, files);

      // Adding duplicate should not duplicate entries
      await db.addFiles(userId, folderId, [files[0]]);

      const list = await db.listFiles(userId, folderId);
      if (!list.error) {
        expect(list.data).toHaveLength(2);
      }

      // Remove one file
      await db.removeFiles(userId, folderId, ['tg_1']);

      const afterRemove = await db.listFiles(userId, folderId);
      if (!afterRemove.error) {
        expect(afterRemove.data).toHaveLength(1);
        expect(afterRemove.data[0].id).toBe('tg_2');
      }
    }
  });

  it('clears all user data completely', async () => {
    const kv = createMockKV();
    const db = new CloudflareKVDatabase(kv);

    const f1 = await db.addFolder(userId, 'Work');
    const f2 = await db.addFolder(userId, 'Personal');

    if (!f1.error && !f2.error) {
      await db.addFiles(userId, f1.data.id, [
        { id: 'w1', name: 'w1.doc', type: 'document' },
      ]);
      await db.addFiles(userId, f2.data.id, [
        { id: 'p1', name: 'p1.png', type: 'photo' },
      ]);

      const clearRes = await db.clearUserData(userId);
      expect(clearRes.error).toBe(false);

      const folders = await db.listFolders(userId);
      if (!folders.error) {
        expect(folders.data).toHaveLength(0);
      }

      const files1 = await db.listFiles(userId, f1.data.id);
      if (!files1.error) {
        expect(files1.data).toHaveLength(0);
      }
    }
  });
});
