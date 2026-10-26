import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './extension-harness.js';
import { renderProviderTierFixture, renderUnsupportedProviderFixture } from './fixtures/provider-tier-fixture.js';

const MANUAL_ORDER = ['chatgpt', 'claude', 'gemini', 'grok', 'deepseek'];

function routeProviderFixtures(extension, {
  chatgpt = {},
  deepseek = {},
  claude = {},
  grok = {},
} = {}) {
  return Promise.all([
    extension.context.route('https://chatgpt.com/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: renderProviderTierFixture('chatgpt', chatgpt)
    })),
    extension.context.route('https://chat.deepseek.com/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: renderProviderTierFixture('deepseek', deepseek)
    })),
    extension.context.route('https://claude.ai/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: renderProviderTierFixture('claude', claude)
    })),
    extension.context.route('https://grok.com/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: renderUnsupportedProviderFixture('grok', grok)
    })),
  ]);
}

async function openPage(extension, viewport = { width: 1280, height: 800 }) {
  const page = await extension.context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(extension.extensionUrl('multi-panel/multi-panel.html'));
  await waitForReady(page);
  return page;
}

async function openConfiguredMultiPanel(extension, options) {
  const page = await openMultiPanel(extension, options);
  await waitForReady(page);
  return page;
}

async function waitForReady(page) {
  await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
}

async function seedAnswerRounds(extension) {
  const page = await extension.context.newPage();
  try {
    await page.goto(extension.extensionUrl('options/options.html'));
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('PanelizeAnswerStatsDB', 1);
      request.onupgradeneeded = event => {
        const database = event.target.result;
        const store = database.createObjectStore('rounds', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction(['rounds'], 'readwrite');
        const store = transaction.objectStore('rounds');
        const now = Date.now();
        for (let index = 0; index < 3; index += 1) {
          store.put({
            id: `fixture-deepseek-${index}`,
            createdAt: now + index,
            adoptedProviderId: 'deepseek',
            answers: {
              deepseek: { providerId: 'deepseek', status: null },
              chatgpt: { providerId: 'chatgpt', status: null }
            }
          });
        }
        store.put({
          id: 'fixture-chatgpt',
          createdAt: now + 4,
          adoptedProviderId: 'chatgpt',
          answers: {
            deepseek: { providerId: 'deepseek', status: null },
            chatgpt: { providerId: 'chatgpt', status: null }
          }
        });
        transaction.oncomplete = () => {
          request.result.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    }));
  } finally {
    await page.close();
  }
}

async function readFixture(page, host) {
  const frame = page.frames().find(candidate => candidate.url().startsWith(host));
  return frame ? frame.evaluate(() => window.__fixture).catch(() => null) : null;
}

async function uploadPixel(page) {
  await page.locator('#image-file-input').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/XQ0AAAAASUVORK5CYII=', 'base64')
  });
  await expect(page.locator('.image-preview-item')).toHaveCount(1);
}

