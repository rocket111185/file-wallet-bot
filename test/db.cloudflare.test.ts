import { describe, expect, it, vi } from 'vitest';

import { CloudflareKVDatabase } from 'src/db/db.cloudflare';
import { DB_ERROR_KEYS, MAX_FILES_PER_FOLDER, type FileItem } from 'src/types';
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
    }
  });

  it('treats names that differ only in non-ASCII case as duplicates', async () => {
    const db = new CloudflareKVDatabase(createMockKV());

    await db.addFolder(userId, 'Фото');
    const duplicateRes = await db.addFolder(userId, 'фото');

    expect(duplicateRes.error).toBe(true);
  });

  it('counts emoji as single characters when validating name length', async () => {
    const db = new CloudflareKVDatabase(createMockKV());

    // 32 family emoji: 32 user-perceived characters, but far more UTF-16 code units
    const res = await db.addFolder(userId, '👨‍👩‍👧'.repeat(32));

    expect(res.error).toBe(false);
  });

  it('returns only a translation key and logs the details when storage fails', async () => {
    const kv = createMockKV();
    kv.get = (() => Promise.reject(new Error('KV is down'))) as KVNamespace['get'];
    const db = new CloudflareKVDatabase(kv);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await db.addFolder(userId, 'Docs');

    expect(res).toEqual({ error: true, key: DB_ERROR_KEYS.DB_ADD_FOLDER });
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'db.addFolder.failed',
        userId,
        error: expect.objectContaining({ message: 'KV is down' }),
      }),
    );
    consoleError.mockRestore();
  });

  it('reports a missing folder on removal', async () => {
    const db = new CloudflareKVDatabase(createMockKV());

    const res = await db.removeFolder(userId, 'nonexistent');

    expect(res).toEqual({ error: true, key: DB_ERROR_KEYS.FOLDER_NOT_FOUND });
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

  it('dedupes repeated files within a single batch', async () => {
    const kv = createMockKV();
    const db = new CloudflareKVDatabase(kv);

    const folder = await db.addFolder(userId, 'Stickers');
    expect(folder.error).toBe(false);
    if (folder.error) return;

    const heart: FileItem = { id: 'tg_heart', name: '❤️', type: 'sticker' };
    const rose: FileItem = { id: 'tg_rose', name: '🌹', type: 'sticker' };
    await db.addFiles(userId, folder.data.id, [heart, rose, heart]);

    const list = await db.listFiles(userId, folder.data.id);
    expect(list.error).toBe(false);
    if (!list.error) {
      expect(list.data.map((f) => f.id)).toEqual(['tg_heart', 'tg_rose']);
    }
  });

  it('clears all user data completely', async () => {
    const kv = createMockKV();
    const db = new CloudflareKVDatabase(kv);

    const f1 = await db.addFolder(userId, 'Work');
    const f2 = await db.addFolder(userId, 'Personal');

    if (!f1.error && !f2.error) {
      await db.addFiles(userId, f1.data.id, [{ id: 'w1', name: 'w1.doc', type: 'document' }]);
      await db.addFiles(userId, f2.data.id, [{ id: 'p1', name: 'p1.png', type: 'photo' }]);

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

describe('CloudflareKVDatabase: limits', () => {
  const userId = 42;
  const photos = (prefix: string, n: number): FileItem[] =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: '', type: 'photo' }));

  it('allows 10 folders', async () => {
    const db = new CloudflareKVDatabase(createMockKV());
    for (let i = 0; i < 10; i++) expect((await db.addFolder(userId, `F${i}`)).error).toBe(false);

    expect(await db.addFolder(userId, 'One more')).toEqual({
      error: true,
      key: DB_ERROR_KEYS.FOLDER_LIMIT_REACHED,
      params: { max: 10 },
    });
    expect(await db.getFolderQuota(userId)).toEqual({ error: false, data: { used: 10, max: 10 } });
  });

  it(`allows ${MAX_FILES_PER_FOLDER} files per folder, not counting repeats`, async () => {
    const db = new CloudflareKVDatabase(createMockKV());
    const add = await db.addFolder(userId, 'Work');
    if (add.error) throw new Error(add.key);
    const folderId = add.data.id;

    await db.addFiles(userId, folderId, photos('a', MAX_FILES_PER_FOLDER - 2));
    expect(await db.addFiles(userId, folderId, photos('b', 3))).toEqual({
      error: true,
      key: DB_ERROR_KEYS.FILE_LIMIT_REACHED,
      params: { max: MAX_FILES_PER_FOLDER, remaining: 2 },
    });
    expect(await db.addFiles(userId, folderId, [...photos('a', 5), ...photos('b', 2)])).toEqual({ error: false });

    const list = await db.listFiles(userId, folderId);
    expect(!list.error && list.data).toHaveLength(MAX_FILES_PER_FOLDER);
  });
});
