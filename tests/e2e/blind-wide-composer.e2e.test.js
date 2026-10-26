import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './extension-harness.js';
import { renderProviderTierFixture } from './fixtures/provider-tier-fixture.js';
import { PANEL_COLUMN_WEIGHTS_KEY } from '../../modules/panel-resize.js';
import { getProviderById } from '../../modules/providers.js';

function renderBlindFixture(provider) {
  return renderProviderTierFixture(provider)
    .replace('</head>', `<style>
      html, body { height: 100%; margin: 0; }
      .fixture-conversation { height: 100vh; overflow-y: auto; box-sizing: border-box; }
      .markdown p { margin: ${provider === 'chatgpt' ? '32px' : '4px'} 0; }
      .markdown h1 { font-size: 38px; margin: 40px 0; }
      [data-type="unified-composer"], textarea {
        position: absolute; top: ${provider === 'chatgpt' ? '40%' : '20%'};
        left: 20%; width: 60%; transform: translateY(-50%); background: white;
      }
      [data-testid="reasoning-effort"], #deep-think { position: fixed; top: 0; right: 0; z-index: 30; }
      #model-menu { position: fixed; bottom: 50px; z-index: 100; background: white; }
    </style></head>`)
    .replace('<body>', `<body>
      <header class="fixture-identity"><svg aria-label="provider logo" width="24" height="24"></svg>${provider}</header>
      <aside class="fixture-identity">Sidebar and conversation history</aside>
      <h1 class="fixture-identity">Welcome to ${provider}</h1>
      <section class="fixture-identity">Promotional cards</section>
      <section class="fixture-conversation"><div class="markdown">
        <h1>A neutral answer from ${provider === 'chatgpt' ? 'ChatGPT' : 'DeepSeek'}.</h1>
        ${Array.from({ length: 25 }, (_, index) => `<p>Answer paragraph ${index + 1}. Detailed explanation to compare across panels.</p>`).join('')}
        <ul><li>First point</li><li>Second point</li></ul>
        <p id="last-answer">The final answer paragraph must remain readable.</p>
      </div></section>
      <footer class="fixture-identity">Provider footer</footer>`)
    .replace('id="deep-think"', 'id="deep-think" class="think-mode-trigger"');
}

function routeProviderFixtures(extension, providers = ['chatgpt', 'deepseek']) {
  return Promise.all(providers.map(provider => extension.context.route(
    `${new URL(getProviderById(provider).url).origin}/**`,
    route => route.fulfill({ status: 200, contentType: 'text/html', body: renderBlindFixture(provider) })
  )));
}

async function openPanels(extension) {
  const page = await openMultiPanel(extension, { providers: ['chatgpt', 'deepseek'], layout: '1x2' });
  await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
  return page;
}

function pageStyleIn(page, host) {
  const frame = page.frames().find(candidate => candidate.url().includes(host));
  return frame?.evaluate(() => document.getElementById('panelize-page-style')?.textContent || '') ?? '';
}

function columnWidths(page) {
  return page.locator('#panel-grid .panel-item').evaluateAll(panels =>
    panels.map(panel => panel.getBoundingClientRect().width));
}

