import { test, expect } from '@playwright/test';
import {
  AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY,
  AI_SUMMARY_API_KEYS_STORAGE_KEY,
  AI_SUMMARY_PROFILES_STORAGE_KEY
} from '../../modules/answers/ai-summary-profiles.js';
import { createPatchedExtensionCopy, launchExtension } from './support/extension-harness.js';

const API_BASE_URL = 'https://api.panelize-e2e.test/v1';
const SECOND_API_BASE_URL = 'https://api.panelize-e2e-2.test/v1';

test('adds, saves and selects several AI summary API profiles', async ({}, testInfo) => {
  test.setTimeout(90000);
  let extensionCopy;
  let extension;
  const requests = [];
  try {
    extensionCopy = await createPatchedExtensionCopy(manifest => {
      manifest.host_permissions.push(
        'https://api.panelize-e2e.test/*',
        'https://api.panelize-e2e-2.test/*'
      );
    });
    extension = await launchExtension({
      extensionPath: extensionCopy.extensionPath,
      viewport: { width: 1440, height: 900 }
    });
    const fulfillSummary = route => {
      requests.push({
        url: route.request().url(),
        body: route.request().postDataJSON()
      });
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] })
      });
    };
    await extension.context.route(`${API_BASE_URL}/chat/completions`, fulfillSummary);
    await extension.context.route(`${SECOND_API_BASE_URL}/chat/completions`, fulfillSummary);
    // Finish the options page's automatic update check instead of leaving it
    // waiting on GitHub; event listeners bind after init() resolves.
    await extension.context.route('https://api.github.com/**', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{}'
    }));
    await extension.serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({ language: 'en' });
    });

    const page = await extension.context.newPage();
    await page.goto(extension.extensionUrl('options/options.html'));

    const rows = page.locator('#ai-summary-profiles .ai-summary-profile');
    await expect(rows).toHaveCount(1);

    await rows.nth(0).locator('[data-field="name"]').fill('First');
    await rows.nth(0).locator('[data-field="baseUrl"]').fill(API_BASE_URL);
    await rows.nth(0).locator('[data-field="model"]').fill('model-one');
    await rows.nth(0).locator('[data-field="apiKey"]').fill('key-one');

    await page.locator('#ai-summary-add-profile-btn').click();
    await expect(rows).toHaveCount(2);
    await rows.nth(1).locator('[data-field="name"]').fill('Second');
    await rows.nth(1).locator('[data-field="baseUrl"]').fill(SECOND_API_BASE_URL);
    await rows.nth(1).locator('[data-field="model"]').fill('model-two');
    await rows.nth(1).locator('[data-field="apiKey"]').fill('key-two');
    await rows.nth(1).locator('input[name="ai-summary-active-profile"]').check();

    await page.locator('#ai-summary-save-btn').click();
    await expect(page.locator('#ai-summary-test-result')).toHaveText('The API works; settings saved', { timeout: 30000 });
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].url).toContain(SECOND_API_BASE_URL);
    expect(requests[0].body.model).toBe('model-two');

    const stored = await extension.serviceWorker.evaluate(async ({ profileKey, activeKey, keysKey }) => ({
      sync: await chrome.storage.sync.get([profileKey, activeKey]),
      local: await chrome.storage.local.get(keysKey)
    }), {
      profileKey: AI_SUMMARY_PROFILES_STORAGE_KEY,
      activeKey: AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY,
      keysKey: AI_SUMMARY_API_KEYS_STORAGE_KEY
    });

    const profiles = stored.sync[AI_SUMMARY_PROFILES_STORAGE_KEY];
    expect(profiles).toHaveLength(2);
    expect(profiles.map(profile => profile.model)).toEqual(['model-one', 'model-two']);
    expect(stored.sync[AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]).toBe(profiles[1].id);
    expect(stored.local[AI_SUMMARY_API_KEYS_STORAGE_KEY]).toEqual({
      [profiles[0].id]: 'key-one',
      [profiles[1].id]: 'key-two'
    });
    // API keys never reach synced storage.
    expect(JSON.stringify(stored.sync)).not.toContain('key-one');
    expect(JSON.stringify(stored.sync)).not.toContain('key-two');

    // Reopening the page restores the saved list and the selected model.
    await page.reload();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1).locator('[data-field="model"]')).toHaveValue('model-two');
    await expect(rows.nth(1).locator('input[name="ai-summary-active-profile"]')).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath('ai-summary-profiles-options.png'), fullPage: true });
    await page.locator('#ai-summary-profiles').screenshot({
      path: testInfo.outputPath('ai-summary-profiles-section.png')
    });
  } finally {
    await extension?.close();
    await extensionCopy?.cleanup();
  }
});