import { describe, expect, it } from 'vitest';

import { createTranslator, resolveLocale } from 'src/i18n/i18n';
import { DB_ERROR_KEYS } from 'src/types';
import { translateError } from 'src/bot/utils';

describe('i18n', () => {
  const { html, text } = createTranslator('en');

  it('escapes string params in HTML messages only', () => {
    expect(html('add-folder-success', { name: '<b>&' })).toContain('<b>&lt;b&gt;&amp;</b>');
    expect(text('inline-empty-folder-title', { name: '<b>&' })).toBe('"<b>&" is empty');
  });

  it('picks plural forms', () => {
    expect(text('add-files-saved', { count: 1, name: 'X' })).toContain('1 file to');
    expect(text('add-files-saved', { count: 3, name: 'X' })).toContain('3 files to');
  });

  it('translates DB errors with their params', () => {
    expect(translateError(text, { error: true, key: DB_ERROR_KEYS.FOLDER_NAME_LENGTH, params: { max: 32 } })).toContain(
      'between 1 and 32',
    );
  });

  it('falls back to the default locale', () => {
    expect(resolveLocale(undefined)).toBe('en');
    expect(resolveLocale('en-GB')).toBe('en');
    expect(resolveLocale('xx')).toBe('en');
  });
});
