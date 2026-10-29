import { Context, SessionFlavor } from 'grammy';
import type { Database } from 'src/db/db.interface';
import type { UserSession } from 'src/types';

export interface BotContext extends Context, SessionFlavor<UserSession> {
  db: Database;
}
