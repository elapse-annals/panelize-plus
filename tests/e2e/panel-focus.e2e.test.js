import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './extension-harness.js';
import { SHARE_SNAPSHOT_ACTION } from '../../modules/share-trigger.js';

const PROVIDER_HOSTS = {
  chatgpt: 'chatgpt.com',
  claude: 'claude.ai',
  gemini: 'gemini.google.com',
  grok: 'grok.com',
};

const FOCUS_FIXTURE = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html, body { margin: 0; width: 100%; height: 100%; }</style>
</head><body><main>Provider fixture</main><script>
window.__panelFocusFixture = {
  token: location.hostname + '-' + Date.now() + '-' + Math.random(),
  documentRoot: document.documentElement,
  ticks: 0,
  messages: []
};
setInterval(() => { window.__panelFocusFixture.ticks += 1; }, 20);
window.addEventListener('message', event => {
  if (event.source === window.parent && event.data?.context === 'multi-panel') {
    window.__panelFocusFixture.messages.push({ type: event.data.type, text: event.data.text });
  }
});
</script></body></html>`;

async function routeProviderFixtures(extension, providers) {
  const hosts = [...new Set(providers.map(provider => PROVIDER_HOSTS[provider]))];
  await Promise.all(hosts.map(host => extension.context.route(`https://${host}/**`, route => route.fulfill({
    contentType: 'text/html',
    body: FOCUS_FIXTURE,
  }))));
}

function providerFrame(page, providerId) {
  const host = PROVIDER_HOSTS[providerId];
  return page.frames().find(frame => {
    try {
      return new URL(frame.url()).host === host;
    } catch {
      return false;
    }
  });
}

async function waitForProviderFixtures(page, providers) {
  await Promise.all(providers.map(providerId => expect.poll(async () => {
    const frame = providerFrame(page, providerId);
    return frame
      ? frame.evaluate(() => Boolean(window.__panelFocusFixture)).catch(() => false)
      : false;
  }, { timeout: 15_000 }).toBe(true)));
}

async function getFixtureState(page, providerId) {
  const frame = providerFrame(page, providerId);
  return frame.evaluate(() => ({
    token: window.__panelFocusFixture.token,
    ticks: window.__panelFocusFixture.ticks,
    messages: window.__panelFocusFixture.messages,
    documentRetained: window.__panelFocusFixture.documentRoot === document.documentElement,
  }));
}

async function getPanelMetrics(page) {
  return page.locator('#panel-grid .panel-item').evaluateAll(panels => panels.map(panel => {
    const rect = panel.getBoundingClientRect();
    return {
      id: panel.id,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      visibility: getComputedStyle(panel).visibility,
    };
  }));
}

async function getColumnWidths(page) {
  return page.locator('#panel-grid .panel-item').evaluateAll(panels =>
    panels.map(panel => Math.round(panel.getBoundingClientRect().width))
  );
}

async function captureIframeLoadState(page) {
  return page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll('#panel-grid iframe'));
    window.__panelFocusFrameNodes = frames.slice();
    frames.forEach(frame => {
      frame.dataset.focusTestLoads = '0';
      frame.addEventListener('load', () => {
        frame.dataset.focusTestLoads = String(Number(frame.dataset.focusTestLoads || 0) + 1);
      });
    });
    return frames.map(frame => ({ src: frame.src, loads: Number(frame.dataset.focusTestLoads) }));
  });
}

async function readIframeLoadState(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#panel-grid iframe'), (frame, index) => ({
    sameNode: frame === window.__panelFocusFrameNodes[index],
    src: frame.src,
    loads: Number(frame.dataset.focusTestLoads),
  })));
}

async function focusPanel(page, index) {
  const panel = page.locator('#panel-grid .panel-item').nth(index);
  const panelId = await panel.getAttribute('id');
  await panel.locator('.focus-panel-btn').click();
  await expect(page.locator('#main-content')).toHaveClass(/panel-focus-active/);
  await expect(page.locator(`#${panelId}`)).toHaveClass(/panel-focused/);
  await expect(page.locator(`#${panelId} .focus-panel-btn`)).toHaveAttribute('aria-pressed', 'true');
  return panelId;
}

async function dragFirstResizeHandle(page, deltaX) {
  const box = await page.locator('.panel-resize-handle').first().boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y, { steps: 4 });
  await page.mouse.up();
}

