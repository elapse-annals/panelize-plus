import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './support/extension-harness.js';
import { renderChatgptFixture } from './fixtures/chatgpt-fixture.js';

// The instruction appended for the concise mode, as shipped in _locales/en.
const CONCISE_INSTRUCTION = 'Be as concise as possible';
const DEEP_INSTRUCTION = 'Think step by step: break the problem down, identify assumptions, analyze root causes, compare options and verify in reverse; before the final conclusion, list your reasoning steps in detail and state any uncertainty.';

function readFixture(page) {
  const frame = page.frames().find(candidate => candidate.url().startsWith('https://chatgpt.com/'));
  return frame ? frame.evaluate(() => window.__fixture).catch(() => null) : null;
}

async function chooseMode(page, name) {
  await page.locator('#prompt-mode-btn').click();
  await page.locator('.prompt-mode-option', { has: page.locator('.prompt-mode-option-name', { hasText: new RegExp(`^${name}$`) }) }).click();
  await expect(page.locator('#prompt-mode-list')).toBeHidden();
}

function modeNames(page) {
  return page.locator('.prompt-mode-option-name');
}

async function openChatgptPanel(extension, settings = {}) {
  await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
    contentType: 'text/html', body: renderChatgptFixture({ composer: 'current' })
  }));
  // These tests assert English labels and placeholders; the default UI is
  // Chinese, so pin the language instead of depending on the host locale.
  return openMultiPanel(extension, { providers: ['chatgpt'], settings: { language: 'en', ...settings } });
}

