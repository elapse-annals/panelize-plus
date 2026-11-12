import { expect, test } from '@playwright/test';
import { launchExtension, openMultiPanel } from './support/extension-harness.js';
import { renderChatgptFixture } from './fixtures/chatgpt-fixture.js';

const PROGRESS_KEY = '__panelizeGlobalSendProgress';

/** Records the page's progress reports where the background receives them. */
function captureGlobalSendMessages() {
  globalThis.__panelizeGlobalSendProgress = [];
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === 'globalSendProgress') {
      globalThis.__panelizeGlobalSendProgress.push(message.payload);
    }
  });
}

async function dispatchGlobalSend(extension, requestId) {
  const launcher = await extension.context.newPage();
  await launcher.goto(extension.extensionUrl('options/options.html'));
  await launcher.evaluate((id) => chrome.runtime.sendMessage({
    action: 'sendPromptToAll',
    payload: { requestId: id, text: 'Explain closures' }
  }), requestId);
  await launcher.close();
}

function readProgress(extension) {
  return extension.serviceWorker.evaluate(
    (key) => globalThis[key] || [],
    PROGRESS_KEY
  );
}

test('global send reports readiness counts and the AIs still loading', async () => {
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await extension.serviceWorker.evaluate(captureGlobalSendMessages);
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
    // One panel is ready and Gemini stays loading, so preparing never reaches
    // the 70% send threshold before the test ends.
    await expect(page.locator('#composer-status-text')).toContainText('1/2');

    await dispatchGlobalSend(extension, 'e2e-progress-1');

    await expect.poll(async () => {
      const messages = await readProgress(extension);
      return messages.some(message => message.stage === 'preparing'
        && message.ready === 1
        && message.total === 2);
    }).toBe(true);

    const preparing = (await readProgress(extension)).find(message =>
      message.stage === 'preparing' && message.ready === 1 && message.total === 2);
    expect(preparing).toMatchObject({
      requestId: 'e2e-progress-1',
      pendingCount: 1,
      timedOutCount: 0,
      pendingNames: ['Gemini'],
      blind: false
    });

    // Repeated 200ms ticks with unchanged readiness are not sent again.
    const preparingReports = (await readProgress(extension))
      .filter(message => message.stage === 'preparing');
    expect(preparingReports).toHaveLength(1);
  } finally {
    await extension.close();
  }
});

test('global send progress omits AI names in blind mode', async () => {
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await extension.serviceWorker.evaluate(captureGlobalSendMessages);
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
      settings: { selectedPromptMode: null, blindModeEnabled: true }
    });
    await expect(page.locator('#panel-grid iframe')).toHaveCount(2);
    await expect(page.locator('body')).toHaveClass(/blind-mode/);
    await expect(page.locator('#composer-status-text')).toContainText('1/2');

    await dispatchGlobalSend(extension, 'e2e-progress-blind');

    await expect.poll(async () => {
      const messages = await readProgress(extension);
      return messages.some(message => message.stage === 'preparing'
        && message.ready === 1
        && message.total === 2);
    }).toBe(true);

    const preparing = (await readProgress(extension)).find(message =>
      message.stage === 'preparing' && message.ready === 1 && message.total === 2);
    expect(preparing).toMatchObject({
      requestId: 'e2e-progress-blind',
      pendingCount: 1,
      pendingNames: [],
      timedOutNames: [],
      blind: true
    });
  } finally {
    await extension.close();
  }
});