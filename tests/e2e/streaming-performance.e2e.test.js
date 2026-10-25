import { test, expect } from '@playwright/test';
import {
  createPatchedExtensionCopy,
  launchExtension,
  openMultiPanel
} from './extension-harness.js';
import { renderChatgptFixture } from './fixtures/chatgpt-fixture.js';
import { OPTIONAL_PROVIDER_CONFIGS } from '../../modules/optional-provider-access.js';
import { PROVIDERS } from '../../modules/providers.js';

const STREAM_PROVIDER_IDS = PROVIDERS.slice(0, 12).map(provider => provider.id);
const TIMED_PROVIDER_IDS = ['chatgpt', 'gemini', 'deepseek'];
const PROVIDER_BY_ID = new Map(PROVIDERS.map(provider => [provider.id, provider]));
const LAYOUT_FOR_COUNT = { 3: '1x3', 6: '1x6', 9: '1x9', 12: '1x12' };

let extensionCopy;
let extension;
let fixtureMode = 'stream';

function renderStreamingFixture(providerId) {
  const serializedProviderId = JSON.stringify(providerId);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 14px sans-serif; margin: 16px; }
  .provider-brand { margin-bottom: 12px; }
  .composer { margin-bottom: 16px; }
  #answer { min-height: 120px; }
</style></head>
<body>
  <header class="provider-brand">Provider ${providerId}</header>
  <form class="composer">
    <textarea aria-label="Message"></textarea>
    <button type="button">Send</button>
  </form>
  <article id="answer" class="markdown">Initial answer from ChatGPT</article>
  <script>
    const providerId = ${serializedProviderId};
    const answerText = document.querySelector('#answer').firstChild;
    window.__fixture = {
      providerId,
      updates: 0,
      timer: null,
      startStream() {
        if (this.timer) return;
        this.timer = setInterval(() => {
          this.updates += 1;
          answerText.nodeValue += ' ChatGPT token-' + this.updates;
          if (this.updates >= 28) {
            clearInterval(this.timer);
            this.timer = null;
          }
        }, 40);
      }
    };
  </script>
