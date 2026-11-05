import { describe, expect, it } from 'vitest';

import { menuCommands } from 'src/bot/commands';
import { createTestBot } from './helpers';

const MENU = [
  'add_folder',
  'add_files',
  'remove_files',
  'rename_folder',
  'copy_folder',
  'remove_folder',
  'clear_data',
  'cancel',
];

describe('command menu', () => {
  it('has every menu command, in order, in every language, with descriptions Telegram accepts', () => {
    const { scopes, uncompliantCommands } = menuCommands.toArgs();

    expect(uncompliantCommands).toEqual([]);
    expect(scopes.map((s) => s.language_code)).toEqual([undefined, 'uk']);
    for (const { scope, commands } of scopes) {
      expect(scope).toEqual({ type: 'default' });
      expect(commands.map((c) => c.command)).toEqual(MENU);
      for (const { description } of commands) {
        expect(description.length).toBeGreaterThan(0);
        expect(description.length).toBeLessThanOrEqual(256);
      }
    }
    expect(scopes[1].commands[0].description).toBe('Створити нову папку');
  });

  it('/start lists the same commands', async () => {
    const bot = createTestBot();
    await bot.send('/start');

    const lines = String(bot.lastText())
      .split('\n')
      .filter((l) => l.startsWith('/'));
    expect(lines.map((l) => l.split(' ')[0])).toEqual(MENU.map((name) => `/${name}`));
    expect(lines[0]).toBe('/add_folder - Create a new folder');
  });

  it('menu commands still start their flows', async () => {
    const bot = createTestBot();
    await bot.send('/add_folder');
    expect(bot.flow()).toEqual({ kind: 'add-folder' });

    await bot.send('/cancel');
    expect(bot.flow()).toBeNull();
    expect(bot.lastText()).toBe('Action cancelled.');
  });
});
