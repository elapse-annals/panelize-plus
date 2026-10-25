import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEEPSEEK_CONSENT_COOKIE_NAME,
  DEEPSEEK_COOKIE_URL,
  isDeepSeekConsentCookieChange,
  upgradeDeepSeekConsentCookies,
} from '../modules/consent-cookies.js';

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'manifest.json'), 'utf8')
);

function deepSeekConsentCookie(overrides = {}) {
  return {
    name: DEEPSEEK_CONSENT_COOKIE_NAME,
    value: '%7B%22level%22%3A%22all%22%7D',
    domain: '.deepseek.com',
    hostOnly: false,
    path: '/',
    secure: false,
    httpOnly: false,
    sameSite: 'unspecified',
    expirationDate: 1824465600,
    storeId: '0',
    ...overrides,
  };
}

describe('DeepSeek consent cookies', () => {
  beforeEach(() => {
    chrome.cookies = {
      getAll: vi.fn(() => Promise.resolve([])),
      set: vi.fn(() => Promise.resolve({})),
    };
  });

  it('registers the consent cookie script in the main world of DeepSeek frames', () => {
    expect(manifest.content_scripts).toContainEqual({
      matches: ['https://chat.deepseek.com/*'],
      js: ['content-scripts/embedded-consent-cookies.js'],
      run_at: 'document_start',
      all_frames: true,
      world: 'MAIN',
    });
  });

  it('upgrades an existing banner choice to SameSite=None; Secure and keeps its other attributes', async () => {
    chrome.cookies.getAll.mockResolvedValue([deepSeekConsentCookie()]);

    await upgradeDeepSeekConsentCookies();

    expect(chrome.cookies.getAll).toHaveBeenCalledWith({
      url: DEEPSEEK_COOKIE_URL,
      name: DEEPSEEK_CONSENT_COOKIE_NAME,
    });
    expect(chrome.cookies.set).toHaveBeenCalledTimes(1);
    expect(chrome.cookies.set).toHaveBeenCalledWith({
      url: DEEPSEEK_COOKIE_URL,
      name: DEEPSEEK_CONSENT_COOKIE_NAME,
      value: '%7B%22level%22%3A%22all%22%7D',
      domain: '.deepseek.com',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'no_restriction',
      expirationDate: 1824465600,
      storeId: '0',
    });
  });

  it('leaves banner choices that already work in embedded frames and partitioned cookies alone', async () => {
    chrome.cookies.getAll.mockResolvedValue([
      deepSeekConsentCookie({ sameSite: 'no_restriction', secure: true }),
      deepSeekConsentCookie({ partitionKey: { topLevelSite: 'https://example.com' } }),
    ]);

    await upgradeDeepSeekConsentCookies();

    expect(chrome.cookies.set).not.toHaveBeenCalled();
  });

  it('reacts only to banner choices that still need the upgrade', () => {
    expect(isDeepSeekConsentCookieChange({ removed: false, cookie: deepSeekConsentCookie({ sameSite: 'lax' }) })).toBe(true);
    expect(isDeepSeekConsentCookieChange({ removed: true, cookie: deepSeekConsentCookie({ sameSite: 'lax' }) })).toBe(false);
    expect(isDeepSeekConsentCookieChange({
      removed: false,
      cookie: deepSeekConsentCookie({ sameSite: 'no_restriction', secure: true }),
    })).toBe(false);
    expect(isDeepSeekConsentCookieChange({
      removed: false,
      cookie: deepSeekConsentCookie({ name: 'smidV2' }),
    })).toBe(false);
    expect(isDeepSeekConsentCookieChange(null)).toBe(false);
  });
});
