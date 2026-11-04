import { describe, expect, it } from 'vitest';

import { createTestBot } from './helpers';

const setup = async () => {
  const bot = createTestBot();
  const workId = await bot.addFolder('Work');
  const homeId = await bot.addFolder('Home');
  await bot.db.addFiles(bot.userId, workId, [
    { id: 'a', name: 'a.pdf', type: 'document' },
    { id: 'b', name: 'b.pdf', type: 'document' },
  ]);
  return { ...bot, workId, homeId };
};

const names = async (bot: { folders: () => Promise<{ name: string }[]> }) => (await bot.folders()).map((f) => f.name);

describe('/add_folder', () => {
  it('creates a folder from the next text message', async () => {
    const bot = createTestBot();
    await bot.send('/add_folder');
    await bot.send('  Work  ');
    expect(bot.lastText()).toContain('Folder <b>Work</b> created');
    expect(await names(bot)).toEqual(['Work']);
    expect(bot.flow()).toBeNull();
  });

  it('asks for text when something else is sent', async () => {
    const bot = createTestBot();
    await bot.send('/add_folder');
    await bot.send({ sticker: { file_id: 's' } } as never);
    expect(bot.lastText()).toBe('⚠️ Please send a text message with the folder name.');
    expect(bot.flow()?.kind).toBe('add-folder');
  });

  it('lets another command take over instead of using it as a name', async () => {
    const bot = createTestBot();
    await bot.send('/add_folder');
    await bot.send('/clear_data');
    expect(await names(bot)).toEqual([]);
    expect(bot.flow()?.kind).toBe('clear-data');
  });

  it('ignores unknown commands', async () => {
    const bot = createTestBot();
    await bot.send('/add_folder');
    await bot.send('/typo');
    expect(await names(bot)).toEqual([]);
    expect(bot.flow()?.kind).toBe('add-folder');
  });
});

describe('/rename_folder', () => {
  it('renames the picked folder', async () => {
    const bot = await setup();
    await bot.send('/rename_folder');
    await bot.press(`rnf:select:${bot.workId}`);
    expect(bot.lastText()).toContain('new name for <b>Work</b>');

    await bot.send('Office');
    expect(bot.lastText()).toBe('✅ Folder <b>Work</b> renamed to <b>Office</b>.');
    expect(await names(bot)).toEqual(['Office', 'Home']);
  });

  it('keeps asking when the name is taken', async () => {
    const bot = await setup();
    await bot.send('/rename_folder');
    await bot.press(`rnf:select:${bot.workId}`);

    await bot.send('home');
    expect(bot.lastText()).toContain('already exists');

    await bot.send('Office');
    expect(await names(bot)).toEqual(['Office', 'Home']);
  });

  it('ignores text until a folder is picked', async () => {
    const bot = await setup();
    await bot.send('/rename_folder');
    await bot.send('Office');
    expect(await names(bot)).toEqual(['Work', 'Home']);
  });

  it('cancels', async () => {
    const bot = await setup();
    await bot.send('/rename_folder');
    await bot.press('rnf:cancel');
    expect(bot.lastText()).toBe('Action cancelled.');
    expect(bot.flow()).toBeNull();
  });

  it('warns when the user has no folders', async () => {
    const bot = createTestBot();
    await bot.send('/rename_folder');
    expect(bot.lastText()).toBe("⚠️ You don't have any folders to rename.");
    expect(bot.flow()).toBeNull();
  });
});

describe('/copy_folder', () => {
  it('copies all files of the picked folder into a new folder', async () => {
    const bot = await setup();
    await bot.send('/copy_folder');
    await bot.press(`cpf:select:${bot.workId}`);
    expect(bot.lastText()).toContain('copy of <b>Work</b>');

    await bot.send('Work 2');
    expect(bot.lastText()).toBe('✅ Copied 2 files from <b>Work</b> to the new folder <b>Work 2</b>.');
    expect(bot.flow()).toBeNull();

    const folders = await bot.folders();
    expect(folders.map((f) => f.name)).toEqual(['Work', 'Home', 'Work 2']);
    const copy = await bot.db.listFiles(bot.userId, folders[2].id);
    const original = await bot.db.listFiles(bot.userId, bot.workId);
    expect(copy).toEqual(original);
  });

  it('keeps asking when the name is taken', async () => {
    const bot = await setup();
    await bot.send('/copy_folder');
    await bot.press(`cpf:select:${bot.workId}`);

    await bot.send('home');
    expect(bot.lastText()).toContain('already exists');
    expect(bot.flow()?.kind).toBe('copy-folder');

    await bot.send('Office');
    expect(await names(bot)).toEqual(['Work', 'Home', 'Office']);
  });

  it('copies an empty folder', async () => {
    const bot = await setup();
    await bot.send('/copy_folder');
    await bot.press(`cpf:select:${bot.homeId}`);
    await bot.send('Home 2');
    expect(bot.lastText()).toBe('✅ Copied 0 files from <b>Home</b> to the new folder <b>Home 2</b>.');
  });

  it('cancels', async () => {
    const bot = await setup();
    await bot.send('/copy_folder');
    await bot.press('cpf:cancel');
    expect(bot.lastText()).toBe('Action cancelled.');
    expect(bot.flow()).toBeNull();
    expect(await names(bot)).toEqual(['Work', 'Home']);
  });

  it('warns when the user has no folders', async () => {
    const bot = createTestBot();
    await bot.send('/copy_folder');
    expect(bot.lastText()).toBe("⚠️ You don't have any folders to copy.");
  });
});

