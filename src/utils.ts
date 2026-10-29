/**
 * Generates a compact, URL-safe Base64URL ID
 *
 * @param byteLength Number of random bytes
 */
export const generateId = (byteLength: number = 9): string => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytes.toBase64({ alphabet: 'base64url', omitPadding: true });
};

/**
 * Escapes a string for Telegram's HTML parse mode
 */
export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Length in user-perceived characters, so an emoji or a letter with combining marks counts as 1
 */
export const graphemeLength = (s: string): number => [...new Intl.Segmenter().segment(s)].length;

/**
 * Case-insensitive name comparison that also works outside of plain ASCII
 */
export const sameName = (a: string, b: string): boolean => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
