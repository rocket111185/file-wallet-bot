import { Composer } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { addFolder } from 'src/bot/features/folders/add';
import { removeFolder } from 'src/bot/features/folders/remove';
import { renameFolder } from 'src/bot/features/folders/rename';

/** Folder management: `/add_folder`, `/rename_folder`, `/remove_folder` */
export const folders = new Composer<BotContext>(addFolder, renameFolder, removeFolder);
