/**
 * Variation of JSON.parse which instead of throwing error returns `undefined`
 * if something goes wrong.
 *
 * @param content A string to be parsed
 * @returns A parsed value if everything went well, otherwise `undefined`
 */
export const tryParseJson = <T>(content: string): T | undefined => {
  try {
    const parsed = JSON.parse(content);
    return parsed as T;
  } catch {
    return undefined;
  }
};

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