test('focus fills the panel area while hidden providers keep running, and chips switch focus', async () => {
  test.setTimeout(60_000);
  const providers = ['chatgpt', 'claude', 'gemini', 'grok'];
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await routeProviderFixtures(extension, providers);
    const page = await openMultiPanel(extension, { providers, layout: '2x2' });
    await waitForProviderFixtures(page, providers);
    await expect(page.locator('.focus-panel-btn')).toHaveCount(4);
    await page.locator('.panel-selector').nth(1).click();
    await expect(page.locator('#main-content')).not.toHaveClass(/panel-focus-active/);
    await expect(page.locator('.panel-item.panel-focused')).toHaveCount(0);

    const startingMetrics = await getPanelMetrics(page);
    const initialFrameState = await captureIframeLoadState(page);
    const initialFixtureState = await Promise.all(providers.map(provider => getFixtureState(page, provider)));
    const firstFocusedId = await focusPanel(page, 1);

    const geometry = await page.evaluate(panelId => {
      const main = document.getElementById('main-content').getBoundingClientRect();
      const panel = document.getElementById(panelId).getBoundingClientRect();
      return {
        leftInset: panel.left - main.left,
        topInset: panel.top - main.top,
        rightInset: main.right - panel.right,
        bottomInset: main.bottom - panel.bottom,
      };
    }, firstFocusedId);
    for (const inset of Object.values(geometry)) {
      expect(Math.abs(inset - 4)).toBeLessThanOrEqual(1);
    }

    let focusedMetrics = await getPanelMetrics(page);
    for (let index = 0; index < focusedMetrics.length; index += 1) {
      const current = focusedMetrics[index];
      const before = startingMetrics[index];
      if (current.id === firstFocusedId) {
        expect(current.visibility).toBe('visible');
        continue;
      }
      expect(current.visibility).toBe('hidden');
      expect(Math.abs(current.width - before.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(current.height - before.height)).toBeLessThanOrEqual(1);
    }
    await expect(page.locator(`#${firstFocusedId} .focus-panel-btn .material-symbols-outlined`))
      .toHaveText('close_fullscreen');

    const secondFocusedId = await page.locator('.panel-selector').nth(2).getAttribute('data-panel-id');
    await page.locator(`.panel-selector[data-panel-id="${secondFocusedId}"]`).click();
    await expect(page.locator(`#${secondFocusedId}`)).toHaveClass(/panel-focused/);
    await expect(page.locator(`#${firstFocusedId}`)).not.toHaveClass(/panel-focused/);
    await expect(page.locator(`.panel-selector[data-panel-id="${secondFocusedId}"]`)).toHaveClass(/panel-focused/);
    await expect(page.locator(`.panel-selector[data-panel-id="${firstFocusedId}"]`)).not.toHaveClass(/panel-focused/);

    const broadcastText = 'Hidden panels receive this prompt';
    await page.locator('#unified-input').fill(broadcastText);
    await page.locator('#send-all-btn').click();
    await expect.poll(async () => Promise.all(providers.map(async provider => {
      const state = await getFixtureState(page, provider);
      return state.messages.at(-1)?.text;
    }))).toEqual(providers.map(() => broadcastText));

    await page.waitForTimeout(250);
    const finalFrameState = await readIframeLoadState(page);
    expect(finalFrameState.map(({ sameNode, src, loads }) => ({ sameNode, src, loads }))).toEqual(
      initialFrameState.map(({ src, loads }) => ({ sameNode: true, src, loads }))
    );
    const finalFixtureState = await Promise.all(providers.map(provider => getFixtureState(page, provider)));
    finalFixtureState.forEach((state, index) => {
      expect(state.token).toBe(initialFixtureState[index].token);
      expect(state.documentRetained).toBe(true);
      expect(state.ticks).toBeGreaterThan(initialFixtureState[index].ticks);
    });

    await page.locator(`#${secondFocusedId} .focus-panel-btn`).click();
    await expect(page.locator('#main-content')).not.toHaveClass(/panel-focus-active/);
    await expect(page.locator('.panel-item.panel-focused')).toHaveCount(0);
    await focusPanel(page, 3);

    await page.reload();
    await expect(page.locator('#panel-grid iframe')).toHaveCount(4);
    await expect(page.locator('#main-content')).not.toHaveClass(/panel-focus-active/);
    await expect(page.locator('.focus-panel-btn[aria-pressed="true"]')).toHaveCount(0);
  } finally {
    await extension.close();
  }
});

