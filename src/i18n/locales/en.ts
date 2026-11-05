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
  'error-folder-limit': (p: { max: number }) =>
    `⚠️ You've reached the limit of ${p.max} folders. Delete a folder with /remove_folder to create a new one.`,
  'error-file-limit': (p: { max: number; remaining: number }) =>
    p.remaining === 0
      ? `⚠️ This folder is full: a folder can hold up to ${p.max} files.`
      : `⚠️ A folder can hold up to ${p.max} files, so only ${plural('en', p.remaining, { one: '1 more file fits', other: `${p.remaining} more files fit` })} in this one.`,
  'error-db-get-quota': '❌ Failed to check your folder limit. Please try again later.',
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

  // --- Command menu (plain text, at most 256 characters; also listed by /start) ---
  'command-add-folder': 'Create a new folder',
  'command-add-files': 'Add files to an existing folder',
  'command-remove-files': 'Remove files from a folder',
  'command-rename-folder': 'Rename a folder',
  'command-copy-folder': 'Copy a folder with all its files',
  'command-remove-folder': 'Delete a folder and its files',
  'command-clear-data': 'Delete all your data',
  'command-cancel': 'Cancel current action',

  // --- /start ---
  /** `commands`: one "/name - description" line per command, see src/bot/commands.ts */
  'start-welcome': (p: { botUsername: string; commands: string }) =>
    '👋 <b>Welcome to File Wallet Bot!</b>\n\n' +
    'Organize your documents, photos, audio, and stickers into folders, and share them in any chat via inline mode!\n\n' +
    '<b>Available commands:</b>\n' +
    `${p.commands}\n\n` +
    `In any chat, type <code>@${p.botUsername}</code> to see your folders, then add a folder's number ` +
    `(e.g. <code>@${p.botUsername} 1</code>) to open it. Tap a file to send it instantly!`,

  // --- /start help (the inline help button; may be the user's first message, so it is self-contained) ---
  'inline-guide': (p: { botUsername: string }) =>
    '🔎 <b>How to use inline search</b>\n\n' +
    'Inline search sends your saved files to any chat: private chats, groups and channels.\n\n' +
    '<b>1. Save your files.</b> Create a folder with /add_folder, then put files into it with /add_files.\n\n' +
    `<b>2. Open your folders.</b> In any chat, type <code>@${p.botUsername}</code> in the ` +
    'message field. Your folders appear above it, numbered.\n\n' +
    `<b>3. Open a folder.</b> Add the folder's number: <code>@${p.botUsername} 2</code> shows the files of ` +
    'folder 2. Tap a file to send it.\n\n' +
    '<b>4. Go back.</b> Erase the number to see all folders again. Tapping a folder itself only sends its name.\n\n' +
    '💡 New and changed folders may take up to half a minute to show up in inline search.\n\n' +
    'Send /start to see all commands.',

  // --- /add_folder ---
  'add-folder-prompt': (p: { max: number }) => `Please enter the name for your new folder (1–${p.max} characters):`,
  'folder-name-text-required': '⚠️ Please send a text message with the folder name.',
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
  /** Plain text (a popup) */
  'add-files-folder-full': (p: { max: number }) =>
    `This folder is full: it already has ${p.max} files. Choose another folder or remove some files first.`,
  'add-files-limit-reached': (p: { max: number }) =>
    `⚠️ The folder can't take more files (at most ${p.max}). Press <b>Save</b> to keep the ones you've sent.`,

  // --- /rename_folder ---
  'rename-folder-no-folders': "⚠️ You don't have any folders to rename.",
  'rename-folder-choose-folder': 'Choose a folder to rename:',
  'rename-folder-prompt': (p: { name: string; max: number }) =>
    `Send me the new name for <b>${p.name}</b> (1–${p.max} characters):`,
  'rename-folder-success': (p: { oldName: string; newName: string }) =>
    `✅ Folder <b>${p.oldName}</b> renamed to <b>${p.newName}</b>.`,

  // --- /copy_folder ---
  'copy-folder-no-folders': "⚠️ You don't have any folders to copy.",
  'copy-folder-choose-folder': 'Choose a folder to copy:',
  'copy-folder-prompt': (p: { name: string; max: number }) =>
    `Send me the name for the copy of <b>${p.name}</b> (1–${p.max} characters):`,
  'copy-folder-success': (p: { name: string; newName: string; count: number }) =>
    `✅ Copied ${plural('en', p.count, { one: '1 file', other: `${p.count} files` })} from <b>${p.name}</b> to the new folder <b>${p.newName}</b>.`,

  // --- /remove_folder ---
  'remove-folder-no-folders': "⚠️ You don't have any folders to remove.",
  'remove-folder-choose-folder': 'Choose a folder to delete:',
  'remove-folder-confirm': (p: { name: string; count: number }) =>
    `⚠️ <b>Are you sure you want to delete folder ${p.name}?</b>\n` +
    `This will permanently delete the folder and ${plural('en', p.count, {
      one: 'the 1 file',
      other: `all ${p.count} files`,
    })} inside it!`,
  'remove-folder-button-confirm': '🗑️ Yes, delete folder',
  'remove-folder-success': (p: { name: string }) => `✅ Folder <b>${p.name}</b> and its files have been deleted.`,
  'remove-folder-cancelled': 'Folder deletion cancelled.',

  // --- /remove_files ---
  'remove-files-no-folders': "⚠️ You don't have any folders.",
  'remove-files-choose-folder': 'Choose a folder to remove files from:',
  'remove-files-empty': (p: { name: string }) => `⚠️ Folder <b>${p.name}</b> is empty. There are no files to remove.`,
  'remove-files-choose-files': (p: { name: string; page: number; pages: number }) =>
    `Tap the files to remove from <b>${p.name}</b>, then press <b>Delete Selected</b>.` +
    (p.pages > 1 ? `\n\nPage ${p.page} of ${p.pages}` : ''),
  'remove-files-button-prev': '◀️ Previous',
  'remove-files-button-next': 'Next ▶️',
  'remove-files-button-delete': (p: { count: number }) => `🗑️ Delete Selected (${p.count})`,
  'remove-files-nothing-selected': '⚠️ Please select at least one file to delete.',
  'remove-files-success': (p: { count: number; name: string }) =>
    `✅ Removed ${plural('en', p.count, { one: '1 file', other: `${p.count} files` })} from <b>${p.name}</b>.`,

  // --- /clear_data ---
  'clear-data-confirm':
    '⚠️ <b>DANGER: IRREVERSIBLE ACTION</b>\n\n' +
    'This will permanently delete all your folders and files.\n\n' +
    'Are you sure you want to proceed?',
  'clear-data-button-confirm': '💥 Yes, delete all my data',
  'clear-data-success': '🧹 All your data has been completely and permanently erased.',
  'clear-data-cancelled': 'Operation cancelled. Your data remains safe.',

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
  /** The button above inline results; opens the bot chat with `inline-guide` */
  'inline-help-button': '❓ How to use inline search',
  'inline-unknown-folder-title': (p: { n: number }) => `No folder #${p.n}`,
  'inline-unknown-folder-description': 'Erase the number to see all folders',
  'inline-empty-folder-title': (p: { name: string }) => `"${p.name}" is empty`,
  'inline-empty-folder-description': 'Erase the number to go back to folders',
};
