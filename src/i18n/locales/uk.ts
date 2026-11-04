import type { Messages } from 'src/i18n/i18n';
import { plural } from 'src/i18n/plural';

/** "N файл / файли / файлів": Ukrainian has one/few/many forms (`other` is only for fractions) */
const files = (count: number, bold = false): string => {
  const n = bold ? `<b>${count}</b>` : String(count);
  return plural('uk', count, { one: `${n} файл`, few: `${n} файли`, many: `${n} файлів`, other: `${n} файлу` });
};

/** "N папка / папки / папок" */
const folders = (count: number): string =>
  plural('uk', count, {
    one: `${count} папка`,
    few: `${count} папки`,
    many: `${count} папок`,
    other: `${count} папки`,
  });

/** Ukrainian messages. Same keys and parameters as the source locale (src/i18n/locales/en.ts). */
export const uk: Messages = {
  // --- Errors (keys are shared with the DB layer, see DB_ERROR_KEYS) ---
  'error-folder-name-length': (p: { max: number }) => `⚠️ Назва папки має містити від 1 до ${p.max} символів.`,
  'error-folder-already-exists': (p: { name: string }) =>
    `⚠️ Папка з назвою '${p.name}' уже існує. Будь ласка, оберіть іншу назву.`,
  'error-folder-not-found': '⚠️ Папку не знайдено.',
  'error-folder-limit': (p: { max: number }) =>
    `⚠️ Ви досягли ліміту: ${folders(p.max)}. Видаліть папку за допомогою /remove_folder, щоб створити нову.`,
  'error-file-limit': (p: { max: number; remaining: number }) =>
    p.remaining === 0
      ? `⚠️ Ця папка заповнена: папка може містити не більше ніж ${files(p.max)}.`
      : `⚠️ Папка може містити не більше ніж ${files(p.max)}, тож до цієї можна додати ще лише ${files(p.remaining)}.`,
  'error-db-get-quota': '❌ Не вдалося перевірити ліміт папок. Спробуйте пізніше.',
  'error-db-add-folder': '❌ Не вдалося створити папку. Спробуйте пізніше.',
  'error-db-rename-folder': '❌ Не вдалося перейменувати папку. Спробуйте пізніше.',
  'error-db-remove-folder': '❌ Не вдалося видалити папку. Спробуйте пізніше.',
  'error-db-list-folders': '❌ Не вдалося завантажити ваші папки. Спробуйте пізніше.',
  'error-db-add-files': '❌ Не вдалося зберегти файли. Спробуйте пізніше.',
  'error-db-remove-files': '❌ Не вдалося видалити файли. Спробуйте пізніше.',
  'error-db-list-files': '❌ Не вдалося завантажити файли. Спробуйте пізніше.',
  'error-db-clear-data': '❌ Не вдалося видалити ваші дані. Спробуйте пізніше.',

  // --- Common ---
  'action-cancelled': 'Дію скасовано.',
  'session-expired': 'Ця дія вже неактуальна. Будь ласка, почніть знову.',
  'button-cancel': '❌ Скасувати',

  // --- Command menu (plain text, at most 256 characters; also listed by /start) ---
  'command-add-folder': 'Створити нову папку',
  'command-add-files': 'Додати файли до наявної папки',
  'command-remove-files': 'Видалити файли з папки',
  'command-rename-folder': 'Перейменувати папку',
  'command-copy-folder': 'Скопіювати папку з усіма файлами',
  'command-remove-folder': 'Видалити папку разом із файлами',
  'command-clear-data': 'Видалити всі ваші дані',
  'command-cancel': 'Скасувати поточну дію',

  // --- /start ---
  'start-welcome': (p: { botUsername: string; commands: string }) =>
    '👋 <b>Вітаємо у File Wallet Bot!</b>\n\n' +
    'Упорядковуйте документи, фото, аудіо та стікери в папки й діліться ними в будь-якому чаті через inline-режим!\n\n' +
    '<b>Доступні команди:</b>\n' +
    `${p.commands}\n\n` +
    `У будь-якому чаті введіть <code>@${p.botUsername}</code>, щоб побачити свої папки, а потім додайте номер ` +
    `папки (наприклад, <code>@${p.botUsername} 1</code>), щоб її відкрити. Торкніться файлу, щоб миттєво надіслати його!`,

  // --- /add_folder ---
  'add-folder-prompt': (p: { max: number }) => `Введіть назву нової папки (1–${p.max} символів):`,
  'folder-name-text-required': '⚠️ Будь ласка, надішліть назву папки текстовим повідомленням.',
  'add-folder-success': (p: { name: string }) =>
    `✅ Папку <b>${p.name}</b> створено!\n\nСкористайтеся /add_files, щоб додати до неї файли.`,

  // --- /add_files ---
  'add-files-no-folders': '⚠️ У вас ще немає папок! Створіть першу за допомогою /add_folder, перш ніж додавати файли.',
  'add-files-choose-folder': 'Оберіть папку, до якої додати файли:',
  'add-files-folder-selected': (p: { name: string }) =>
    `Обрана папка: <b>${p.name}</b>\n\n` +
    'Тепер надішліть файли, які хочете додати (документи, фото, аудіо, стікери, відео).\n' +
    'Коли закінчите, натисніть <b>Зберегти</b>.',
  'add-files-pending': (p: { count: number; name: string }) =>
    `📥 Готово до збереження в <b>${p.name}</b>: ${files(p.count, true)}.`,
  'add-files-saved': (p: { count: number; name: string }) => `✅ Збережено ${files(p.count)} в <b>${p.name}</b>.`,
  'add-files-album-unsupported': '⚠️ Альбоми поки не підтримуються. Будь ласка, надсилайте файли по одному.',
  'add-files-nothing-to-save': '⚠️ Немає файлів для збереження.',
  'add-files-button-save': (p: { count: number }) => `💾 Зберегти (${p.count})`,
  'add-files-folder-full': (p: { max: number }) =>
    `Ця папка заповнена: у ній уже ${files(p.max)}. Оберіть іншу папку або спершу видаліть кілька файлів.`,
  'add-files-limit-reached': (p: { max: number }) =>
    `⚠️ До папки більше не можна додати файлів (максимум ${files(p.max)}). Натисніть <b>Зберегти</b>, щоб зберегти вже надіслані.`,

  // --- /rename_folder ---
  'rename-folder-no-folders': '⚠️ У вас немає папок, які можна перейменувати.',
  'rename-folder-choose-folder': 'Оберіть папку, яку потрібно перейменувати:',
  'rename-folder-prompt': (p: { name: string; max: number }) =>
    `Надішліть нову назву для <b>${p.name}</b> (1–${p.max} символів):`,
  'rename-folder-success': (p: { oldName: string; newName: string }) =>
    `✅ Папку <b>${p.oldName}</b> перейменовано на <b>${p.newName}</b>.`,

  // --- /copy_folder ---
  'copy-folder-no-folders': '⚠️ У вас немає папок, які можна скопіювати.',
  'copy-folder-choose-folder': 'Оберіть папку, яку потрібно скопіювати:',
  'copy-folder-prompt': (p: { name: string; max: number }) =>
    `Надішліть назву для копії <b>${p.name}</b> (1–${p.max} символів):`,
  'copy-folder-success': (p: { name: string; newName: string; count: number }) =>
    `✅ Скопійовано ${files(p.count)} з <b>${p.name}</b> до нової папки <b>${p.newName}</b>.`,

  // --- /remove_folder ---
  'remove-folder-no-folders': '⚠️ У вас немає папок, які можна видалити.',
  'remove-folder-choose-folder': 'Оберіть папку, яку потрібно видалити:',
  'remove-folder-confirm': (p: { name: string; count: number }) =>
    `⚠️ <b>Ви впевнені, що хочете видалити папку ${p.name}?</b>\n` +
    `Папку та ${plural('uk', p.count, {
      one: 'єдиний файл у ній',
      few: `усі ${p.count} файли в ній`,
      many: `усі ${p.count} файлів у ній`,
      other: `усі ${p.count} файлу в ній`,
    })} буде видалено назавжди!`,
  'remove-folder-button-confirm': '🗑️ Так, видалити папку',
  'remove-folder-success': (p: { name: string }) => `✅ Папку <b>${p.name}</b> і її файли видалено.`,
  'remove-folder-cancelled': 'Видалення папки скасовано.',

  // --- /remove_files ---
  'remove-files-no-folders': '⚠️ У вас немає папок.',
  'remove-files-choose-folder': 'Оберіть папку, з якої потрібно видалити файли:',
  'remove-files-empty': (p: { name: string }) => `⚠️ Папка <b>${p.name}</b> порожня. Немає файлів для видалення.`,
  'remove-files-choose-files': (p: { name: string; page: number; pages: number }) =>
    `Торкніться файлів, які потрібно видалити з <b>${p.name}</b>, а потім натисніть <b>Видалити обрані</b>.` +
    (p.pages > 1 ? `\n\nСторінка ${p.page} з ${p.pages}` : ''),
  'remove-files-button-prev': '◀️ Назад',
  'remove-files-button-next': 'Далі ▶️',
  'remove-files-button-delete': (p: { count: number }) => `🗑️ Видалити обрані (${p.count})`,
  'remove-files-nothing-selected': '⚠️ Оберіть хоча б один файл для видалення.',
  'remove-files-success': (p: { count: number; name: string }) => `✅ Видалено ${files(p.count)} з <b>${p.name}</b>.`,

  // --- /clear_data ---
  'clear-data-confirm':
    '⚠️ <b>УВАГА: ЦЮ ДІЮ НЕ МОЖНА СКАСУВАТИ</b>\n\n' +
    'Усі ваші папки та файли буде видалено назавжди.\n\n' +
    'Ви впевнені, що хочете продовжити?',
  'clear-data-button-confirm': '💥 Так, видалити всі мої дані',
  'clear-data-success': '🧹 Усі ваші дані повністю й остаточно видалено.',
  'clear-data-cancelled': 'Операцію скасовано. Ваші дані в безпеці.',

  // --- Default file names (used when Telegram provides no name or caption) ---
  'file-default-document': 'Документ',
  'file-default-photo': 'Фото',
  'file-default-audio': 'Аудіо',
  'file-default-video': 'Відео',
  'file-default-voice': 'Голосове повідомлення',
  'file-default-sticker': 'Стікер',
  'file-default-animation': 'GIF',

  // --- Inline mode (titles and descriptions are plain text, not HTML) ---
  'inline-error-title': 'Щось пішло не так',
  'inline-error-description': 'Спробуйте пізніше',
  'inline-no-folders-title': 'Папок не знайдено',
  'inline-no-folders-description': 'Відкрийте чат із ботом і створіть папку командою /add_folder',
  'inline-folder-description': (p: { n: number }) => `Введіть ${p.n} після імені бота, щоб відкрити цю папку`,
  'inline-unknown-folder-title': (p: { n: number }) => `Немає папки №${p.n}`,
  'inline-unknown-folder-description': 'Зітріть номер, щоб побачити всі папки',
  'inline-empty-folder-title': (p: { name: string }) => `«${p.name}» порожня`,
  'inline-empty-folder-description': 'Зітріть номер, щоб повернутися до папок',
};
