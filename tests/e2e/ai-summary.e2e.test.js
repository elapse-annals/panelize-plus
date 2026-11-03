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

async function seedSummarySettings(extension, { auto = false } = {}) {
  await extension.serviceWorker.evaluate(async ({ baseUrl, apiKey, autoSummarize }) => {
    await chrome.storage.sync.set({
      aiSummaryBaseUrl: baseUrl,
      aiSummaryModel: 'e2e-mock',
      aiSummaryAutoEnabled: autoSummarize
    });
    await chrome.storage.local.set({ [apiKey.key]: 'e2e-dummy-key' });
  }, { baseUrl: API_BASE_URL, apiKey: { key: AI_SUMMARY_API_KEY_STORAGE_KEY }, autoSummarize: auto });
}

// Sends a question and gives both panels an answer, which is what lets the
// automatic summary reach its 80% threshold.
async function sendQuestionWithTwoAnswers(page) {
  await page.locator('#unified-input').fill(QUESTION);
  await page.locator('#send-all-btn').click();
  await expect(page.locator('.adopt-answer-btn').first()).toBeEnabled();
  await appendAnswer(page, 'https://chatgpt.com/', {
    attribute: 'data-message-author-role', value: 'assistant'
  }, 'ChatGPT answer text');
  await appendAnswer(page, 'https://chat.deepseek.com/', {
    className: 'ds-markdown'
  }, 'DeepSeek answer text');
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

      // A short summary opens in the narrow drawer.
      await expect(drawer).not.toHaveClass(/ai-summary-expanded/);
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

test('renders a Markdown fallback reply with headings, lists and code', async ({}, testInfo) => {
  test.setTimeout(90000);
  let extensionCopy;
  let extension;
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
    await extension.context.route(`${API_BASE_URL}/chat/completions`, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: '## Comparison\n\n- **Speed**: `fast`\n- Memory use\n\n```\ncode **x**\n```' } }]
      })
    }));
    await seedSummarySettings(extension);

    const page = await openMultiPanel(extension, {
      providers: ['chatgpt', 'deepseek'], layout: '1x2'
    });
    await page.locator('#unified-input').fill(QUESTION);
    await page.locator('#send-all-btn').click();
    await expect(page.locator('.adopt-answer-btn').first()).toBeEnabled();
    await appendAnswer(page, 'https://chatgpt.com/', {
      attribute: 'data-message-author-role', value: 'assistant'
    }, 'ChatGPT answer text');
    await appendAnswer(page, 'https://chat.deepseek.com/', {
      className: 'ds-markdown'
    }, 'DeepSeek answer text');

    await page.locator('#ai-summary-btn').click();
    const overview = page.locator('#ai-summary-overview');
    await expect(overview.locator('h4')).toHaveText('Comparison');
    await expect(overview.locator('ul li')).toHaveCount(2);
    await expect(overview.locator('ul li strong')).toHaveText('Speed');
    await expect(overview.locator('ul li code')).toHaveText('fast');
    await expect(overview.locator('pre code')).toHaveText('code **x**');
    await expect(overview.locator('pre code strong')).toHaveCount(0);
    await overview.screenshot({ path: testInfo.outputPath('ai-summary-markdown.png') });
  } finally {
    await extension?.close();
    await extensionCopy?.cleanup();
  }
});

