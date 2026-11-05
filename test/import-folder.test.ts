import { describe, expect, it } from 'vitest';

import type { FileItem } from 'src/types';
import { createTestBot } from './helpers';

const files: FileItem[] = [
  { id: 'cv', name: 'cv.pdf', type: 'document' },
  { id: 'pic', name: '', type: 'photo' },
];

/** Two users: `owner` has a folder "Work" with two files, `friend` opens its share link */
const setup = async () => {
  const owner = createTestBot();
  const friend = createTestBot();
  const workId = await owner.addFolder('Work');
  await owner.db.addFiles(owner.userId, workId, files);
  return { owner, friend, workId };
};

const fileIdsOf = async (bot: ReturnType<typeof createTestBot>, folderId: string) => {
  const res = await bot.db.listFiles(bot.userId, folderId);
  return res.error ? [] : res.data.map((f) => f.id);
};

describe('shared folders (/start s_<folderId>)', () => {
  it('previews the folder, then saves a copy to the user who opened the link', async () => {
    const { owner, friend, workId } = await setup();

    // A fresh test bot is a new user: this is their first message, with an empty vault
    await friend.send(`/start s_${workId}`);
    expect(friend.lastText()).toBe(
      '📁 <b>Work</b>\n\nThis folder was shared with you: 2 files. Save a copy to your folders?',
    );
    expect(friend.flow()).toMatchObject({ kind: 'import-folder', folderId: workId, naming: false });

    await friend.press('imf:save', friend.lastMessageId());
    expect(friend.lastText()).toBe(
      '✅ Saved <b>Work</b> with 2 files to your folders. Type <code>@test_bot</code> in any chat to use it.',
    );
    expect(friend.calls.at(-1)?.method).toBe('editMessageText'); // Replaces the preview
    expect(friend.flow()).toBeNull();

    const [copy] = await friend.folders();
    expect(copy.name).toBe('Work');
    expect(copy.id).not.toBe(workId);
    expect(await fileIdsOf(friend, copy.id)).toEqual(['cv', 'pic']);
    expect((await owner.folders()).map((f) => f.name)).toEqual(['Work']);
  });

  it('copies by value: later changes to the original do not reach the copy', async () => {
    const { owner, friend, workId } = await setup();
    await friend.send(`/start s_${workId}`);
    await friend.press('imf:save', friend.lastMessageId());

    await owner.db.addFiles(owner.userId, workId, [{ id: 'new', name: 'new.pdf', type: 'document' }]);
    await owner.db.removeFiles(owner.userId, workId, ['cv']);

    const [copy] = await friend.folders();
    expect(await fileIdsOf(friend, copy.id)).toEqual(['cv', 'pic']);
  });

  it('saves what the folder holds when Save is pressed, not when the preview was shown', async () => {
    const { owner, friend, workId } = await setup();
    await friend.send(`/start s_${workId}`);
    await owner.db.addFiles(owner.userId, workId, [{ id: 'new', name: 'new.pdf', type: 'document' }]);

    await friend.press('imf:save', friend.lastMessageId());
    const [copy] = await friend.folders();
    expect(await fileIdsOf(friend, copy.id)).toEqual(['cv', 'pic', 'new']);
  });

  it('asks for another name when the user already has a folder with that name', async () => {
    const { friend, workId } = await setup();
    await friend.addFolder('work');

    await friend.send(`/start s_${workId}`);
    await friend.press('imf:save', friend.lastMessageId());
    expect(friend.lastText()).toBe(
      'You already have a folder named <b>Work</b>. Send me a name for the copy (1–32 characters):',
    );
    expect(friend.flow()).toMatchObject({ kind: 'import-folder', naming: true });

    // A taken name keeps it waiting, like /copy_folder
    await friend.send('WORK');
    expect(friend.lastText()).toContain('already exists');
    expect(friend.flow()).toMatchObject({ kind: 'import-folder', naming: true });

    await friend.send({ sticker: { file_id: 's' } } as never);
    expect(friend.lastText()).toBe('⚠️ Please send a text message with the folder name.');

    await friend.send('Shared work');
    expect(friend.lastText()).toContain('✅ Saved <b>Shared work</b> with 2 files');
    expect(friend.flow()).toBeNull();
    expect((await friend.folders()).map((f) => f.name)).toEqual(['work', 'Shared work']);
  });

  it('lets the owner save a copy of their own folder, under a new name', async () => {
    const { owner, workId } = await setup();
    await owner.send(`/start s_${workId}`);
    await owner.press('imf:save', owner.lastMessageId());
    expect(owner.flow()).toMatchObject({ naming: true });

    await owner.send('Work copy');
    const folders = await owner.folders();
    expect(folders.map((f) => f.name)).toEqual(['Work', 'Work copy']);
    expect(await fileIdsOf(owner, folders[1].id)).toEqual(['cv', 'pic']);
  });

  it('ignores text while the preview is up', async () => {
    const { friend, workId } = await setup();
    await friend.send(`/start s_${workId}`);
    const sent = friend.calls.length;

    await friend.send('Some name');
    expect(friend.calls.length).toBe(sent);
    expect(await friend.folders()).toEqual([]);
  });

  it('tells the user when the link no longer works', async () => {
    const { owner, friend, workId } = await setup();
    await owner.db.removeFolder(owner.userId, workId);

    await friend.send(`/start s_${workId}`);
    expect(friend.lastText()).toBe('⚠️ This link no longer works: the folder was removed.');
    expect(friend.flow()).toBeNull();

    await friend.send('/start s_AAAAAAAAAAAA'); // Never a folder
    expect(friend.lastText()).toBe('⚠️ This link no longer works: the folder was removed.');
  });

  it('tells the user when the folder was removed after the preview', async () => {
    const { owner, friend, workId } = await setup();
    await friend.send(`/start s_${workId}`);
    await owner.db.removeFolder(owner.userId, workId);

    await friend.press('imf:save', friend.lastMessageId());
    expect(friend.lastText()).toBe('⚠️ This link no longer works: the folder was removed.');
    expect(friend.flow()).toBeNull();
    expect(await friend.folders()).toEqual([]);
  });

  it("doesn't show the preview to a user at their folder limit", async () => {
    const { friend, workId } = await setup();
    for (let i = 0; i < 10; i++) await friend.addFolder(`Folder ${i}`);

    await friend.send(`/start s_${workId}`);
    expect(friend.lastText()).toContain("You've reached the limit of 10 folders");
    expect(friend.flow()).toBeNull();
  });

  it('cancels', async () => {
    const { friend, workId } = await setup();
    await friend.send(`/start s_${workId}`);
    await friend.press('imf:cancel', friend.lastMessageId());

    expect(friend.lastText()).toBe('Action cancelled.');
    expect(friend.flow()).toBeNull();
    expect(await friend.folders()).toEqual([]);
  });

  it('expires the Save button of an older preview', async () => {
    const { friend, workId } = await setup();
    await friend.send(`/start s_${workId}`);
    const oldPreview = friend.lastMessageId();
    await friend.send(`/start s_${workId}`);

    await friend.press('imf:save', oldPreview);
    expect(friend.lastAlert()).toBe('This action has expired. Please start again.');
    expect(await friend.folders()).toEqual([]);
  });

  it('expires Save once another command took over', async () => {
    const { friend, workId } = await setup();
    await friend.send(`/start s_${workId}`);
    const preview = friend.lastMessageId();
    await friend.send('/add_folder');

    await friend.press('imf:save', preview);
    expect(friend.lastAlert()).toBe('This action has expired. Please start again.');
    expect(friend.flow()).toEqual({ kind: 'add-folder' });
  });

  it('treats a malformed share payload as plain /start', async () => {
    const bot = createTestBot();
    await bot.send('/start s_short');
    expect(bot.lastText()).toContain('Welcome to File Wallet Bot!');
  });

  it("speaks the user's language", async () => {
    const owner = createTestBot();
    const friend = createTestBot({ languageCode: 'uk' });
    const workId = await owner.addFolder('Робота');

    await friend.send(`/start s_${workId}`);
    expect(friend.lastText()).toBe(
      '📁 <b>Робота</b>\n\nЗ вами поділилися цією папкою: 0 файлів. Зберегти копію до ваших папок?',
    );
  });
});
