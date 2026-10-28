import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './extension-harness.js';
import { renderChatgptFixture } from './fixtures/chatgpt-fixture.js';

// The instruction appended for the concise mode, as shipped in _locales/en.
const CONCISE_INSTRUCTION = 'Be as concise as possible';

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
      const select = page.locator('#prompt-mode-btn');
      const control = page.locator('.prompt-mode-control');
      await expect(select).toHaveAttribute('data-mode', '');
      await expect(control).toHaveAttribute('data-active', 'false');

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
      await expect(modeNames(page)).toHaveText(['Default', 'Auto', 'Concise', 'Learning', 'Challenge', 'Brainstorm']);

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

      await expect(modeNames(page)).toHaveText(['Default', 'Auto', 'Concise', 'Learning', 'Challenge', 'Brainstorm', 'Pirate']);
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
      await page.locator('#prompt-content-input').fill('Talk like a pirate.');
      await page.locator('#save-prompt-btn').click();
      await expect(page.locator('#unified-input')).toHaveAttribute('placeholder', /Appends: Talk like a pirate\./);

      await page.locator('#prompt-mode-btn').click();
      await page.locator('.prompt-mode-row', { hasText: 'Pirate' }).locator('.prompt-mode-delete').click();
      await expect(modeNames(page)).toHaveText(['Default', 'Auto', 'Concise', 'Learning', 'Challenge', 'Brainstorm']);
      await expect(page.locator('#prompt-mode-btn')).toHaveAttribute('data-mode', '');
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

  test('the Edit button on a library card opens the editor without inserting the prompt', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await openChatgptPanel(extension);
      const editor = page.locator('#prompt-editor-modal');

      await page.locator('#prompt-library-btn').click();
      const card = page.locator('.prompt-item-modal', { has: page.locator('.prompt-item-modal-title', { hasText: /^Concise$/ }) });
      const editButton = card.locator('.prompt-item-edit');
      await expect(editButton).toHaveCSS('opacity', '0');
      await card.hover();
      await expect(editButton).toHaveCSS('opacity', '1');
      await editButton.click();

      await expect(editor).toBeVisible();
      await expect(page.locator('#prompt-title-input')).toHaveValue('Concise');
      await expect(page.locator('#prompt-modal')).toBeVisible();
      await expect(page.locator('#unified-input')).toHaveValue('');
    } finally {
      await extension.close();
    }
  });
});
