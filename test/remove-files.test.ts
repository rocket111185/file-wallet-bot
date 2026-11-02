import type { InlineKeyboardButton } from 'grammy/types';
import { describe, expect, it } from 'vitest';

import type { FileItem } from 'src/types';
import { createTestBot } from './helpers';

const doc = (id: string): FileItem => ({ id, name: `${id}.pdf`, type: 'document' });

/** `count` files f0, f1, ... in folder Work; /remove_files is sent and Work is picked */
const setup = async (count: number) => {
  const bot = createTestBot();
  const workId = await bot.addFolder('Work');
  await bot.db.addFiles(
    bot.userId,
    workId,
    Array.from({ length: count }, (_, i) => doc(`f${i}`)),
  );

  await bot.send('/remove_files');
  const menuId = bot.lastMessageId();
  await bot.press(`rf:select:${workId}`, menuId);

  /** Presses a button on the menu */
  const tap = (data: string) => bot.press(data, menuId);

  /** Buttons of the menu's current keyboard, row by row */
  const keyboard = () => {
    const markup = bot.calls.filter((c) => c.payload.reply_markup).at(-1)?.payload.reply_markup as {
      inline_keyboard: InlineKeyboardButton.CallbackButton[][];
    };
    return markup.inline_keyboard.map((row) => row.map((b) => [b.text, b.callback_data]));
  };

  const savedIds = async () => {
    const res = await bot.db.listFiles(bot.userId, workId);
    return res.error ? [] : res.data.map((f) => f.id);
  };

  return { ...bot, workId, menuId, tap, keyboard, savedIds };
};

