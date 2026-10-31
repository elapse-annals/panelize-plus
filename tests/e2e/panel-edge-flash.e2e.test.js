import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './extension-harness.js';
import { renderProviderTierFixture } from './fixtures/provider-tier-fixture.js';

test('swiping past the first or last panel flashes that edge once per push', async () => {
  test.setTimeout(120000);
  const extension = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    for (const [host, provider] of [['chatgpt.com', 'chatgpt'], ['chat.deepseek.com', 'deepseek']]) {
      await extension.context.route(`https://${host}/**`, route => route.fulfill({
        status: 200, contentType: 'text/html', body: renderProviderTierFixture(provider)
      }));
    }
    const page = await openMultiPanel(extension, { providers: ['chatgpt', 'deepseek'], layout: '1x2' });
    await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
    await page.locator('#wide-content-btn').click();
    await expect.poll(() => page.locator('#panel-grid').evaluate(grid => grid.scrollWidth - grid.clientWidth))
      .toBeGreaterThan(100);
    await page.evaluate(() => {
      window.__edgeFlashes = [];
      document.querySelectorAll('.panel-edge-flash').forEach(flash => flash.addEventListener('animationstart', () =>
        window.__edgeFlashes.push(flash.id)));
    });
    const header = page.locator('#panel-grid .panel-item').first().locator('.panel-header');
    const box = await header.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // A continuous push at the start edge flashes once.
    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(-40, 0);
    await expect.poll(() => page.evaluate(() => window.__edgeFlashes)).toEqual(['panel-edge-flash-start']);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__edgeFlashes)).toEqual(['panel-edge-flash-start']);

    // Scrolling away from an edge does not flash; pushing past the end does.
    await page.locator('#panel-grid').evaluate(grid => { grid.scrollLeft = grid.scrollWidth; });
    await page.mouse.wheel(40, 0);
    await expect.poll(() => page.evaluate(() => window.__edgeFlashes))
      .toEqual(['panel-edge-flash-start', 'panel-edge-flash-end']);
  } finally {
    await extension.close();
  }
});
