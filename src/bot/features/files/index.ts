import { Composer } from 'grammy';

import type { BotContext } from 'src/bot/context';
import { addFiles } from 'src/bot/features/files/add';

/** File management: `/add_files` (`/remove_files` goes here too) */
export const files = new Composer<BotContext>(addFiles);
