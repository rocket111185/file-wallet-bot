import { Composer } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { addFiles } from 'src/bot/features/files/add';
import { removeFiles } from 'src/bot/features/files/remove';

/** File management: `/add_files`, `/remove_files` */
export const files = new Composer<BotContext>(addFiles, removeFiles);
