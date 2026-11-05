import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './support/extension-harness.js';
import { renderChatgptFixture } from './fixtures/chatgpt-fixture.js';

const HISTORY = ['How do these compare?', 'How does it work?', '什么是人工智能？'];

test.describe('recent question suggestions', () => {
  test('match a prefix, fill without sending, and record a new send', async () => {
    test.setTimeout(60000);
    const extension = await launchExtension();

    await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
      contentType: 'text/html',
      body: renderChatgptFixture({ composer: 'current' })
    }));
    await extension.serviceWorker.evaluate(async history => {
      await chrome.storage.local.set({ questionHistory: history });
    }, HISTORY);

    const page = await openMultiPanel(extension, { providers: ['chatgpt'], layout: '1x1' });
    const input = page.locator('#unified-input');
    const list = page.locator('#question-history');
    const items = list.locator('.question-history-item');
    const findFrame = () => page.frames().find(candidate => candidate.url().startsWith('https://chatgpt.com/'));
    await expect.poll(() => Boolean(findFrame())).toBe(true);
    const sends = () => findFrame().evaluate(() => window.__fixture?.sends ?? 0);

    await input.fill('how d');
    await expect(list).toBeVisible();
    await expect(items).toHaveText(['How do these compare?', 'How does it work?']);

    await items.first().click();
    await expect(input).toHaveValue('How do these compare?');
    expect(await sends()).toBe(0);

    await input.fill('How does');
    await input.press('ArrowDown');
    await expect(items.first()).toHaveClass(/is-active/);
    await input.press('Enter');
    await expect(input).toHaveValue('How does it work?');
    expect(await sends()).toBe(0);

    await input.fill('How d');
    await expect(list).toBeVisible();
    await input.press('Escape');
    await expect(list).toBeHidden();
    await expect(page.locator('#input-bar')).toBeVisible();

    await input.fill('What is new?');
    await expect(list).toBeHidden();
    await input.press('Enter');
    await expect.poll(sends).toBe(1);
    await expect.poll(async () => {
      const stored = await extension.serviceWorker.evaluate(() => chrome.storage.local.get('questionHistory'));
      return stored.questionHistory?.[0];
    }).toBe('What is new?');

    const stored = await extension.serviceWorker.evaluate(() => chrome.storage.local.get('questionHistory'));
    expect(stored.questionHistory).toHaveLength(3);
  });
});
