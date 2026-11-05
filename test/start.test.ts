import { describe, expect, it } from 'vitest';

import { createTestBot } from './helpers';

describe('/start', () => {
  it("speaks the user's language, if it has a translation", async () => {
    const bot = createTestBot({ languageCode: 'uk-UA' });
    await bot.send('/start');

    expect(bot.lastText()).toContain('Вітаємо у File Wallet Bot!');
    expect(bot.lastText()).toContain('/copy_folder - Скопіювати папку з усіма файлами');
  });

  it('ends the current flow', async () => {
    const bot = createTestBot();
    await bot.send('/add_folder');
    await bot.send('/start');
    expect(bot.flow()).toBeNull();
    expect(bot.lastText()).toContain('Welcome to File Wallet Bot!');
  });
});

describe('/start help (the inline help button)', () => {
  it('sends the guide to a user who never talked to the bot before', async () => {
    // A fresh test bot is a new user: no session, empty vault, and this is their first message
    const bot = createTestBot();
    await bot.send('/start help');

    const text = String(bot.lastText());
    expect(text).toContain('How to use inline search');
    expect(text).toContain('@test_bot 2');
    expect(text).toContain('/add_folder'); // Explains how to get a first folder
    expect(bot.flow()).toBeNull();
  });

  it('keeps the current flow, unlike plain /start', async () => {
    const bot = createTestBot();
    await bot.send('/add_folder');
    await bot.send('/start help');
    expect(bot.flow()).toEqual({ kind: 'add-folder' });

    await bot.send('/start');
    expect(bot.flow()).toBeNull();
  });

  it('answers unknown payloads with the welcome', async () => {
    const bot = createTestBot();
    await bot.send('/start whatever');
    expect(bot.lastText()).toContain('Welcome to File Wallet Bot!');
  });

  it("speaks the user's language", async () => {
    const bot = createTestBot({ languageCode: 'uk' });
    await bot.send('/start help');
    expect(bot.lastText()).toContain('Як користуватися inline-пошуком');
  });
});
