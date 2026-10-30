import type { StorageAdapter } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { describe, expect, it } from 'vitest';

import { createChatBot } from 'src/bot/chat-bot';
import type { UserSession } from 'src/bot/session';
import type { Database } from 'src/db/db.interface';
import { createSerialQueue } from 'src/utils';

const USER_ID = 1;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Session storage that is slow like a real one, so parallel updates actually overlap */
const createSlowStorage = (initial: UserSession) => {
  const data = new Map<string, UserSession>([[String(USER_ID), initial]]);
  const storage: StorageAdapter<UserSession> = {
    read: async (key) => {
      await sleep(5);
      return structuredClone(data.get(key));
    },
    write: async (key, value) => {
      await sleep(5);
      data.set(key, structuredClone(value));
    },
    delete: async (key) => {
      data.delete(key);
    },
  };
  return { storage, data };
};

const setup = () => {
  const { storage, data } = createSlowStorage({
    flow: { kind: 'add-files', folder: { id: 'f1', name: 'Work' }, files: [] },
  });
  const bot = createChatBot({
    token: 'test',
    db: {} as Database,
    botInfo: { id: 2, is_bot: true, first_name: 'Bot', username: 'test_bot' } as UserFromGetMe,
    sessionStorage: storage,
  });

  // Fake Telegram API: nothing leaves the test
  let messageId = 100;
  bot.api.config.use(async (_prev, method) => {
    const result = method === 'sendMessage' ? { message_id: ++messageId, date: 0, chat: { id: USER_ID } } : true;
    return { ok: true, result } as never;
  });

  const savedFileIds = () => {
    const flow = data.get(String(USER_ID))?.flow;
    return flow?.kind === 'add-files' ? flow.files.map((f) => f.id) : [];
  };
  return { bot, savedFileIds };
};

const photoUpdate = (n: number): Update => ({
  update_id: n,
  message: {
    message_id: n,
    date: 0,
    chat: { id: USER_ID, type: 'private', first_name: 'User' },
    from: { id: USER_ID, is_bot: false, first_name: 'User' },
    photo: [{ file_id: `p${n}`, file_unique_id: `u${n}`, width: 1, height: 1 }],
  },
});

describe('createSerialQueue', () => {
  it('runs tasks one at a time, in order', async () => {
    const enqueue = createSerialQueue();
    const log: string[] = [];
    const task = (name: string, ms: number) => async () => {
      log.push(`start ${name}`);
      await sleep(ms);
      log.push(`end ${name}`);
      return name;
    };

    const results = await Promise.all([enqueue(task('a', 10)), enqueue(task('b', 1)), enqueue(task('c', 5))]);

    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('keeps going after a failed task, and reports the failure to its caller', async () => {
    const enqueue = createSerialQueue();
    const failed = enqueue(async () => {
      throw new Error('boom');
    });
    const next = enqueue(async () => 'ok');

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});

describe('parallel updates from one user', () => {
  it('keeps every file when the updates are queued (as UserChat does)', async () => {
    const { bot, savedFileIds } = setup();
    const enqueue = createSerialQueue();

    await Promise.all([1, 2, 3].map((n) => enqueue(() => bot.handleUpdate(photoUpdate(n)))));

    expect(savedFileIds()).toEqual(['p1', 'p2', 'p3']);
  });

  it('loses files without the queue (the reason UserChat queues updates)', async () => {
    const { bot, savedFileIds } = setup();

    await Promise.all([1, 2, 3].map((n) => bot.handleUpdate(photoUpdate(n))));

    expect(savedFileIds()).toHaveLength(1);
  });
});
