/**
 * Lightweight i18n engine for TaskList plugin.
 * Supports zh (Chinese) and en (English) with dot-notation key lookup.
 */

// Module-level state — intentionally mutable for simplicity
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let locale: Record<string, any> = {};
let currentLanguage: string = 'zh';

/**
 * Load a locale dictionary by language code.
 * Called once during plugin init and whenever the user changes language.
 */
export function initI18n(lang: string): void {
  currentLanguage = lang;
  // The actual JSON loading happens externally (import or fetch via Obsidian).
  // This function is paired with a JSON import pattern:
  //   import zh from './locales/zh.json'
  //   initI18n('zh'); setLocale(zh);
}

/**
 * Set the current locale dictionary directly.
 * Used after importing JSON language packs.
 */
export function setLocale(dict: Record<string, any>): void {
  locale = dict;
}

/**
 * Get the current language code ('zh' or 'en').
 */
export function getLanguage(): string {
  return currentLanguage;
}

/**
 * Translate a dot-notation key to its localized string.
 * Falls back to the key itself if not found, logging a warning.
 *
 * @example t('settings.databasePath.name') → '数据库文件路径'
 */
export function t(key: string): string {
  const parts = key.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = locale;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      console.warn(`[TaskList i18n] Missing translation: "${key}"`);
      return key;
    }
    current = current[part];
  }

  if (typeof current !== 'string') {
    console.warn(`[TaskList i18n] Missing translation: "${key}"`);
    return key;
  }

  return current;
}
