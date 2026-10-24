import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './extension-harness.js';
import { renderProviderTierFixture } from './fixtures/provider-tier-fixture.js';

function routeProviderFixtures(extension) {
  return Promise.all(['chatgpt', 'deepseek'].map(provider => extension.context.route(
    provider === 'chatgpt' ? 'https://chatgpt.com/**' : 'https://chat.deepseek.com/**',
    route => route.fulfill({ status: 200, contentType: 'text/html', body: renderProviderTierFixture(provider) })
  )));
}

async function openPanels(extension) {
  const page = await openMultiPanel(extension, { providers: ['chatgpt', 'deepseek'], layout: '1x2' });
  await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
  return page;
}

function pageStyleIn(page, host) {
  const frame = page.frames().find(candidate => candidate.url().includes(host));
  return frame?.evaluate(() => document.getElementById('panelize-page-style')?.textContent || '') ?? '';
}

test.describe('Blind mode, wide content and composer overhang', () => {
  test.setTimeout(90000);

  test('blind mode hides provider identity in the host and styles the provider pages', async ({}, testInfo) => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      await routeProviderFixtures(extension);
      const page = await openPanels(extension);
      await expect.poll(() => page.frames().filter(frame => /chatgpt|deepseek/.test(frame.url())).length).toBe(2);

      await page.locator('#blind-mode-btn').click();
      await expect(page.locator('#blind-mode-btn')).toHaveAttribute('aria-pressed', 'true');
      const labels = page.locator('#panel-grid .panel-header .blind-label');
      await expect(labels).toHaveText([/A$/, /B$/]);
      await expect(page.locator('#panel-grid .panel-header .provider-icon').first()).toBeHidden();
      await expect(page.locator('#panel-grid .panel-header .provider-name').first()).toBeHidden();
      await expect(page.locator('.open-provider-top-level-btn').first()).toBeHidden();
      await expect(page.locator('.switch-provider-btn').first()).toBeHidden();
      await expect(page.locator('#answer-stats-btn')).toBeHidden();
      await expect(page.locator('.panel-selector .blind-label')).toHaveText([/A$/, /B$/]);
      await expect.poll(() => pageStyleIn(page, 'chatgpt.com')).toContain('font-family');
      await expect.poll(() => extension.serviceWorker.evaluate(async () =>
        (await chrome.storage.sync.get('blindModeEnabled')).blindModeEnabled
      )).toBe(true);

      await page.locator('#tier-details-btn').click();
      await expect(page.locator('#tier-details-body')).not.toContainText(/ChatGPT|DeepSeek/);
      await expect(page.locator('#tier-details-body tr').first()).toContainText(/A$|A\b/);
      await page.screenshot({ path: testInfo.outputPath('blind-mode.png') });
      await page.locator('#close-tier-details').click();

      await page.locator('#blind-mode-btn').click();
      await expect(page.locator('#panel-grid .panel-header .provider-name').first()).toBeVisible();
      await expect(labels.first()).toBeHidden();
      await expect.poll(() => pageStyleIn(page, 'chatgpt.com')).toBe('');
    } finally {
      await extension.close();
    }
  });

  test('wide content reaches every panel, survives a reload, and toggles back', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      await routeProviderFixtures(extension);
      const page = await openPanels(extension);
      await page.locator('#wide-content-btn').click();
      await expect(page.locator('#wide-content-btn')).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => pageStyleIn(page, 'chatgpt.com')).toContain('--thread-content-max-width: 100%');
      await expect.poll(() => pageStyleIn(page, 'chat.deepseek.com')).toContain('[data-panelize-wide]');

      const reopened = await openPanels(extension);
      await expect(reopened.locator('#wide-content-btn')).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => pageStyleIn(reopened, 'chatgpt.com')).toContain('--thread-content-max-width: 100%');

      await reopened.locator('#wide-content-btn').click();
      await expect.poll(() => pageStyleIn(reopened, 'chatgpt.com')).toBe('');
    } finally {
      await extension.close();
    }
  });

  test('a multi-line draft overhangs the panels instead of shrinking them, and collapses on blur', async ({}, testInfo) => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      await routeProviderFixtures(extension);
      const page = await openPanels(extension);
      const mainHeight = () => page.locator('#main-content').evaluate(element => element.getBoundingClientRect().height);
      const before = await mainHeight();

      const input = page.locator('#unified-input');
      await input.click();
      await input.fill(Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join('\n'));
      await expect(page.locator('#input-bar')).toHaveClass(/composer-expanded/);
      expect(await mainHeight()).toBe(before);
      const shellTop = await page.locator('#composer-shell').evaluate(element => element.getBoundingClientRect().top);
      const barTop = await page.locator('#input-bar').evaluate(element => element.getBoundingClientRect().top);
      expect(shellTop).toBeLessThan(barTop);
      await page.screenshot({ path: testInfo.outputPath('composer-overhang.png') });

      await page.locator('#panel-grid .panel-header').first().click();
      await expect(page.locator('#input-bar')).not.toHaveClass(/composer-expanded/);
      expect(await mainHeight()).toBe(before);
      await expect(input).toHaveValue(/line 8/);
    } finally {
      await extension.close();
    }
  });
});