test.describe('Prompt mode and Prompt Library keyboard', () => {
  test.setTimeout(120000);

  test('appends the instruction after the question without changing the question', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension);
      const select = page.locator('#prompt-mode-btn');
      const control = page.locator('.prompt-mode-control');
      // New installs start in Auto mode.
      await expect(select).toHaveAttribute('data-mode', 'auto');
      await expect(control).toHaveAttribute('data-active', 'true');

      await chooseMode(page, 'Concise');
      await expect(control).toHaveAttribute('data-active', 'true');
      await expect(select).toHaveAttribute('title', /Prompt mode: Concise/);
      await expect(page.locator('#unified-input')).toHaveAttribute('placeholder', new RegExp(`Appends: ${CONCISE_INSTRUCTION}`));
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
      await expect(select).toHaveAttribute('data-mode', 'concise');
    } finally {
      await extension.close();
    }
  });

  test('a per-send prompt mode overrides the saved mode without changing it', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension, { selectedPromptMode: 'deep' });
      await expect(page.locator('#prompt-mode-btn')).toHaveAttribute('data-mode', 'deep');

      await extension.serviceWorker.evaluate(() => {
        const result = chrome.runtime.sendMessage({
          action: 'sendPromptToAll',
          payload: {
            requestId: 'native-default-mode',
            text: 'Explain closures',
            promptMode: 'default'
          }
        });
        result?.catch?.(() => {});
      });

      await expect.poll(async () => (await readFixture(page))?.sends).toBe(1);
      const sent = (await readFixture(page)).sentTexts[0];
      expect(sent).toBe('Explain closures');
      expect(sent).not.toContain(DEEP_INSTRUCTION);
      await expect(page.locator('#prompt-mode-btn')).toHaveAttribute('data-mode', 'deep');
      expect(await extension.serviceWorker.evaluate(async () =>
        (await chrome.storage.sync.get('selectedPromptMode')).selectedPromptMode
      )).toBe('deep');
    } finally {
      await extension.close();
    }
  });

  test('Auto applies a mode only when its trigger word is typed and drops the word', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension);
      await chooseMode(page, 'Auto');
      await expect(page.locator('.prompt-mode-control')).toHaveAttribute('data-active', 'true');
      await expect(page.locator('#unified-input')).toHaveAttribute('placeholder', /Auto: \/brief Concise · \/study Learning/);

      const editor = page.frameLocator('iframe')
        .locator('[data-composer-placement="thread"] [data-composer-markdown]');
      await page.locator('#unified-input').fill('/brief Explain closures');
      await page.locator('#fill-input-btn').click();
      await expect.poll(async () => editor.innerText())
        .toMatch(new RegExp(`^Explain closures\\s*\\n+\\s*${CONCISE_INSTRUCTION}`));
      expect(await editor.innerText()).not.toContain('/brief');
    } finally {
      await extension.close();
    }
  });

  test('Deep thinking appends its instruction and Auto previews and removes /think', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension);
      const input = page.locator('#unified-input');
      await chooseMode(page, 'Deep thinking');
      await expect(input).toHaveAttribute('placeholder', /Appends: Think step by step/);

      await input.fill('Question');
      await expect(page.locator('#prompt-ghost .prompt-ghost-suffix')).toHaveText(DEEP_INSTRUCTION);
      await page.locator('#send-all-btn').click();
      await expect.poll(async () => (await readFixture(page))?.sentTexts.length).toBe(1);
      const directSent = (await readFixture(page)).sentTexts[0];
      expect(directSent.startsWith('Question')).toBe(true);
      expect(directSent).toContain(DEEP_INSTRUCTION);

      await chooseMode(page, 'Auto');
      await input.fill('/think Another question');
      await expect(page.locator('#prompt-ghost .prompt-ghost-removed')).toHaveText('/think');
      await expect(page.locator('#prompt-ghost .prompt-ghost-suffix')).toHaveText(DEEP_INSTRUCTION);
      await page.locator('#send-all-btn').click();
      await expect.poll(async () => (await readFixture(page))?.sentTexts.length).toBe(2);
      const autoSent = (await readFixture(page)).sentTexts[1];
      expect(autoSent.startsWith('Another question')).toBe(true);
      expect(autoSent).not.toContain('/think');
      expect(autoSent).toContain(DEEP_INSTRUCTION);
    } finally {
      await extension.close();
    }
  });

  test('Auto suggests the trigger word being typed and Tab completes it', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension);
      await chooseMode(page, 'Auto');
      const input = page.locator('#unified-input');
      await input.click();
      await input.pressSequentially('Explain closures /st');
      await expect(page.locator('#prompt-ghost .prompt-ghost-completion')).toHaveText('udy');
      await expect(page.locator('#prompt-ghost .prompt-ghost-completion-hint')).toHaveText('Tab · Learning');

      await input.press('Tab');
      await expect(input).toHaveValue('Explain closures /study ');
      await expect(input).toBeFocused();
      await expect(page.locator('#prompt-ghost .prompt-ghost-completion')).toHaveCount(0);
      await expect(page.locator('#prompt-ghost .prompt-ghost-removed')).toHaveText('/study');
    } finally {
      await extension.close();
    }
  });

  test('lists the built-in modes and library prompts marked as modes', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension);
      await expect(modeNames(page)).toHaveText(['Default', 'Auto', 'Concise', 'Learning', 'Challenge', 'Brainstorm', 'Deep thinking']);

      await page.locator('#prompt-library-btn').click();
      await page.locator('#new-prompt-btn').click();
      await page.locator('#prompt-title-input').fill('Plain prompt');
      await page.locator('#prompt-content-input').fill('Not a mode.');
      await page.locator('#save-prompt-btn').click();
      await page.locator('#new-prompt-btn').click();
      await page.locator('#prompt-title-input').fill('Pirate');
      await page.locator('#prompt-content-input').fill('Answer like a pirate.');
      await page.locator('#prompt-is-mode-input').check();
      await page.locator('#save-prompt-btn').click();
      await page.locator('#close-prompt-modal').click();
      await expect(page.locator('#prompt-modal')).toBeHidden();

      await expect(modeNames(page)).toHaveText(['Default', 'Auto', 'Concise', 'Learning', 'Challenge', 'Brainstorm', 'Deep thinking', 'Pirate']);
      await chooseMode(page, 'Pirate');
      await expect(page.locator('#unified-input')).toHaveAttribute('placeholder', /Appends: Answer like a pirate\./);

      await page.locator('#unified-input').fill('Explain closures');
      await page.locator('#send-all-btn').click();
      await expect.poll(async () => (await readFixture(page))?.sends).toBe(1);
      const sent = (await readFixture(page)).sentTexts[0];
      expect(sent.startsWith('Explain closures')).toBe(true);
      expect(sent).toContain('Answer like a pirate.');
    } finally {
      await extension.close();
    }
  });

  test('creates, edits and deletes modes from the mode menu', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension);
      page.on('dialog', dialog => dialog.accept());
      const editor = page.locator('#prompt-editor-modal');

      await page.locator('#prompt-mode-btn').click();
      await page.locator('.prompt-mode-new').click();
      await expect(editor).toBeVisible();
      await expect(page.locator('#prompt-is-mode-input')).toBeChecked();
      await page.locator('#prompt-title-input').fill('Pirate');
      await page.locator('#prompt-content-input').fill('Answer like a pirate.');
      await page.locator('#save-prompt-btn').click();
      await expect(editor).toBeHidden();
      await expect(modeNames(page).last()).toHaveText('Pirate');

      await chooseMode(page, 'Pirate');
      await page.locator('#prompt-mode-btn').click();
      const pirateRow = page.locator('.prompt-mode-row', { hasText: 'Pirate' });
      await pirateRow.locator('.prompt-mode-edit').click();
      await expect(page.locator('#prompt-title-input')).toHaveValue('Pirate');
      // Wait for the loaded prompt, or the editor's leftover text from the
      // previous save would let the fill below be overwritten by it.
      await expect(page.locator('#prompt-content-input')).toHaveValue('Answer like a pirate.');
      await page.locator('#prompt-content-input').fill('Talk like a pirate.');
      await page.locator('#save-prompt-btn').click();
      await expect(page.locator('#unified-input')).toHaveAttribute('placeholder', /Appends: Talk like a pirate\./);

      await page.locator('#prompt-mode-btn').click();
      await page.locator('.prompt-mode-row', { hasText: 'Pirate' }).locator('.prompt-mode-delete').click();
      await expect(modeNames(page)).toHaveText(['Default', 'Auto', 'Concise', 'Learning', 'Challenge', 'Brainstorm', 'Deep thinking']);
      await expect(page.locator('#prompt-mode-btn')).toHaveAttribute('data-mode', '');
    } finally {
      await extension.close();
    }
  });

  test('Default sends the question exactly as typed', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension, { selectedPromptMode: null });
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

  test('the Edit button on a library card opens the editor without inserting the prompt', async ({}, testInfo) => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension);
      const editor = page.locator('#prompt-editor-modal');

      await page.locator('#prompt-library-btn').click();
      const card = page.locator('.prompt-item-modal', { has: page.locator('.prompt-item-modal-title', { hasText: /^Concise$/ }) });
      const editButton = card.locator('.prompt-item-edit');
      await expect(editButton).toHaveCSS('opacity', '1');
      await expect(editButton).toHaveCSS('width', '32px');
      await expect(editButton).toHaveCSS('height', '32px');
      await page.screenshot({ path: testInfo.outputPath('always-visible-edit.png'), fullPage: true });
      await editButton.click();

      await expect(editor).toBeVisible();
      await expect(page.locator('#prompt-title-input')).toHaveValue('Concise');
      await expect(page.locator('#prompt-modal')).toBeVisible();
      await expect(page.locator('#unified-input')).toHaveValue('');
    } finally {
      await extension.close();
    }
  });

  test('shows the Chinese text of a prompt and sends its English text', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension);
      const editor = page.locator('#prompt-editor-modal');

      // A mode with both texts: the library card, the placeholder and the
      // send preview show the Chinese text, the AIs get the English one.
      await page.locator('#prompt-library-btn').click();
      await page.locator('#new-prompt-btn').click();
      await page.locator('#prompt-title-input').fill('Bilingual');
      await page.locator('#prompt-content-input').fill('用一句中文回答。');
      await page.locator('#prompt-content-en-input').fill('Answer in one English sentence.');
      await page.locator('#prompt-is-mode-input').check();
      await page.locator('#save-prompt-btn').click();
      await expect(editor).toBeHidden();
      const modeCard = page.locator('.prompt-item-modal', {
        has: page.locator('.prompt-item-modal-title', { hasText: /^Bilingual$/ })
      });
      await expect(modeCard.locator('.prompt-item-modal-preview')).toHaveText('用一句中文回答。');
      await page.locator('#close-prompt-modal').click();
      await expect(page.locator('#prompt-modal')).toBeHidden();

      await chooseMode(page, 'Bilingual');
      await expect(page.locator('#unified-input')).toHaveAttribute('placeholder', /Appends: 用一句中文回答。/);
      await page.locator('#unified-input').fill('Explain closures');
      await expect(page.locator('#prompt-ghost .prompt-ghost-suffix')).toHaveText('用一句中文回答。');
      await page.locator('#send-all-btn').click();
      await expect.poll(async () => (await readFixture(page))?.sentTexts.length).toBe(1);
      const modeSent = (await readFixture(page)).sentTexts[0];
      expect(modeSent).toContain('Answer in one English sentence.');
      expect(modeSent).not.toContain('用一句中文回答。');

      // A plain prompt fills the input with the Chinese text and sends the
      // English one; editing the text sends what was typed instead.
      await chooseMode(page, 'Default');
      await page.locator('#prompt-library-btn').click();
      await page.locator('#new-prompt-btn').click();
      await expect(page.locator('#prompt-content-en-input')).toHaveValue('');
      await page.locator('#prompt-title-input').fill('中文问答');
      await page.locator('#prompt-content-input').fill('用中文回答。');
      await page.locator('#prompt-content-en-input').fill('Answer in English.');
      await page.locator('#save-prompt-btn').click();
      await expect(editor).toBeHidden();

      const plainCard = page.locator('.prompt-item-modal', {
        has: page.locator('.prompt-item-modal-title', { hasText: /^中文问答$/ })
      });
      await expect(plainCard.locator('.prompt-item-modal-preview')).toHaveText('用中文回答。');
      await plainCard.click();
      await expect(page.locator('#prompt-modal')).toBeHidden();
      await expect(page.locator('#unified-input')).toHaveValue('用中文回答。');

      await page.locator('#send-all-btn').click();
      await expect.poll(async () => (await readFixture(page))?.sentTexts.length).toBe(2);
      expect((await readFixture(page)).sentTexts[1]).toBe('Answer in English.');

      await page.locator('#prompt-library-btn').click();
      await plainCard.click();
      await expect(page.locator('#unified-input')).toHaveValue('用中文回答。');
      await page.locator('#unified-input').fill('Edited question');
      await page.locator('#send-all-btn').click();
      await expect.poll(async () => (await readFixture(page))?.sentTexts.length).toBe(3);
      expect((await readFixture(page)).sentTexts[2]).toBe('Edited question');
    } finally {
      await extension.close();
    }
  });
});
