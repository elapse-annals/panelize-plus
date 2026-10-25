import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createPatchedExtensionCopy,
  launchExtension,
} from './extension-harness.js';

const STARTUP_SNAPSHOT_KEY = 'panelize.startupSnapshot';
const PROVIDER_URLS = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/',
  gemini: 'https://gemini.google.com/app',
  googleAi: 'https://www.google.com/search?udm=50',
  googleSearch: 'https://www.google.com/',
  'qwen-cn': 'https://www.qianwen.com/',
};

test.describe('startup localStorage snapshot', () => {
  test.setTimeout(60_000);

  let extensionCopy;
  let extension;

  test.beforeAll(async () => {
    extensionCopy = await createPatchedExtensionCopy(() => {});

    const htmlPath = path.join(extensionCopy.extensionPath, 'multi-panel/multi-panel.html');
    const html = await readFile(htmlPath, 'utf8');
    const moduleScript = '  <script type="module" src="multi-panel.js"></script>';
    expect(html).toContain(moduleScript);
    await writeFile(htmlPath, html.replace(moduleScript, [
      '  <script src="startup-storage-gate.js"></script>',
      moduleScript,
    ].join('\n')));

    // This test-only gate leaves the underlying Chrome API intact, then lets a
    // test release every storage read after checking the first paint.
    await writeFile(path.join(extensionCopy.extensionPath, 'multi-panel/startup-storage-gate.js'), `
      (() => {
        const originalGet = chrome.storage.sync.get.bind(chrome.storage.sync);
        let release;
        const ready = new Promise(resolve => { release = resolve; });
        const gate = window.__startupStorageGate = {
          installed: true,
          released: false,
          calls: 0,
          release() {
            if (this.released) return;
            this.released = true;
            release();
          }
        };
        window.__startupProviderReports = [];
        window.addEventListener('message', event => {
          if (event.data?.type === 'PANELIZE_PROVIDER_LOCATION' || event.data?.type === 'PANELIZE_PAGE_WIDTH') {
            window.__startupProviderReports.push(event.data.type);
          }
        });
        chrome.storage.sync.get = (...args) => {
          gate.calls += 1;
          return ready.then(() => originalGet(...args));
        };
      })();
    `);

    extension = await launchExtension({ extensionPath: extensionCopy.extensionPath });
    await extension.context.route('https://**/*', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body>Provider fixture</body></html>',
    }));
  });

  test.afterAll(async () => {
    await extension?.close();
    await extensionCopy?.cleanup();
  });

  async function setSettings(settings) {
    await extension.serviceWorker.evaluate(async values => {
      await chrome.storage.sync.set(values);
    }, settings);
  }

  async function setPreservedState(state) {
    await extension.serviceWorker.evaluate(async value => {
      await chrome.storage.session.set({ preservedState: value });
    }, state);
  }

  async function readSnapshot(page) {
    return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STARTUP_SNAPSHOT_KEY);
  }

  async function openPage(snapshot, { chatgptStatusFixture = false } = {}) {
    const page = await extension.context.newPage();
    page.on('console', message => {
      if (message.type() === 'error') console.log('[multi-panel-console-error]', message.text());
    });
    if (chatgptStatusFixture) {
      await page.route('https://chatgpt.com/**', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><body><script>
          window.__startupStyleMessages = [];
          history.replaceState(null, '', '/c/early-startup-report');
          window.parent.postMessage({
            type: 'PANELIZE_PROVIDER_LOCATION',
            provider: 'chatgpt',
            url: location.href,
            context: 'multi-panel-provider-status'
          }, '*');
          window.parent.postMessage({
            type: 'PANELIZE_PAGE_WIDTH',
            provider: 'chatgpt',
            neededWidth: 2000,
            context: 'multi-panel-provider-status'
          }, '*');
          window.addEventListener('message', event => {
            if (event.source === window.parent && event.data?.type === 'PANELIZE_PAGE_STYLE') {
              window.__startupStyleMessages.push(event.data.blind);
            }
          });
        </script></body></html>`,
      }));
    }
    await page.addInitScript(({ key, value }) => {
      if (window.top !== window) return;
      localStorage.removeItem(key);
      if (value !== null) localStorage.setItem(key, value);
    }, {
      key: STARTUP_SNAPSHOT_KEY,
      value: snapshot === undefined ? null : JSON.stringify(snapshot),
    });
    await page.goto(extension.extensionUrl('multi-panel/multi-panel.html'), {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => window.__startupStorageGate?.installed === true);
    return page;
  }

  async function releaseStorageAndWait(page) {
    await page.evaluate(() => window.__startupStorageGate.release());
    await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
  }

  function makeSnapshot(providerIds, frameUrls = {}, layout = '1x3') {
    return {
      version: 1,
      layout,
      startupProviderIds: providerIds,
      frameUrls: Object.fromEntries(providerIds.map(id => [id, frameUrls[id] || PROVIDER_URLS[id]])),
    };
  }

  test('starts provider requests from a valid snapshot before storage responds and keeps matching frames', async () => {
    const providerIds = ['chatgpt', 'claude'];
    await setSettings({
      enabledProviders: providerIds,
      providerOrder: providerIds,
      startupProviders: providerIds,
      multiPanelLayout: '1x3',
    });
    const requestedUrls = [];
    const page = await extension.context.newPage();
    page.on('request', request => requestedUrls.push(request.url()));
    const snapshot = makeSnapshot(providerIds);
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
      key: STARTUP_SNAPSHOT_KEY,
      value: JSON.stringify(snapshot),
    });
    await page.goto(extension.extensionUrl('multi-panel/multi-panel.html'), {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => window.__startupStorageGate?.installed === true);

    await expect(page.locator('#panel-grid iframe')).toHaveCount(2);
    await expect.poll(() => requestedUrls.some(url => url.startsWith(PROVIDER_URLS.chatgpt))).toBe(true);
    const before = await page.locator('#panel-grid iframe').evaluateAll(frames => {
      window.__startupSnapshotFrames = frames.slice();
      return frames.map(frame => frame.src);
    });
    expect(before).toEqual([PROVIDER_URLS.chatgpt, PROVIDER_URLS.claude]);
    expect(await page.evaluate(() => window.__startupStorageGate.calls)).toBeGreaterThan(0);

    await releaseStorageAndWait(page);
    expect(await page.locator('#panel-grid iframe').evaluateAll(frames =>
      frames.map((frame, index) => frame === window.__startupSnapshotFrames[index])
    )).toEqual([true, true]);
    await page.close();
  });

  test('keeps early location and width reports, then reapplies loaded page style settings', async () => {
    await setSettings({
      enabledProviders: ['chatgpt'],
      providerOrder: ['chatgpt'],
      startupProviders: ['chatgpt'],
      multiPanelLayout: '1x1',
      blindModeEnabled: true,
    });
    const page = await openPage(makeSnapshot(['chatgpt'], {}, '1x1'), { chatgptStatusFixture: true });
    await page.waitForFunction(() => window.__startupProviderReports.includes('PANELIZE_PROVIDER_LOCATION')
      && window.__startupProviderReports.includes('PANELIZE_PAGE_WIDTH'));
    const beforeReconcile = await page.locator('#panel-grid iframe').evaluate(iframe => {
      window.__earlyStartupFrame = iframe;
      return iframe.classList.contains('panel-fitted');
    });
    expect(beforeReconcile).toBe(true);

    await releaseStorageAndWait(page);
    expect(await page.locator('#panel-grid iframe').evaluate(iframe => iframe === window.__earlyStartupFrame)).toBe(true);
    const providerFrame = page.frames().find(frame => frame.url().startsWith('https://chatgpt.com/'));
    await expect.poll(() => providerFrame.evaluate(() => window.__startupStyleMessages.at(-1))).toBe(true);

    const [openedPage] = await Promise.all([
      extension.context.waitForEvent('page'),
      page.locator('.open-provider-top-level-btn').evaluate(button => button.click()),
    ]);
    await expect.poll(() => openedPage.url()).toBe('https://chatgpt.com/c/early-startup-report');
    await openedPage.close();
    await page.close();
  });

  test('waits to create Grok and MiMo frames until their session synchronization runs', async () => {
    const providerIds = ['grok', 'mimo', 'chatgpt'];
    await setSettings({
      enabledProviders: providerIds,
      providerOrder: providerIds,
      startupProviders: providerIds,
      multiPanelLayout: '1x3',
    });
    const page = await openPage(makeSnapshot(providerIds, {
      grok: 'https://grok.com/',
      mimo: 'https://aistudio.xiaomimimo.com/#/c',
    }));
    await expect(page.locator('#panel-grid iframe')).toHaveCount(1);
    await expect(page.locator('#panel-grid .provider-icon').first()).toHaveAttribute('data-provider-id', 'chatgpt');

    await releaseStorageAndWait(page);
    // MiMo is an optional provider and this test profile has not granted its
    // host permission. Grok remains enabled and should appear after sync.
    await expect(page.locator('#panel-grid iframe')).toHaveCount(2);
    await expect(page.locator('#panel-grid .provider-icon').first()).toHaveAttribute('data-provider-id', 'grok');
    await page.close();
  });

  test('reconciles changed startup providers and drops an optional provider without permission', async () => {
    const cachedIds = ['chatgpt', 'claude', 'qwen-cn'];
    const actualIds = ['chatgpt', 'gemini'];
    await setSettings({
      enabledProviders: ['chatgpt', 'claude', 'gemini', 'qwen-cn'],
      providerOrder: ['chatgpt', 'claude', 'gemini', 'qwen-cn'],
      startupProviders: actualIds,
      multiPanelLayout: '1x3',
    });
    const page = await openPage(makeSnapshot(cachedIds));
    await expect(page.locator('#panel-grid iframe')).toHaveCount(2);
    await expect(page.locator('#panel-grid iframe').evaluateAll(frames => frames.some(frame =>
      new URL(frame.src).host === 'www.qianwen.com'
    ))).resolves.toBe(false);
    await page.locator('#panel-grid iframe').evaluateAll(frames => {
      window.__startupSnapshotFramesByHost = Object.fromEntries(frames.map(frame => [
        new URL(frame.src).host,
        frame,
      ]));
    });

    await releaseStorageAndWait(page);
    await expect.poll(() => page.locator('#panel-grid .provider-icon').evaluateAll(images =>
      images.map(image => image.dataset.providerId)
    )).toEqual(actualIds);
    expect(await page.locator('#panel-grid iframe').evaluateAll(frames =>
      frames.map(frame => new URL(frame.src).host)
    )).toEqual(['chatgpt.com', 'gemini.google.com']);
    const retainedChatgpt = await page.locator('#panel-grid iframe').first().evaluate(frame =>
      frame === window.__startupSnapshotFramesByHost['chatgpt.com']
    );
    expect(retainedChatgpt).toBe(true);
    await page.close();
  });

  test('replaces a cached Google frame when the saved provider mode changed', async () => {
    await setSettings({
      enabledProviders: ['google'],
      providerOrder: ['google'],
      startupProviders: ['google'],
      multiPanelLayout: '1x1',
      googleProviderMode: 'search',
    });
    const page = await openPage(makeSnapshot(['google'], { google: PROVIDER_URLS.googleAi }, '1x1'));
    await expect(page.locator('#panel-grid iframe')).toHaveCount(1);
    const initialSrc = await page.locator('#panel-grid iframe').getAttribute('src');
    expect(initialSrc).toBe(PROVIDER_URLS.googleAi);
    await page.locator('#panel-grid iframe').evaluate(frame => {
      window.__startupSnapshotFrame = frame;
    });

    await releaseStorageAndWait(page);
    await expect(page.locator('#panel-grid iframe')).toHaveAttribute('src', PROVIDER_URLS.googleSearch);
    expect(await page.locator('#panel-grid iframe').evaluate(frame =>
      frame !== window.__startupSnapshotFrame
    )).toBe(true);
    await page.close();
  });

  test('replaces a temporary-chat URL with the regular URL after startup resets temporary mode', async () => {
    await setSettings({
      enabledProviders: ['chatgpt'],
      providerOrder: ['chatgpt'],
      startupProviders: ['chatgpt'],
      multiPanelLayout: '1x1',
    });
    const page = await openPage(makeSnapshot(['chatgpt'], {
      chatgpt: 'https://chatgpt.com/?temporary-chat=true',
    }, '1x1'));
    await expect(page.locator('#panel-grid iframe')).toHaveAttribute('src', 'https://chatgpt.com/?temporary-chat=true');
    await page.locator('#panel-grid iframe').evaluate(frame => { window.__startupTempFrame = frame; });

    await releaseStorageAndWait(page);
    await expect(page.locator('#panel-grid iframe')).toHaveAttribute('src', 'https://chatgpt.com');
    expect(await page.locator('#panel-grid iframe').evaluate(frame => frame !== window.__startupTempFrame)).toBe(true);
    await page.close();
  });

  test('reconciles restored providers in their saved order and preserves an iframe that stays in order', async () => {
    await setSettings({
      enabledProviders: ['chatgpt', 'claude', 'gemini'],
      providerOrder: ['chatgpt', 'claude', 'gemini'],
      startupProviders: ['gemini'],
      multiPanelLayout: '1x3',
    });
    const page = await openPage(makeSnapshot(['chatgpt', 'claude', 'gemini']));
    await page.locator('#panel-grid iframe').nth(1).evaluate(frame => { window.__startupClaudeFrame = frame; });
    await setPreservedState({
      currentLayout: '1x2',
      panels: [{ providerId: 'claude' }, { providerId: 'chatgpt' }],
    });

    await releaseStorageAndWait(page);
    await expect.poll(() => page.locator('#panel-grid .provider-icon').evaluateAll(images =>
      images.map(image => image.dataset.providerId)
    )).toEqual(['claude', 'chatgpt']);
    await expect(page.locator('#panel-grid')).toHaveClass(/layout-1x2/);
    expect(await page.locator('#panel-grid iframe').first().evaluate(frame => frame === window.__startupClaudeFrame)).toBe(true);
    await page.close();
  });

  test('writes an updated snapshot when the user changes layout', async () => {
    const providerIds = ['chatgpt', 'claude'];
    await setSettings({
      enabledProviders: providerIds,
      providerOrder: providerIds,
      startupProviders: providerIds,
      multiPanelLayout: '1x2',
    });
    const page = await openPage(null);
    await releaseStorageAndWait(page);
    const oldSnapshot = await readSnapshot(page);
    expect(oldSnapshot.layout).toBe('1x2');

    await page.locator('#layout-btn').click();
    await page.locator('.layout-option[data-layout="2x1"]').click();
    await expect(page.locator('#panel-grid')).toHaveClass(/layout-2x1/);
    await expect.poll(async () => (await readSnapshot(page))?.layout).toBe('2x1');
    await expect.poll(async () => (await extension.serviceWorker.evaluate(async () =>
      (await chrome.storage.sync.get('multiPanelLayout')).multiPanelLayout
    ))).toBe('2x1');
    await page.close();
  });

  test('falls back to storage initialization when the cached snapshot is malformed', async () => {
    const providerIds = ['chatgpt', 'claude'];
    await setSettings({
      enabledProviders: providerIds,
      providerOrder: providerIds,
      startupProviders: providerIds,
      multiPanelLayout: '1x3',
    });
    const page = await extension.context.newPage();
    await page.addInitScript(key => localStorage.setItem(key, '{invalid'), STARTUP_SNAPSHOT_KEY);
    await page.goto(extension.extensionUrl('multi-panel/multi-panel.html'), {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => window.__startupStorageGate?.installed === true);
    await expect(page.locator('#panel-grid iframe')).toHaveCount(0);

    await releaseStorageAndWait(page);
    await expect(page.locator('#panel-grid iframe')).toHaveCount(2);
    await page.close();
  });

  test('falls back to storage initialization when the snapshot is missing', async () => {
    const providerIds = ['chatgpt', 'claude'];
    await setSettings({
      enabledProviders: providerIds,
      providerOrder: providerIds,
      startupProviders: providerIds,
      multiPanelLayout: '1x3',
    });
    const page = await openPage(null);
    await expect(page.locator('#panel-grid iframe')).toHaveCount(0);
    await releaseStorageAndWait(page);
    await expect(page.locator('#panel-grid iframe')).toHaveCount(2);
    await expect.poll(async () => (await readSnapshot(page))?.startupProviderIds).toEqual(providerIds);
    await page.close();
  });
});
