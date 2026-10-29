import { InlineKeyboard } from 'grammy';
import type { BotContext } from 'src/bot/context';
import { initialSession } from 'src/types';

export const handleStart = async (ctx: BotContext): Promise<void> => {
  ctx.session.action = null;

  const username = ctx.me?.username ? `@${ctx.me.username}` : 'the bot';
  const text =
    '👋 **Welcome to File Wallet Bot!**\n\n' +
    'Organize your documents, photos, audio, and stickers into folders, and share them in any chat via inline mode!\n\n' +
    '**Available commands:**\n' +
    '`/add_folder` - Create a new folder\n' +
    '`/add_files` - Add files to an existing folder\n' +
    '`/cancel` - Cancel current action\n\n' +
    `In any chat, type \`${username}\` to browse your folders and share saved files instantly!`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
};

export const handleCancel = async (ctx: BotContext): Promise<void> => {
  if (ctx.session.pendingMessageId && ctx.chat) {
    try {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.session.pendingMessageId);
    } catch {
      // Ignore if message already deleted
    }
  }

  ctx.session = initialSession();
  await ctx.reply('Action cancelled.');
};

export const handleAddFolderCommand = async (ctx: BotContext): Promise<void> => {
  ctx.session.action = 'add-folder';
  await ctx.reply('Please enter the name for your new folder (1–32 characters):');
};

export const handleAddFilesCommand = async (ctx: BotContext): Promise<void> => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const foldersRes = await ctx.db.listFolders(userId);
  if (foldersRes.error) {
    await ctx.reply(foldersRes.message ?? 'Failed to retrieve folders.');
    return;
  }

  const folders = foldersRes.data;
  if (folders.length === 0) {
    await ctx.reply(
      'You do not have any folders yet!\nUse `/add_folder` to create your first folder before adding files.',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const folder of folders) {
    keyboard.text(`${folder.name}`, `af:select:${folder.id}`).row();
  }
  keyboard.text('Cancel', 'af:cancel');

  ctx.session.action = 'add-files';
  await ctx.reply('Choose a folder to add files to:', {
    reply_markup: keyboard,
  });
};
