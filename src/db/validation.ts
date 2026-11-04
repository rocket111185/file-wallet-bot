import { DB_ERROR_KEYS, MAX_FILES_PER_FOLDER, MAX_FOLDER_NAME_LENGTH, type StatusError } from 'src/types';
import { graphemeLength } from 'src/utils';

/**
 * Checks an already trimmed folder name; shared by every Database implementation
 *
 * @returns The error to return to the caller, or null when the name is fine
 */
export const validateFolderName = (name: string): StatusError | null => {
  const length = graphemeLength(name);
  if (length === 0 || length > MAX_FOLDER_NAME_LENGTH) {
    return { error: true, key: DB_ERROR_KEYS.FOLDER_NAME_LENGTH, params: { max: MAX_FOLDER_NAME_LENGTH } };
  }
  return null;
};

/**
 * Checks that one more folder fits; shared by every Database implementation
 *
 * @param count Folders the user has now
 * @param max Folders their plan allows
 * @returns The error to return to the caller, or null when there is room
 */
export const checkFolderLimit = (count: number, max: number): StatusError | null =>
  count >= max ? { error: true, key: DB_ERROR_KEYS.FOLDER_LIMIT_REACHED, params: { max } } : null;

/**
 * Checks that `adding` new files fit into a folder holding `existing`; shared by every Database
 * implementation. Folders already over the limit (from before it existed) keep their files, they just
 * can't get more.
 *
 * @param existing Files in the folder now
 * @param adding Files to add that aren't in the folder yet (repeats already dropped)
 * @returns The error to return to the caller, or null when they fit
 */
export const checkFileLimit = (existing: number, adding: number): StatusError | null => {
  if (adding === 0 || existing + adding <= MAX_FILES_PER_FOLDER) return null;
  return {
    error: true,
    key: DB_ERROR_KEYS.FILE_LIMIT_REACHED,
    params: { max: MAX_FILES_PER_FOLDER, remaining: Math.max(0, MAX_FILES_PER_FOLDER - existing) },
  };
};
