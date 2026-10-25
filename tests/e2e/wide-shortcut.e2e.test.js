import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './extension-harness.js';
import { renderProviderTierFixture } from './fixtures/provider-tier-fixture.js';

test('wide mode shortcuts work in the composer and AI frames, persist custom bindings, and can be cleared or reset', async () => {
  test.setTimeout(120000);
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: renderProviderTierFixture('chatgpt')
    }));
    await extension.context.route('https://chat.deepseek.com/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: renderProviderTierFixture('deepseek')
    }));
    const page = await openMultiPanel(extension, { providers: ['chatgpt', 'deepseek'], layout: '1x2' });
    await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
    const isMac = await page.evaluate(() => /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
    const defaultShortcut = `${isMac ? 'Meta' : 'Control'}+Alt+W`;
    const customShortcut = 'Control+Shift+6';
    const input = page.locator('#unified-input');
    const button = page.locator('#wide-content-btn');
    const aiInput = page.frameLocator('iframe[src*="chat.deepseek.com"]').locator('textarea');
    const modal = page.locator('#keyboard-shortcuts-modal');
    const field = modal.locator('[data-action="toggleWideContent"]');
    const save = async () => {
      await modal.locator('#save-keyboard-shortcuts').click();
      await expect(modal).toBeHidden();
    };
    const isWideStored = () => extension.serviceWorker.evaluate(async () =>
      (await chrome.storage.sync.get('wideContentEnabled')).wideContentEnabled);

    await expect(button).toHaveAttribute('title', /W\)$/);
    const normalWidth = await page.locator('#panel-grid .panel-item').first().evaluate(element => element.getBoundingClientRect().width);
    await input.press(defaultShortcut);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('body')).toHaveClass(/wide-content/);
    await expect.poll(isWideStored).toBe(true);
    await expect.poll(() => page.locator('#panel-grid .panel-item').first().evaluate(element => element.getBoundingClientRect().width))
      .toBeGreaterThan(normalWidth * 1.4);
    await aiInput.press(defaultShortcut);
    await expect(button).toHaveAttribute('aria-pressed', 'false');

    await page.locator('#keyboard-shortcuts-btn').click();
    await expect(field).toHaveValue(isMac ? '⌘⌥W' : 'Ctrl+Alt+W');
    await field.press(customShortcut);
    await expect(field).toHaveValue(isMac ? '⌃⇧6' : 'Ctrl+Shift+6');
    await save();
    await expect(button).toHaveAttribute('title', /6/);
    await expect.poll(() => extension.serviceWorker.evaluate(async () =>
      (await chrome.storage.sync.get('keyboardShortcutBindings')).keyboardShortcutBindings?.toggleWideContent
    )).toBe(isMac ? 'Ctrl+Shift+6' : 'Mod+Shift+6');

    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
    await expect(button).toHaveAttribute('title', /6/);
    await input.press(defaultShortcut);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await input.press(customShortcut);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await aiInput.press(customShortcut);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(isWideStored).toBe(false);

    await page.locator('#keyboard-shortcuts-btn').click();
    await field.press('Backspace');
    await expect(field).toHaveValue('');
    await save();
    await aiInput.press(customShortcut);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(button).not.toHaveAttribute('title', /6/);

    await page.locator('#keyboard-shortcuts-btn').click();
    await modal.locator('#reset-keyboard-shortcuts').click();
    await expect(field).toHaveValue(isMac ? '⌘⌥W' : 'Ctrl+Alt+W');
    await save();
    await input.press(defaultShortcut);
    await expect(button).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#keyboard-shortcuts-btn').click();
    await modal.locator('#page-shortcuts-enabled').uncheck();
    await save();
    await expect(button).not.toHaveAttribute('title', /W\)$/);
    await aiInput.press(defaultShortcut);
    await input.press(defaultShortcut);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await extension.close();
  }
});
