import { test, expect } from '@playwright/test';
import { launchExtension } from './extension-harness.js';

test.describe('Layout options E2E', () => {
  test.setTimeout(60000);

  let extension;
  let page;

  test.beforeAll(async () => {
    extension = await launchExtension();
    const { serviceWorker } = extension;

    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        enabledProviders: [],
        providerOrder: [],
        multiPanelProviders: [],
        multiPanelLayout: '1x3',
      });
    });

    page = await extension.context.newPage();
    await page.goto(extension.extensionUrl('multi-panel/multi-panel.html'));
    await page.waitForSelector('#layout-btn');
  });

  test.afterAll(async () => {
    await extension?.close();
  });

  test('shows and applies 1x30 and 2x15 layouts, then saves a high-capacity default', async () => {
    await page.click('#layout-btn');
    await expect(page.locator('#layout-modal')).toBeVisible();
    await expect(page.locator('[data-layout="1x30"]')).toBeVisible();
    await expect(page.locator('[data-layout="2x15"]')).toBeVisible();

    await page.locator('[data-layout="2x15"]').scrollIntoViewIfNeeded();
    await page.click('[data-layout="2x15"]');
    await expect(page.locator('#panel-grid')).toHaveClass(/layout-2x15/);

    await page.click('#layout-btn');
    await page.locator('[data-layout="1x30"]').scrollIntoViewIfNeeded();
    await page.click('[data-layout="1x30"]');
    await expect(page.locator('#panel-grid')).toHaveClass(/layout-1x30/);

    const settingsPage = await extension.context.newPage();
    await settingsPage.goto(extension.extensionUrl('options/options.html'));
    const defaultLayout = settingsPage.locator('#multi-panel-layout-select');
    await expect(defaultLayout).toBeVisible();
    await expect(defaultLayout).toHaveValue('1x30');
    await expect(defaultLayout.locator('option[value="1x30"]')).toHaveCount(1);
    await expect(defaultLayout.locator('option[value="2x15"]')).toHaveCount(1);
    await defaultLayout.selectOption('2x15');
    await expect.poll(async () => (
      (await extension.serviceWorker.evaluate(async () => (
        chrome.storage.sync.get('multiPanelLayout')
      ))).multiPanelLayout
    )).toBe('2x15');
    await defaultLayout.selectOption('1x30');
    await expect.poll(async () => (
      (await extension.serviceWorker.evaluate(async () => (
        chrome.storage.sync.get('multiPanelLayout')
      ))).multiPanelLayout
    )).toBe('1x30');
  });
});
