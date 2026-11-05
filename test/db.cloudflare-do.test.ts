import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
import { describe, expect, it, vi } from 'vitest';

import migrations from '../drizzle/user-vault/migrations';
import { CloudflareDODatabase, type UserVault } from 'src/db/db.cloudflare-do';
import { DurableObjectShareRegistry } from 'src/db/share-registry.durable-object';
import { DB_ERROR_KEYS, MAX_FILES_PER_FOLDER, type FileItem, type Status } from 'src/types';

// Real UserVault and FolderShare objects (remote bindings are off in vitest.config.mts)
const shares = new DurableObjectShareRegistry(env.FOLDER_SHARE);
const db = new CloudflareDODatabase(env.USER_VAULT, shares);

// Every test gets its own user, and so its own UserVault
let nextUserId = 1_000;
const newUser = () => ++nextUserId;

const file = (id: string, type: FileItem['type'] = 'photo'): FileItem => ({ id, name: `${id}.jpg`, type });

const ok = <T>(res: Status<T>): T => {
  if (res.error) throw new Error(`Expected success, got ${res.key}`);
  return (res as { data: T }).data;
};

const addFolder = async (userId: number, name: string) => ok(await db.addFolder(userId, name)).id;
const folderNames = async (userId: number) => ok(await db.listFolders(userId)).map((f) => f.name);
const fileIds = async (userId: number, folderId: string) => ok(await db.listFiles(userId, folderId)).map((f) => f.id);

describe('CloudflareDODatabase: folders', () => {
  it('adds folders and lists them in creation order', async () => {
    const user = newUser();
    const id = await addFolder(user, '  Work  ');
    await addFolder(user, 'Memes');

    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(await db.listFolders(user)).toEqual({
      error: false,
      data: [
        { id, name: 'Work' },
        { id: expect.any(String), name: 'Memes' },
      ],
    });
  });

  it('rejects duplicate (case-insensitive) and invalid names', async () => {
    const user = newUser();
    await addFolder(user, 'Work');

    expect(await db.addFolder(user, 'work')).toMatchObject({ error: true, key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS });
    expect(await db.addFolder(user, '   ')).toMatchObject({ error: true, key: DB_ERROR_KEYS.FOLDER_NAME_LENGTH });
    expect(await db.addFolder(user, 'x'.repeat(33))).toMatchObject({
      error: true,
      key: DB_ERROR_KEYS.FOLDER_NAME_LENGTH,
    });
    expect(await folderNames(user)).toEqual(['Work']);
  });

  it('renames a folder, keeping its place', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    await addFolder(user, 'Memes');

    expect(await db.renameFolder(user, work, 'memes')).toMatchObject({
      error: true,
      key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS,
    });
    expect(await db.renameFolder(user, 'nope', 'Job')).toMatchObject({
      error: true,
      key: DB_ERROR_KEYS.FOLDER_NOT_FOUND,
    });
    expect(await db.renameFolder(user, work, 'WORK')).toEqual({ error: false }); // Same folder: changing case is fine
    expect(await folderNames(user)).toEqual(['WORK', 'Memes']);
  });

  it('removes a folder together with its files', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    await db.addFiles(user, work, [file('a'), file('b')]);

    expect(await db.removeFolder(user, work)).toEqual({ error: false });
    expect(await db.removeFolder(user, work)).toMatchObject({ error: true, key: DB_ERROR_KEYS.FOLDER_NOT_FOUND });
    expect(await folderNames(user)).toEqual([]);
    expect(await fileIds(user, work)).toEqual([]);
  });

  it('keeps users apart', async () => {
    const alice = newUser();
    const bob = newUser();
    await addFolder(alice, 'Work');

    expect(await folderNames(bob)).toEqual([]);
  });
});

