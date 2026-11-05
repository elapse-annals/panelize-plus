export const DEFAULT_LOCALE = 'zh_CN';

/** Keep English preferences; all other or missing locales use Chinese. */
export function normalizeLocale(locale) {
  return typeof locale === 'string' && /^en(?:[-_]|$)/i.test(locale)
    ? 'en'
    : DEFAULT_LOCALE;
}