test('Escape restores custom 1x3 widths and does not exit through an open modal', async () => {
  test.setTimeout(60_000);
  const providers = ['chatgpt', 'claude', 'gemini'];
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await routeProviderFixtures(extension, providers);
    const page = await openMultiPanel(extension, { providers, layout: '1x3' });
    await waitForProviderFixtures(page, providers);

    const equalWidths = await getColumnWidths(page);
    await dragFirstResizeHandle(page, -60);
    await expect.poll(() => getColumnWidths(page)).not.toEqual(equalWidths);
    const customWidths = await getColumnWidths(page);
    expect(Math.abs(customWidths[0] - equalWidths[0])).toBeGreaterThan(20);
    const customGridTemplate = await page.locator('#panel-grid').evaluate(grid => grid.style.gridTemplateColumns);
    const originalMetrics = await getPanelMetrics(page);
    const focusedId = await focusPanel(page, 1);

    const hiddenMetrics = await getPanelMetrics(page);
    hiddenMetrics.forEach((current, index) => {
      if (current.id === focusedId) {
        expect(current.visibility).toBe('visible');
        expect(current.width).toBeGreaterThan(originalMetrics[index].width);
      } else {
        expect(current.visibility).toBe('hidden');
        expect(Math.abs(current.width - originalMetrics[index].width)).toBeLessThanOrEqual(1);
      }
    });
    await expect(page.locator('.panel-selector.panel-focused')).toHaveCount(1);

    await page.locator('#unified-input').fill('Still usable while focused');
    await expect(page.locator('#unified-input')).toHaveValue('Still usable while focused');

    await page.click('#layout-btn');
    await expect(page.locator('#layout-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#layout-modal')).toBeVisible();
    await expect(page.locator('#main-content')).toHaveClass(/panel-focus-active/);

    await page.click('#close-layout-modal');
    await page.keyboard.press('Escape');
    await expect(page.locator('#main-content')).not.toHaveClass(/panel-focus-active/);
    await expect(page.locator('.panel-item.panel-focused')).toHaveCount(0);
    expect(await page.locator('#panel-grid').evaluate(grid => grid.style.gridTemplateColumns)).toBe(customGridTemplate);
    const restoredWidths = await getColumnWidths(page);
    restoredWidths.forEach((width, index) => expect(Math.abs(width - customWidths[index])).toBeLessThanOrEqual(1));
  } finally {
    await extension.close();
  }
});

test('adding, removing, or changing layout exits panel focus', async () => {
  test.setTimeout(60_000);
  const providers = ['chatgpt', 'claude', 'gemini'];
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await routeProviderFixtures(extension, providers);
    const page = await openMultiPanel(extension, {
      providers: providers.slice(0, 2),
      layout: '1x2',
      enabledProviders: providers,
    });
    await waitForProviderFixtures(page, providers.slice(0, 2));

    await focusPanel(page, 0);
    await page.click('#add-panel-btn');
    await page.locator('.add-panel-item[data-provider-id="gemini"]').click();
    await expect(page.locator('#panel-grid')).toHaveClass(/layout-1x3/);
    await expect(page.locator('#panel-grid iframe')).toHaveCount(3);
    await expect(page.locator('#main-content')).not.toHaveClass(/panel-focus-active/);
    await waitForProviderFixtures(page, ['gemini']);

    const focusedId = await focusPanel(page, 1);
    await page.locator(`.panel-selector[data-panel-id="${focusedId}"] .remove-panel`).click();
    await expect(page.locator('#panel-grid iframe')).toHaveCount(2);
    await expect(page.locator('#panel-grid')).toHaveClass(/layout-1x2/);
    await expect(page.locator('#main-content')).not.toHaveClass(/panel-focus-active/);

    await focusPanel(page, 0);
    await page.click('#layout-btn');
    await page.locator('[data-layout="1x1"]').click();
    await expect(page.locator('#panel-grid')).toHaveClass(/layout-1x1/);
    await expect(page.locator('#panel-grid iframe')).toHaveCount(1);
    await expect(page.locator('#main-content')).not.toHaveClass(/panel-focus-active/);
  } finally {
    await extension.close();
  }
});

test('the focus button stays visible in a narrow header and provider switching keeps focus', async () => {
  test.setTimeout(60_000);
  const providers = ['chatgpt', 'claude'];
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await routeProviderFixtures(extension, providers);
    const page = await openMultiPanel(extension, {
      providers: ['chatgpt'],
      layout: '1x1',
      enabledProviders: providers,
    });
    await waitForProviderFixtures(page, ['chatgpt']);
    await page.addStyleTag({ content: '#panel-grid.layout-1x1 { grid-template-columns: 160px !important; }' });
    await expect.poll(() => page.locator('#panel-grid .panel-item').evaluate(panel => panel.getBoundingClientRect().width))
      .toBe(160);
    await expect(page.locator('.focus-panel-btn')).toBeVisible();

    const panelId = await focusPanel(page, 0);
    await page.locator(`#${panelId} .switch-provider-btn`).click();
    await page.locator('.provider-switcher-item[data-provider-id="claude"]').click();
    await waitForProviderFixtures(page, ['claude']);
    await expect(page.locator(`#${panelId}`)).toHaveClass(/panel-focused/);
    await expect(page.locator('#main-content')).toHaveClass(/panel-focus-active/);
    await expect(page.locator(`#${panelId} .focus-panel-btn`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`#${panelId} .focus-panel-btn .material-symbols-outlined`))
      .toHaveText('close_fullscreen');
  } finally {
    await extension.close();
  }
});