test.describe('Composer controls browser fixtures', () => {
  test.setTimeout(120000);

  test('controls render; frequent order updates menus and the next startup without reloading current panels', async ({}, testInfo) => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      await routeProviderFixtures(extension);
      await seedAnswerRounds(extension);
      await extension.serviceWorker.evaluate(async (providerOrder) => chrome.storage.sync.set({
        enabledProviders: providerOrder,
        providerOrder,
        providerSortMode: 'manual',
        multiPanelLayout: '1x1',
        startupProviders: null
      }), MANUAL_ORDER);

      const page = await openConfiguredMultiPanel(extension, { providers: ['chatgpt'], enabledProviders: MANUAL_ORDER, layout: '1x1' });
      await expect(page.locator('#composer-new-chat-btn')).toBeHidden();
      // Editing the draft updates the Fill/Retry button. It must keep showing
      // the actual shortcut after that state update, not only at startup.
      await page.locator('#unified-input').fill('Keep the shortcut visible');
      await expect(page.locator('#fill-input-btn')).toHaveAttribute('title', /Enter|↵/);
      await expect(page.locator('.tier-option')).toHaveCount(4);
      await expect(page.locator('.tier-option[data-tier="default"]')).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('#provider-sort-btn')).toBeVisible();
      await expect(page.locator('#keyboard-shortcuts-btn')).toBeVisible();
      await expect(page.locator('#new-chat-btn')).toBeVisible();

      const panel = page.locator('#panel-grid .panel-item').first();
      const panelId = await panel.getAttribute('id');
      const iframeSrc = await panel.locator('iframe').getAttribute('src');
      await page.locator('#provider-sort-btn').click();
      await expect(page.locator('#provider-sort-btn')).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => extension.serviceWorker.evaluate(async () =>
        (await chrome.storage.sync.get('providerSortMode')).providerSortMode
      )).toBe('frequent');

      await page.locator('#add-panel-btn').click();
      await expect(page.locator('.add-panel-menu')).toBeVisible();
      const addMenuIds = await page.locator('.add-panel-menu .add-panel-item').evaluateAll(items =>
        items.map(item => item.dataset.providerId)
      );
      expect(addMenuIds[0]).toBe('deepseek');
      await page.locator('body').click({ position: { x: 640, y: 40 } });

      await panel.locator('.switch-provider-btn').click();
      await expect(page.locator('.provider-switcher-menu')).toBeVisible();
      const switchMenuIds = await page.locator('.provider-switcher-menu .provider-switcher-item').evaluateAll(items =>
        items.map(item => item.dataset.providerId)
      );
      expect(switchMenuIds[0]).toBe('deepseek');
      await page.locator('body').click({ position: { x: 640, y: 40 } });

      await expect(page.locator(`#${panelId} iframe`)).toHaveAttribute('src', iframeSrc);
      await expect(page.locator('#panel-grid .panel-item')).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath('composer-controls-frequent-order.png'), fullPage: true });

      const nextStartup = await openPage(extension);
      await nextStartup.waitForFunction(() => document.querySelectorAll('#panel-grid iframe').length === 1);
      await expect(nextStartup.locator('#panel-grid .panel-header .provider-icon').first())
        .toHaveAttribute('data-provider-id', 'deepseek');
    } finally {
      await extension.close();
    }
  });

  test('custom shortcuts persist and iframe key events reach new chat, tier switching, and host input focus', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      await routeProviderFixtures(extension);
      const page = await openConfiguredMultiPanel(extension, { providers: ['chatgpt', 'deepseek'], layout: '1x2' });
      await expect(page.locator('#panel-grid iframe')).toHaveCount(2);
      await page.locator('#keyboard-shortcuts-btn').click();
      const modal = page.locator('#keyboard-shortcuts-modal');
      await expect(modal).toBeVisible();
      const isMac = await page.evaluate(() => /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
      const primaryKey = 'Control';

      for (const [action, shortcut] of [
        ['newConversation', `${primaryKey}+Shift+Q`],
        ['tierDeep', `${primaryKey}+Shift+5`],
        ['focusInput', `${primaryKey}+Shift+F`]
      ]) {
        const field = modal.locator(`[data-action="${action}"]`);
        const key = action === 'tierDeep' ? '5' : action === 'focusInput' ? 'F' : 'Q';
        await field.press(`${primaryKey}+Shift+${key}`);
        await expect(field).toHaveValue(isMac ? `⌃⇧${key}` : `Ctrl+Shift+${key}`);
      }
      await modal.locator('#save-keyboard-shortcuts').click();
      await expect(modal).toBeHidden();
      await expect(page.locator('#composer-new-chat-btn')).toHaveAttribute('title', /Q/);
      await expect(page.locator('.tier-option[data-tier="deep"]')).toHaveAttribute('title', /5/);
      await expect.poll(() => extension.serviceWorker.evaluate(async () =>
        (await chrome.storage.sync.get('keyboardShortcutBindings')).keyboardShortcutBindings
      )).toMatchObject(isMac
        ? { newConversation: 'Ctrl+Shift+Q', tierDeep: 'Ctrl+Shift+5', focusInput: 'Ctrl+Shift+F' }
        : { newConversation: 'Mod+Shift+Q', tierDeep: 'Mod+Shift+5', focusInput: 'Mod+Shift+F' });

      await page.reload();
      await waitForReady(page);
      await page.waitForFunction(() => document.querySelectorAll('#panel-grid iframe').length === 2);
      await expect(page.locator('#composer-new-chat-btn')).toHaveAttribute('title', /Q/);
      const chatgptFrame = page.frameLocator('iframe[src*="chatgpt.com"]');
      await chatgptFrame.locator('[data-composer-markdown]').press(`${primaryKey}+Shift+Q`);
      await expect.poll(async () => (await readFixture(page, 'https://chatgpt.com/'))?.newChats).toBe(1);
      await expect(page.locator('#new-chat-status')).not.toContainText(/starting/i);

      const deepseekFrame = page.frameLocator('iframe[src*="chat.deepseek.com"]');
      await deepseekFrame.locator('textarea').press(`${primaryKey}+Shift+5`);
      await expect(deepseekFrame.locator('#deep-think')).toHaveAttribute('aria-pressed', 'true');

      await page.locator('#unified-input').evaluate(input => input.blur());
      await deepseekFrame.locator('textarea').press(`${primaryKey}+Shift+F`);
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('unified-input');
    } finally {
      await extension.close();
    }
  });

  test('tier batch reports mixed unsupported and logged-out results, while new chat confirms, retries failures only, and restores the saved tier', async ({}, testInfo) => {
    const extension = await launchExtension({ viewport: { width: 1420, height: 900 } });
    try {
      await routeProviderFixtures(extension, {
        chatgpt: { newChatResetMode: 'balanced' },
        deepseek: { newChatFailOnClicks: [1] },
        claude: { loggedOut: true }
      });
      const page = await openConfiguredMultiPanel(extension, {
        providers: ['chatgpt', 'deepseek', 'grok', 'claude'],
        layout: '1x4'
      });
      await expect(page.locator('#panel-grid iframe')).toHaveCount(4);
      await expect.poll(async () => (await readFixture(page, 'https://chatgpt.com/'))?.provider).toBe('chatgpt');

      await page.locator('#unified-input').fill('Keep this composer draft');
      await uploadPixel(page);
      await page.locator('.tier-option[data-tier="deep"]').click();
      await expect.poll(async () => (await readFixture(page, 'https://chatgpt.com/'))?.model).toBe('High');
      const deepseekFrame = page.frameLocator('iframe[src*="chat.deepseek.com"]');
      await expect(deepseekFrame.locator('#deep-think')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#tier-status')).toContainText(/2\s*\/\s*4/);
      await expect(page.locator('#unified-input')).toHaveValue('Keep this composer draft');
      await expect(page.locator('.image-preview-item')).toHaveCount(1);
      await expect.poll(() => extension.serviceWorker.evaluate(async () =>
        (await chrome.storage.sync.get('selectedProviderTier')).selectedProviderTier
      )).toBe('deep');

      await page.locator('#tier-details-btn').click();
      const details = page.locator('#tier-details-modal');
      await expect(details).toBeVisible();
      const rows = details.locator('#tier-details-body tr');
      await expect(rows).toHaveCount(4);
      await expect(rows.filter({ hasText: 'Claude' }).locator('td').nth(1)).toHaveText('Reasoning effort High');
      await expect(rows.filter({ hasText: 'DeepSeek' }).locator('td').nth(1)).toHaveText('深度思考 on · shared with Balanced');
      await expect(rows.filter({ hasText: 'Grok' }).locator('td').nth(1)).toHaveText('Not supported');
      await expect(rows.filter({ hasText: 'ChatGPT' }).locator('td').nth(3)).toContainText(/Confirmed|Switched/);
      await expect(rows.filter({ hasText: 'DeepSeek' }).locator('td').nth(3)).toContainText(/Confirmed|Switched/);
      await expect(rows.filter({ hasText: 'Grok' }).locator('td').nth(3)).toContainText(/Not supported|Unsupported/);
      await expect(rows.filter({ hasText: 'Claude' }).locator('td').nth(3)).toContainText(/Unavailable/);
      await page.screenshot({ path: testInfo.outputPath('composer-tier-details-mixed.png'), fullPage: true });
      await details.locator('#close-tier-details').click();

      const pageWithBothSupported = await openConfiguredMultiPanel(extension, {
        providers: ['chatgpt', 'deepseek'],
        enabledProviders: ['chatgpt', 'deepseek'],
        layout: '1x2'
      });
      await expect(pageWithBothSupported.locator('.tier-option[data-tier="deep"]')).toHaveAttribute('aria-checked', 'true');
      await pageWithBothSupported.locator('#unified-input').fill('Retain my draft after new chat');
      await uploadPixel(pageWithBothSupported);
      await pageWithBothSupported.locator('#new-chat-btn').click();

      await expect.poll(async () => (await readFixture(pageWithBothSupported, 'https://chatgpt.com/'))?.newChats).toBe(1);
      await expect.poll(async () => (await readFixture(pageWithBothSupported, 'https://chat.deepseek.com/'))?.newChats).toBe(1);
      await expect(pageWithBothSupported.locator('#retry-new-chat-btn')).toBeVisible({ timeout: 20000 });
      await expect(pageWithBothSupported.locator('#new-chat-status')).toContainText(/not confirmed/i);
      await expect(pageWithBothSupported.locator('#unified-input')).toHaveValue('Retain my draft after new chat');
      await expect(pageWithBothSupported.locator('.image-preview-item')).toHaveCount(1);
      await expect.poll(async () => (await readFixture(pageWithBothSupported, 'https://chatgpt.com/'))?.model).toBe('High');

      await pageWithBothSupported.locator('#retry-new-chat-btn').click();
      await expect.poll(async () => (await readFixture(pageWithBothSupported, 'https://chat.deepseek.com/'))?.newChats).toBe(2);
      await expect(pageWithBothSupported.locator('#retry-new-chat-btn')).toBeHidden({ timeout: 20000 });
      await expect.poll(async () => (await readFixture(pageWithBothSupported, 'https://chatgpt.com/'))?.newChats).toBe(1);
      await expect(pageWithBothSupported.frameLocator('iframe[src*="chat.deepseek.com"]').locator('#deep-think'))
        .toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => pageWithBothSupported.evaluate(() => document.activeElement?.id)).toBe('unified-input');
      await expect(pageWithBothSupported.locator('#unified-input')).toHaveValue('Retain my draft after new chat');
      await expect(pageWithBothSupported.locator('.image-preview-item')).toHaveCount(1);
    } finally {
      await extension.close();
    }
  });

  test('composer screenshots cover light, dark, narrow, and reduced-motion states', async ({}, testInfo) => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      await routeProviderFixtures(extension);
      const page = await openConfiguredMultiPanel(extension, { providers: ['chatgpt'], layout: '1x1' });
      await expect(page.locator('#composer-shell')).toBeVisible();
      await page.locator('#input-bar').screenshot({ path: testInfo.outputPath('composer-light.png') });
      const levelColors = [];
      for (const tier of ['fast', 'balanced', 'deep']) {
        await page.locator(`.tier-option[data-tier="${tier}"]`).click();
        await expect(page.locator('#composer-shell')).toHaveAttribute('data-tier', tier);
        await expect(page.locator('#composer-shell')).toHaveAttribute('data-tier-state', 'confirmed');
        levelColors.push(await page.locator('#composer-shell').evaluate(shell =>
          getComputedStyle(shell).getPropertyValue('--tier-color').trim()));
        await page.locator('#input-bar').screenshot({ path: testInfo.outputPath(`composer-light-${tier}.png`), animations: 'disabled' });
      }
      expect(new Set(levelColors).size).toBe(3);

      await extension.serviceWorker.evaluate(async () => chrome.storage.sync.set({ theme: 'dark' }));
      await page.reload();
      await waitForReady(page);
      await page.waitForFunction(() => document.querySelectorAll('#panel-grid iframe').length === 1);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.locator('#input-bar').screenshot({ path: testInfo.outputPath('composer-dark.png') });
      for (const tier of ['fast', 'balanced', 'deep']) {
        await page.locator(`.tier-option[data-tier="${tier}"]`).click();
        await expect(page.locator('#composer-shell')).toHaveAttribute('data-tier-state', 'confirmed');
        await page.locator('#input-bar').screenshot({ path: testInfo.outputPath(`composer-dark-${tier}.png`), animations: 'disabled' });
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('#composer-new-chat-btn')).toBeHidden();
      await expect(page.locator('.tier-option[data-tier="deep"]')).toBeVisible();
      await page.locator('#input-bar').screenshot({ path: testInfo.outputPath('composer-narrow.png') });

      await page.emulateMedia({ reducedMotion: 'reduce' });
      // Also cover a media preference change while a pulse is already active.
      await page.locator('#composer-shell').evaluate(shell => shell.classList.add('composer-pulse'));
      expect(await page.locator('#composer-shell').evaluate(shell =>
        [getComputedStyle(shell, '::before').animationName, getComputedStyle(shell, '::after').animationName]
      )).toEqual(['none', 'none']);
      await page.locator('#composer-shell').evaluate(shell => shell.classList.remove('composer-pulse'));
      await page.locator('#unified-input').evaluate(input => input.blur());
      await page.locator('#unified-input').focus();
      await expect(page.locator('#composer-shell')).not.toHaveClass(/composer-pulse/);
      await page.locator('.tier-option[data-tier="fast"]').click();
      await expect(page.locator('#composer-shell')).toHaveAttribute('data-tier-state', 'confirmed');
      expect(await page.locator('#composer-shell').evaluate(shell =>
        [getComputedStyle(shell, '::before').animationName, getComputedStyle(shell, '::after').animationName]
      )).toEqual(['none', 'none']);
      await page.locator('#input-bar').screenshot({ path: testInfo.outputPath('composer-reduced-motion.png') });
    } finally {
      await extension.close();
    }
  });
});
