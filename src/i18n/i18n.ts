import { en } from 'src/i18n/locales/en';
import { escapeHtml } from 'src/utils';

/** Shape every locale must implement: same keys and parameters as English */
export type Messages = typeof en;
export type MessageKey = keyof Messages;
/** Keys of messages without parameters */
export type PlainMessageKey = { [K in MessageKey]: Messages[K] extends string ? K : never }[MessageKey];

type Params<K extends MessageKey> = Messages[K] extends (p: infer P) => string ? P : never;
type ParamsArg<K extends MessageKey> = [Params<K>] extends [never] ? [] : [params: Params<K>];

export type Translate = <K extends MessageKey>(key: K, ...params: ParamsArg<K>) => string;

const locales: Record<string, Messages> = {
  en,
  // uk, de, ... — add a `Messages` object in ./locales and register it here
};

export const DEFAULT_LOCALE = 'en';

/**
 * Maps a Telegram `language_code` (IETF tag such as "en", "pt-br") to a supported locale
 */
export const resolveLocale = (languageCode: string | undefined): string => {
  if (!languageCode) {
    return DEFAULT_LOCALE;
  }

  const tag = languageCode.toLowerCase();
  if (tag in locales) {
    return tag;
  }

  const base = tag.split('-')[0];
  return base in locales ? base : DEFAULT_LOCALE;
};

const render = (locale: string, key: MessageKey, params: Record<string, unknown> | undefined, html: boolean) => {
  const message = (locales[locale] ?? locales[DEFAULT_LOCALE])[key];
  if (typeof message === 'string') {
    return message;
  }

  const prepared = html
    ? Object.fromEntries(
        Object.entries(params ?? {}).map(([k, v]) => [k, typeof v === 'string' ? escapeHtml(v) : v]),
      )
    : params;
  return (message as (p: unknown) => string)(prepared);
};

/**
 * Creates translators for a locale.
 *
 * - `html` escapes string params, for messages sent with `parse_mode: 'HTML'`
 * - `text` leaves them as-is, for plain-text places (button labels, inline result titles, alerts)
 */
export const createTranslator = (locale: string): { html: Translate; text: Translate } => ({
  html: (key, ...[params]) => render(locale, key, params as Record<string, unknown>, true),
  text: (key, ...[params]) => render(locale, key, params as Record<string, unknown>, false),
});
