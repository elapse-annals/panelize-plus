// T074: Internationalization (i18n) utility module
// Provides helper functions for Chrome i18n API
import { DEFAULT_LOCALE, normalizeLocale } from './locale.js';
import { getSetting } from './settings.js';

// Translation cache for custom language override
let translationCache = null;
let currentLocale = null;

/**
 * Load translations from a specific locale
 * @param {string} locale - Locale code ('en' or 'zh_CN')
 * @returns {Promise<Object>} Translation messages object
 */
async function loadTranslations(locale) {
  try {
    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Translation request failed: ${response.status}`);
    }
    const messages = await response.json();
    return messages;
  } catch (error) {
    console.warn(`Failed to load translations for locale: ${locale}`, error);
    return null;
  }
}

/**
 * Initialize i18n with user's preferred language
 * @param {string} preferredLocale - User's preferred locale from settings
 */
export async function initializeLanguage(preferredLocale = null) {
  const locale = normalizeLocale(preferredLocale ?? await getSetting('language'));

  // Load the translations
  translationCache = await loadTranslations(locale);
  currentLocale = locale;

  // Prefer Chinese on failure, with English as a last available fallback.
  if (!translationCache) {
    const fallbackLocale = locale === DEFAULT_LOCALE ? 'en' : DEFAULT_LOCALE;
    translationCache = await loadTranslations(fallbackLocale);
    currentLocale = fallbackLocale;
  }
}

/**
 * Get translated message with substitutions support
 * @param {string} key - Message key from messages.json
 * @param {string|string[]} substitutions - Optional substitution values
 * @returns {string} Translated message
 */
export function t(key, substitutions = null) {
  // If we have custom translations loaded, use them
  if (translationCache && translationCache[key]) {
    let message = translationCache[key].message || '';

    // Handle substitutions
    if (substitutions) {
      const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
      subs.forEach((sub, index) => {
        const placeholder = `$${index + 1}`;
        message = message.replace(new RegExp(`\\$${index + 1}`, 'g'), sub);
        // Also try $PLACEHOLDER$ format
        if (translationCache[key].placeholders) {
          Object.entries(translationCache[key].placeholders).forEach(([name, config]) => {
            if (config.content === placeholder) {
              message = message.replace(new RegExp(`\\$${name.toUpperCase()}\\$`, 'g'), sub);
            }
          });
        }
      });
    }

    return message;
  }

  // Fallback to Chrome's native i18n
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n) {
      return chrome.i18n.getMessage(key, substitutions) || key;
    }
  } catch (error) {
    // chrome.i18n not available
  }
  return key;
}

/**
 * Translate all elements with data-i18n attribute
 * @param {HTMLElement} root - Root element to search (default: document)
 */
export function translatePage(root = document) {
  if (root === document) {
    document.documentElement.lang = getTranslationLocale().replace('_', '-');
  }

  // Translate elements with data-i18n attribute for text content
  root.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    if (key) {
      element.textContent = t(key);
    }
  });

  // Translate elements with data-i18n-html attribute for HTML content
  root.querySelectorAll('[data-i18n-html]').forEach(element => {
    const key = element.getAttribute('data-i18n-html');
    if (key) {
      element.innerHTML = t(key);
    }
  });

  // Translate placeholders
  root.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    if (key) {
      element.placeholder = t(key);
    }
  });

  // Translate titles/tooltips
  root.querySelectorAll('[data-i18n-title]').forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    if (key) {
      element.title = t(key);
    }
  });

  // Translate aria-labels
  root.querySelectorAll('[data-i18n-aria]').forEach(element => {
    const key = element.getAttribute('data-i18n-aria');
    if (key) {
      element.setAttribute('aria-label', t(key));
    }
  });
}

/**
 * Get current UI language
 * @returns {string} Locale code ('en' or 'zh_CN')
 */
export function getCurrentLanguage() {
  return getTranslationLocale();
}

/**
 * Locale of the loaded translations, which follows the language setting.
 * @returns {string} Locale code (e.g., 'en', 'zh_CN')
 */
export function getTranslationLocale() {
  return currentLocale || DEFAULT_LOCALE;
}

/**
 * Initialize i18n for a page
 * Call this on DOMContentLoaded
 */
export function initI18n() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => translatePage());
  } else {
    translatePage();
  }
}

// Export as default for convenience
export default {
  t,
  translatePage,
  getCurrentLanguage,
  initI18n,
  initializeLanguage
};
