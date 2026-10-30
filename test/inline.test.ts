import { describe, expect, it } from 'vitest';

import type { BaseContext } from 'src/bot/context';
import { handleInlineQuery } from 'src/bot/handlers/inline';
import type { Database } from 'src/db/db.interface';
import { createTranslator } from 'src/i18n/i18n';
import type { FileItem, FolderInfo } from 'src/types';

type Answer = { results: { type: string; title?: string }[]; opts: { next_offset?: string } };

const run = async (query: string, folders: FolderInfo[], files: Record<string, FileItem[]> = {}, offset = '') => {
  const answers: Answer[] = [];
  const db = {
    listFolders: async () => ({ error: false, data: folders }),
    listFiles: async (_: unknown, folderId: string) => ({ error: false, data: files[folderId] ?? [] }),
  } as unknown as Database;
  const { html, text } = createTranslator('en');

  const ctx = {
    from: { id: 1 },
    inlineQuery: { query, offset },
    db,
    t: html,
    tText: text,
    answerInlineQuery: async (results: Answer['results'], opts: Answer['opts']) => {
      answers.push({ results, opts });
      return true;
    },
  } as unknown as BaseContext;

  await handleInlineQuery(ctx);
  expect(answers).toHaveLength(1);
  return answers[0];
};

const folders = (count: number): FolderInfo[] =>
  Array.from({ length: count }, (_, i) => ({ id: `f${i + 1}`, name: `Folder ${i + 1}` }));

describe('inline mode', () => {
  it('lists numbered folders for an empty query', async () => {
    const { results } = await run('', folders(2));
    expect(results.map((r) => r.title)).toEqual(['1. Folder 1', '2. Folder 2']);
  });

  it('shows the folder list for non-numeric queries instead of filtering', async () => {
    const { results } = await run('Folder 2', folders(2));
    expect(results).toHaveLength(2);
  });

  it('opens a folder by number', async () => {
    const files = { f2: [{ id: 'doc', name: 'cv.pdf', type: 'document' as const }] };
    const { results } = await run(' 2 ', folders(2), files);
    expect(results).toEqual([expect.objectContaining({ type: 'document', title: 'cv.pdf' })]);
  });

  it('does not treat "number + text" as a folder number', async () => {
    const { results } = await run('2 cv', folders(2));
    expect(results.map((r) => r.title)).toEqual(['1. Folder 1', '2. Folder 2']);
  });

  it('reports unknown folder numbers', async () => {
    const { results } = await run('5', folders(2));
    expect(results[0].title).toBe('No folder #5');
  });

  it('paginates folders and keeps numbering across pages', async () => {
    const first = await run('', folders(60));
    expect(first.results).toHaveLength(50);
    expect(first.opts.next_offset).toBe('50');

    const second = await run('', folders(60), {}, '50');
    expect(second.results).toHaveLength(10);
    expect(second.results[0].title).toBe('51. Folder 51');
    expect(second.opts.next_offset).toBe('');
  });
});
