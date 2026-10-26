import { test, expect } from '@playwright/test';
import { launchExtension } from './extension-harness.js';

test.describe('Provider access notice E2E', () => {
  test.setTimeout(60000);

  let extension;

  test.beforeAll(async () => {
    extension = await launchExtension();
  });

  test.afterAll(async () => {
    await extension?.close();
  });

  test('lists default providers that still need site access after a fresh install', async ({}, testInfo) => {
    const optionsUrl = extension.extensionUrl('options/options.html');
    await expect.poll(() => extension.context.pages().some(page => page.url().startsWith(optionsUrl))).toBe(true);

    const page = await extension.context.newPage();
    await page.goto(optionsUrl);
    await page.waitForSelector('[data-provider-id="qwen-global"]');

    const notice = page.locator('#provider-access-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('data-provider-ids', 'qwen-global,chatglm,zai-global,yuanbao,mimo,meta-ai');
    await expect(page.locator('#grant-provider-access-btn')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('provider-access-notice.png'), fullPage: true });
  });
});
