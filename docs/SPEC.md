# File Wallet Bot - Specification

This document describes the architecture, database schema, and detailed conversational behaviors of the File Wallet Telegram Bot. It is written to serve as a complete, unambiguous implementation guide for developers building the bot from scratch.

---

## 1. Overview & Architecture

**File Wallet Bot** is a Telegram bot that allows users to organize files, documents, media, and stickers into logical folders and quickly share them in any chat via Telegram's **Inline Mode**.

### Core Architecture Principles
* **Runtime**: [Cloudflare Workers](https://developers.cloudflare.com/workers/) using [grammY](https://grammy.dev/).
* **Zero-Cost Storage Strategy**: The bot **does not** store binary files. It stores Telegram's internal `file_id` references. When a user requests or shares a file, Telegram servers deliver it directly.
* **Database & State**: [Cloudflare Workers KV](https://developers.cloudflare.com/kv/) stores folder hierarchies, file metadata, and user sessions.

---

## 2. Database & Data Models

### 2.1 TypeScript Types (`src/types.ts`)

```typescript
export type StatusSuccess<T = void> = T extends void
  ? { error: false }
  : { error: false; data: T };

export type StatusError = {
  error: true;
  key: string; // Localization key for grammY i18n
  params?: Record<string, string | number>; // Dynamic translation variables (e.g. { name: 'Work' })
  message?: string; // Optional English fallback / debug message
};

export type Status<T = void> = StatusSuccess<T> | StatusError;

export type TelegramFileType =
  | 'document'
  | 'photo'
  | 'audio'
  | 'video'
  | 'voice'
  | 'sticker'
  | 'animation';

export type FileItem = {
  id: string; // Telegram file_id
  name: string;
  type: TelegramFileType;
};

export type Folder = FileItem[];

export type FolderInfo = {
  id: string; // Generated unique folder ID (e.g., 12-char Base64URL via Uint8Array.prototype.toBase64)
  name: string; // User-defined display name
};



export type BotAction =
  | 'add-folder'
  | 'add-files'
  | 'remove-folder'
  | 'remove-files'
  | 'confirm-clear-data'
  | null;

export type UserSession = {
  language: string;
  action: BotAction;
  destinationFolderId: string | null;
  selectedFolderId: string | null;
  filesToRemove: string[]; // List of file IDs marked for deletion
  tmpFiles: FileItem[]; // Files uploaded in current session waiting to be saved
  currentPage?: number; // Current page index for file pagination (0-based)
  pendingMessageId?: number; // Message ID for active prompt/counter message
};
```

### 2.2 Database Interface (`src/db/db.interface.ts`)

The `Database` interface is solely responsible for persistent domain data: managing user folders and file metadata. Session state is intentionally decoupled from `Database` and managed independently by **grammY's built-in session middleware** (see section 2.4).

All database operations are **asynchronous** and scoped by `userId` (Telegram user ID) to ensure multi-tenant isolation:

```typescript
import type { FileItem, FolderInfo, Status } from 'src/types';

export interface Database {
  // Folder operations
  addFolder(userId: string | number, name: string): Promise<Status<{ id: string }>>;
  renameFolder?(userId: string | number, folderId: string, newName: string): Promise<Status>;
  removeFolder(userId: string | number, folderId: string): Promise<Status>;
  listFolders(userId: string | number): Promise<Status<FolderInfo[]>>;

  // File operations
  addFiles(userId: string | number, folderId: string, files: FileItem[]): Promise<Status>;
  removeFiles(userId: string | number, folderId: string, fileIds: string[]): Promise<Status>;
  listFiles(userId: string | number, folderId: string): Promise<Status<FileItem[]>>;

  // User teardown
  clearUserData(userId: string | number): Promise<Status>;
}
```

### 2.3 Cloudflare KV Storage Schema

Data is partitioned cleanly between persistent bot data (handled by `Database`) and conversation state (handled by `grammY` session adapter):

#### A. Database Storage (Managed by `Database`)
1. **User Folders**:
   * **Key**: `folders:${userId}`
   * **Value**: Serialized `FolderInfo[]` (`[{ id, name }]`).
2. **Folder Contents**:
   * **Key**: `files:${userId}:${folderId}`
   * **Value**: Serialized `FileItem[]` representing all files saved in that specific folder.

#### B. Session Storage (Managed by grammY Session Adapter)
* **Key**: Handled by grammY's storage adapter (e.g. `session:${userId}`).
* **Value**: Serialized `UserSession` tracking transient conversation state.

> [!NOTE]
> Cloudflare KV has an eventual consistency model with a limit of 1 write per second per key. Sending files as media albums (batches) is deferred to future releases; the bot currently expects individual file uploads per message update.

### 2.4 Session Management (grammY)

Session state is injected into `ctx.session` using grammY's `session()` middleware with a KV storage adapter.

Initial session factory:
```typescript
export const initialSession = (): UserSession => ({
  language: 'en',
  action: null,
  destinationFolderId: null,
  selectedFolderId: null,
  filesToRemove: [],
  tmpFiles: [],
  currentPage: 0,
});
```

* When `/cancel` is called: session fields (`action`, `destinationFolderId`, `filesToRemove`, `tmpFiles`, `currentPage`) are reset to their initial defaults.
* When `/clear-data` is confirmed: `db.clearUserData(userId)` is executed and `ctx.session = initialSession()` clears the session.


---

## 3. Bot Behavior & Commands

### 3.1 Common Guards & Cancellation

* **`/cancel` Command**:
  * Resets `action` to `null`.
  * Clears `destinationFolderId`, `filesToRemove`, `tmpFiles`, `currentPage`, and `pendingMessageId`.
  * If `pendingMessageId` exists, attempts to delete or clear the dynamic status message.
  * Sends: *"Action cancelled."*
* **Inline "Cancel" Buttons**:
  * Any interactive menu (folder selection, file deletion, confirmation) should include a `[ ❌ Cancel ]` inline button that triggers the `/cancel` logic.
* **Concurrent Command Interruption**:
  * If a user triggers a new command (e.g., `/add-files`) while currently inside an action (e.g., `add-folder`), the bot resets the prior action and proceeds with the new command.

---

### 3.2 `/start`

* Resets `action` to `null`.
* Replies with a welcoming greeting explaining the bot's features:
  * How to organize files into folders (`/add-folder`, `/add-files`).
  * How to share files in any chat using inline queries (`@botname`).
  * List of available commands.

---

### 3.3 `/add-folder`

1. Sets `action = 'add-folder'`.
2. Asks the user: *"Please enter the name of the new folder:"*.
3. **Validation & Edge Cases**:
   * **Non-text inputs**: If the user sends a photo, sticker, or document instead of text, warn:
     > *"⚠️ Please send a text message with the folder name."*
   * **Length validation**: Name must be between 1 and 32 characters (trimmed). If invalid, warn:
     > *"⚠️ Folder name must be between 1 and 32 characters long."*
   * **Duplicate check**: If a folder with the same name already exists (case-insensitive) for this user, warn:
     > *"⚠️ A folder named '{name}' already exists. Please choose a different name."*
4. **Completion**:
   * Generates a unique `folderId`.
   * Persists the new folder into the user's folder list.
   * Resets `action = null`.
   * Sends confirmation: *"✅ Folder '{name}' created successfully!"*

---

### 3.4 `/add-files`

1. **Empty State Guard**:
   * Checks if user has any folders.
   * If `folders.length === 0`:
     > *"⚠️ You don't have any folders yet! Use /add-folder to create your first folder before adding files."*
     * Aborts flow without modifying state.
2. **Folder Selection**:
   * Displays an inline keyboard listing all user folders.
   * User clicks a folder button.
   * Sets `destinationFolderId = folderId`, sets `action = 'add-files'`, and initializes `tmpFiles = []`.
   * Sends prompt:
     > *"Selected folder: **{folderName}**.\nNow send me the files you want to add. When you are done, click 'Save'."*
3. **Receiving Files**:
   * When user sends a message containing a file (`document`, `photo`, `audio`, `video`, `voice`, `sticker`, `animation`):
     * Extracts `file_id`.
     * Resolves display `name`:
       * `document`: `document.file_name` (or fallback).
       * `photo`: Takes largest `PhotoSize`, default name `Photo YYYY-MM-DD HH:mm:ss` (or caption if provided).
       * `audio`: `audio.title` or `audio.file_name`.
       * `video` / `voice` / `sticker`: appropriate title, emoji, or caption.
     * Appends `{ id, name, type }` to `tmpFiles`.
4. **Dynamic Status & Save Message**:
   * If an existing status message (`pendingMessageId`) exists, deletes it to avoid clutter.
   * Sends a new message:
     > *"📥 {count} file(s) ready to be saved to **{folderName}**."*
     * With inline keyboard:
       * `[ 💾 Save ]` (callback `af:save`)
       * `[ ❌ Cancel ]` (callback `af:cancel`)
   * Saves new message ID to `pendingMessageId`.
5. **Saving / Finalizing**:
   * When user clicks `[ 💾 Save ]`:
     * If `tmpFiles.length === 0`, alerts user via callback query: *"⚠️ No files to save."*
     * Appends `tmpFiles` to `folder:${userId}:${folderId}` in KV.
     * Deletes the dynamic status message.
     * Sends: *"✅ Successfully saved {count} file(s) to '{folderName}'."*
     * Clears `tmpFiles`, `destinationFolderId`, `pendingMessageId`, and resets `action = null`.

---

### 3.5 `/remove-folder`

1. **Empty State Guard**:
   * If `folders.length === 0`:
     > *"⚠️ You don't have any folders to remove."*
     * Aborts flow.
2. **Folder Selection**:
   * Sets `action = 'remove-folder'`.
   * Displays an inline keyboard of all folders with a `[ ❌ Cancel ]` button.
3. **Destructive Action Warning & Confirmation**:
   * Once user selects a folder, do **NOT** delete immediately.
   * Checks file count in that folder.
   * Sends a confirmation prompt:
     > *"⚠️ **Are you sure you want to delete folder '{folderName}'?**\nThis will permanently delete the folder and all {count} file(s) inside it!"*
     * Inline buttons:
       * `[ 🗑️ Yes, delete folder ]` (callback `rf_confirm:{folderId}`)
       * `[ ❌ Cancel ]` (callback `rf_cancel`)
4. **Execution**:
   * If confirmed:
     * Deletes `folder:${userId}:${folderId}` from KV.
     * Removes folder from user's `folders` list.
     * Edits message to: *"✅ Folder '{folderName}' and its files have been deleted."*
     * Resets `action = null`.
   * If cancelled:
     * Edits message to: *"Folder deletion cancelled."*
     * Resets `action = null`.

---

### 3.6 `/remove-files`

1. **Empty State Guard**:
   * If `folders.length === 0`, warns: *"⚠️ You don't have any folders."*
2. **Select Folder**:
   * Displays folder list buttons.
   * User selects folder `folderId`.
   * Loads files from `folder:${userId}:${folderId}`.
   * If file list is empty:
     > *"⚠️ Folder '{folderName}' is empty. There are no files to remove."*
     * Aborts flow.
3. **Paginated Interactive List (10 items per page)**:
   * Sets `destinationFolderId = folderId`, `action = 'remove-files'`, `filesToRemove = []`, `currentPage = 0`.
   * Renders files as inline buttons (10 per page):
     * If file ID is in `filesToRemove`: `[ ✅ {name} ]`
     * If not selected: `[ {name} ]`
   * **64-Byte Callback Data Constraint**:
     * Raw Telegram `file_id` strings exceed Telegram's 64-byte `callback_data` limit.
     * Use short index-based payloads:
       * Toggle file: `rf:t:{indexOnPage}`
       * Pagination: `rf:p:{targetPage}`
       * Delete action: `rf:del`
       * Cancel: `rf:cancel`
4. **Multi-Selection Toggle**:
   * Clicking a file toggles its selection in `filesToRemove`.
   * Edits the existing message markup (`editMessageReplyMarkup`) to update checkmarks without sending new messages.
5. **Execution**:
   * Bottom bar displays: `[ 🗑️ Delete Selected ({count}) ]` and `[ ❌ Cancel ]`.
   * If user clicks Delete with 0 files selected:
     * Alerts via `answerCallbackQuery`: *"⚠️ Please select at least one file to delete."*
   * If files are selected:
     * Removes selected file IDs from KV.
     * Sends: *"✅ Removed {count} file(s) from '{folderName}'."*
     * Cleans up session variables (`filesToRemove`, `destinationFolderId`, `currentPage`) and resets `action = null`.

---

### 3.7 `/clear-data`

1. **High-Risk Destructive Warning**:
   * Sets `action = 'confirm-clear-data'`.
   * Sends critical warning:
     > *"⚠️ **DANGER: IRREVERSIBLE ACTION**\n\nThis will permanently delete all your folders, files, and personal settings.\n\nAre you sure you want to proceed?"*
     * Inline buttons:
       * `[ 💥 Yes, delete all my data ]` (callback `clear_confirm`)
       * `[ ❌ Cancel ]` (callback `clear_cancel`)
2. **Execution**:
   * On confirmation:
     * Calls `db.clearUserData(userId)` to delete all folder keys and user profile in KV.
     * Resets session to defaults.
     * Edits message to: *"🧹 All your data has been completely and permanently erased."*
   * On cancel:
     * Edits message to: *"Operation cancelled. Your data remains safe."*
     * Resets `action = null`.

---

## 4. Telegram Inline Query Behavior

Telegram inline queries operate statelessly. When a user invokes `@botname`, Telegram requests an array of `InlineQueryResult` items to display in the inline popup.

```
+-------------------------------------------------------------+
| User types: @file_wallet_bot                                |
+-------------------------------------------------------------+
| [📁 Work Documents]   -> switches query to: @bot Work Documents|
| [📁 Personal Photos]  -> switches query to: @bot Personal Photos|
+-------------------------------------------------------------+

+-------------------------------------------------------------+
| User types: @file_wallet_bot Work Documents                |
+-------------------------------------------------------------+
| [⬅️ Back to Folders]  -> switches query to: @bot             |
| [📄 Resume.pdf]       -> sends Telegram cached document      |
| [📊 Report.xlsx]      -> sends Telegram cached document      |
+-------------------------------------------------------------+
```

### 4.1 Folder Navigation (`@file_wallet_bot`)
* When query text is empty:
  * If user has 0 folders: Returns a single `InlineQueryResultArticle` informing the user:
    * Title: *"No folders found"*
    * Description: *"Open bot chat and use /add-folder to create one."*
  * If user has folders: Returns each folder as an `InlineQueryResultArticle`.
  * Each folder article has an inline keyboard button or action using `switch_inline_query_current_chat` with value `{folderName} `.
  * When clicked, Telegram updates the input field to `@file_wallet_bot {folderName} `.

### 4.2 File Browsing (`@file_wallet_bot {folderName} [searchQuery]`)
* Matches the folder name (case-insensitive).
* If matched:
  * First item: `InlineQueryResultArticle` with label:
    * Title: *"⬅️ Return to Folders"*
    * `switch_inline_query_current_chat`: `""` (clears folder name to show folders again).
  * Subsequent items: Files in that folder matching optional `searchQuery` (filtered by file `name`).
* **Cached Telegram Results**:
  * Files are returned using Telegram's cached file results by `file_id`:
    * `'document'` -> `InlineQueryResultCachedDocument`
    * `'photo'` -> `InlineQueryResultCachedPhoto`
    * `'audio'` -> `InlineQueryResultCachedAudio`
    * `'video'` -> `InlineQueryResultCachedVideo`
    * `'voice'` -> `InlineQueryResultCachedVoice`
    * `'sticker'` -> `InlineQueryResultCachedSticker`
    * `'animation'` -> `InlineQueryResultCachedGif`
* **Zero Bandwidth Delivery**: When user taps a file in the inline list, Telegram delivers it directly from Telegram servers into the chat.

---

## 5. Security & Developer Implementation Notes

1. **Webhook Security**:
   * Verify the `X-Telegram-Bot-Api-Secret-Token` header on incoming POST requests to ensure updates originate from Telegram.
2. **Cloudflare KV Configuration**:
   * In `wrangler.jsonc`, configure the KV namespace binding (e.g. `BOT_KV_VAULT`):
     ```jsonc
     "kv_namespaces": [
       {
         "binding": "BOT_KV_VAULT",
         "id": "<production-kv-id>",
         "preview_id": "<preview-kv-id>"
       }
     ]
     ```
3. **Error Boundaries**:
   * Register a global error handler (`bot.catch(...)`) to prevent worker crashes on unexpected API errors (such as a blocked bot or modified messages).
