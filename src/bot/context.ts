import type { Context, SessionFlavor } from 'grammy';

import type { UserSession } from 'src/bot/session';
import type { Database } from 'src/db/db.interface';
import type { Translate } from 'src/i18n/i18n';

export interface BotContext extends Context, SessionFlavor<UserSession> {
  db: Database;
  locale: string;
  /** Translates for `parse_mode: 'HTML'` messages (string params are escaped) */
  t: Translate;
  /** Translates for plain-text places: button labels, callback alerts, inline result titles */
  tText: Translate;
}
