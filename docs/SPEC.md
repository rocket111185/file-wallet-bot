# File Wallet Bot - Specification

This document describes the architecture, database schema, and detailed conversational behaviors of the File Wallet Telegram Bot. It is written to serve as a complete, unambiguous implementation guide for developers building the bot from scratch.

---

## 1. Overview & Architecture

**File Wallet Bot** is a Telegram bot that allows users to organize files, documents, media, and stickers into logical folders and quickly share them in any chat via Telegram's **Inline Mode**.

### Core Architecture Principles
* **Runtime**: [Cloudflare Workers](https://developers.cloudflare.com/workers/) using [grammY](https://grammy.dev/).
* **Zero-Cost Storage Strategy**: The bot **does not** store binary files. It stores Telegram's internal `file_id` references. When a user requests or shares a file, Telegram servers deliver it directly.
* **Database**: [Cloudflare Workers KV](https://developers.cloudflare.com/kv/) stores folders and file metadata. Reads are cheap and fast, which suits inline mode, where most traffic is.
* **Sessions**: one [Durable Object](https://developers.cloudflare.com/durable-objects/) per user (`UserChat`, SQLite storage) handles all updates from the user's private chat, one at a time, and keeps their session. Inline queries are answered directly by the Worker and never reach it.

---

## 2. Database & Data Models

### 2.1 TypeScript Types (`src/types.ts`)

```typescript
export type StatusSuccess<T = void> = T extends void
  ? { error: false }
  : { error: false; data: T };

export type StatusError = {
  error: true;
  key: DbErrorKey; // Translation key (see DB_ERROR_KEYS), rendered by the bot layer
  params?: Record<string, string | number>; // Translation variables (e.g. { name: 'Work' })
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
  name: string; // Empty when Telegram gave no name/caption; a localized default is shown instead
  type: TelegramFileType;
};

export type FolderInfo = {
  id: string; // Generated unique folder ID (e.g., 12-char Base64URL via Uint8Array.prototype.toBase64)
  name: string; // User-defined display name
};
```

Session types are described in section 2.4.

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

#### B. Session Storage (Durable Object `UserChat`, not KV)
* **Object**: one per user, named by the private chat ID (equal to the user ID), via `env.USER_CHAT.getByName(chatId)`.
* **Key**: the user ID, inside that object's own storage (grammY's session key).
* **Value**: `UserSession` tracking transient conversation state.

> [!NOTE]
> Why not KV: KV is eventually consistent, allows 1 write per second per key, and only 1,000 writes per day on the Free plan, while every session change is a write. Telegram also delivers updates in parallel (an album is several updates at once), and grammY reads the session when an update starts and writes it back when it ends, so parallel updates would overwrite each other's changes. `UserChat` sees all of a user's updates and runs them one at a time through an in-memory queue. Durable Object input gates alone don't prevent this, since awaiting a Telegram API call lets the next update start.
>
> Media albums are still not supported (see section 3.4); with the queue in place they can be supported later.

### 2.4 Session Management (grammY)

Session state is injected into `ctx.session` using grammY's `session()` middleware. Like the database, the session layer (`src/session/`) is an interface plus an implementation, injected into the chat bot:
* `src/session/session.ts`: the session types and `SessionStorage`, which is grammY's own `StorageAdapter<UserSession>` (`read`/`write`/`delete`). Any grammY storage fits, e.g. the built-in `MemorySessionStorage` used by the tests.
* `src/session/session.durable-object.ts`: `DurableObjectSessionStorage`, over the `UserChat` Durable Object's storage. The official `@grammyjs/storage-cloudflare` package only offers KV and D1 adapters.

Whatever the storage, a user's updates must be handled one at a time (see the note in 2.3). On Cloudflare, `UserChat` does this; a non-Cloudflare host would use grammY's `sequentialize`.

Sessions exist only in the private chat with the bot. There are two bots, sharing their setup (`src/bot/base.ts`):
* **Worker bot** (`src/bot/worker-bot.ts`, runs on every webhook request):
  * Has no session; its context type (`BaseContext`) has no `ctx.session`.
  * Answers inline queries itself, from KV (`src/bot/features/inline.ts`).
  * Forwards every private-chat update over RPC to the user's `UserChat`.
* **Chat bot** (`src/bot/chat-bot.ts`, runs inside `UserChat`):
  * Reads the session from `SessionStorage` before each update and writes it back after.
  * Handles commands, buttons and uploads.

The session holds a single `flow`: the multi-step conversation the user is in, as a discriminated union (`src/session/session.ts`). Each flow kind carries only its own state, so starting a new flow or cancelling is one assignment and cannot leave stale fields behind:

```typescript
export type Flow =
  | { kind: 'add-folder' }
  | {
      kind: 'add-files';
      folder: { id: string; name: string } | null; // null until a folder is picked
      files: FileItem[];                           // received, not yet saved
      statusMessageId?: number;                    // the "N files ready / Save" message
    }
  | { kind: 'rename-folder'; folder: { id: string; name: string } | null } // null until picked
  | { kind: 'remove-folder'; folder: { id: string; name: string } | null } // null until picked
  | { kind: 'clear-data' };
// remove-files is added when it gets implemented

export type UserSession = { flow: Flow | null };
export const initialSession = (): UserSession => ({ flow: null });
```

* Ending a flow (`endFlow(ctx)`) sets `flow = null` and deletes the flow's status message (`statusMessageId`, any flow may have one), if any.
* When `/clear_data` is confirmed: `db.clearUserData(userId)` is executed and `ctx.session = initialSession()` clears the session.

### 2.5 Bot Features

The chat bot's handlers are grouped by feature in `src/bot/features/`. Each feature is a grammY `Composer` holding its own commands, buttons and message handlers, and `createChatBot` only plugs them in:

```
src/bot/features/
  common.ts          /start, /cancel
  folders/           add.ts (/add_folder), rename.ts (/rename_folder), remove.ts (/remove_folder)
  files/             add.ts (/add_files); /remove_files goes here
  clear-data.ts      /clear_data
  inline.ts          inline queries (Worker bot)
```

Shared helpers:
* `src/bot/flow.ts`: `endFlow`; `awaitingInput(kind)`, the filter for messages that are input to a flow; `activeFlow` and `cancelFlow` for buttons (section 3.5).
* `src/bot/folder-picker.ts`: the folder keyboard and the lookup of a picked folder, for commands that start by picking a folder.

**Commands always win.** A message is flow input only while the user is in that flow and only if it is not a command (`awaitingInput`). So the order features are registered in doesn't matter: a command sent mid-flow always reaches its own handler and starts over (section 3.1), and an unknown command (e.g. a typo) is ignored instead of becoming a folder name.

### 2.6 Localization

* The locale comes from the user's Telegram `language_code`, falling back to English (`src/i18n/i18n.ts`).
* Messages live in `src/i18n/locales/<locale>.ts`. `en.ts` is the source locale: its keys and parameter types define what every other locale must provide.
* All messages are Telegram HTML. `ctx.t` escapes string params (for messages); `ctx.tText` does not (for button labels, callback alerts, inline result titles). `parse_mode: 'HTML'` is applied by default to `sendMessage`/`editMessageText`.
* Plurals use `Intl.PluralRules` via `plural(locale, count, forms)`.
* The DB layer never returns user-facing text, only a translation key (`DbErrorKey`) and params.
* Default file names (e.g. "Photo") are never stored: `FileItem.name` is left empty and the localized fallback is rendered at display time.

### 2.7 Logging

* Logs go through `src/logger.ts`, which writes structured objects (`{ level, event, ...fields, error }`) to the console. Workers Logs indexes each field, so logs can be filtered by `event`, `userId`, etc.
* Unexpected storage errors are logged by the DB layer (`db.<operation>.failed`) and returned to the caller as a translation key only.


---

## 3. Bot Behavior & Commands

### 3.1 Common Guards & Cancellation

* **`/cancel` Command**:
  * Ends the current flow (`flow = null`).
  * If the flow has a status message (`statusMessageId`), attempts to delete it.
  * Sends: *"Action cancelled."*
* **Inline "Cancel" Buttons**:
  * Any interactive menu (folder selection, file deletion, confirmation) should include a `[ ❌ Cancel ]` inline button that triggers the `/cancel` logic.
* **Concurrent Command Interruption**:
  * If a user triggers a new command (e.g., `/add_files`) while currently inside an action (e.g., `add-folder`), the bot resets the prior action and proceeds with the new command.

---

### 3.2 `/start`

* Ends the current flow (`flow = null`).
* Replies with a welcoming greeting explaining the bot's features:
  * How to organize files into folders (`/add_folder`, `/add_files`).
  * How to share files in any chat using inline queries: `@botname` lists folders, `@botname {number}` opens one.
  * List of available commands.

---

### 3.3 `/add_folder`

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

### 3.4 `/add_files`

1. **Empty State Guard**:
   * Checks if user has any folders.
   * If `folders.length === 0`:
     > *"⚠️ You don't have any folders yet! Use /add_folder to create your first folder before adding files."*
     * Aborts flow without modifying state.
2. **Folder Selection**:
   * Displays an inline keyboard listing all user folders.
   * User clicks a folder button.
   * Sets `flow.folder = { id, name }` and resets `flow.files = []` (the `add-files` flow starts when the folder list is shown).
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
     * Appends `{ id, name, type }` to `flow.files`.
   * **Albums** (messages with `media_group_id`) are not supported yet: their files are not added, and the bot warns once per album (tracked by `flow.rejectedGroupId`):
     > *"⚠️ Albums aren't supported yet. Please send files one by one."*
4. **Dynamic Status & Save Message**:
   * If an existing status message (`flow.statusMessageId`) exists, deletes it to avoid clutter.
   * Sends a new message:
     > *"📥 {count} file(s) ready to be saved to **{folderName}**."*
     * With inline keyboard:
       * `[ 💾 Save ]` (callback `af:save`)
       * `[ ❌ Cancel ]` (callback `af:cancel`)
   * Saves new message ID to `flow.statusMessageId`.
5. **Saving / Finalizing**:
   * When user clicks `[ 💾 Save ]`:
     * If `flow.files.length === 0`, alerts user via callback query: *"⚠️ No files to save."*
     * Appends `flow.files` to `files:${userId}:${folderId}` in KV.
     * Deletes the dynamic status message.
     * Sends: *"✅ Successfully saved {count} file(s) to '{folderName}'."*
     * Ends the flow (`flow = null`).

---

### 3.5 Stale Buttons

Buttons stay on old messages after their flow ended or another command replaced it. Every button except Cancel checks that the session's flow is of its kind; otherwise it answers with the alert *"This action has expired. Please start again."* and does nothing. Cancel always replaces its menu with the cancellation text, but only ends the flow if it is of its kind.

---

### 3.6 `/rename_folder`

1. **Empty State Guard**:
   * If `folders.length === 0`:
     > *"⚠️ You don't have any folders to rename."*
     * Aborts flow.
2. **Folder Selection**:
   * Sets `flow = { kind: 'rename-folder', folder: null }`.
   * Displays an inline keyboard of all folders (callback `rnf:select:{folderId}`) with a `[ ❌ Cancel ]` button (callback `rnf:cancel`).
   * Once a folder is picked, sets `flow.folder` and edits the message to:
     > *"Send me the new name for **{folderName}** (1–32 characters):"*
3. **Receiving the Name**: same validation as `/add_folder` (non-text inputs, length, duplicate names; renaming a folder to a different casing of its own name is allowed). On an invalid name, the bot warns and keeps waiting. Text sent before a folder is picked is ignored.
4. **Completion**:
   * Renames the folder in the user's folder list. Its ID, files and position (inline folder number) stay the same.
   * Ends the flow (`flow = null`).
   * Sends: *"✅ Folder **{oldName}** renamed to **{newName}**."*
5. **Cancel**: edits the message to *"Action cancelled."* and ends the flow.

---

### 3.7 `/remove_folder`

1. **Empty State Guard**:
   * If `folders.length === 0`:
     > *"⚠️ You don't have any folders to remove."*
     * Aborts flow.
2. **Folder Selection**:
   * Sets `flow = { kind: 'remove-folder', folder: null }`.
   * Displays an inline keyboard of all folders (callback `rmf:select:{folderId}`) with a `[ ❌ Cancel ]` button (callback `rmf:cancel`).
3. **Destructive Action Warning & Confirmation**:
   * Once user selects a folder, do **NOT** delete immediately.
   * Sets `flow.folder` and checks the file count in that folder.
   * Edits the message to a confirmation prompt:
     > *"⚠️ **Are you sure you want to delete folder {folderName}?**\nThis will permanently delete the folder and all {count} file(s) inside it!"*
     * Inline buttons:
       * `[ 🗑️ Yes, delete folder ]` (callback `rmf:confirm`; the folder is taken from `flow.folder`)
       * `[ ❌ Cancel ]` (callback `rmf:cancel`)
4. **Execution**:
   * If confirmed:
     * Deletes `files:${userId}:${folderId}` from KV.
     * Removes folder from user's `folders` list. The folders after it move up one inline number.
     * Edits message to: *"✅ Folder **{folderName}** and its files have been deleted."*
     * Ends the flow (`flow = null`).
   * If cancelled:
     * Edits message to: *"Folder deletion cancelled."*
     * Ends the flow (`flow = null`).

---

### 3.8 `/remove_files`

1. **Empty State Guard**:
   * If `folders.length === 0`, warns: *"⚠️ You don't have any folders."*
2. **Select Folder**:
   * Displays folder list buttons.
   * User selects folder `folderId`.
   * Loads files from `files:${userId}:${folderId}`.
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

### 3.9 `/clear_data`

1. **High-Risk Destructive Warning**:
   * Sets `flow = { kind: 'clear-data' }`.
   * Sends critical warning:
     > *"⚠️ **DANGER: IRREVERSIBLE ACTION**\n\nThis will permanently delete all your folders and files.\n\nAre you sure you want to proceed?"*
     * Inline buttons:
       * `[ 💥 Yes, delete all my data ]` (callback `cd:confirm`)
       * `[ ❌ Cancel ]` (callback `cd:cancel`)
2. **Execution**:
   * On confirmation:
     * Calls `db.clearUserData(userId)` to delete the folder list and every `files:${userId}:*` key in KV.
     * Resets session to defaults (`ctx.session = initialSession()`).
     * Edits message to: *"🧹 All your data has been completely and permanently erased."*
   * On cancel:
     * Edits message to: *"Operation cancelled. Your data remains safe."*
     * Ends the flow (`flow = null`).

---

## 4. Telegram Inline Query Behavior

Telegram inline queries operate statelessly. When a user invokes `@botname`, Telegram requests an array of `InlineQueryResult` items to display in the inline popup.

### 4.0 Why folders are opened by number

Selecting **any** inline result sends it to the chat: every result type is either a media item or carries an `InputMessageContent`, and there is no result type that only triggers an action. So a folder cannot be "opened" by tapping it. Instead, the query text is the folder's number:

```
+-------------------------------------------------------------+
| User types: @file_wallet_bot                                |
+-------------------------------------------------------------+
| [1. Work Documents]   Type 1 after the bot name to open...  |
| [2. Personal Photos]  Type 2 after the bot name to open...  |
+-------------------------------------------------------------+

+-------------------------------------------------------------+
| User types: @file_wallet_bot 1                              |
+-------------------------------------------------------------+
| [📄 Resume.pdf]       -> sends Telegram cached document     |
| [📊 Report.xlsx]      -> sends Telegram cached document     |
+-------------------------------------------------------------+
```

Folder numbers are the folder's 1-based position in the user's folder list (`folders:${userId}`, creation order).

### 4.1 Query Parsing

* The query is trimmed. If it consists only of digits (`/^\d+$/`), it is a **folder number** (section 4.3).
* Anything else (empty query, words, `"2 cv"`, …) shows the **folder list** (section 4.2). There is no keyword search over folder or file names.

### 4.2 Folder List (`@file_wallet_bot`)

* If the user has 0 folders: returns a single `InlineQueryResultArticle`:
  * Title: *"No folders found"*
  * Description: *"Open the bot chat and use /add_folder to create one"*
* Otherwise: each folder is an `InlineQueryResultArticle`:
  * Title: `{n}. {folderName}`
  * Description: *"Type {n} after the bot name to open this folder"*
  * Selecting it (by mistake) sends `📁 {folderName}`; this cannot be prevented (see 4.0).
* Pagination: up to 50 results per answer, the rest via `next_offset`. Numbering continues across pages.

### 4.3 Folder Contents (`@file_wallet_bot {n}`)

* If folder `n` doesn't exist: a single article *"No folder #{n}"* / *"Erase the number to see all folders"*.
* If the folder is empty: a single article *"\"{folderName}\" is empty"* / *"Erase the number to go back to folders"*.
* Otherwise: all files of the folder, paginated (50 per answer, `next_offset`).
* There is no "Back to folders" result: like any result it would be sent to the chat. The user erases the number instead.
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

### 4.4 Caching

* Answers use `is_personal: true` and `cache_time: 0`, since results depend on the user and change as soon as they edit their folders.

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