describe('CloudflareDODatabase: files', () => {
  it('appends files in order, skipping ones the folder already has', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');

    await db.addFiles(user, work, [file('a'), file('b'), file('a')]); // Repeat within the batch
    await db.addFiles(user, work, [file('b'), file('c', 'document')]); // Repeat of a saved file

    expect(await db.listFiles(user, work)).toEqual({
      error: false,
      data: [file('a'), file('b'), file('c', 'document')],
    });
  });

  it('refuses files for a folder that no longer exists', async () => {
    const user = newUser();
    expect(await db.addFiles(user, 'gone', [file('a')])).toMatchObject({
      error: true,
      key: DB_ERROR_KEYS.FOLDER_NOT_FOUND,
    });
  });

  it('removes only the given files from the given folder', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    const memes = await addFolder(user, 'Memes');
    await db.addFiles(user, work, [file('a'), file('b'), file('c')]);
    await db.addFiles(user, memes, [file('a')]);

    expect(await db.removeFiles(user, work, ['a', 'c', 'unknown'])).toEqual({ error: false });
    expect(await fileIds(user, work)).toEqual(['b']);
    expect(await fileIds(user, memes)).toEqual(['a']);
  });

  it('appends after the last remaining file when ones in the middle were removed', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    await db.addFiles(user, work, [file('s0'), file('s1'), file('s2'), file('s3')]);
    await db.removeFiles(user, work, ['s1', 's2']);

    // Positions left: 0 and 3. The next one is max + 1 = 4, not count = 2 (which would sort before s3)
    await db.addFiles(user, work, [file('new')]);
    expect(await fileIds(user, work)).toEqual(['s0', 's3', 'new']);
  });

  it('appends a folder after the last remaining one when ones in the middle were removed', async () => {
    const user = newUser();
    const ids = [await addFolder(user, 'F0'), await addFolder(user, 'F1'), await addFolder(user, 'F2')];
    await addFolder(user, 'F3');
    await db.removeFolder(user, ids[1]);
    await db.removeFolder(user, ids[2]);

    await addFolder(user, 'New');
    expect(await folderNames(user)).toEqual(['F0', 'F3', 'New']);
    expect(ok(await db.getFolderContents(user, 3))?.folder.name).toBe('New');
  });

  it('handles a full folder: 45 files', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    const files = Array.from({ length: 45 }, (_, i) => file(`f${i}`));
    await db.addFiles(user, work, files);

    expect(await fileIds(user, work)).toEqual(files.map((f) => f.id));
  });

  // Writes go in batches of 10 rows or IDs, to stay under the 100 bound parameters a statement may
  // have. These cross batch boundaries; the 45-file ones also fail if a batch outgrows the limit.

  it('skips a repeat that lands in a later insert batch than the original', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    const files = Array.from({ length: 25 }, (_, i) => file(`f${i}`));
    await db.addFiles(user, work, [...files, file('f0'), file('f24'), file('new')]);

    expect(await fileIds(user, work)).toEqual([...files.map((f) => f.id), 'new']);
  });

  it('removes more files than fit in one delete statement', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    const files = Array.from({ length: 45 }, (_, i) => file(`f${i}`));
    await db.addFiles(user, work, files);

    // 151 IDs (23 saved, 128 unknown) in 16 delete batches, saved ones among them
    const unknown = Array.from({ length: 128 }, (_, i) => `unknown${i}`);
    const removed = files.filter((_, i) => i % 2 === 0).map((f) => f.id);
    expect(await db.removeFiles(user, work, [...unknown.slice(0, 90), ...removed, ...unknown.slice(90)])).toEqual({
      error: false,
    });

    expect(await fileIds(user, work)).toEqual(files.filter((_, i) => i % 2 === 1).map((f) => f.id));
  });
});

describe('CloudflareDODatabase: getFolderContents (inline mode)', () => {
  it('finds a folder by its 1-based number, with its files', async () => {
    const user = newUser();
    await addFolder(user, 'Work');
    const memes = await addFolder(user, 'Memes');
    await db.addFiles(user, memes, [file('m1')]);

    expect(await db.getFolderContents(user, 2)).toEqual({
      error: false,
      data: { folder: { id: memes, name: 'Memes' }, files: [file('m1')] },
    });
  });

  it('returns null for numbers without a folder', async () => {
    const user = newUser();
    await addFolder(user, 'Work');

    for (const n of [0, 2, -1, 1.5]) {
      expect(await db.getFolderContents(user, n)).toEqual({ error: false, data: null });
    }
  });

  it('renumbers folders after one is removed, like listFolders', async () => {
    const user = newUser();
    const first = await addFolder(user, 'First');
    await addFolder(user, 'Second');
    await db.removeFolder(user, first);

    expect(ok(await db.getFolderContents(user, 1))?.folder.name).toBe('Second');
  });
});

describe('CloudflareDODatabase: concurrency', () => {
  it('lets only one of two concurrent adds with the same name through', async () => {
    const user = newUser();
    const results = await Promise.all([db.addFolder(user, 'Work'), db.addFolder(user, 'work')]);

    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error)).toMatchObject([{ key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS }]);
    expect(await folderNames(user)).toHaveLength(1);
  });

  it('keeps every file of concurrent batches, each at its own position', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    await Promise.all([
      db.addFiles(user, work, [file('a1'), file('a2')]),
      db.addFiles(user, work, [file('b1'), file('b2')]),
    ]);

    expect((await fileIds(user, work)).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
  });
});