describe('/remove_files', () => {
  it('removes the selected files', async () => {
    const bot = await setup(3);
    expect(bot.keyboard()).toEqual([
      [['f0.pdf', 'rf:t:0']],
      [['f1.pdf', 'rf:t:1']],
      [['f2.pdf', 'rf:t:2']],
      [
        ['🗑️ Delete Selected (0)', 'rf:del'],
        ['❌ Cancel', 'rf:cancel'],
      ],
    ]);

    await bot.tap('rf:t:0');
    await bot.tap('rf:t:2');
    expect(bot.calls.at(-1)?.method).toBe('editMessageReplyMarkup');
    expect(bot.keyboard().map((row) => row[0][0])).toEqual([
      '✅ f0.pdf',
      'f1.pdf',
      '✅ f2.pdf',
      '🗑️ Delete Selected (2)',
    ]);

    await bot.tap('rf:del');
    expect(bot.lastText()).toBe('✅ Removed 2 files from <b>Work</b>.');
    expect(await bot.savedIds()).toEqual(['f1']);
    expect(bot.flow()).toBeNull();
  });

  it('unselects a file tapped twice', async () => {
    const bot = await setup(2);
    await bot.tap('rf:t:1');
    await bot.tap('rf:t:1');
    await bot.tap('rf:del');
    expect(bot.lastAlert()).toBe('⚠️ Please select at least one file to delete.');
    expect(await bot.savedIds()).toEqual(['f0', 'f1']);
    expect(bot.flow()?.kind).toBe('remove-files');
  });

  it('pages through files 10 at a time, keeping the selection', async () => {
    const bot = await setup(23);
    expect(bot.lastText()).toContain('Page 1 of 3');
    expect(bot.keyboard()).toHaveLength(12); // 10 files, navigation, Delete/Cancel
    expect(bot.keyboard()[10]).toEqual([['Next ▶️', 'rf:p:1']]);

    await bot.tap('rf:t:3');
    await bot.tap('rf:p:2');
    expect(bot.lastText()).toContain('Page 3 of 3');
    expect(bot.keyboard().slice(0, 3).flat()).toEqual([
      ['f20.pdf', 'rf:t:20'],
      ['f21.pdf', 'rf:t:21'],
      ['f22.pdf', 'rf:t:22'],
    ]);
    expect(bot.keyboard()[3]).toEqual([['◀️ Previous', 'rf:p:1']]);

    await bot.tap('rf:t:22');
    await bot.tap('rf:del');
    expect(bot.lastText()).toBe('✅ Removed 2 files from <b>Work</b>.');
    expect(await bot.savedIds()).not.toContain('f3');
    expect(await bot.savedIds()).not.toContain('f22');
    expect(await bot.savedIds()).toHaveLength(21);
  });

  it("doesn't edit the menu when its own page is requested again", async () => {
    const bot = await setup(15);
    await bot.tap('rf:p:1');
    const edits = bot.calls.length;
    await bot.tap('rf:p:1');
    expect(bot.calls.slice(edits).map((c) => c.method)).toEqual(['answerCallbackQuery']);
  });

  // UserVault can't store a file twice in one folder, but old KV data may have duplicates
  it('shows each file once even if it was stored twice', async () => {
    const bot = createTestBot({ storage: 'kv' });
    const workId = await bot.addFolder('Work');
    bot.data.set(`files:${bot.userId}:${workId}`, JSON.stringify([doc('a'), doc('a'), doc('b')]));
    await bot.send('/remove_files');
    await bot.press(`rf:select:${workId}`, bot.lastMessageId());
    const flow = bot.flow();
    expect(flow?.kind === 'remove-files' && flow.files.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('warns when the folder is empty', async () => {
    const bot = await setup(0);
    expect(bot.lastText()).toBe('⚠️ Folder <b>Work</b> is empty. There are no files to remove.');
    expect(bot.flow()).toBeNull();
  });

  it('warns when the user has no folders', async () => {
    const bot = createTestBot();
    await bot.send('/remove_files');
    expect(bot.lastText()).toBe("⚠️ You don't have any folders.");
    expect(bot.flow()).toBeNull();
  });

  it('cancels without removing anything', async () => {
    const bot = await setup(2);
    await bot.tap('rf:t:0');
    await bot.tap('rf:cancel');
    expect(bot.lastText()).toBe('Action cancelled.');
    expect(await bot.savedIds()).toEqual(['f0', 'f1']);
    expect(bot.flow()).toBeNull();
  });

  it('ignores buttons left on an older menu', async () => {
    const bot = await setup(3);
    await bot.tap('rf:t:0');

    // A second /remove_files: the first menu's buttons must not act on the new flow
    await bot.send('/remove_files');
    const newMenuId = bot.lastMessageId();
    await bot.press(`rf:select:${bot.workId}`, newMenuId);

    await bot.tap('rf:t:1');
    expect(bot.lastAlert()).toBe('This action has expired. Please start again.');
    await bot.tap('rf:del');
    expect(bot.lastAlert()).toBe('This action has expired. Please start again.');
    await bot.tap('rf:cancel');
    expect(bot.flow()?.kind).toBe('remove-files');

    const flow = bot.flow();
    expect(flow?.kind === 'remove-files' && flow.selected).toEqual([]);
    expect(await bot.savedIds()).toEqual(['f0', 'f1', 'f2']);
  });

  it('expires once another command starts', async () => {
    const bot = await setup(2);
    await bot.tap('rf:t:0');
    await bot.send('/add_folder');
    await bot.tap('rf:del');
    expect(bot.lastAlert()).toBe('This action has expired. Please start again.');
    expect(await bot.savedIds()).toEqual(['f0', 'f1']);
    expect(bot.flow()?.kind).toBe('add-folder');
  });

  it('ignores positions outside the file list', async () => {
    const bot = await setup(2);
    const before = bot.calls.length;
    await bot.tap('rf:t:5');
    await bot.tap('rf:p:3');
    expect(bot.calls.slice(before).map((c) => c.method)).toEqual(['answerCallbackQuery', 'answerCallbackQuery']);
    const flow = bot.flow();
    expect(flow?.kind === 'remove-files' && [flow.selected, flow.page]).toEqual([[], 0]);
  });
});
