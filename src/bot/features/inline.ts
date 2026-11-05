import { createHash } from 'node:crypto';
import { Composer, InlineQueryResultBuilder } from 'grammy';
import type { InlineQueryResult } from 'grammy/types';

import type { BaseContext } from 'src/bot/context';
import { fileDisplayName, uniqueFiles } from 'src/bot/utils';
import { HELP_START_PARAMETER } from 'src/bot/features/start';

import type { Translate } from 'src/i18n/i18n';
import type { FileItem } from 'src/types';
import { escapeHtml } from 'src/utils';

// Telegram accepts at most 50 results per answer; the rest is fetched via `next_offset`
const PAGE_SIZE = 50;

// How long Telegram may reuse an answer for the same query from the same user, unless configured
// otherwise (INLINE_CACHE_SECONDS in wrangler.jsonc)
export const DEFAULT_CACHE_SECONDS = 30;

const resultId = (prefix: string, raw: string): string =>
  `${prefix}:${createHash('sha1').update(raw).digest('hex').slice(0, 32)}`;

/**
 * Selecting an inline result always sends it, so folders can't be opened by tapping them.
 * Instead the query is the folder's number: "" lists folders, "2" opens folder #2.
 *
 * @returns 1-based folder number, or null when the query is not a number (folder list is shown)
 */
const parseFolderNumber = (query: string): number | null => {
  const m = query.trim().match(/^\d+$/);
  return m ? Number(m[0]) : null;
};

const fileResult = (t: Translate, file: FileItem): InlineQueryResult => {
  const id = resultId('file', file.id);
  const title = fileDisplayName(t, file);
  switch (file.type) {
    case 'photo':
      return InlineQueryResultBuilder.photoCached(id, file.id);
    case 'audio':
      return InlineQueryResultBuilder.audioCached(id, file.id);
    case 'video':
      return InlineQueryResultBuilder.videoCached(id, title, file.id);
    case 'voice':
      return InlineQueryResultBuilder.voiceCached(id, title, file.id);
    case 'sticker':
      return InlineQueryResultBuilder.stickerCached(id, file.id);
    case 'animation':
      return InlineQueryResultBuilder.gifCached(id, file.id);
    default:
      return InlineQueryResultBuilder.documentCached(id, title, file.id);
  }
};

const info = (id: string, title: string, description: string): InlineQueryResult =>
  InlineQueryResultBuilder.article(id, title, { description }).text(title);

const paginate = <T>(items: T[], offset: number) => ({
  page: items.slice(offset, offset + PAGE_SIZE),
  next_offset: offset + PAGE_SIZE < items.length ? String(offset + PAGE_SIZE) : '',
});

export const handleInlineQuery = async (ctx: BaseContext, cacheSeconds = DEFAULT_CACHE_SECONDS): Promise<void> => {
  const userId = ctx.from?.id;
  if (!userId || !ctx.inlineQuery) return;

  const t = ctx.tText; // Titles and descriptions are plain text
  // Repeated queries are answered by Telegram from its cache, without reaching the Worker. Edits show
  // up in inline mode after at most `cacheSeconds`.
  const opts = { cache_time: cacheSeconds, is_personal: true } as const;
  const offset = Number(ctx.inlineQuery.offset) || 0;
  const errorResult = () => info('err', t('inline-error-title'), t('inline-error-description'));

  const folderNumber = parseFolderNumber(ctx.inlineQuery.query);

  // ---- Folder list ----
  if (folderNumber === null) {
    // The help button sits above the folder list and opens the bot chat, instead of sending anything to
    // the current one (unlike any result, see parseFolderNumber). Someone who typed a folder number
    // already knows how this works, so folder contents don't get it.
    const listOpts = {
      ...opts,
      button: { text: t('inline-help-button'), start_parameter: HELP_START_PARAMETER },
    };

    const foldersRes = await ctx.db.listFolders(userId);
    if (foldersRes.error) {
      await ctx.answerInlineQuery([errorResult()], listOpts);
      return;
    }
    const folders = foldersRes.data; // Folder number = position in this list + 1

    if (folders.length === 0) {
      await ctx.answerInlineQuery(
        [info('none', t('inline-no-folders-title'), t('inline-no-folders-description'))],
        listOpts,
      );
      return;
    }

    const { page, next_offset } = paginate(folders, offset);
    const results = page.map((folder, i) => {
      const n = offset + i + 1;
      // How the numbers work is explained by the help button
      return InlineQueryResultBuilder.article(resultId('folder', folder.id), `${n}. ${folder.name}`).text(
        `<b>${escapeHtml(folder.name)}</b>`,
        { parse_mode: 'HTML' },
      );
    });

    await ctx.answerInlineQuery(results, { ...listOpts, next_offset });
    return;
  }

  // ---- Files in folder ----
  // One call: the folder is looked up by number and its files are read together
  const contentsRes = await ctx.db.getFolderContents(userId, folderNumber);
  if (contentsRes.error) {
    await ctx.answerInlineQuery([errorResult()], opts);
    return;
  }

  if (!contentsRes.data) {
    await ctx.answerInlineQuery(
      [info('nofolder', t('inline-unknown-folder-title', { n: folderNumber }), t('inline-unknown-folder-description'))],
      opts,
    );
    return;
  }
  const { folder, files: storedFiles } = contentsRes.data;

  // Telegram rejects the whole answer if two results share an id (RESULT_ID_DUPLICATE)
  const files = uniqueFiles(storedFiles);

  if (files.length === 0) {
    await ctx.answerInlineQuery(
      [info('empty', t('inline-empty-folder-title', { name: folder.name }), t('inline-empty-folder-description'))],
      opts,
    );
    return;
  }

  const { page, next_offset } = paginate(files, offset);
  await ctx.answerInlineQuery(
    page.map((file) => fileResult(t, file)),
    { ...opts, next_offset },
  );
};

/** Inline mode: answered by the Worker straight from the user's UserVault, without a session */
export const createInline = (cacheSeconds = DEFAULT_CACHE_SECONDS): Composer<BaseContext> => {
  const inline = new Composer<BaseContext>();
  inline.on('inline_query', (ctx) => handleInlineQuery(ctx, cacheSeconds));
  return inline;
};
