import { plural } from 'src/i18n/plural';

/**
 * English messages. This is the source locale: its keys and parameter types define what every
 * other locale must provide (see `Messages`).
 *
 * Messages are rendered with Telegram's HTML parse mode. String parameters are escaped by the
 * translator, so never escape them here.
 */
export const en = {
  // --- Errors (keys are shared with the DB layer, see DB_ERROR_KEYS) ---
  'error-folder-name-length': (p: { max: number }) => `⚠️ Folder name must be between 1 and ${p.max} characters long.`,
  'error-folder-already-exists': (p: { name: string }) =>
    `⚠️ A folder named '${p.name}' already exists. Please choose a different name.`,
  'error-folder-not-found': '⚠️ Folder not found.',
  'error-db-add-folder': '❌ Failed to create the folder. Please try again later.',
  'error-db-rename-folder': '❌ Failed to rename the folder. Please try again later.',
  'error-db-remove-folder': '❌ Failed to remove the folder. Please try again later.',
  'error-db-list-folders': '❌ Failed to load your folders. Please try again later.',
  'error-db-add-files': '❌ Failed to save the files. Please try again later.',
  'error-db-remove-files': '❌ Failed to remove the files. Please try again later.',
  'error-db-list-files': '❌ Failed to load the files. Please try again later.',
  'error-db-clear-data': '❌ Failed to clear your data. Please try again later.',

  // --- Common ---
  'action-cancelled': 'Action cancelled.',
  'session-expired': 'This action has expired. Please start again.',
  'button-cancel': '❌ Cancel',

  // --- /start ---
  'start-welcome': (p: { botUsername: string }) =>
    '👋 <b>Welcome to File Wallet Bot!</b>\n\n' +
    'Organize your documents, photos, audio, and stickers into folders, and share them in any chat via inline mode!\n\n' +
    '<b>Available commands:</b>\n' +
    '/add_folder - Create a new folder\n' +
    '/add_files - Add files to an existing folder\n' +
    '/cancel - Cancel current action\n\n' +
    `In any chat, type <code>@${p.botUsername}</code> to see your folders, then add a folder's number ` +
    `(e.g. <code>@${p.botUsername} 1</code>) to open it. Tap a file to send it instantly!`,

  // --- /add_folder ---
  'add-folder-prompt': (p: { max: number }) => `Please enter the name for your new folder (1–${p.max} characters):`,
  'add-folder-text-required': '⚠️ Please send a text message with the folder name.',
  'add-folder-success': (p: { name: string }) =>
    `✅ Folder <b>${p.name}</b> created successfully!\n\nUse /add_files to add files to it.`,

  // --- /add_files ---
  'add-files-no-folders':
    "⚠️ You don't have any folders yet! Use /add_folder to create your first folder before adding files.",
  'add-files-choose-folder': 'Choose a folder to add files to:',
  'add-files-folder-selected': (p: { name: string }) =>
    `Selected folder: <b>${p.name}</b>\n\n` +
    'Now send me the files you want to add (documents, photos, audios, stickers, videos).\n' +
    'When you are finished, click <b>Save</b>.',
  'add-files-pending': (p: { count: number; name: string }) =>
    `📥 ${plural('en', p.count, { one: '<b>1</b> file', other: `<b>${p.count}</b> files` })} ready to be saved to <b>${p.name}</b>.`,
  'add-files-saved': (p: { count: number; name: string }) =>
    `✅ Successfully saved ${plural('en', p.count, { one: '1 file', other: `${p.count} files` })} to <b>${p.name}</b>.`,
  'add-files-album-unsupported': "⚠️ Albums aren't supported yet. Please send files one by one.",
  'add-files-nothing-to-save': '⚠️ No files to save.',
  'add-files-button-save': (p: { count: number }) => `💾 Save (${p.count})`,

  // --- Default file names (used when Telegram provides no name or caption) ---
  'file-default-document': 'Document',
  'file-default-photo': 'Photo',
  'file-default-audio': 'Audio',
  'file-default-video': 'Video',
  'file-default-voice': 'Voice message',
  'file-default-sticker': 'Sticker',
  'file-default-animation': 'GIF',

  // --- Inline mode (titles and descriptions are plain text, not HTML) ---
  'inline-error-title': 'Something went wrong',
  'inline-error-description': 'Please try again later',
  'inline-no-folders-title': 'No folders found',
  'inline-no-folders-description': 'Open the bot chat and use /add_folder to create one',
  'inline-folder-description': (p: { n: number }) => `Type ${p.n} after the bot name to open this folder`,
  'inline-unknown-folder-title': (p: { n: number }) => `No folder #${p.n}`,
  'inline-unknown-folder-description': 'Erase the number to see all folders',
  'inline-empty-folder-title': (p: { name: string }) => `"${p.name}" is empty`,
  'inline-empty-folder-description': 'Erase the number to go back to folders',
};
