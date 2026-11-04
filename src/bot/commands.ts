import { CommandGroup } from '@grammyjs/commands';
import { Composer } from 'grammy';
import type { LanguageCode } from 'grammy/types';

import type { BotContext } from 'src/bot/context';
import { startClearData } from 'src/bot/features/clear-data';
import { startAddFiles } from 'src/bot/features/files/add';
import { startRemoveFiles } from 'src/bot/features/files/remove';
import { startAddFolder } from 'src/bot/features/folders/add';
import { startCopyFolder } from 'src/bot/features/folders/copy';
import { startRemoveFolder } from 'src/bot/features/folders/remove';
import { startRenameFolder } from 'src/bot/features/folders/rename';
import { endFlow } from 'src/bot/flow';
import { createTranslator, DEFAULT_LOCALE, LOCALES, type PlainMessageKey } from 'src/i18n/i18n';

const handleCancel = async (ctx: BotContext): Promise<void> => {
  await endFlow(ctx);
  await ctx.reply(ctx.t('action-cancelled'));
};

/**
 * The commands users see, in menu order. This list is the only place they are defined: it
 * registers their handlers, fills Telegram's command menu (`setMyCommands`) and the /start list.
 *
 * /start is deliberately left out (see `commands` below).
 */
const MENU: { name: string; description: PlainMessageKey; handler: (ctx: BotContext) => Promise<void> }[] = [
  { name: 'add_folder', description: 'command-add-folder', handler: startAddFolder },
  { name: 'add_files', description: 'command-add-files', handler: startAddFiles },
  { name: 'remove_files', description: 'command-remove-files', handler: startRemoveFiles },
  { name: 'rename_folder', description: 'command-rename-folder', handler: startRenameFolder },
  { name: 'copy_folder', description: 'command-copy-folder', handler: startCopyFolder },
  { name: 'remove_folder', description: 'command-remove-folder', handler: startRemoveFolder },
  { name: 'clear_data', description: 'command-clear-data', handler: startClearData },
  { name: 'cancel', description: 'command-cancel', handler: handleCancel },
];

/**
 * The command menu. Telegram only shows it after `menuCommands.setCommands(...)`, which
 * scripts/set-commands.mts calls at deploy time (`npm run deploy`), never from the Worker.
 */
export const menuCommands = new CommandGroup<BotContext>();

for (const { name, description, handler } of MENU) {
  const command = menuCommands.command(name, createTranslator(DEFAULT_LOCALE).text(description), handler);
  const nonDefaultLocales = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE)

  // Users whose Telegram language has a translation get a translated menu
  for (const locale of nonDefaultLocales) {
    command.localize(locale as LanguageCode, name, createTranslator(locale).text(description));
  }
}

const handleStart = async (ctx: BotContext): Promise<void> => {
  await endFlow(ctx);
  const commands = MENU.map(({ name, description }) => `/${name} - ${ctx.tText(description)}`).join('\n');
  await ctx.reply(ctx.t('start-welcome', { botUsername: ctx.me.username, commands }));
};

/** The menu commands plus /start, which stays out of the menu as Telegram shows its own Start button */
export const commands = new Composer<BotContext>(menuCommands);

commands.command('start', handleStart);
