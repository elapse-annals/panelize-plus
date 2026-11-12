import { expect, test } from '@playwright/test';
import { launchExtension, openMultiPanel } from './support/extension-harness.js';
import { renderChatgptFixture } from './fixtures/chatgpt-fixture.js';
import { renderProviderTierFixture } from './fixtures/provider-tier-fixture.js';

test('composer status bar stays inside the composer and auto-hides its not-ready notice', async () => {
  test.setTimeout(90000);
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: renderChatgptFixture({ composer: 'current' })
    }));
    await extension.context.route('https://gemini.google.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body>Loading Gemini</body></html>'
    }));

    const page = await openMultiPanel(extension, {
      providers: ['chatgpt', 'gemini'],
      layout: '1x2',
      settings: { selectedPromptMode: null }
    });
    await expect(page.locator('#panel-grid iframe')).toHaveCount(2);
    // ChatGPT is ready and Gemini keeps loading, so one blocking status shows.
    await expect(page.locator('#composer-status-text')).toContainText('1/2');

    // One bar, embedded in the composer below the controls, never over the panels.
    await expect(page.locator('.composer-result-row')).toHaveCount(1);
    const layout = await page.evaluate(() => {
      const row = document.getElementById('composer-status-row');
      const shell = document.getElementById('composer-shell');
      const controls = shell.querySelector('.composer-controls');
      const grid = document.getElementById('panel-grid');
      return {
        inShell: row.closest('#composer-shell') === shell,
        position: getComputedStyle(row).position,
        rowTop: row.getBoundingClientRect().top,
        controlsBottom: controls.getBoundingClientRect().bottom,
        rowBottom: row.getBoundingClientRect().bottom,
        shellBottom: shell.getBoundingClientRect().bottom,
        gridBottom: grid.getBoundingClientRect().bottom
      };
    });
    expect(layout.inShell).toBe(true);
    expect(layout.position).not.toBe('absolute');
    expect(layout.rowTop).toBeGreaterThanOrEqual(layout.controlsBottom - 1);
    expect(layout.rowTop).toBeGreaterThanOrEqual(layout.gridBottom - 1);
    expect(layout.rowBottom).toBeLessThanOrEqual(layout.shellBottom + 1);
    // The truncatable single line keeps the full text on hover.
    await expect(page.locator('#composer-status-row')).toHaveAttribute('title', /1\/2/);

    // After the 20s readiness timeout the blocking notice gives way to the
    // partial-not-ready notice, which closes itself after a few seconds.
    await expect(page.locator('#composer-status-text')).toContainText(/check sign-in|检查登录/i, { timeout: 25000 });
    await expect(page.locator('#composer-status-row')).toBeVisible();
    await expect(page.locator('#composer-status-row')).toBeHidden({ timeout: 9000 });
    await expect(page.locator('#composer-status-row')).toHaveAttribute('title', '');
  } finally {
    await extension.close();
  }
});

test('new-chat failures keep the retry action in the merged status bar', async () => {
  test.setTimeout(90000);
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: renderProviderTierFixture('chatgpt')
    }));
    // The startup reset fails too, which leaves a conversation to clear and
    // makes the first user new chat the second click: both stay unconfirmed.
    await extension.context.route('https://chat.deepseek.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: renderProviderTierFixture('deepseek', { newChatFailOnClicks: [1, 2] })
    }));

    const page = await openMultiPanel(extension, { providers: ['chatgpt', 'deepseek'], layout: '1x2' });
    await page.waitForFunction(() => document.querySelectorAll('#panel-grid iframe').length === 2);
    await page.click('#new-chat-btn');

    await expect(page.locator('#retry-new-chat-btn')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#composer-status-text')).toContainText(/not confirmed|未确认/);
    await expect(page.locator('#composer-status-row')).toHaveAttribute('title', /not confirmed|未确认/);
    await expect(page.locator('.composer-result-row')).toHaveCount(1);

    await page.locator('#retry-new-chat-btn').click();
    await expect(page.locator('#retry-new-chat-btn')).toBeHidden({ timeout: 30000 });
    await expect(page.locator('#composer-status-text')).toContainText(/new conversations ready|新对话已就绪/);
  } finally {
    await extension.close();
  }
});
