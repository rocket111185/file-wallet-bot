import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { CloudflareDODatabase } from 'src/db/db.cloudflare-do';
import { DB_ERROR_KEYS, type FileItem, type Status } from 'src/types';

// Real UserVault objects (remote bindings are off in vitest.config.mts)
const db = new CloudflareDODatabase(env.USER_VAULT);

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
    expect(await db.addFolder(user, 'x'.repeat(33))).toMatchObject({ error: true, key: DB_ERROR_KEYS.FOLDER_NAME_LENGTH });
    expect(await folderNames(user)).toEqual(['Work']);
  });

  it('renames a folder, keeping its place', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    await addFolder(user, 'Memes');

    expect(await db.renameFolder(user, work, 'memes')).toMatchObject({ error: true, key: DB_ERROR_KEYS.FOLDER_ALREADY_EXISTS });
    expect(await db.renameFolder(user, 'nope', 'Job')).toMatchObject({ error: true, key: DB_ERROR_KEYS.FOLDER_NOT_FOUND });
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

  it('handles a full folder: 45 files', async () => {
    const user = newUser();
    const work = await addFolder(user, 'Work');
    const files = Array.from({ length: 45 }, (_, i) => file(`f${i}`));
    await db.addFiles(user, work, files);

    expect(await fileIds(user, work)).toEqual(files.map((f) => f.id));
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
