import { expect, test } from '@playwright/test';
import { launchExtension } from './extension-harness.js';

test('the service worker reuses and activates the existing Multi-Panel tab', async () => {
  const extension = await launchExtension();
  try {
    await extension.context.route(/^https?:\/\//, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body>Provider fixture</body></html>'
    }));

    await extension.serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        enabledProviders: ['chatgpt'],
        providerOrder: ['chatgpt'],
        multiPanelProviders: ['chatgpt'],
        multiPanelLayout: '1x1',
        startupProviders: ['chatgpt']
      });
    });

    const launcherPage = await extension.context.newPage();
    await launcherPage.goto(extension.extensionUrl('options/options.html'));

    const openFromExtensionPage = () => launcherPage.evaluate(async () => {
      const { openMultiPanelPage } = await import(
        chrome.runtime.getURL('modules/open-multi-panel.js')
      );
      await openMultiPanelPage(chrome, 'tab');
    });

    await openFromExtensionPage();
    const multiPanelUrl = extension.extensionUrl('multi-panel/multi-panel.html');
    const multiPanelPage = await expect.poll(() => extension.context.pages().some(
      (page) => page.url() === multiPanelUrl
    )).toBe(true).then(() => extension.context.pages().find(
      (page) => page.url() === multiPanelUrl
    ));
    await expect.poll(() => multiPanelPage.evaluate(
      () => document.documentElement.dataset.panelizeReady === 'true'
    )).toBe(true);
    await expect(multiPanelPage.locator('#panel-grid iframe')).toHaveCount(1);

    await multiPanelPage.locator('#unified-input').fill('Keep this draft when the tab is reused');
    const frameCountBefore = multiPanelPage.frames().length;

    const unrelatedPage = await extension.context.newPage();
    await unrelatedPage.goto('https://example.com/');
    await unrelatedPage.bringToFront();

    await openFromExtensionPage();
    await expect.poll(() => multiPanelPage.evaluate(() => document.visibilityState))
      .toBe('visible');
    expect(extension.context.pages().filter((page) => page.url() === multiPanelUrl))
      .toHaveLength(1);
    expect(multiPanelPage.frames()).toHaveLength(frameCountBefore);
    await expect(multiPanelPage.locator('#unified-input'))
      .toHaveValue('Keep this draft when the tab is reused');
    await expect(multiPanelPage.locator('#panel-grid iframe')).toHaveCount(1);

    await unrelatedPage.close();
  } finally {
    await extension.close();
  }
});
