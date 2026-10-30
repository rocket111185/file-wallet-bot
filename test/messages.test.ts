import { describe, expect, it } from 'vitest';

import type { BotContext } from 'src/bot/context';
import { handleMediaMessage } from 'src/bot/handlers/messages';
import type { UserSession } from 'src/bot/session';
import { createTranslator } from 'src/i18n/i18n';

const setup = () => {
  const { html, text } = createTranslator('en');
  const session: UserSession = { flow: { kind: 'add-files', folder: { id: 'f1', name: 'Work' }, files: [] } };
  const replies: string[] = [];

  const send = (message: Record<string, unknown>) =>
    handleMediaMessage({
      session,
      message,
      chat: { id: 1 },
      t: html,
      tText: text,
      api: { deleteMessage: async () => true },
      reply: async (msg: string) => {
        replies.push(msg);
        return { message_id: replies.length };
      },
    } as unknown as BotContext);

  return { session, replies, send };
};

const photo = (id: string, media_group_id?: string) => ({ photo: [{ file_id: id }], media_group_id });

describe('add-files media handling', () => {
  it('adds a single file', async () => {
    const { session, send } = setup();
    await send(photo('p1'));
    expect(session.flow?.kind === 'add-files' && session.flow.files.map((f) => f.id)).toEqual(['p1']);
  });

  it('rejects album items and warns once per album', async () => {
    const { session, replies, send } = setup();
    await send(photo('p1', 'g1'));
    await send(photo('p2', 'g1'));
    await send(photo('p3', 'g1'));

    expect(session.flow?.kind === 'add-files' && session.flow.files).toEqual([]);
    expect(replies).toEqual(["⚠️ Albums aren't supported yet. Please send files one by one."]);

    await send(photo('p4', 'g2'));
    expect(replies).toHaveLength(2);
  });
});