test('toolbar sharing and a share snapshot request exit panel focus', async () => {
  test.setTimeout(60_000);
  const providers = ['chatgpt'];
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await routeProviderFixtures(extension, providers);
    const page = await openMultiPanel(extension, { providers, layout: '1x1' });
    await waitForProviderFixtures(page, providers);
    const captureStubInstalled = await page.evaluate(() => {
      try {
        window.__panelFocusCaptureAttempts = 0;
        Object.defineProperty(chrome.tabs, 'captureVisibleTab', {
          configurable: true,
          value: async () => {
            window.__panelFocusCaptureAttempts += 1;
            throw new Error('E2E snapshot capture stub');
          },
        });
        return true;
      } catch {
        return false;
      }
    });
    expect(captureStubInstalled).toBe(true);

    await focusPanel(page, 0);
    await page.click('#share-snapshot-btn');
    await expect(page.locator('#main-content')).not.toHaveClass(/panel-focus-active/);
    await expect.poll(() => page.evaluate(() => window.__panelFocusCaptureAttempts)).toBe(1);
    await expect(page.locator('#share-snapshot-btn')).toBeEnabled();

    await focusPanel(page, 0);
    const tabId = await page.evaluate(async () => (await chrome.tabs.getCurrent())?.id ?? null);
    await extension.serviceWorker.evaluate(async ({ action, tabId: targetTabId }) => {
      await chrome.runtime.sendMessage({ action, payload: { tabId: targetTabId } });
    }, { action: SHARE_SNAPSHOT_ACTION, tabId });
    await expect(page.locator('#main-content')).not.toHaveClass(/panel-focus-active/);
    await expect.poll(() => page.evaluate(() => window.__panelFocusCaptureAttempts)).toBe(2);
  } finally {
    await extension.close();
  }
});

test('removing another panel keeps hidden cells, and Escape waits for IME and open menus', async () => {
  test.setTimeout(60_000);
  const providers = ['chatgpt', 'claude', 'gemini', 'grok'];
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    await routeProviderFixtures(extension, providers);
    const page = await openMultiPanel(extension, { providers, layout: '2x2' });
    await waitForProviderFixtures(page, providers);

    const equalWidths = await getColumnWidths(page);
    await dragFirstResizeHandle(page, -80);
    await expect.poll(() => getColumnWidths(page)).not.toEqual(equalWidths);

    const focusedId = await focusPanel(page, 0);
    const removedId = await page.locator('#panel-grid .panel-item').nth(1).getAttribute('id');
    const hiddenBefore = (await getPanelMetrics(page)).filter(panel => ![focusedId, removedId].includes(panel.id));
    await page.locator(`.panel-selector[data-panel-id="${removedId}"] .remove-panel`).click();
    await expect(page.locator('#panel-grid iframe')).toHaveCount(3);
    await expect(page.locator('#panel-grid')).toHaveClass(/layout-2x2/);
    await expect(page.locator(`#${focusedId}`)).toHaveClass(/panel-focused/);

    const hiddenAfter = await getPanelMetrics(page);
    hiddenBefore.forEach(before => {
      const after = hiddenAfter.find(panel => panel.id === before.id);
      expect(after.visibility).toBe('hidden');
      for (const key of ['x', 'y', 'width', 'height']) {
        expect(Math.abs(after[key] - before[key])).toBeLessThanOrEqual(1);
      }
    });

    await page.locator('#unified-input').focus();
    await page.evaluate(() => {
      document.getElementById('unified-input').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', isComposing: true, bubbles: true, cancelable: true,
      }));
    });
    await expect(page.locator('#main-content')).toHaveClass(/panel-focus-active/);

    await page.locator(`#${focusedId} .switch-provider-btn`).click();
    await expect(page.locator('.provider-switcher-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#main-content')).toHaveClass(/panel-focus-active/);
    await page.locator('#unified-input').click();
    await expect(page.locator('.provider-switcher-menu')).toHaveCount(0);

    await page.click('#add-panel-btn');
    await expect(page.locator('.add-panel-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#main-content')).toHaveClass(/panel-focus-active/);
    await page.locator('#unified-input').click();
    await expect(page.locator('.add-panel-menu')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.locator('#main-content')).not.toHaveClass(/panel-focus-active/);
    expect(await page.locator('#panel-grid .panel-item').evaluateAll(panels =>
      panels.map(panel => panel.style.gridColumnStart + panel.style.gridRowStart)
    )).toEqual(['', '', '']);
  } finally {
    await extension.close();
  }
});