test('source chips locate quoted passages and older summary paragraphs in provider frames', async ({}, testInfo) => {
  test.setTimeout(60000);
  let extensionCopy;
  let extension;
  const chatgptAnswer = '<div data-message-author-role="assistant"><p>Start with a small example.</p><p id="retry">A careful retry policy waits before sending another request.</p></div>';
  const deepseekAnswer = '<div class="ds-markdown"><p id="backoff">Use exponential <strong>backoff</strong> for busy servers.</p><p id="header">Respect the Retry-After header.</p></div>';
  const summary = {
    verdict: { text: 'Wait before retrying.', sources: ['S1'], quotes: { S1: 'A careful retry policy waits before sending another request.' } },
    consensus: [
      { text: 'A careful retry policy waits before sending another request.', sources: ['S1'] },
      { text: 'Zyzzyva', sources: ['S1'], quotes: { S1: 'This phrase is absent.' } }
    ],
    unique: [
      { text: 'Back off for busy servers.', sources: ['S2'], quotes: { S2: 'Use exponential backoff for busy servers.' } },
      { text: 'Honor the retry header.', sources: ['S2'], quotes: { S2: 'Respect the Retry-After header.' } }
    ],
    disagreements: [{ topic: 'What next?', positions: [
      { text: 'Try a small example.', sources: ['S1'], quotes: { S1: 'Start with a small example.' } },
      { text: 'Use the header.', sources: ['S2'], quotes: { S2: 'Respect the Retry-After header.' } }
    ] }]
  };
  try {
    extensionCopy = await createPatchedExtensionCopy(manifest => {
      manifest.host_permissions.push('https://chat.deepseek.com/*', 'https://api.panelize-e2e.test/*');
    });
    extension = await launchExtension({ extensionPath: extensionCopy.extensionPath, viewport: { width: 1440, height: 900 } });
    await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
      contentType: 'text/html', body: renderChatgptFixture({ composer: 'current' })
    }));
    await extension.context.route('https://chat.deepseek.com/**', route => route.fulfill({
      contentType: 'text/html', body: DEEPSEEK_FIXTURE
    }));
    await extension.context.route(`${API_BASE_URL}/chat/completions`, route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(summary) } }] })
    }));
    await extension.serviceWorker.evaluate(async ({ baseUrl, key }) => {
      await chrome.storage.sync.set({
        aiSummaryBaseUrl: baseUrl,
        aiSummaryModel: 'e2e-mock',
        aiSummaryAutoEnabled: false
      });
      await chrome.storage.local.set({ [key]: 'e2e-dummy-key' });
    }, { baseUrl: API_BASE_URL, key: AI_SUMMARY_API_KEY_STORAGE_KEY });
    const page = await openMultiPanel(extension, { providers: ['chatgpt', 'deepseek'], layout: '1x2' });
    await page.locator('#unified-input').fill('How should I retry requests?');
    await page.locator('#send-all-btn').click();
    await expect(page.locator('.adopt-answer-btn').first()).toBeEnabled();
    const chatgpt = findFrame(page, 'https://chatgpt.com/');
    const deepseek = findFrame(page, 'https://chat.deepseek.com/');
    await chatgpt.evaluate(html => document.body.insertAdjacentHTML('beforeend', html), chatgptAnswer);
    await deepseek.evaluate(html => document.getElementById('thread').insertAdjacentHTML('beforeend', html), deepseekAnswer);
    await page.locator('#ai-summary-btn').click();
    await expect(page.locator('#ai-summary-result')).toBeVisible({ timeout: 15000 });

    await page.locator('#ai-summary-verdict .ai-summary-source').click();
    await expect(chatgpt.locator('#retry')).toHaveClass(/panelize-quote-highlight/);
    await expect(chatgpt.locator('p').filter({ hasText: 'Start with a small example.' })).not.toHaveClass(/panelize-quote-highlight/);
    await page.screenshot({ path: testInfo.outputPath('ai-summary-quote-highlight.png') });
    await expect(chatgpt.locator('#retry')).not.toHaveClass(/panelize-quote-highlight/, { timeout: 5000 });

    // A reply without quotes still uses a sufficiently similar original paragraph.
    await page.locator('#ai-summary-consensus .ai-summary-article-paragraph').first().locator('.ai-summary-source').click();
    await expect(chatgpt.locator('#retry')).toHaveClass(/panelize-quote-highlight/);

    // Each point in a shared unique-source group keeps its own anchor.
    const uniqueItems = page.locator('#ai-summary-unique .ai-summary-unique-list li');
    await uniqueItems.nth(0).locator('.ai-summary-source').click();
    await expect(deepseek.locator('#backoff')).toHaveClass(/panelize-quote-highlight/);
    await uniqueItems.nth(1).locator('.ai-summary-source').click();
    await expect(deepseek.locator('#header')).toHaveClass(/panelize-quote-highlight/);

    await page.locator('#ai-summary-disagreements .ai-summary-position').first().locator('.ai-summary-source').click();
    await expect(chatgpt.locator('p').filter({ hasText: 'Start with a small example.' })).toHaveClass(/panelize-quote-highlight/);
    await expect(chatgpt.locator('.panelize-quote-highlight')).toHaveCount(0, { timeout: 5000 });
    await page.locator('#ai-summary-consensus .ai-summary-article-paragraph').nth(1).locator('.ai-summary-source').click();
    await expect(page.locator('.panel-item').first()).toHaveClass(/panel-jump-highlight/);
    await expect(chatgpt.locator('.panelize-quote-highlight')).toHaveCount(0);
  } finally {
    await extension?.close();
    await extensionCopy?.cleanup();
  }
});

