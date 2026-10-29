import { test, expect } from '@playwright/test';
import { AI_SUMMARY_API_KEY_STORAGE_KEY } from '../../modules/ai-summary.js';
import { createPatchedExtensionCopy, launchExtension, openMultiPanel } from './extension-harness.js';
import { renderChatgptFixture } from './fixtures/chatgpt-fixture.js';

const API_BASE_URL = 'https://api.panelize-e2e.test/v1';
const QUESTION = 'How do these explanations compare?';
const DEEPSEEK_FIXTURE = `<!doctype html><html><body>
  <div id="thread"></div>
  <textarea placeholder="How can I help you?"></textarea>
</body></html>`;

const SUMMARY = {
  verdict: null,
  overview: 'Both answers explain the core idea and give practical guidance.',
  consensus: [
    {
      heading: 'Core idea',
      points: [
        { text: 'Both describe the same underlying concept.', sources: ['S1', 'S2'] },
        { text: 'Both recommend checking the assumptions.', sources: ['S1', 'S2'] }
      ]
    },
    {
      heading: 'Practical use',
      points: [{ text: 'Both suggest testing a small example first.', sources: ['S1', 'S2'] }]
    }
  ],
  // Deliberately mixed source order: rendering groups each exact source set,
  // with single-model groups in panel order followed by shared sources.
  unique: [
    { text: 'A point raised by DeepSeek.', sources: ['S2'] },
    { text: 'A point raised by ChatGPT.', sources: ['S1'] },
    { text: 'A point they both raise.', sources: ['S2', 'S1'] }
  ],
  disagreements: []
};

function findFrame(page, origin) {
  return page.frames().find(candidate => candidate.url().startsWith(origin));
}

async function appendAnswer(page, origin, answerSelector, text) {
  const frame = findFrame(page, origin);
  await frame.evaluate(({ selector, text: answerText }) => {
    const container = document.getElementById('thread') || document.body;
    const answer = document.createElement('div');
    if (selector.className) answer.className = selector.className;
    if (selector.attribute) answer.setAttribute(selector.attribute, selector.value);
    answer.textContent = answerText;
    container.append(answer);
  }, { selector: answerSelector, text });
}

