import { DB_ERROR_KEYS, MAX_FOLDER_NAME_LENGTH, type StatusError } from 'src/types';
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