test('automatic summary opens the drawer only after the summary arrives', async ({}, testInfo) => {
  test.setTimeout(90000);
  let extensionCopy;
  let extension;
  let releaseSummary;
  const requests = [];
  const gate = new Promise(resolve => { releaseSummary = resolve; });
  try {
    extensionCopy = await createPatchedExtensionCopy(manifest => {
      manifest.host_permissions.push('https://chat.deepseek.com/*', 'https://api.panelize-e2e.test/*');
    });
    extension = await launchExtension({ extensionPath: extensionCopy.extensionPath, viewport: { width: 1440, height: 900 } });
    await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
      contentType: 'text/html', body: renderChatgptFixture({ composer: 'current' })
    }));
    await extension.context.route('https://chat.deepseek.com/**', route => route.fulfill({
      contentType: 'text/html', body: DEEPSEEK_FIXTURE
    }));
    await extension.context.route(`${API_BASE_URL}/chat/completions`, async route => {
      requests.push(route.request().postDataJSON());
      await gate;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(SUMMARY) } }] })
      });
    });
    await seedSummarySettings(extension, { auto: true });
    const page = await openMultiPanel(extension, { providers: ['chatgpt', 'deepseek'], layout: '1x2' });

    await sendQuestionWithTwoAnswers(page);
    await expect.poll(() => requests.length, { timeout: 30000 }).toBe(1);
    // The request is in flight; the drawer must stay closed until there is a
    // summary to read, and the button must not ring as if one were ready.
    const drawer = page.locator('#ai-summary-drawer');
    await expect(drawer).toBeHidden();
    await expect(page.locator('#ai-summary-btn')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#ai-summary-btn')).not.toHaveClass(/ai-summary-ready/);
    await page.screenshot({ path: testInfo.outputPath('ai-summary-auto-pending.png') });

    releaseSummary();
    await expect(drawer).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#ai-summary-result')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#ai-summary-overview')).toHaveText(SUMMARY.overview);
  } finally {
    releaseSummary?.();
    await extension?.close();
    await extensionCopy?.cleanup();
  }
});

test('an empty automatic summary leaves the drawer closed', async ({}, testInfo) => {
  test.setTimeout(90000);
  let extensionCopy;
  let extension;
  const requests = [];
  try {
    extensionCopy = await createPatchedExtensionCopy(manifest => {
      manifest.host_permissions.push('https://chat.deepseek.com/*', 'https://api.panelize-e2e.test/*');
    });
    extension = await launchExtension({ extensionPath: extensionCopy.extensionPath, viewport: { width: 1440, height: 900 } });
    await extension.context.route('https://chatgpt.com/**', route => route.fulfill({
      contentType: 'text/html', body: renderChatgptFixture({ composer: 'current' })
    }));
    await extension.context.route('https://chat.deepseek.com/**', route => route.fulfill({
      contentType: 'text/html', body: DEEPSEEK_FIXTURE
    }));
    await extension.context.route(`${API_BASE_URL}/chat/completions`, route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: '{}' } }] })
      });
    });
    await seedSummarySettings(extension, { auto: true });
    const page = await openMultiPanel(extension, { providers: ['chatgpt', 'deepseek'], layout: '1x2' });

    await sendQuestionWithTwoAnswers(page);
    await expect.poll(() => requests.length, { timeout: 30000 }).toBe(1);
    const button = page.locator('#ai-summary-btn');
    await expect(button).not.toHaveClass(/ai-summary-busy/, { timeout: 15000 });
    // No result: no drawer, no ready ring, no toast.
    await expect(page.locator('#ai-summary-drawer')).toBeHidden();
    await expect(button).not.toHaveClass(/ai-summary-ready/);
    await expect(page.locator('.panelize-toast')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('ai-summary-auto-empty.png') });

    // Asking by hand still explains why there is nothing to show.
    await button.click();
    await expect(page.locator('#ai-summary-drawer')).toBeVisible();
    const status = page.locator('#ai-summary-status');
    await expect(status).toHaveClass(/error/, { timeout: 15000 });
    await expect(status).not.toHaveText('');
  } finally {
    await extension?.close();
    await extensionCopy?.cleanup();
  }
});