describe('/remove_folder', () => {
  it('asks for confirmation, then deletes the folder and its files', async () => {
    const bot = await setup();
    await bot.send('/remove_folder');
    await bot.press(`rmf:select:${bot.workId}`);
    expect(bot.lastText()).toContain('all 2 files');
    expect(await bot.folders()).toHaveLength(2);

    await bot.press('rmf:confirm');
    expect(bot.lastText()).toBe('✅ Folder <b>Work</b> and its files have been deleted.');
    expect(await names(bot)).toEqual(['Home']);
    expect(await bot.db.listFiles(bot.userId, bot.workId)).toEqual({ error: false, data: [] });
  });

  it('cancels without deleting', async () => {
    const bot = await setup();
    await bot.send('/remove_folder');
    await bot.press(`rmf:select:${bot.workId}`);
    await bot.press('rmf:cancel');
    expect(bot.lastText()).toBe('Folder deletion cancelled.');
    expect(await bot.folders()).toHaveLength(2);
  });

  it('expires the confirmation once another command starts', async () => {
    const bot = await setup();
    await bot.send('/remove_folder');
    await bot.press(`rmf:select:${bot.workId}`);
    await bot.send('/add_folder');

    await bot.press('rmf:confirm');
    expect(bot.lastAlert()).toBe('This action has expired. Please start again.');
    expect(await bot.folders()).toHaveLength(2);
  });

  it('leaves a newer flow alone when an old Cancel is pressed', async () => {
    const bot = await setup();
    await bot.send('/remove_folder');
    await bot.send('/add_folder');
    await bot.press('rmf:cancel');
    expect(bot.flow()?.kind).toBe('add-folder');
  });
});

describe('/clear_data', () => {
  it('deletes everything after confirmation', async () => {
    const bot = await setup();
    await bot.send('/clear_data');
    await bot.press('cd:confirm');
    expect(bot.lastText()).toBe('🧹 All your data has been completely and permanently erased.');
    expect(await bot.folders()).toEqual([]);
    expect(await bot.db.listFiles(bot.userId, bot.workId)).toEqual({ error: false, data: [] });
    expect(bot.flow()).toBeNull();
  });

  it('keeps the data when cancelled', async () => {
    const bot = await setup();
    await bot.send('/clear_data');
    await bot.press('cd:cancel');
    expect(bot.lastText()).toBe('Operation cancelled. Your data remains safe.');
    expect(await bot.folders()).toHaveLength(2);
  });
});

describe('folder limit', () => {
  const fill = async (bot: ReturnType<typeof createTestBot>) => {
    for (let i = 0; i < 10; i++) await bot.addFolder(`Folder ${i}`);
  };
  const limitText =
    "⚠️ You've reached the limit of 10 folders. Delete a folder with /remove_folder to create a new one.";

  it('/add_folder refuses to start at the limit', async () => {
    const bot = createTestBot();
    await fill(bot);
    await bot.send('/add_folder');
    expect(bot.lastText()).toBe(limitText);
    expect(bot.flow()).toBeNull();
  });

  it('/add_folder ends the flow if the limit is reached while asking for a name', async () => {
    const bot = createTestBot();
    await bot.send('/add_folder');
    await fill(bot);
    await bot.send('Late');
    expect(bot.lastText()).toBe(limitText);
    expect(bot.flow()).toBeNull();
    expect(await names(bot)).toHaveLength(10);
  });

  it('/copy_folder refuses to start at the limit', async () => {
    const bot = createTestBot();
    await fill(bot);
    await bot.send('/copy_folder');
    expect(bot.lastText()).toBe(limitText);
    expect(bot.flow()).toBeNull();
  });
});