test.describe('Blind mode, wide content and composer overhang', () => {
  test.setTimeout(90000);

  test('blind mode hides provider identity in the host and styles the provider pages', async ({}, testInfo) => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      await routeProviderFixtures(extension);
      const page = await openPanels(extension);
      await expect.poll(() => page.frames().filter(frame => /chatgpt|deepseek/.test(frame.url())).length).toBe(2);

      const frameUrls = page.frames().map(frame => frame.url()).sort();
      await page.locator('#blind-mode-btn').click();
      await expect(page.locator('#blind-mode-btn')).toHaveAttribute('aria-pressed', 'true');
      const labels = page.locator('#panel-grid .panel-header .blind-label');
      await expect(labels).toHaveText([/匿名模型|Anonymous model/, /匿名模型|Anonymous model/]);
      // Two panels always swap places, through CSS order only, so no frame reloads.
      await expect.poll(() => page.locator('#panel-grid > .panel-item').evaluateAll(items =>
        items.map(item => item.style.order))).toEqual(['1', '0']);
      await expect(page.locator('.panel-selector')).toHaveCount(2);
      expect(await page.locator('.panel-selector').evaluateAll(chips => chips.map(chip => chip.style.order))).toEqual(['1', '0']);
      expect(page.frames().map(frame => frame.url()).sort()).toEqual(frameUrls);
      // Panels take clicks again once they have been dealt out.
      await expect(page.locator('body')).not.toHaveClass(/panel-shuffling/);
      await expect(page.locator('#panel-grid .panel-header .provider-icon').first()).toBeHidden();
      await expect(page.locator('#panel-grid .panel-header .provider-name').first()).toBeHidden();
      await expect(page.locator('.open-provider-top-level-btn').first()).toBeHidden();
      await expect(page.locator('.switch-provider-btn').first()).toBeHidden();
      await expect(page.locator('#answer-stats-btn')).toBeHidden();
      await expect(page.locator('#answer-log-btn')).toBeHidden();
      await expect(page.locator('.panel-selector .blind-label')).toHaveText([/匿名模型|Anonymous model/, /匿名模型|Anonymous model/]);
      await expect.poll(() => pageStyleIn(page, 'chatgpt.com')).toContain('font-family');
      for (const host of ['chatgpt.com', 'chat.deepseek.com']) {
        const frame = page.frames().find(candidate => candidate.url().includes(host));
        await expect(frame.locator('.fixture-identity').first()).toHaveCSS('display', 'none');
        for (const identity of await frame.locator('.fixture-identity').all()) await expect(identity).toBeHidden();
        await expect(frame.locator('textarea, [contenteditable="true"]')).toBeVisible();
        await expect(frame.locator('.markdown')).toBeVisible();
        await expect(frame.locator('.markdown')).toHaveCSS('font-size', '15px');
        await expect(frame.locator('.markdown')).not.toContainText(/ChatGPT|DeepSeek/);
        const composer = frame.locator('[data-panelize-composer]');
        await expect(composer).toHaveCSS('position', 'fixed');
        // Every provider shows the same empty box; its own controls are invisible.
        expect(await composer.evaluate(element => {
          const isField = element.matches('textarea, input');
          const box = getComputedStyle(element, isField ? null : '::after');
          const height = isField ? `${element.getBoundingClientRect().height}px` : box.height;
          const hidden = [...element.children].every(child => getComputedStyle(child).opacity === '0');
          return [height, box.borderRadius, box.backgroundColor, getComputedStyle(element).color, hidden];
        })).toEqual(['56px', '20px', 'rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)', true]);
        await expect.poll(() => composer.evaluate(element =>
          Math.abs(element.getBoundingClientRect().bottom - (window.innerHeight - 12))
        )).toBeLessThanOrEqual(1);
        await expect(frame.locator('.markdown h1')).toHaveCSS('font-size', '22.5px');
        await expect(frame.locator('.markdown h1')).toHaveCSS('margin-top', '0px');
        await expect(frame.locator('.markdown p').first()).toHaveCSS('margin-bottom', '11.25px');
        await expect.poll(() => frame.evaluate(() => {
          const composer = document.querySelector('[data-panelize-composer]');
          const scroller = document.querySelector('[data-panelize-scroller]');
          return Math.abs(parseFloat(getComputedStyle(scroller).paddingBottom) - (composer.getBoundingClientRect().height + 24));
        })).toBeLessThanOrEqual(1);
        await frame.locator('.fixture-conversation').evaluate(element => { element.scrollTop = element.scrollHeight; });
        expect(await frame.evaluate(() => document.getElementById('last-answer').getBoundingClientRect().bottom <=
          document.querySelector('[data-panelize-composer]').getBoundingClientRect().top)).toBe(true);
      }
      const chatgpt = page.frames().find(frame => frame.url().includes('chatgpt.com'));
      await chatgpt.evaluate(() => {
        window.__fixture.isolationRefreshed = false;
        const observer = new MutationObserver(() => {
          window.__fixture.isolationRefreshed = true;
          observer.disconnect();
        });
        observer.observe(document.querySelector('.markdown'), { attributes: true, attributeFilter: ['data-panelize-keep'] });
      });
      await chatgpt.locator('[data-testid="reasoning-effort"]').click();
      await expect(chatgpt.locator('#model-menu')).toBeVisible();
      await chatgpt.locator('[data-tier-option="balanced"]').click();
      await expect.poll(() => chatgpt.evaluate(() => window.__fixture.isolationRefreshed)).toBe(true);
      // Model controls keep their dimensions and portal menus remain usable.
      await page.locator('.tier-option[data-tier="deep"]').click();
      await expect.poll(() => page.frames().find(frame => frame.url().includes('chatgpt.com'))
        .evaluate(() => window.__fixture.model)).toBe('High');
      await expect.poll(() => page.frames().find(frame => frame.url().includes('chat.deepseek.com'))
        .evaluate(() => document.getElementById('deep-think').getAttribute('aria-pressed'))).toBe('true');
      await expect.poll(() => extension.serviceWorker.evaluate(async () =>
        (await chrome.storage.sync.get('blindModeEnabled')).blindModeEnabled
      )).toBe(true);

      await page.locator('#tier-details-btn').click();
      await expect(page.locator('#tier-details-body')).not.toContainText(/ChatGPT|DeepSeek/);
      await expect(page.locator('#tier-details-body tr').first()).toContainText(/匿名模型|Anonymous model/);
      await page.screenshot({ path: testInfo.outputPath('blind-mode.png') });
      await page.locator('#close-tier-details').click();
      for (const host of ['chatgpt.com', 'chat.deepseek.com']) {
        const frame = page.frames().find(candidate => candidate.url().includes(host));
        expect(await frame.evaluate(() => document.getElementById('last-answer').getBoundingClientRect().bottom <=
          document.querySelector('[data-panelize-composer]').getBoundingClientRect().top)).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath('blind-layout.png') });

      // A new conversation has no message root, so reserve space on the document.
      for (const host of ['chatgpt.com', 'chat.deepseek.com']) {
        const frame = page.frames().find(candidate => candidate.url().includes(host));
        await frame.evaluate(() => document.querySelectorAll('.fixture-conversation, [data-message-author-role]').forEach(element => element.remove()));
        await expect.poll(() => frame.evaluate(() => document.scrollingElement.hasAttribute('data-panelize-scroller'))).toBe(true);
        await expect(frame.locator('[data-panelize-composer]')).toHaveCSS('bottom', '12px');
      }

      await page.locator('#blind-mode-btn').click();
      await expect(page.locator('#panel-grid .panel-header .provider-name').first()).toBeVisible();
      await expect(labels.first()).toBeHidden();
      await expect.poll(() => pageStyleIn(page, 'chatgpt.com')).toBe('');
      for (const host of ['chatgpt.com', 'chat.deepseek.com']) {
        const frame = page.frames().find(candidate => candidate.url().includes(host));
        await expect(frame.locator('.fixture-identity').first()).toBeVisible();
        await expect(frame.locator('[data-panelize-hide], [data-panelize-keep], [data-panelize-composer], [data-panelize-scroller]')).toHaveCount(0);
        expect(await frame.evaluate(() => document.documentElement.style.getPropertyValue('--panelize-composer-space'))).toBe('');
        await expect(frame.locator('form, textarea').first()).toHaveCSS('position', 'absolute');
      }
    } finally {
      await extension.close();
    }
  });

  test('a horizontal swipe over a panel scrolls the panel row without navigating the panel', async () => {
    const extension = await launchExtension({ viewport: { width: 700, height: 700 } });
    try {
      await routeProviderFixtures(extension);
      const page = await openPanels(extension);
      await expect.poll(() => page.frames().filter(frame => /chatgpt|deepseek/.test(frame.url())).length).toBe(2);
      const grid = page.locator('#panel-grid');
      await expect.poll(() => grid.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
      const frameUrls = page.frames().map(frame => frame.url()).sort();
      const box = await grid.boundingBox();
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point)).toBe('IFRAME');
      await page.mouse.move(point.x, point.y);
      await page.mouse.wheel(120, 0);
      await expect.poll(() => grid.evaluate(element => element.scrollLeft)).toBeGreaterThan(60);
      await page.mouse.wheel(-400, 0);
      await expect.poll(() => grid.evaluate(element => element.scrollLeft)).toBe(0);
      expect(page.frames().map(frame => frame.url()).sort()).toEqual(frameUrls);
    } finally {
      await extension.close();
    }
  });

  test('wide content widens actual columns, resizes with the viewport, survives reload and toggles back', async ({}, testInfo) => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      await routeProviderFixtures(extension);
      const page = await openPanels(extension);
      const normal = await columnWidths(page);
      await page.locator('#wide-content-btn').click();
      await expect(page.locator('#wide-content-btn')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('body')).toHaveClass(/wide-content/);
      const frames = page.locator('#panel-grid iframe');
      await expect(frames).toHaveCount(2);
      await expect.poll(() => columnWidths(page)).toEqual(normal.map(width => Math.round(width * 1.5)));
      const grid = page.locator('#panel-grid');
      await expect.poll(() => grid.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
      await expect(grid).toHaveCSS('scroll-snap-type', 'none');
      await expect(grid).toHaveCSS('scroll-behavior', 'auto');
      const gridBox = await grid.boundingBox();
      await page.mouse.move(gridBox.x + 2, gridBox.y + gridBox.height / 2);
      await page.mouse.wheel(240, 0);
      await expect.poll(() => grid.evaluate(element => element.scrollLeft)).toBeGreaterThan(80);
      const partialScroll = await grid.evaluate(element => element.scrollLeft);
      expect(partialScroll).toBeLessThan(600);
      expect(await grid.locator('.panel-item').first().evaluate(element => element.getBoundingClientRect().left))
        .toBeLessThan(0);
      for (const frame of await frames.all()) {
        await expect(frame).not.toHaveClass(/panel-fitted/);
        expect(await frame.evaluate(element => element.offsetWidth)).toBe(await frame.evaluate(element => element.parentElement.clientWidth));
      }
      await expect.poll(() => pageStyleIn(page, 'chatgpt.com')).toBe('');
      await page.screenshot({ path: testInfo.outputPath('wide-panels.png') });

      await page.setViewportSize({ width: 1600, height: 800 });
      await expect.poll(() => columnWidths(page)).toEqual([1191, 1191]);
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect.poll(() => columnWidths(page)).toEqual(normal.map(width => Math.round(width * 1.5)));

      const reopened = await openPanels(extension);
      await expect(reopened.locator('#wide-content-btn')).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => columnWidths(reopened)).toEqual(normal.map(width => Math.round(width * 1.5)));
      await expect(reopened.locator('#panel-grid iframe').first()).not.toHaveClass(/panel-fitted/);

      await reopened.locator('#wide-content-btn').click();
      await expect(reopened.locator('body')).not.toHaveClass(/wide-content/);
      await expect.poll(() => columnWidths(reopened)).toEqual(normal);
      await expect(reopened.locator('#panel-grid iframe').first()).not.toHaveClass(/panel-fitted/);
    } finally {
      await extension.close();
    }
  });

  test('eight wide panels match the reference ChatGPT width and preserve resized columns', async ({}, testInfo) => {
    const extension = await launchExtension({ viewport: { width: 1438, height: 900 } });
    try {
      const providers = ['chatgpt', 'gemini', 'grok', 'deepseek', 'kimi', 'claude', 'google', 'doubao'];
      await routeProviderFixtures(extension, providers);
      const page = await openMultiPanel(extension, { providers, layout: '1x8' });
      const normal = Array(8).fill(320);
      const wide = Array(8).fill(672);
      await expect.poll(() => columnWidths(page)).toEqual(normal);
      await page.locator('#wide-content-btn').click();
      await expect.poll(() => columnWidths(page)).toEqual(wide);
      await page.screenshot({ path: testInfo.outputPath('reference-wide-panels.png') });

      await page.setViewportSize({ width: 1000, height: 900 });
      await expect.poll(() => columnWidths(page)).toEqual(wide);
      const handle = page.locator('.panel-resize-handle').first();
      await handle.focus();
      await handle.press('ArrowRight');
      const dragged = [688, ...wide.slice(1)];
      await expect.poll(() => columnWidths(page)).toEqual(dragged);
      const stored = await extension.serviceWorker.evaluate(async key =>
        (await chrome.storage.local.get(key))[key]['1x8'], PANEL_COLUMN_WEIGHTS_KEY);
      expect(stored[0]).toBeCloseTo(688 / 672, 3);
      expect(stored.slice(1)).toEqual(Array(7).fill(1));

      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
      await expect.poll(() => columnWidths(page)).toEqual(dragged);
      await page.locator('#wide-content-btn').click();
      await expect.poll(() => columnWidths(page).then(widths => widths.slice(1))).toEqual(normal.slice(1));
      expect((await columnWidths(page))[0]).toBeLessThan(330);
      await page.locator('#wide-content-btn').click();
      await expect.poll(() => columnWidths(page)).toEqual(dragged);
      await page.locator('.panel-resize-handle').first().dblclick();
      await expect.poll(() => columnWidths(page)).toEqual(wide);
    } finally {
      await extension.close();
    }
  });

  test('edge buttons and Option+Arrow jump to the first and last panel', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      await routeProviderFixtures(extension);
      const page = await openPanels(extension);
      const grid = page.locator('#panel-grid');
      const start = page.locator('#panel-edge-start-btn');
      const end = page.locator('#panel-edge-end-btn');
      const wide = page.locator('#wide-content-btn');
      if (await wide.getAttribute('aria-pressed') === 'true') await wide.click();
      await expect(wide).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(() => grid.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
      await expect(start).toBeHidden();
      await expect(end).toBeHidden();

      await wide.click();
      await expect.poll(() => grid.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
      await expect(start).toBeHidden();
      await expect(end).toBeVisible();
      await expect(end).toHaveAttribute('title', /\((⌥→|Alt\+Right)\)$/);

      const atEnd = () => grid.evaluate(element => element.scrollLeft >= element.scrollWidth - element.clientWidth - 1);
      await end.click();
      await expect.poll(atEnd).toBe(true);
      await expect(end).toBeHidden();
      await expect(start).toBeVisible();
      await start.click();
      await expect.poll(() => grid.evaluate(element => element.scrollLeft)).toBe(0);

      await page.locator('#toolbar').click({ position: { x: 4, y: 4 } });
      await page.keyboard.press('Alt+ArrowRight');
      await expect.poll(atEnd).toBe(true);
      await page.keyboard.press('Alt+ArrowLeft');
      await expect.poll(() => grid.evaluate(element => element.scrollLeft)).toBe(0);

      // An empty composer has no words to move over, so it scrolls too.
      const input = page.locator('#unified-input');
      await input.focus();
      await page.keyboard.press('Alt+ArrowRight');
      await expect.poll(atEnd).toBe(true);
      await page.keyboard.press('Alt+ArrowLeft');
      await expect.poll(() => grid.evaluate(element => element.scrollLeft)).toBe(0);

      // With text, Option+Arrow keeps moving by word.
      await input.fill('hello world');
      await page.keyboard.press('Alt+ArrowRight');
      await page.waitForTimeout(300);
      expect(await grid.evaluate(element => element.scrollLeft)).toBe(0);
    } finally {
      await extension.close();
    }
  });

  test('wide resizing stores unscaled weights and single-column layouts stay full size', async () => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      await routeProviderFixtures(extension);
      const page = await openPanels(extension);
      const normal = await columnWidths(page);
      await page.locator('#wide-content-btn').click();
      const handle = page.locator('.panel-resize-handle');
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 40);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 90, box.y + 40, { steps: 5 });
      await page.mouse.up();
      const dragged = await columnWidths(page);
      expect(Math.abs(dragged[0] - (Math.round(normal[0] * 1.5) + 90))).toBeLessThanOrEqual(1);
      expect(dragged[1]).toBe(Math.round(normal[1] * 1.5));
      const stored = await extension.serviceWorker.evaluate(async key =>
        (await chrome.storage.local.get(key))[key]['1x2'], PANEL_COLUMN_WEIGHTS_KEY);
      expect(stored[0]).toBeCloseTo(dragged[0] / (normal[0] * 1.5), 3);
      expect(stored[1]).toBeCloseTo(1, 3);
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
      await expect.poll(() => columnWidths(page)).toEqual(dragged);
      await page.locator('#wide-content-btn').click();
      const unscaled = await columnWidths(page);
      expect(unscaled[0] / unscaled[1]).toBeCloseTo(stored[0] / stored[1], 2);
      await page.locator('#wide-content-btn').click();
      await expect.poll(() => columnWidths(page)).toEqual(dragged);

      const single = await openMultiPanel(extension, { providers: ['chatgpt'], layout: '1x1' });
      await single.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
      await expect(single.locator('#wide-content-btn')).toHaveAttribute('aria-pressed', 'true');
      expect(await single.locator('#panel-grid').evaluate(grid => grid.scrollWidth)).toBe(
        await single.locator('#panel-grid').evaluate(grid => grid.clientWidth));
      await expect(single.locator('#panel-grid iframe')).not.toHaveClass(/panel-fitted/);
    } finally {
      await extension.close();
    }
  });

  test('the full-width two-line composer keeps the previous desktop bar height and fits small screens', async ({}, testInfo) => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      await routeProviderFixtures(extension);
      const page = await openPanels(extension);
      const input = page.locator('#unified-input');
      await expect(input).toHaveAttribute('rows', '2');
      const barHeight = await page.locator('#input-bar').evaluate(element => element.getBoundingClientRect().height);
      // Measured on the pre-change 1280 × 800 fixture: bar 84px, textarea 32px.
      expect(Math.abs(barHeight - 84)).toBeLessThanOrEqual(2);
      expect(await input.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(45);
      expect(await input.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(1150);
      await page.screenshot({ path: testInfo.outputPath('composer-two-lines.png') });

      for (const width of [760, 520, 390]) {
        await page.setViewportSize({ width, height: 800 });
        for (const id of ['unified-input', 'prompt-library-btn', 'image-upload-btn', 'clear-all-btn', 'fill-input-btn', 'send-all-btn']) {
          const element = page.locator(`#${id}`);
          await expect(element).toBeVisible();
          const rect = await element.boundingBox();
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.width).toBeLessThanOrEqual(width);
        }
        await page.screenshot({ path: testInfo.outputPath(`composer-${width}.png`) });
      }
    } finally {
      await extension.close();
    }
  });

  test('a multi-line draft overhangs the panels instead of shrinking them, and collapses on blur', async ({}, testInfo) => {
    const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
    try {
      await routeProviderFixtures(extension);
      const page = await openPanels(extension);
      const mainHeight = () => page.locator('#main-content').evaluate(element => element.getBoundingClientRect().height);
      const before = await mainHeight();

      const input = page.locator('#unified-input');
      await input.click();
      await input.fill(Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join('\n'));
      await expect(page.locator('#input-bar')).toHaveClass(/composer-expanded/);
      expect(await mainHeight()).toBe(before);
      const shellTop = await page.locator('#composer-shell').evaluate(element => element.getBoundingClientRect().top);
      const barTop = await page.locator('#input-bar').evaluate(element => element.getBoundingClientRect().top);
      expect(shellTop).toBeLessThan(barTop);
      await page.screenshot({ path: testInfo.outputPath('composer-overhang.png') });

      // Loading panels briefly protect the unified input from autofocus.
      // Wait for a user click to keep focus outside the composer.
      await expect.poll(async () => {
        await page.locator('#panel-grid .panel-header').first().click();
        return input.evaluate(element => new Promise(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.activeElement !== element)));
        }));
      }, { timeout: 10000 }).toBe(true);
      await expect(page.locator('#input-bar')).not.toHaveClass(/composer-expanded/);
      expect(await mainHeight()).toBe(before);
      await expect(input).toHaveValue(/line 8/);
    } finally {
      await extension.close();
    }
  });
});
