import { createHash } from 'node:crypto';
import { InlineQueryResultBuilder } from 'grammy';
import type { InlineQueryResult } from 'grammy/types';
import type { BotContext } from 'src/bot/context';
import { fileDisplayName } from 'src/bot/utils';
import type { Translate } from 'src/i18n/i18n';
import { logger } from 'src/logger';
import type { FileItem } from 'src/types';
import { escapeHtml } from 'src/utils';

// Telegram accepts at most 50 results per answer; the rest is fetched via `next_offset`
const PAGE_SIZE = 50;

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

export const handleInlineQuery = async (ctx: BotContext): Promise<void> => {
  const userId = ctx.from?.id;
  if (!userId || !ctx.inlineQuery) return;

  const t = ctx.tText; // Titles and descriptions are plain text
  const opts = { cache_time: 0, is_personal: true } as const;
  const offset = Number(ctx.inlineQuery.offset) || 0;
  const errorResult = () => info('err', t('inline-error-title'), t('inline-error-description'));

  const foldersRes = await ctx.db.listFolders(userId);
  if (foldersRes.error) {
    await ctx.answerInlineQuery([errorResult()], opts);
    return;
  }
  const folders = foldersRes.data; // Folder number = position in this list + 1

  const folderNumber = parseFolderNumber(ctx.inlineQuery.query);

  // ---- Folder list ----
  if (folderNumber === null) {
    if (folders.length === 0) {
      await ctx.answerInlineQuery(
        [info('none', t('inline-no-folders-title'), t('inline-no-folders-description'))],
        opts,
      );
      return;
    }

    const { page, next_offset } = paginate(folders, offset);
    const results = page.map((folder, i) => {
      const n = offset + i + 1;
      return InlineQueryResultBuilder.article(resultId('folder', folder.id), `${n}. ${folder.name}`, {
        description: t('inline-folder-description', { n }),
      }).text(`<b>${escapeHtml(folder.name)}</b>`, { parse_mode: 'HTML' });
    });
    await ctx.answerInlineQuery(results, { ...opts, next_offset });
    return;
  }

  // ---- Files in folder ----
  const folder = folders[folderNumber - 1];
  if (!folder) {
    await ctx.answerInlineQuery(
      [info('nofolder', t('inline-unknown-folder-title', { n: folderNumber }), t('inline-unknown-folder-description'))],
      opts,
    );
    return;
  }

  const filesRes = await ctx.db.listFiles(userId, folder.id);
  if (filesRes.error) {
    await ctx.answerInlineQuery([errorResult()], opts);
    return;
  }

  if (filesRes.data.length === 0) {
    await ctx.answerInlineQuery(
      [info('empty', t('inline-empty-folder-title', { name: folder.name }), t('inline-empty-folder-description'))],
      opts,
    );
    return;
  }

  const { page, next_offset } = paginate(filesRes.data, offset);

  try {
    await ctx.answerInlineQuery(
      page.map((file) => fileResult(t, file)),
      { ...opts, next_offset },
    );
  } catch (err) {
    logger.error('inline.answer.failed', { userId, folderId: folder.id, offset, count: page.length, err });
    await ctx.answerInlineQuery([errorResult()], opts);
  }
};
