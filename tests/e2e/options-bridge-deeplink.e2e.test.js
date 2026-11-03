import { test, expect } from '@playwright/test';
import { launchExtension } from './extension-harness.js';

test('the macOS client deep link lands on the global-input bridge switch', async () => {
  const extension = await launchExtension();
  try {
    const page = await extension.context.newPage();
    await page.goto(extension.extensionUrl('options/options.html#global-send-bridge-toggle'));

    const row = page.locator('#global-send-bridge-setting');
    await expect(row.locator('.slider')).toBeVisible();
    await expect(row).toHaveClass(/setting-highlight/);
    await expect(row).toBeInViewport();
    await expect(row).not.toHaveClass(/setting-highlight/, { timeout: 5000 });
  } finally {
    await extension.close();
  }
});