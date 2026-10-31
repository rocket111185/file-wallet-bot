import type { MessageKey, Translate } from 'src/i18n/i18n';
import type { FileItem, StatusError } from 'src/types';

/**
 * Translates an error returned by the DB layer
 */
export const translateError = (t: Translate, err: StatusError): string => {
  const key: MessageKey = err.key; // Fails to compile if a DB error key has no translation
  return (t as (key: MessageKey, params?: StatusError['params']) => string)(key, err.params);
};

/**
 * Name to show for a file, falling back to a localized default when it has none
 */
export const fileDisplayName = (t: Translate, file: FileItem): string =>
  file.name || t(`file-default-${file.type}`);
