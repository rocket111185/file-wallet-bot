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
 * Creates a queue that runs tasks one at a time, in the order they were added
 *
 * @returns Function that adds a task and resolves (or rejects) with that task's result
 */
export const createSerialQueue = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => {
      // A failed task must not block the ones after it; the caller gets the error via `run`
    });
    return run;
  };
};

/**
 * Case-insensitive name comparison that also works outside of plain ASCII
 */
export const sameName = (a: string, b: string): boolean => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
