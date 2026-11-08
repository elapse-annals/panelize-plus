import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './support/extension-harness.js';
import { renderChatgptFixture } from './fixtures/chatgpt-fixture.js';
import { DEEP_PROMPT_TEXTS } from '../../modules/prompts/prompt-modes.js';

const CONCISE_INSTRUCTION = 'Be as concise as possible';
const DEEP_INSTRUCTION = DEEP_PROMPT_TEXTS.current.en.split('\n')[0];

function panelIds(page) {
  return page.locator('#panel-grid .panel-item').evaluateAll(items => items.map(item => item.id));
}

async function panelFrame(page, panelId) {
  const handle = await page.locator(`#${panelId} iframe`).elementHandle();
  return handle.contentFrame();
}

async function panelFixture(page, panelId) {
  const frame = await panelFrame(page, panelId);
  return frame.evaluate(() => window.__fixture);
}

async function panelEditorText(page, panelId) {
  const frame = await panelFrame(page, panelId);
  return frame.evaluate(() => document.querySelector(
    '[data-composer-placement="thread"] [data-composer-markdown]'
  )?.innerText || '');
}

test.describe('Per-panel prompt modes', () => {
  test.setTimeout(120000);

  let extension;

  test.beforeEach(async () => {
    extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
      contentType: 'text/html', body: renderChatgptFixture({ composer: 'current' })
    }));
  });

  test.afterEach(async () => {
    await extension?.close();
  });

  async function openChatgpt(settings = {}) {
    return openMultiPanel(extension, {
      providers: ['chatgpt'],
      layout: '1x1',
      enabledProviders: ['chatgpt'],
      settings: { language: 'en', selectedPromptMode: null, ...settings }
    });
  }

  test('clones an AI panel and sends each panel its own instruction', async () => {
    const page = await openChatgpt();
    await expect(page.locator('#panel-grid .panel-item')).toHaveCount(1);
    const [firstId] = await panelIds(page);

    await page.locator(`#${firstId} .clone-panel-btn`).click();
    await expect(page.locator('#panel-grid .panel-item')).toHaveCount(2);
    const ids = await panelIds(page);
    expect(ids[0]).toBe(firstId);
    await expect(page.locator('#panel-grid .panel-header .provider-icon')).toHaveCount(2);
    expect(await page.locator('#panel-grid .panel-header .provider-icon').evaluateAll(images =>
      images.map(image => image.dataset.providerId)
    )).toEqual(['chatgpt', 'chatgpt']);

    const [firstPanelId, secondPanelId] = ids;
    await page.locator(`#${firstPanelId} .panel-prompt-mode-select`).selectOption('concise');
    await page.locator(`#${secondPanelId} .panel-prompt-mode-select`).selectOption('deep');
    await expect(page.locator(`#${firstPanelId} .provider-name`)).toHaveText('ChatGPT · Concise');
    await expect(page.locator(`#${secondPanelId} .provider-name`)).toHaveText('ChatGPT · Deep thinking');

    await page.locator('#unified-input').fill('Explain closures');
    await page.locator('#fill-input-btn').click();
    await expect.poll(() => panelEditorText(page, firstPanelId))
      .toContain(CONCISE_INSTRUCTION);
    await expect.poll(() => panelEditorText(page, secondPanelId))
      .toContain(DEEP_INSTRUCTION);
    expect(await panelEditorText(page, firstPanelId)).not.toContain(DEEP_INSTRUCTION);
    expect(await panelEditorText(page, secondPanelId)).not.toContain(CONCISE_INSTRUCTION);

    await page.locator('#send-all-btn').click();
    await expect.poll(async () => (await panelFixture(page, firstPanelId))?.sends).toBe(1);
    await expect.poll(async () => (await panelFixture(page, secondPanelId))?.sends).toBe(1);
    const firstSent = (await panelFixture(page, firstPanelId)).sentTexts[0];
    const secondSent = (await panelFixture(page, secondPanelId)).sentTexts[0];
    expect(firstSent).toContain('Explain closures');
    expect(firstSent).toContain(CONCISE_INSTRUCTION);
    expect(firstSent).not.toContain(DEEP_INSTRUCTION);
    expect(secondSent).toContain('Explain closures');
    expect(secondSent).toContain(DEEP_INSTRUCTION.replace(/\n/g, ''));
    expect(secondSent).not.toContain(CONCISE_INSTRUCTION);
    await page.close();
  });

  test('adds a second panel of the same AI and keeps Auto triggers for inherit panels only', async () => {
    const page = await openChatgpt({ selectedPromptMode: 'auto' });
    await page.locator('#add-panel-btn').click();
    const sameAiItem = page.locator('.add-panel-item[data-provider-id="chatgpt"]');
    await expect(sameAiItem).toHaveCount(1);
    await sameAiItem.click();
    await expect(page.locator('#panel-grid .panel-item')).toHaveCount(2);

    const [firstPanelId, secondPanelId] = await panelIds(page);
    await expect(page.locator(`#${firstPanelId} .provider-name`)).toHaveText('ChatGPT #1');
    await expect(page.locator(`#${secondPanelId} .provider-name`)).toHaveText('ChatGPT #2');
    await page.locator(`#${secondPanelId} .panel-prompt-mode-select`).selectOption('deep');
    await expect(page.locator(`#${secondPanelId} .provider-name`)).toHaveText('ChatGPT · Deep thinking');

    await page.locator('#unified-input').fill('/study Explain closures');
    await page.locator('#send-all-btn').click();
    await expect.poll(async () => (await panelFixture(page, firstPanelId))?.sends).toBe(1);
    await expect.poll(async () => (await panelFixture(page, secondPanelId))?.sends).toBe(1);
    const inheritSent = (await panelFixture(page, firstPanelId)).sentTexts[0];
    const fixedSent = (await panelFixture(page, secondPanelId)).sentTexts[0];

    // The inherit panel takes the Auto trigger's Learning mode; the fixed panel
    // keeps Deep thinking. The trigger word leaves the shared question.
    expect(inheritSent).not.toContain('/study');
    expect(inheritSent).toContain('Answer as a teacher');
    expect(fixedSent).not.toContain('/study');
    expect(fixedSent).toContain(DEEP_INSTRUCTION);
    expect(fixedSent).not.toContain('Answer as a teacher');
    await page.close();
  });
});