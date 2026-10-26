import { test, expect } from '@playwright/test';
import { launchExtension } from './extension-harness.js';

test('billing markers keep account preferences across reloads and sync without enabling providers', async ({}, testInfo) => {
  test.setTimeout(60000);
  const extension = await launchExtension();

  try {
    await extension.serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        language: 'zh_CN',
        theme: 'light',
        enabledProviders: ['chatgpt', 'claude'],
        providerOrder: ['chatgpt', 'claude'],
        startupProviders: ['claude']
      });
    });
    const page = await extension.context.newPage();
    await page.goto(extension.extensionUrl('options/options.html'));

    const marker = id => page.locator(`[data-billing-provider-id="${id}"]`);
    await expect(marker('claude')).toHaveValue('quota');
    await expect(marker('claude').locator('option:checked')).toHaveText('扣额度');
    await expect(marker('agnes')).toHaveValue('credits');
    await expect(marker('agnes').locator('option:checked')).toHaveText('扣积分');
    await expect(marker('chatgpt')).toHaveValue('unmarked');
    await expect(marker('qwen-cn')).toBeEnabled();
    await page.locator('#provider-list').screenshot({ path: testInfo.outputPath('billing-defaults-zh.png') });

    const overrides = { chatgpt: 'free', claude: 'unmarked', google: 'credits', 'qwen-cn': 'paid' };
    for (const [id, value] of Object.entries(overrides)) {
      await marker(id).selectOption(value);
      await expect.poll(() => extension.serviceWorker.evaluate(async providerId => (
        (await chrome.storage.sync.get('providerBillingTypes')).providerBillingTypes?.[providerId]
      ), id)).toBe(value);
    }

    await page.reload();
    for (const [id, value] of Object.entries(overrides)) {
      await expect(marker(id)).toHaveValue(value);
    }
    await expect(marker('agnes')).toHaveValue('credits');
    await expect(page.locator('[data-startup-provider-id="claude"]')).toBeChecked();
    await expect(page.locator('.provider-item[data-provider-id="qwen-cn"] .toggle-switch')).not.toHaveClass(/active/);
    expect(await extension.serviceWorker.evaluate(() => chrome.storage.sync.get([
      'enabledProviders', 'providerOrder', 'startupProviders'
    ]))).toEqual({
      enabledProviders: ['chatgpt', 'claude'],
      providerOrder: ['chatgpt', 'claude'],
      startupProviders: ['claude']
    });

    // Changes from another settings page/device should refresh the marker.
    await extension.serviceWorker.evaluate(() => chrome.storage.sync.set({
      providerBillingTypes: { chatgpt: 'free', claude: 'quota', google: 'credits', 'qwen-cn': 'paid' }
    }));
    await expect(marker('claude')).toHaveValue('quota');
    await page.selectOption('#theme-select', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#provider-list').screenshot({ path: testInfo.outputPath('billing-markers-dark-zh.png') });

    // Export/import must retain the marker preference, including an explicit
    // unmarked override of Claude's default.
    const imported = await page.evaluate(async () => {
      const { exportSettings, importSettings } = await import('/modules/settings.js');
      const exported = await exportSettings();
      const result = await importSettings({
        providerBillingTypes: { ...exported.providerBillingTypes, claude: 'unmarked' }
      });
      return { exported: exported.providerBillingTypes, imported: result.imported };
    });
    expect(imported.exported).toEqual({ chatgpt: 'free', claude: 'quota', google: 'credits', 'qwen-cn': 'paid' });
    expect(imported.imported).toContain('providerBillingTypes');
    await expect(marker('claude')).toHaveValue('unmarked');

    await page.selectOption('#language-select', 'en');
    await expect(marker('google').locator('option:checked')).toHaveText('Uses credits');
  } finally {
    await extension.close();
  }
});