test.describe('AI summary reading layout', () => {
  test('shows the question, grouped consensus and unique insights, and copies the same structure', async ({}, testInfo) => {
    test.setTimeout(90000);
    let extensionCopy;
    let extension;
    const requests = [];

    try {
      // The throwaway extension has only the two fixture hosts and the mock
      // API host. The real extension and its saved permissions stay untouched.
      extensionCopy = await createPatchedExtensionCopy(manifest => {
        manifest.host_permissions.push(
          'https://chat.deepseek.com/*',
          'https://api.panelize-e2e.test/*'
        );
      });
      extension = await launchExtension({
        extensionPath: extensionCopy.extensionPath,
        viewport: { width: 1440, height: 900 }
      });
      await extension.context.addInitScript(() => {
        const writes = [];
        Object.defineProperty(window, '__testClipboardWrites', { value: writes });
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async text => { writes.push(String(text)); },
            readText: async () => writes.at(-1) || ''
          }
        });
      });

      await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
        contentType: 'text/html',
        body: renderChatgptFixture({ composer: 'current' })
      }));
      await extension.context.route('https://chat.deepseek.com/**', route => route.fulfill({
        contentType: 'text/html', body: DEEPSEEK_FIXTURE
      }));
      await extension.context.route(`${API_BASE_URL}/chat/completions`, async route => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(SUMMARY) } }] })
        });
      });

      // Seed a dummy API key in this isolated browser profile. The network
      // request above is intercepted, so the credential cannot leave the test.
      await extension.serviceWorker.evaluate(async ({ baseUrl, apiKey }) => {
        await chrome.storage.sync.set({ aiSummaryBaseUrl: baseUrl, aiSummaryModel: 'e2e-mock' });
        await chrome.storage.local.set({ [apiKey.key]: 'e2e-dummy-key' });
      }, { baseUrl: API_BASE_URL, apiKey: { key: AI_SUMMARY_API_KEY_STORAGE_KEY } });

      const page = await openMultiPanel(extension, {
        providers: ['chatgpt', 'deepseek'], layout: '1x2'
      });
      const order = await page.locator('.toolbar-right').evaluate(toolbar => [...toolbar.children].map(element => (
        element.id || (element.classList.contains('toolbar-divider') ? 'divider' : '')
      )));
      const newChatIndex = order.indexOf('new-chat-btn');
      expect(order.slice(newChatIndex, newChatIndex + 5)).toEqual([
        'new-chat-btn', 'wide-content-btn', 'ai-summary-btn', 'divider', 'temporary-chat-btn'
      ]);
      const divider = page.locator('.toolbar-divider');
      await expect(divider).toHaveCSS('width', '1px');
      await expect(divider).toHaveCSS('height', '16px');

      await page.locator('#unified-input').fill(QUESTION);
      await page.locator('#send-all-btn').click();
      await expect.poll(async () => {
        const chatgpt = findFrame(page, 'https://chatgpt.com/');
        return chatgpt ? chatgpt.evaluate(() => window.__fixture?.sends) : 0;
      }).toBe(1);
      await appendAnswer(page, 'https://chatgpt.com/', {
        attribute: 'data-message-author-role', value: 'assistant'
      }, 'ChatGPT answer text');
      await appendAnswer(page, 'https://chat.deepseek.com/', {
        className: 'ds-markdown'
      }, 'DeepSeek answer text');

      await page.locator('#ai-summary-btn').click();
      const drawer = page.locator('#ai-summary-drawer');
      await expect(drawer).toBeVisible();
      await expect(page.locator('#ai-summary-title-text')).toHaveText(QUESTION);
      await expect(page.locator('#ai-summary-title')).toHaveAttribute('title', QUESTION);
      await expect(page.locator('#ai-summary-title .material-symbols-outlined')).toHaveText('auto_awesome');
      const header = page.locator('#ai-summary-title').locator('..');
      await expect(header).toHaveCSS('padding', '8px 14px');
      await expect(page.locator('#ai-summary-title')).toHaveCSS('font-size', '15px');
      await expect(page.locator('#ai-summary-title')).toHaveCSS('white-space', 'nowrap');
      await expect(page.locator('#ai-summary-result')).toBeVisible({ timeout: 15000 });

      const consensus = page.locator('#ai-summary-consensus');
      await expect(consensus.locator('.ai-summary-article-heading')).toHaveText(['Core idea', 'Practical use']);
      await expect(consensus.locator('.ai-summary-article-paragraph')).toHaveCount(3);
      const sharedSourceChips = consensus.locator('.ai-summary-article-paragraph').first().locator('.ai-summary-source');
      const sharedSourceLabels = await sharedSourceChips.evaluateAll(chips => chips.flatMap(chip => (
        chip.classList.contains('ai-summary-source-all')
          ? chip.title.split(',').map(label => label.trim())
          : [chip.textContent.trim()]
      )));
      expect(sharedSourceLabels).toEqual(expect.arrayContaining(['ChatGPT', 'DeepSeek']));
      await expect(consensus.locator('.ai-summary-article-paragraph').first()).toHaveClass(/ai-summary-strong/);

      const uniqueGroups = page.locator('#ai-summary-unique .ai-summary-unique-group');
      await expect(uniqueGroups).toHaveCount(3);
      const uniqueSources = await uniqueGroups.locator('.ai-summary-unique-heading').evaluateAll(headings => (
        headings.map(heading => [...heading.querySelectorAll('.ai-summary-source')].map(chip => chip.textContent.trim()))
      ));
      expect(uniqueSources).toEqual([['ChatGPT'], ['DeepSeek'], ['ChatGPT', 'DeepSeek']]);
      await expect(uniqueGroups.locator('.ai-summary-unique-list li')).toHaveCount(3);
      expect(requests).toHaveLength(1);
      expect(requests[0].model).toBe('e2e-mock');
      await expect.poll(() => page.locator('#ai-summary-result').evaluate(element => (
        [...element.querySelectorAll('.ai-summary-reveal:not([hidden]), .ai-summary-article-paragraph, .ai-summary-unique-group, .ai-summary-disagreement')]
          .every(item => Number(getComputedStyle(item).opacity) >= 0.99)
      ))).toBe(true);
      await drawer.hover();
      await expect.poll(() => drawer.evaluate(element => getComputedStyle(element).backgroundColor))
        .toBe('rgb(255, 255, 255)');
      const lightHeaderBackground = await header.evaluate(element => getComputedStyle(element).backgroundImage);
      const strongChip = consensus.locator('.ai-summary-article-paragraph.ai-summary-strong .ai-summary-source').first();
      await page.screenshot({ path: testInfo.outputPath('ai-summary-light.png') });
      await page.locator('html').evaluate(element => element.setAttribute('data-theme', 'dark'));
      await expect.poll(() => drawer.evaluate(element => getComputedStyle(element).backgroundColor))
        .toBe('rgb(43, 43, 47)');
      const darkHeaderBackground = await header.evaluate(element => getComputedStyle(element).backgroundImage);
      expect(darkHeaderBackground).not.toBe(lightHeaderBackground);
      await expect.poll(() => strongChip.evaluate(element => getComputedStyle(element).color))
        .toBe('rgb(129, 199, 132)');
      await page.screenshot({ path: testInfo.outputPath('ai-summary-dark.png') });
      await page.locator('html').evaluate(element => element.setAttribute('data-theme', 'light'));
      await expect.poll(() => drawer.evaluate(element => getComputedStyle(element).backgroundColor))
        .toBe('rgb(255, 255, 255)');

      const widthBeforeExpand = await drawer.evaluate(element => element.getBoundingClientRect().width);
      await page.locator('#ai-summary-expand-btn').click();
      await expect(drawer).toHaveClass(/ai-summary-expanded/);
      await expect(page.locator('#ai-summary-expand-btn')).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => drawer.evaluate(element => element.getBoundingClientRect().width))
        .toBeGreaterThan(widthBeforeExpand);
      await page.locator('#ai-summary-expand-btn').click();
      await expect(drawer).not.toHaveClass(/ai-summary-expanded/);
      await expect(page.locator('#ai-summary-expand-btn')).toHaveAttribute('aria-pressed', 'false');

      await page.locator('#ai-summary-copy-btn').click();
      await expect.poll(() => page.evaluate(() => window.__testClipboardWrites.at(-1)))
        .toContain('## Core idea');
      const copied = await page.evaluate(() => window.__testClipboardWrites.at(-1));
      expect(copied).toContain('same underlying concept');
      expect(copied).toContain('## Practical use');
      expect(copied).toContain('[ChatGPT]');
      expect(copied).toContain('[DeepSeek]');
      expect(copied).toContain('[ChatGPT, DeepSeek]');
      expect(copied).toContain('- A point raised by DeepSeek.');
      expect(copied).toContain('- A point raised by ChatGPT.');
    } finally {
      await extension?.close();
      await extensionCopy?.cleanup();
    }
  });
});