const vault = (userId: number) => env.USER_VAULT.getByName(String(userId));
const files = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => file(`${prefix}${i}`));

describe('CloudflareDODatabase: limits', () => {
  const addFolders = async (user: number, n: number) => {
    for (let i = 0; i < n; i++) await addFolder(user, `Folder ${i}`);
  };

  it('allows 10 folders on the free plan', async () => {
    const user = newUser();
    expect(await db.getFolderQuota(user)).toEqual({ error: false, data: { used: 0, max: 10 } });

    await addFolders(user, 10);
    expect(await db.addFolder(user, 'One more')).toEqual({
      error: true,
      key: DB_ERROR_KEYS.FOLDER_LIMIT_REACHED,
      params: { max: 10 },
    });
    expect(await folderNames(user)).toHaveLength(10);
    expect(await db.getFolderQuota(user)).toEqual({ error: false, data: { used: 10, max: 10 } });
  });

  it('frees a place when a folder is removed', async () => {
    const user = newUser();
    await addFolders(user, 10);
    const [first] = ok(await db.listFolders(user));
    await db.removeFolder(user, first.id);
    expect((await db.addFolder(user, 'One more')).error).toBe(false);
  });

  it('allows more folders on a paid plan, and keeps the plan when data is cleared', async () => {
    const user = newUser();
    await vault(user).setPlan('plus');
    await addFolders(user, 20);
    expect(await db.addFolder(user, 'One more')).toMatchObject({ params: { max: 20 } });

    await db.clearUserData(user);
    expect(await db.getFolderQuota(user)).toEqual({ error: false, data: { used: 0, max: 20 } });

    await vault(user).setPlan('pro');
    expect(await db.getFolderQuota(user)).toEqual({ error: false, data: { used: 0, max: 50 } });
  });

  it(`allows ${MAX_FILES_PER_FOLDER} files per folder`, async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    expect(await db.addFiles(user, work, files('a', MAX_FILES_PER_FOLDER - 1))).toEqual({ error: false });
    expect(await db.addFiles(user, work, [file('last')])).toEqual({ error: false });

    expect(await db.addFiles(user, work, [file('extra')])).toEqual({
      error: true,
      key: DB_ERROR_KEYS.FILE_LIMIT_REACHED,
      params: { max: MAX_FILES_PER_FOLDER, remaining: 0 },
    });
    expect(await fileIds(user, work)).toHaveLength(MAX_FILES_PER_FOLDER);
  });

  it('saves nothing from a batch that would go over the limit', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    await db.addFiles(user, work, files('a', MAX_FILES_PER_FOLDER - 3));

    expect(await db.addFiles(user, work, files('b', 4))).toMatchObject({ params: { remaining: 3 } });
    expect(await fileIds(user, work)).toHaveLength(MAX_FILES_PER_FOLDER - 3);
  });

  it('does not count repeats against the limit', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    await db.addFiles(user, work, files('a', MAX_FILES_PER_FOLDER - 1));

    // One new file, plus repeats of saved ones and of itself
    const batch = [file('a0'), file('new'), file('a1'), file('new')];
    expect(await db.addFiles(user, work, batch)).toEqual({ error: false });
    expect(await fileIds(user, work)).toHaveLength(MAX_FILES_PER_FOLDER);

    // A full folder still accepts repeats, as a no-op
    expect(await db.addFiles(user, work, [file('new')])).toEqual({ error: false });
  });
});

describe('UserVault: migrations', () => {
  it('creates every table and records every applied migration', async () => {
    await runInDurableObject(vault(newUser()), (_instance: UserVault, state) => {
      const tables = state.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('folders', 'files', 'account')",
        )
        .toArray();
      expect(tables.map((t) => t.name).sort()).toEqual(['account', 'files', 'folders']);

      const applied = state.storage.sql.exec<{ name: string }>('SELECT name FROM __drizzle_migrations').toArray();
      expect(applied.map((m) => m.name)).toEqual(Object.keys(migrations.migrations).sort());
    });
  });

  it('skips already applied migrations when a vault starts again, keeping its data', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    await db.addFiles(user, work, [file('a')]);

    // What the constructor does on every start: with nothing pending it must not touch the tables
    await runInDurableObject(vault(user), (_instance: UserVault, state) => {
      expect(() => migrate(drizzle(state.storage), migrations)).not.toThrow();
    });

    expect(await folderNames(user)).toEqual(['Work']);
    expect(await fileIds(user, work)).toEqual(['a']);
  });
});

