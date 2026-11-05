import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let i18n;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('chrome', {
    ...chrome,
    runtime: { ...chrome.runtime, getURL: vi.fn(path => `chrome-extension://test/${path}`) },
    storage: {
      ...chrome.storage,
      sync: { ...chrome.storage.sync, get: vi.fn(async defaults => defaults) },
      local: { ...chrome.storage.local, get: vi.fn(async defaults => defaults) }
    },
    i18n: { getUILanguage: vi.fn(() => 'en-US'), getMessage: vi.fn(() => '') }
  });
  vi.stubGlobal('fetch', vi.fn(async url => ({
    ok: true,
    json: async () => JSON.parse(readFileSync(new URL(url).pathname.slice(1), 'utf8'))
  })));
  i18n = await import('../../../modules/platform/i18n.js');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('interface language', () => {
  it('defaults to Chinese even in an English browser and translates the page', async () => {
    expect(i18n.getTranslationLocale()).toBe('zh_CN');
    await i18n.initializeLanguage();
    document.body.innerHTML = '<span data-i18n="labelLanguage"></span>';
    i18n.translatePage();

    expect(i18n.getCurrentLanguage()).toBe('zh_CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.querySelector('span').textContent).toBe('语言');
    expect(chrome.i18n.getUILanguage).not.toHaveBeenCalled();
  });

  it('keeps saved English and applies substitutions from its language pack', async () => {
    chrome.storage.sync.get.mockResolvedValue({ language: 'en' });
    await i18n.initializeLanguage();

    expect(i18n.getTranslationLocale()).toBe('en');
    expect(i18n.t('labelLanguage')).toBe('Language');
    expect(i18n.t('aiSummaryFailed', 'offline')).toContain('offline');
  });

  it.each(['zh_TW', 'ja', 'fr', null])('uses Chinese for the retired or unset preference %s', async language => {
    chrome.storage.sync.get.mockResolvedValue({ language });
    await i18n.initializeLanguage();

    expect(i18n.getTranslationLocale()).toBe('zh_CN');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('chrome-extension://test/_locales/zh_CN/messages.json');
  });

  it('reads English from local settings when sync storage is unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    chrome.storage.sync.get.mockRejectedValue(new Error('Sync unavailable'));
    chrome.storage.local.get.mockResolvedValue({ language: 'en' });
    await i18n.initializeLanguage();

    expect(i18n.getTranslationLocale()).toBe('en');
    expect(i18n.t('labelLanguage')).toBe('Language');
  });

  it('falls back to Chinese when the English pack fails to load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await i18n.initializeLanguage('en');

    expect(i18n.getTranslationLocale()).toBe('zh_CN');
    expect(i18n.t('labelLanguage')).toBe('语言');
  });
});
