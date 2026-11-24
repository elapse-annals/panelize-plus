import { expect, test } from '@playwright/test';
import { launchExtension } from './support/extension-harness.js';

test('closes the last AI chip into an empty state that can add a panel again', async () => {
  test.setTimeout(90000);
  const extension = await launchExtension({ viewport: { width: 1440, height: 900 } });
  try {
    await extension.context.route(/^https?:\/\//, route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body>Provider fixture</body></html>'
    }));
    await extension.serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        language: 'en',
        enabledProviders: ['chatgpt', 'deepseek'],
        providerOrder: ['chatgpt', 'deepseek'],
        multiPanelProviders: ['chatgpt', 'deepseek'],
        multiPanelLayout: '1x2',
        startupProviders: ['chatgpt', 'deepseek']
      });
    });

    const page = await extension.context.newPage();
    await page.goto(extension.extensionUrl('multi-panel/multi-panel.html'));
    await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
    await expect(page.locator('#panel-grid iframe')).toHaveCount(2);
    const emptyState = page.locator('#panel-empty-state');
    await expect(emptyState).toBeHidden();
    await expect(page.locator('.panel-selector .remove-panel').first())
      .toHaveAttribute('title', 'Close this AI panel');

    // The second close used to be refused with "At least one panel is required".
    await page.locator('.panel-selector .remove-panel').first().click();
    await expect(page.locator('#panel-grid iframe')).toHaveCount(1);
    await page.locator('.panel-selector .remove-panel').first().click();
    await expect(page.locator('#panel-grid iframe')).toHaveCount(0);
    await expect(page.locator('#panel-selectors .panel-selector')).toHaveCount(0);
    await expect(emptyState).toBeVisible();
    await expect(page.locator('#panel-empty-title')).toHaveText('No AI panels');
    await expect(page.locator('#send-all-btn')).toHaveAttribute('aria-disabled', 'true');

    // Sending without panels explains the empty grid instead of starting a round.
    await page.locator('#send-all-btn').dispatchEvent('click');
    await expect(page.locator('.panelize-toast').filter({ hasText: 'No AI panels are open' })).toBeVisible();

    // The empty state's button anchors the add panel menu and brings one back.
    await page.locator('#panel-empty-add-btn').click();
    await expect(page.locator('.add-panel-menu')).toBeVisible();
    await page.locator('.add-panel-menu .add-panel-item[data-provider-id="chatgpt"]').click();
    await expect(page.locator('#panel-grid iframe')).toHaveCount(1);
    await expect(page.locator('#panel-selectors .panel-selector')).toHaveCount(1);
    await expect(emptyState).toBeHidden();

    // Closing the last panel again persists while the startup selection is unchanged.
    await page.locator('.panel-selector .remove-panel').first().click();
    await expect(emptyState).toBeVisible();
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
    await expect(page.locator('#panel-grid iframe')).toHaveCount(0);
    await expect(emptyState).toBeVisible();
  } finally {
    await extension?.close();
  }
});