</body></html>`;
}

function timingStreamScript({ answerTag, answerClass = '', sendSelector = '[data-fixture-send]', stopButton = false }) {
  const stopMarkup = stopButton
    ? '<button type="button" class="send-button stop" aria-label="Stop response">Stop</button>'
    : '';
  return `<script>
    (() => {
      let started = false;
      window.__timingFixture = { updates: 0, timer: null };
      const send = document.querySelector(${JSON.stringify(sendSelector)});
      send.addEventListener('click', () => {
        if (started) return;
        started = true;
        const answer = document.createElement(${JSON.stringify(answerTag)});
        answer.className = ${JSON.stringify(answerClass)};
        answer.textContent = 'Answer from ChatGPT';
        answer.dataset.messageAuthorRole = 'assistant';
        if (${stopButton}) document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(stopMarkup)});
        document.body.appendChild(answer);
        window.__timingFixture.timer = setInterval(() => {
          window.__timingFixture.updates += 1;
          answer.firstChild.nodeValue += ' ChatGPT token-' + window.__timingFixture.updates;
          if (window.__timingFixture.updates >= 6) {
            clearInterval(window.__timingFixture.timer);
            window.__timingFixture.timer = null;
            document.querySelector('[aria-label="Stop response"]')?.remove();
          }
        }, 100);
      });
    })();
  </script>`;
}

function renderTimingFixture(providerId) {
  if (providerId === 'chatgpt') {
    const html = renderChatgptFixture({ composer: 'current', busyAfterSendMs: 1200 });
    return html.replace('</body>', `${timingStreamScript({
      answerTag: 'div',
      answerClass: 'markdown',
      sendSelector: '[data-type="unified-composer"] button[aria-label^="Send"]'
    })}</body>`);
  }

  if (providerId === 'gemini') {
    return `<!doctype html><html><body>
      <div class="input-area-container">
        <div class="ql-editor" contenteditable="true" role="textbox" aria-label="Message"></div>
        <button class="send-button" aria-label="Send message" data-fixture-send>Send</button>
      </div>
      ${timingStreamScript({ answerTag: 'model-response', stopButton: true })}
    </body></html>`;
  }

  return `<!doctype html><html><body>
    <div id="composer">
      <textarea placeholder="How can I help you?"></textarea>
      <button type="button" aria-label="Send" data-fixture-send>Send</button>
    </div>
    <div id="thread"></div>
    ${timingStreamScript({ answerTag: 'div', answerClass: 'ds-markdown' })}
  </body></html>`;
}

async function createTestExtension() {
  extensionCopy = await createPatchedExtensionCopy((manifest) => {
    manifest.host_permissions = [...new Set([
      ...(manifest.host_permissions || []),
      ...(manifest.optional_host_permissions || [])
    ])];
  });
  extension = await launchExtension({
    extensionPath: extensionCopy.extensionPath,
    viewport: { width: 1440, height: 900 }
  });

  for (const provider of PROVIDERS) {
    const origin = new URL(provider.url).origin;
    await extension.context.route(`${origin}/**`, route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: fixtureMode === 'timing'
        ? renderTimingFixture(provider.id)
        : renderStreamingFixture(provider.id)
    }));
  }
}

async function configureProviders(providerIds, layout, blindModeEnabled = false) {
  await extension.serviceWorker.evaluate(async ({ ids, nextLayout, blind }) => {
    await chrome.storage.sync.set({
      enabledProviders: ids,
      providerOrder: ids,
      providerSortMode: 'manual',
      multiPanelProviders: ids,
      multiPanelLayout: nextLayout,
      startupProviders: null,
      blindModeEnabled: blind
    });
  }, { ids: providerIds, nextLayout: layout, blind: blindModeEnabled });

  const optionalScriptIds = providerIds
    .filter(id => OPTIONAL_PROVIDER_CONFIGS[id])
    .map(id => OPTIONAL_PROVIDER_CONFIGS[id].contentScript.id);
  if (optionalScriptIds.length > 0) {
    await expect.poll(() => extension.serviceWorker.evaluate(async (ids) => {
      const registered = new Set(
        (await chrome.scripting.getRegisteredContentScripts()).map(({ id }) => id)
      );
      return ids.every(id => registered.has(id));
    }, optionalScriptIds), { timeout: 15000 }).toBe(true);
  }
}

function providerFrame(page, providerId) {
  const origin = new URL(PROVIDER_BY_ID.get(providerId).url).origin;
  return page.frames().find(frame => frame.url().startsWith(origin));
}

async function waitForFixtures(page, providerIds) {
  await expect.poll(async () => Promise.all(providerIds.map(async (id) => {
    const frame = providerFrame(page, id);
    if (!frame) return false;
    return frame.evaluate(() => Boolean(window.__fixture || window.__timingFixture)).catch(() => false);
  })), { timeout: 15000 }).toEqual(providerIds.map(() => true));
}

test.describe('Synthetic multi-panel streaming responsiveness', () => {
  test.setTimeout(120000);

  test.beforeAll(async () => {
    await createTestExtension();
  });

  test.afterAll(async () => {
    await extension?.close();
    await extensionCopy?.cleanup();
  });

  test('keeps the unified input usable while 3, 6, 9, and 12 panels stream', async () => {
    const scenarios = [
      { count: 3, blind: false },
      { count: 6, blind: false },
      { count: 9, blind: false },
      { count: 12, blind: false },
      { count: 6, blind: true },
      { count: 12, blind: true }
    ];

    fixtureMode = 'stream';
    for (const { count, blind } of scenarios) {
      const providerIds = STREAM_PROVIDER_IDS.slice(0, count);
      const layout = LAYOUT_FOR_COUNT[count];
      await configureProviders(providerIds, layout, blind);
      const page = await openMultiPanel(extension, { providers: providerIds, layout });

      try {
        await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
        await waitForFixtures(page, providerIds);
        const frames = providerIds.map(id => providerFrame(page, id));
        expect(frames.every(Boolean)).toBe(true);

        if (blind) {
          await expect.poll(async () => Promise.all(frames.map(frame => frame.evaluate(() =>
            document.getElementById('panelize-page-style')?.textContent.includes('grayscale(1)') === true
          ))), { timeout: 10000 }).toEqual(providerIds.map(() => true));
        }

        await Promise.all(frames.map(frame => frame.evaluate(() => window.__fixture.startStream())));
        await expect.poll(async () => {
          const updates = await Promise.all(frames.map(frame => frame.evaluate(() => window.__fixture.updates)));
          return updates.every(count => count >= 2);
        }, { timeout: 5000 }).toBe(true);

        const input = page.locator('#unified-input');
        await input.click();
        await page.keyboard.type(`draft-${count}`);
        await expect(input).toHaveValue(`draft-${count}`);
        await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('unified-input');
        await expect.poll(async () => {
          const updates = await Promise.all(frames.map(frame => frame.evaluate(() => window.__fixture.updates)));
          return updates.every(count => count >= 10);
        }, { timeout: 5000 }).toBe(true);

        if (blind) {
          await expect.poll(async () => {
            const texts = await Promise.all(frames.map(frame => frame.locator('#answer').textContent()));
            return texts.every(text => !/ChatGPT/i.test(text || ''));
          }, { timeout: 5000 }).toBe(true);
        }
        expect(await page.evaluate(() => document.activeElement?.id)).toBe('unified-input');
      } finally {
        await page.close();
      }
    }
  });

  test('preserves response timing for ChatGPT, Gemini, and DeepSeek during streaming', async () => {
    fixtureMode = 'timing';
    await configureProviders(TIMED_PROVIDER_IDS, '1x3', false);
    const page = await openMultiPanel(extension, { providers: TIMED_PROVIDER_IDS, layout: '1x3' });

    try {
      await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
      await waitForFixtures(page, TIMED_PROVIDER_IDS);
      await page.locator('#unified-input').fill('Compare these streamed answers');
      await page.locator('#send-all-btn').click();

      await expect.poll(async () => Promise.all(TIMED_PROVIDER_IDS.map(id => {
        const frame = providerFrame(page, id);
        return frame?.evaluate(() => window.__timingFixture?.updates >= 6).catch(() => false) || false;
      })), { timeout: 15000 }).toEqual(TIMED_PROVIDER_IDS.map(() => true));

      await page.locator('#answer-stats-btn').click();
      const tableRowFor = providerId => page.locator('#answer-stats-table tbody tr')
        .filter({ hasText: PROVIDER_BY_ID.get(providerId).name });

      for (const providerId of TIMED_PROVIDER_IDS) {
        const row = tableRowFor(providerId);
        await expect(row).toHaveCount(1);
        await expect.poll(() => row.locator('td').nth(2).textContent(), { timeout: 12000 }).not.toBe('—');
        await expect.poll(() => row.locator('td').nth(3).textContent(), { timeout: 12000 }).not.toBe('—');
      }
    } finally {
      await page.close();
    }
  });
});
