import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './extension-harness.js';
import { renderChatgptFixture } from './fixtures/chatgpt-fixture.js';

// The instruction appended for the concise mode, as shipped in _locales/en.
const CONCISE_INSTRUCTION = 'Be as concise as possible';

function readFixture(page) {
  const frame = page.frames().find(candidate => candidate.url().startsWith('https://chatgpt.com/'));
  return frame ? frame.evaluate(() => window.__fixture).catch(() => null) : null;
}

async function openChatgptPanel(extension) {
  await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
    contentType: 'text/html', body: renderChatgptFixture({ composer: 'current' })
  }));
  return openMultiPanel(extension, { providers: ['chatgpt'] });
}

test.describe('Prompt mode and Prompt Library keyboard', () => {
  test.setTimeout(120000);

  test('appends the instruction after the question without changing the question', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension);
      const select = page.locator('#prompt-mode-select');
      const control = page.locator('.prompt-mode-control');
      await expect(select).toHaveValue('');
      await expect(control).toHaveAttribute('data-active', 'false');

      await select.selectOption('concise');
      await expect(control).toHaveAttribute('data-active', 'true');
      await expect(select).toHaveAttribute('title', /Prompt mode: Concise/);
      await expect.poll(() => extension.serviceWorker.evaluate(async () =>
        (await chrome.storage.sync.get('selectedPromptMode')).selectedPromptMode
      )).toBe('concise');

      // Fill only, so the panel's composer can be inspected before it is sent.
      const editor = page.frameLocator('iframe')
        .locator('[data-composer-placement="thread"] [data-composer-markdown]');
      await page.locator('#unified-input').fill('Explain closures');
      await page.locator('#fill-input-btn').click();

      // Providers render the blank line as their own paragraph break, so the
      // block separator survives even where textContent would join the lines.
      await expect.poll(async () => editor.innerText())
        .toMatch(new RegExp(`^Explain closures\\s*\\n+\\s*${CONCISE_INSTRUCTION}`));

      // Sending the filled panels keeps the same text and the chosen mode.
      await page.locator('#send-all-btn').click();
      await expect.poll(async () => (await readFixture(page))?.sends).toBe(1);
      const sent = (await readFixture(page)).sentTexts[0];
      expect(sent.startsWith('Explain closures')).toBe(true);
      expect(sent).toContain(CONCISE_INSTRUCTION);
      await expect(select).toHaveValue('concise');
    } finally {
      await extension.close();
    }
  });

  test('Default sends the question exactly as typed', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension);
      await page.locator('#unified-input').fill('Explain closures');
      await page.locator('#send-all-btn').click();

      await expect.poll(async () => (await readFixture(page))?.sentTexts)
        .toEqual(['Explain closures']);
    } finally {
      await extension.close();
    }
  });

  test('Esc closes the Prompt Library but never the prompt editor on top of it', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension);
      const library = page.locator('#prompt-modal');
      const editor = page.locator('#prompt-editor-modal');

      await page.locator('#prompt-library-btn').click();
      await expect(library).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(library).toBeHidden();

      await page.locator('#prompt-library-btn').click();
      await page.locator('#new-prompt-btn').click();
      await expect(editor).toBeVisible();
      await page.locator('#prompt-title-input').fill('Unsaved draft');
      await page.keyboard.press('Escape');
      await expect(editor).toBeVisible();
      await expect(library).toBeVisible();
      await expect(page.locator('#prompt-title-input')).toHaveValue('Unsaved draft');

      await page.locator('#cancel-prompt-editor').click();
      await expect(editor).toBeHidden();
      await page.keyboard.press('Escape');
      await expect(library).toBeHidden();
    } finally {
      await extension.close();
    }
  });
});