describe('CloudflareDODatabase: shared folders', () => {
  it('registers every new folder to its owner', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');

    expect(await shares.owner(work)).toBe(String(user));
  });

  it("opens another user's folder by its ID, with its files", async () => {
    const owner = newUser();
    const work = await addFolder(owner, 'Work');
    await db.addFiles(owner, work, [file('a'), file('b', 'document')]);

    expect(await db.getSharedFolder(work)).toEqual({
      error: false,
      data: { folder: { id: work, name: 'Work' }, files: [file('a'), file('b', 'document')] },
    });
  });

  it('returns null for an ID that was never a folder', async () => {
    expect(await db.getSharedFolder('nonexistent1')).toEqual({ error: false, data: null });
  });

  it('forgets a removed folder', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    await db.removeFolder(user, work);

    expect(await db.getSharedFolder(work)).toEqual({ error: false, data: null });
    expect(await shares.owner(work)).toBeNull();
  });

  it('forgets every folder when the data is cleared', async () => {
    const user = newUser();
    const ids = [await addFolder(user, 'Work'), await addFolder(user, 'Memes')];
    await db.clearUserData(user);

    for (const id of ids) {
      expect(await db.getSharedFolder(id)).toEqual({ error: false, data: null });
      expect(await shares.owner(id)).toBeNull();
    }
  });

  it("returns null when the owner's vault no longer has the folder, even if the entry was left behind", async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    // A removal whose unregister failed: the entry stays, the folder is gone
    await runInDurableObject(vault(user), (_instance: UserVault, state) => {
      state.storage.sql.exec('DELETE FROM folders WHERE id = ?', work);
    });

    expect(await shares.owner(work)).toBe(String(user));
    expect(await db.getSharedFolder(work)).toEqual({ error: false, data: null });
  });

  it('skips a folder ID that another user already owns', async () => {
    const user = newUser();
    // The first ID the vault generates comes from these bytes; another user owns it already
    const fixed = new Uint8Array(9).fill(7);
    const taken = fixed.toBase64({ alphabet: 'base64url', omitPadding: true });
    expect(await shares.register(taken, 'someone-else')).toBe(true);

    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce((array) => {
      (array as Uint8Array).set(fixed);
      return array;
    });
    try {
      const work = await addFolder(user, 'Work');
      // The vault really got the taken ID first (it runs in this isolate), then picked another one
      expect(spy).toHaveBeenCalledTimes(2);
      expect(work).not.toBe(taken);
      expect(await shares.owner(work)).toBe(String(user));
      expect(await shares.owner(taken)).toBe('someone-else');
    } finally {
      spy.mockRestore();
    }
  });

  it('registers folders from before sharing once, when the vault starts', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');

    // As a vault from before sharing: no entry, no flag
    await shares.unregister(work, String(user));
    await runInDurableObject(vault(user), async (instance: UserVault, state) => {
      state.storage.kv.delete('shares-registered');
      await (instance as unknown as { registerExistingFolders(): Promise<void> }).registerExistingFolders();
      expect(state.storage.kv.get('shares-registered')).toBe(true);
    });
    expect(await shares.owner(work)).toBe(String(user));

    // With the flag set, it doesn't run again
    await shares.unregister(work, String(user));
    await runInDurableObject(vault(user), async (instance: UserVault) => {
      await (instance as unknown as { registerExistingFolders(): Promise<void> }).registerExistingFolders();
    });
    expect(await shares.owner(work)).toBeNull();
  });
});

describe('DurableObjectShareRegistry', () => {
  const newFolderId = () => `test-${Math.random()}`;

  it('keeps the first owner: the same owner may register again, another one may not', async () => {
    const id = newFolderId();
    expect(await shares.register(id, '1')).toBe(true);
    expect(await shares.register(id, '1')).toBe(true);
    expect(await shares.register(id, '2')).toBe(false);
    expect(await shares.owner(id)).toBe('1');
  });

  it('can only be unregistered by the owner', async () => {
    const id = newFolderId();
    await shares.register(id, '1');

    await shares.unregister(id, '2');
    expect(await shares.owner(id)).toBe('1');

    await shares.unregister(id, '1');
    expect(await shares.owner(id)).toBeNull();
  });

  it('knows no owner for an unregistered ID', async () => {
    expect(await shares.owner(newFolderId())).toBeNull();
  });
});
