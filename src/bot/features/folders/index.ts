import { Composer } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { addFolder } from 'src/bot/features/folders/add';
import { copyFolder } from 'src/bot/features/folders/copy';
import { importFolder } from 'src/bot/features/folders/import';
import { removeFolder } from 'src/bot/features/folders/remove';
import { renameFolder } from 'src/bot/features/folders/rename';

/** Folder management: `/add_folder`, `/rename_folder`, `/copy_folder`, `/remove_folder`, shared folders */
export const folders = new Composer<BotContext>(addFolder, renameFolder, copyFolder, removeFolder, importFolder);
