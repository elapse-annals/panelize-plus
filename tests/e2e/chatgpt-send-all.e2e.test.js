import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './support/extension-harness.js';
import { renderChatgptFixture } from './fixtures/chatgpt-fixture.js';
import { renderChatgptSecondSendFixture } from './fixtures/chatgpt-second-send-fixture.js';

async function openSecondSendPanel(extension, fixtureOptions) {
  await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
    contentType: 'text/html', body: renderChatgptSecondSendFixture(fixtureOptions),
  }));
  const page = await openMultiPanel(extension, {
    providers: ['chatgpt'], settings: { selectedPromptMode: null }
  });
  const readFixture = () => {
    const frame = page.frames().find(candidate => candidate.url().startsWith('https://chatgpt.com/'));
    return frame ? frame.evaluate(() => window.__fixture).catch(() => null) : null;
  };
  return { page, readFixture };
}

test('Send All supports the current ChatGPT composer without a legacy id', async ({}, testInfo) => {
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
      contentType: 'text/html', body: renderChatgptFixture({ composer: 'current' }),
    }));
    const page = await openMultiPanel(extension, {
      providers: ['chatgpt'], settings: { selectedPromptMode: null }
    });
    const panel = page.frameLocator('iframe');
    const editor = panel.locator('[data-composer-placement="thread"] [data-composer-markdown]');
    await expect(editor).toBeVisible();

    const readFixture = () => {
      const frame = page.frames().find(candidate => candidate.url().startsWith('https://chatgpt.com/'));
      return frame ? frame.evaluate(() => window.__fixture).catch(() => null) : null;
    };

    await page.locator('#unified-input').fill('Panelize current composer regression');
    await page.locator('#send-all-btn').click();

    await expect.poll(async () => (await readFixture())?.sentTexts)
      .toEqual(['Panelize current composer regression']);
    expect((await readFixture()).straySends).toEqual([]);
    await expect(editor).toHaveText('');
    await expect(panel.locator('[data-composer-placement="home"] [data-composer-markdown]')).toHaveText('');
    await page.screenshot({ path: testInfo.outputPath('chatgpt-send-all.png'), fullPage: true });
  } finally {
    await extension.close();
  }
});

test('the second Send All uses the thread composer after the home one is hidden', async () => {
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    const { page, readFixture } = await openSecondSendPanel(extension, {
      threadSend: 'fruitjuice',
      hideHomeAfterSend: 'visibility',
    });
    const input = page.locator('#unified-input');

    await input.fill('first prompt');
    await page.locator('#send-all-btn').click();
    await expect.poll(async () => (await readFixture())?.sends).toBe(1);

    await input.fill('second prompt');
    await page.locator('#send-all-btn').click();
    await expect.poll(async () => (await readFixture())?.sentTexts, { timeout: 10000 })
      .toEqual(['first prompt', 'second prompt']);

    const fixture = await readFixture();
    expect(fixture.straySends).toEqual([]);
    expect(fixture.stopClicks).toBe(0);
    // The retired home composer must not receive the second prompt.
    await expect(page.frameLocator('iframe')
      .locator('[data-fixture-home] [data-composer-markdown]')).toHaveText('');
  } finally {
    await extension.close();
  }
});

test('a Send All during a ChatGPT answer waits for the send control', async () => {
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    const { page, readFixture } = await openSecondSendPanel(extension, {
      threadSend: 'submit-localized',
      hideHomeAfterSend: 'visibility',
      busyAfterFirstSendMs: 3000,
    });
    const input = page.locator('#unified-input');

    await input.fill('first prompt');
    await page.locator('#send-all-btn').click();
    await expect.poll(async () => (await readFixture())?.sends).toBe(1);

    await input.fill('second prompt');
    await page.locator('#send-all-btn').click();
    await expect.poll(async () => (await readFixture())?.sentTexts, { timeout: 15000 })
      .toEqual(['first prompt', 'second prompt']);

    const fixture = await readFixture();
    expect(fixture.straySends).toEqual([]);
    expect(fixture.stopClicks).toBe(0);
  } finally {
    await extension.close();
  }
});

test('a newer Send All replaces a queued prompt while ChatGPT is streaming', async () => {
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    const { page, readFixture } = await openSecondSendPanel(extension, {
      threadSend: 'fruitjuice',
      hideHomeAfterSend: 'remove',
      busyAfterFirstSendMs: 3000,
    });
    const input = page.locator('#unified-input');

    await input.fill('first prompt');
    await page.locator('#send-all-btn').click();
    await expect.poll(async () => (await readFixture())?.sends).toBe(1);

    await input.fill('second prompt');
    await page.locator('#send-all-btn').click();
    await input.fill('third prompt');
    await page.locator('#send-all-btn').click();

    await expect.poll(async () => (await readFixture())?.sentTexts, { timeout: 15000 })
      .toEqual(['first prompt', 'third prompt']);

    const fixture = await readFixture();
    expect(fixture.sentTexts.join('|')).not.toContain('second prompt');
    expect(fixture.stopClicks).toBe(0);
  } finally {
    await extension.close();
  }
});
