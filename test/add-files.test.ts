import { describe, expect, it } from 'vitest';

import { MAX_FILES_PER_FOLDER, type FileItem } from 'src/types';

import { createTestBot, photo } from './helpers';

const setup = async () => {
  const bot = createTestBot();
  const workId = await bot.addFolder('Work');
  await bot.send('/add_files');
  await bot.press(`af:select:${workId}`);

  const pendingIds = () => {
    const flow = bot.flow();
    return flow?.kind === 'add-files' ? flow.files.map((f) => f.id) : [];
  };
  const savedIds = async () => {
    const res = await bot.db.listFiles(bot.userId, workId);
    return res.error ? [] : res.data.map((f) => f.id);
  };
  return { ...bot, workId, pendingIds, savedIds };
};

describe('/add_files', () => {
  it('collects files and saves them', async () => {
    const bot = await setup();
    await bot.send(photo('p1'));
    await bot.send({ document: { file_id: 'd1', file_unique_id: 'd1', file_name: 'cv.pdf' } });
    expect(bot.pendingIds()).toEqual(['p1', 'd1']);
    expect(bot.lastText()).toContain('<b>2</b> files ready');

    await bot.press('af:save');
    expect(await bot.savedIds()).toEqual(['p1', 'd1']);
    expect(bot.lastText()).toBe('✅ Successfully saved 2 files to <b>Work</b>.');
    expect(bot.flow()).toBeNull();
  });

  it('rejects album items and warns once per album', async () => {
    const bot = await setup();
    await bot.send(photo('p1', 'g1'));
    await bot.send(photo('p2', 'g1'));
    await bot.send(photo('p3', 'g1'));

    expect(bot.pendingIds()).toEqual([]);
    const warning = "⚠️ Albums aren't supported yet. Please send files one by one.";
    const warnings = () => bot.calls.filter((c) => c.payload.text === warning);
    expect(warnings()).toHaveLength(1);

    await bot.send(photo('p4', 'g2'));
    expect(warnings()).toHaveLength(2);
  });

  it('ignores files sent before a folder is picked', async () => {
    const bot = createTestBot();
    await bot.addFolder('Work');
    await bot.send('/add_files');
    await bot.send(photo('p1'));
    const flow = bot.flow();
    expect(flow?.kind === 'add-files' && flow.files).toEqual([]);
  });

  it('deletes the status message when cancelled from it', async () => {
    const bot = await setup();
    await bot.send(photo('p1'));
    await bot.press('af:cancel');
    expect(bot.calls.some((c) => c.method === 'deleteMessage')).toBe(true);
    expect(bot.lastText()).toBe('Action cancelled.');
    expect(await bot.savedIds()).toEqual([]);
  });
});

describe('/add_files: file limit', () => {
  const photos = (n: number): FileItem[] =>
    Array.from({ length: n }, (_, i) => ({ id: `saved${i}`, name: '', type: 'photo' }));

  it('does not accept a full folder', async () => {
    const bot = createTestBot();
    const workId = await bot.addFolder('Work');
    await bot.db.addFiles(bot.userId, workId, photos(MAX_FILES_PER_FOLDER));

    await bot.send('/add_files');
    await bot.press(`af:select:${workId}`);
    expect(bot.lastAlert()).toBe(
      `This folder is full: it already has ${MAX_FILES_PER_FOLDER} files. Choose another folder or remove some files first.`,
    );
    const flow = bot.flow();
    expect(flow?.kind === 'add-files' && flow.folder).toBeNull();
  });

  it('stops collecting once the folder would be full', async () => {
    const bot = createTestBot();
    const workId = await bot.addFolder('Work');
    await bot.db.addFiles(bot.userId, workId, photos(MAX_FILES_PER_FOLDER - 2));
    await bot.send('/add_files');
    await bot.press(`af:select:${workId}`);

    await bot.send(photo('p1'));
    await bot.send(photo('p1')); // A repeat takes no place
    await bot.send(photo('p2'));
    await bot.send(photo('p3'));
    expect(bot.lastText()).toContain("can't take more files");
    const flow = bot.flow();
    expect(flow?.kind === 'add-files' && flow.files.map((f) => f.id)).toEqual(['p1', 'p2']);

    await bot.press('af:save');
    const res = await bot.db.listFiles(bot.userId, workId);
    expect(!res.error && res.data).toHaveLength(MAX_FILES_PER_FOLDER);
  });
});
