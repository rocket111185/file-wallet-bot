import { MemorySessionStorage } from 'grammy';
import type { Message, Update, UserFromGetMe } from 'grammy/types';

import { createChatBot } from 'src/bot/chat-bot';
import { CloudflareKVDatabase } from 'src/db/db.cloudflare';
import type { UserSession } from 'src/session/session';

export const USER_ID = 1;

/** In-memory stand-in for KV, enough for CloudflareKVDatabase */
export const createMemoryKV = () => {
  const data = new Map<string, string>();
  const kv = {
    get: async (key: string) => (data.has(key) ? JSON.parse(data.get(key)!) : null),
    put: async (key: string, value: string) => void data.set(key, value),
    delete: async (key: string) => void data.delete(key),
    list: async ({ prefix }: { prefix: string }) => ({
      keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  };
  return { kv: kv as unknown as KVNamespace, data };
};

/**
 * The real chat bot, with an in-memory KV and session storage and a fake Telegram API that records
 * every call instead of sending it
 */
export const createTestBot = () => {
  const { kv, data } = createMemoryKV();
  const db = new CloudflareKVDatabase(kv);
  const sessions = new MemorySessionStorage<UserSession>();

  const bot = createChatBot({
    token: 'test',
    db,
    botInfo: { id: 2, is_bot: true, first_name: 'Bot', username: 'test_bot' } as UserFromGetMe,
    sessionStorage: sessions,
  });

  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  let messageId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result = method === 'sendMessage' ? { message_id: ++messageId, date: 0, chat: { id: USER_ID } } : true;
    return { ok: true, result } as never;
  });

  let updateId = 0;
  const from = { id: USER_ID, is_bot: false, first_name: 'User', language_code: 'en' };
  const chat = { id: USER_ID, type: 'private' as const, first_name: 'User' };

  /** Sends a message from the user; `text` starting with "/" is a command */
  const send = (message: string | Partial<Message>) => {
    const fields =
      typeof message === 'string'
        ? {
            text: message,
            entities: message.startsWith('/')
              ? [{ type: 'bot_command' as const, offset: 0, length: message.split(' ')[0].length }]
              : undefined,
          }
        : message;
    return bot.handleUpdate({
      update_id: ++updateId,
      message: { message_id: ++messageId, date: 0, chat, from, ...fields },
    } as Update);
  };

  /** Presses an inline button */
  const press = (callbackData: string) =>
    bot.handleUpdate({
      update_id: ++updateId,
      callback_query: {
        id: String(updateId),
        from,
        chat_instance: '1',
        data: callbackData,
        message: { message_id: 1, date: 0, chat, text: 'menu' },
      },
    } as Update);

  /** Text of the last message the bot sent or edited */
  const lastText = () =>
    calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').at(-1)?.payload.text;

  /** Alert text of the last answered button press */
  const lastAlert = () => calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)?.payload.text;

  const flow = () => sessions.read(String(USER_ID))?.flow ?? null;

  const folders = async () => {
    const res = await db.listFolders(USER_ID);
    return res.error ? [] : res.data;
  };

  const addFolder = async (name: string) => {
    const res = await db.addFolder(USER_ID, name);
    if (res.error) throw new Error(res.key);
    return res.data.id;
  };

  return { bot, db, data, calls, send, press, lastText, lastAlert, flow, folders, addFolder };
};

export const photo = (fileId: string, media_group_id?: string): Partial<Message> =>
  ({ photo: [{ file_id: fileId }], media_group_id }) as Partial<Message>;
