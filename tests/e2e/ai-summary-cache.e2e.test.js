import { test, expect } from '@playwright/test';
import { AI_SUMMARY_API_KEY_STORAGE_KEY } from '../../modules/answers/ai-summary.js';
import { createPatchedExtensionCopy, launchExtension, openMultiPanel } from './support/extension-harness.js';
import { renderChatgptFixture } from './fixtures/chatgpt-fixture.js';

const API_BASE_URL = 'https://api.panelize-e2e.test/v1';
const QUESTION = 'How do these explanations compare?';
const DEEPSEEK_FIXTURE = `<!doctype html><html><body>
  <div id="thread"></div>
  <textarea placeholder="How can I help you?"></textarea>
</body></html>`;
const SUMMARY = {
  verdict: null,
  overview: 'Both answers explain the core idea.',
  consensus: [{ heading: 'Core idea', points: [{ text: 'Both agree.', sources: ['S1', 'S2'] }] }],
  unique: [],
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

async function sendQuestionWithTwoAnswers(page) {
  const sendsBefore = await findFrame(page, 'https://chatgpt.com/').evaluate(() => window.__fixture?.sends ?? 0);
  await page.locator('#unified-input').fill(QUESTION);
  await page.locator('#send-all-btn').click();
  await expect.poll(async () => {
    const chatgpt = findFrame(page, 'https://chatgpt.com/');
    return chatgpt ? chatgpt.evaluate(() => window.__fixture?.sends ?? 0) : 0;
  }).toBe(sendsBefore + 1);
  await appendAnswer(page, 'https://chatgpt.com/', {
    attribute: 'data-message-author-role', value: 'assistant'
  }, 'ChatGPT answer text');
  await appendAnswer(page, 'https://chat.deepseek.com/', {
    className: 'ds-markdown'
  }, 'DeepSeek answer text');
  // The persistent card carries the question for this round; the manual
  // summary also collects any missing answer texts on demand.
  await expect(page.locator('#ai-summary-question')).toHaveText(QUESTION);
}

test.describe('AI summary cache', () => {
  test('reuses the same question within three days and reruns on demand', async () => {
    test.setTimeout(120000);
    let extensionCopy;
    let extension;
    const requests = [];

    try {
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

      await extension.serviceWorker.evaluate(async ({ baseUrl, apiKey }) => {
        await chrome.storage.sync.set({
          aiSummaryBaseUrl: baseUrl,
          aiSummaryModel: 'e2e-mock',
          aiSummaryAutoEnabled: false
        });
        await chrome.storage.local.set({ [apiKey.key]: 'e2e-dummy-key' });
      }, { baseUrl: API_BASE_URL, apiKey: { key: AI_SUMMARY_API_KEY_STORAGE_KEY } });

      const page = await openMultiPanel(extension, {
        providers: ['chatgpt', 'deepseek'], layout: '1x2'
      });
      const card = page.locator('#ai-summary-panel');
      await expect(card).toBeVisible();
      await expect(page.locator('#close-ai-summary-panel')).toBeHidden();

      await sendQuestionWithTwoAnswers(page);
      await page.locator('#ai-summary-btn').click();
      await expect(page.locator('#ai-summary-result')).toBeVisible({ timeout: 15000 });
      expect(requests).toHaveLength(1);

      // The finished summary reaches local storage.
      await expect.poll(async () => {
        const stored = await extension.serviceWorker.evaluate(() => chrome.storage.local.get('aiSummaryCache'));
        return stored.aiSummaryCache?.length ?? 0;
      }).toBe(1);

      // The card stays in the grid; the toolbar button only closes the overlay.
      await page.locator('#ai-summary-btn').click();
      await expect(card).not.toHaveClass(/ai-summary-expanded/);
      await expect(card).toBeVisible();

      // Ask the same question again; the cached summary comes back without a
      // second API request.
      await sendQuestionWithTwoAnswers(page);
      await expect(card).toBeVisible();
      await page.locator('#ai-summary-btn').click();
      await expect(card).toHaveClass(/ai-summary-expanded/);
      await expect(card).toHaveAttribute('data-from-cache', 'true');
      await expect(page.locator('#ai-summary-result')).toBeVisible();
      await expect(page.locator('#ai-summary-status')).toContainText('缓存');
      expect(requests).toHaveLength(1);

      // The rerun button always bypasses the cache.
      await page.locator('#ai-summary-rerun-btn').click();
      await expect.poll(() => requests.length).toBe(2);
      await expect(page.locator('#ai-summary-panel')).toHaveAttribute('data-from-cache', 'false');
    } finally {
      await extension?.close();
      await extensionCopy?.cleanup();
    }
  });
});
