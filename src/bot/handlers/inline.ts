import { createHash } from 'node:crypto';
import { InlineQueryResultBuilder } from 'grammy';
import type { InlineQueryResult } from 'grammy/types';
import type { BotContext } from 'src/bot/context';
import type { FileItem } from 'src/types';

const PAGE_SIZE = 50;

const resultId = (prefix: string, raw: string): string =>
  `${prefix}:${createHash('sha1').update(raw).digest('hex').slice(0, 32)}`;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// "2" -> folder #2, "2 report" -> folder #2 filtered by "report"
const parseQuery = (q: string) => {
  const m = q.trim().match(/^(\d+)(?:\s+(.*))?$/);
  return m ? { index: Number(m[1]), search: (m[2] ?? '').trim().toLowerCase() } : null;
};

const fileResult = (file: FileItem): InlineQueryResult => {
  const id = resultId('file', file.id);
  switch (file.type) {
    case 'photo':     return InlineQueryResultBuilder.photoCached(id, file.id);
    case 'audio':     return InlineQueryResultBuilder.audioCached(id, file.id);
    case 'video':     return InlineQueryResultBuilder.videoCached(id, file.name, file.id);
    case 'voice':     return InlineQueryResultBuilder.voiceCached(id, file.name, file.id);
    case 'sticker':   return InlineQueryResultBuilder.stickerCached(id, file.id);
    case 'animation': return InlineQueryResultBuilder.gifCached(id, file.id);
    default:          return InlineQueryResultBuilder.documentCached(id, file.name, file.id);
  }
};

const info = (id: string, title: string, description: string): InlineQueryResult =>
  InlineQueryResultBuilder.article(id, title, { description }).text(title);

export const handleInlineQuery = async (ctx: BotContext): Promise<void> => {
  const userId = ctx.from?.id;
  if (!userId || !ctx.inlineQuery) return;

  const opts = { cache_time: 0, is_personal: true } as const;
  const query = ctx.inlineQuery.query;
  const offset = Number(ctx.inlineQuery.offset) || 0;

  console.log('[inline] query=%j offset=%d', query, offset); // DEBUG

  const foldersRes = await ctx.db.listFolders(userId);
  if (foldersRes.error) {
    console.error('[inline] listFolders failed', foldersRes.error);
    await ctx.answerInlineQuery([info('err', 'Database error', 'Try again later')], opts);
    return;
  }
  const folders = foldersRes.data; // already sorted; position = number

  const parsed = parseQuery(query);

  // ---- Folder list ----
  if (!parsed) {
    const q = query.trim().toLowerCase();

    // Number is assigned BEFORE filtering so it matches the unfiltered list
    const numbered = folders.map((folder, i) => ({ folder, n: i + 1 }));
    const list = numbered.filter(({ folder }) => !q || folder.name.toLowerCase().includes(q));

    if (list.length === 0) {
      await ctx.answerInlineQuery(
        [info('none', 'No folders found', 'Use /add_folder in the bot chat')],
        opts,
      );
      return;
    }

    const results = list.slice(0, PAGE_SIZE).map(({ folder, n }) =>
      InlineQueryResultBuilder.article(resultId('folder', folder.id), `${n}. ${folder.name}`, {
        description: `Type "${n}" after the bot name to open`,
      }).text(`📁 <b>${escapeHtml(folder.name)}</b>`, { parse_mode: 'HTML' }),
    );
    await ctx.answerInlineQuery(results, opts);
    return;
  }

  // ---- Files in folder ----
  const folder = folders[parsed.index - 1];
  if (!folder) {
    await ctx.answerInlineQuery(
      [info('nofolder', `No folder #${parsed.index}`, 'Clear the query to see all folders')],
      opts,
    );
    return;
  }

  const filesRes = await ctx.db.listFiles(userId, folder.id);
  if (filesRes.error) {
    console.error('[inline] listFiles failed', filesRes.error);
    await ctx.answerInlineQuery([info('err', 'Database error', 'Try again later')], opts);
    return;
  }

  const files = parsed.search
    ? filesRes.data.filter((f) => f.name.toLowerCase().includes(parsed.search))
    : filesRes.data;

  console.log('[inline] folder=%s files=%d', folder.name, files.length); // DEBUG

  if (files.length === 0) {
    await ctx.answerInlineQuery(
      [info('empty', `"${folder.name}" has no matching files`, 'Clear the query to go back')],
      opts,
    );
    return;
  }

  const page = files.slice(offset, offset + PAGE_SIZE);
  const next = offset + PAGE_SIZE < files.length ? String(offset + PAGE_SIZE) : '';

  try {
    await ctx.answerInlineQuery(page.map(fileResult), { ...opts, next_offset: next });
  } catch (err) {
    console.error('[inline] answerInlineQuery failed', err);
    await ctx.answerInlineQuery(
      [info('fail', 'Could not load files', 'Check the bot logs')],
      opts,
    );
  }
};
