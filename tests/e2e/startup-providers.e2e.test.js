import { test, expect } from '@playwright/test';
import { launchExtension } from './extension-harness.js';

const ENABLED = ['chatgpt', 'claude', 'gemini', 'grok', 'deepseek'];

test.describe('Startup providers E2E', () => {
  test.setTimeout(60000);

  let extension;

  test.beforeAll(async () => {
    extension = await launchExtension();
    await extension.serviceWorker.evaluate(async (enabled) => {
      await chrome.storage.sync.set({
        enabledProviders: enabled,
        providerOrder: enabled,
        multiPanelLayout: '2x2',
        startupProviders: null,
      });
    }, ENABLED);
  });

  test.afterAll(async () => {
    await extension?.close();
  });

  async function openPanelProviderIds() {
    const page = await extension.context.newPage();
    await page.route(/^https?:\/\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: '' }));
    await page.goto(extension.extensionUrl('multi-panel/multi-panel.html'));
    await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
    const ids = await page.$$eval('#panel-grid .panel-header .provider-icon', imgs => imgs.map(img => img.dataset.providerId));
    const layoutClass = await page.getAttribute('#panel-grid', 'class');
    await page.close();
    return { ids, layoutClass };
  }

  test('opens the first providers that fit the layout by default', async () => {
    const { ids } = await openPanelProviderIds();
    expect(ids).toEqual(['chatgpt', 'claude', 'gemini', 'grok']);
  });

  test('opens the providers checked in the options page', async ({}, testInfo) => {
    const options = await extension.context.newPage();
    await options.goto(extension.extensionUrl('options/options.html'));
    await options.waitForSelector('[data-startup-provider-id="claude"]');

    for (const id of ['claude', 'grok', 'deepseek', 'chatgpt', 'gemini']) {
      await options.check(`[data-startup-provider-id="${id}"]`);
    }
    await options.uncheck('[data-startup-provider-id="chatgpt"]');
    await options.locator('#provider-list').screenshot({ path: testInfo.outputPath('startup-providers-options.png') });

    await expect.poll(() => extension.serviceWorker.evaluate(async () =>
      (await chrome.storage.sync.get('startupProviders')).startupProviders
    )).toEqual(['claude', 'grok', 'deepseek', 'gemini']);
    await options.close();

    const { ids, layoutClass } = await openPanelProviderIds();
    expect(ids).toEqual(['claude', 'gemini', 'grok', 'deepseek']);
    expect(layoutClass).toContain('layout-2x2');
  });

  test('switches a too-small grid layout to a single row', async () => {
    await extension.serviceWorker.evaluate(async (enabled) => {
      await chrome.storage.sync.set({ startupProviders: enabled, multiPanelLayout: '2x2' });
    }, ENABLED);

    const { ids, layoutClass } = await openPanelProviderIds();
    expect(ids).toEqual(ENABLED);
    expect(layoutClass).toContain('layout-1x5');
  });
});
