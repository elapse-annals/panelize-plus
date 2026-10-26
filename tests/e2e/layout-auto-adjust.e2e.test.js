import { test, expect } from '@playwright/test';
import { launchExtension, openMultiPanel } from './extension-harness.js';
import { MAX_PANELS } from '../../modules/layout-auto-adjust.js';
import { createPanelCapacityExtensionCopy, syntheticProviderIds } from './panel-capacity-fixture.js';

// More test-only providers than the product currently ships let the real UI
// exercise both the 30-panel ceiling and the rejected 31st panel.
const ALL_PROVIDERS = syntheticProviderIds(MAX_PANELS + 1);

/**
 * Layout auto-adjust through the real multi-panel UI. The rules themselves
 * are unit tested in tests/layout-auto-adjust.test.js; this covers wiring:
 * the add/remove controls, the grid class and the persisted layout.
 */
test.describe('Layout auto-adjust E2E', () => {
  let extensionCopy;
  let extension;
  let page;

  test.beforeAll(async () => {
    // Optional providers only appear once their host permission is granted,
    // which needs a user gesture; grant them up front in a patched copy.
    extensionCopy = await createPanelCapacityExtensionCopy({
      syntheticProviderCount: ALL_PROVIDERS.length,
      patchManifest: (manifest) => {
        manifest.host_permissions.push(...manifest.optional_host_permissions);
      },
    });
    extension = await launchExtension({
      extensionPath: extensionCopy.extensionPath,
      viewport: { width: 1920, height: 1080 },
    });
    // Provider sites are irrelevant here; serve blank pages instead of the network.
    await extension.context.route((url) => url.protocol === 'https:', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>provider</title>',
    }));
  });

  test.afterEach(async () => {
    await page?.close();
    page = null;
  });

  test.afterAll(async () => {
    await extension?.close();
    await extensionCopy?.cleanup();
  });

  // multi-panel opens min(enabled providers, layout capacity) panels.
  async function openLayout(layout, capacity) {
    page = await openMultiPanel(extension, {
      providers: ALL_PROVIDERS.slice(0, capacity),
      layout,
      enabledProviders: ALL_PROVIDERS,
    });
  }

  async function addPanel() {
    const panelCount = await page.locator('#panel-grid iframe').count();
    await page.click('#add-panel-btn');
    await page.locator('.add-panel-item').first().click();
    await expect(page.locator('#panel-grid iframe')).toHaveCount(panelCount + 1);
  }

  async function removeLastPanel() {
    const panelCount = await page.locator('#panel-grid iframe').count();
    await page.locator('.panel-selector .remove-panel').last().evaluate((button) => button.click());
    await expect(page.locator('#panel-grid iframe')).toHaveCount(panelCount - 1);
  }

  async function storedLayout() {
    return extension.serviceWorker.evaluate(async () => (
      (await chrome.storage.sync.get('multiPanelLayout')).multiPanelLayout
    ));
  }

  async function expectGridGeometry({ columns, rows }) {
    const geometry = await panelGrid().evaluate((grid) => {
      const gridRect = grid.getBoundingClientRect();
      const styles = getComputedStyle(grid);
      const panels = [...grid.querySelectorAll('.panel-item')].map((panel) => {
        const rect = panel.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height };
      });
      return {
        columns: styles.gridTemplateColumns.split(/\s+/).filter(Boolean).length,
        rows: styles.gridTemplateRows.split(/\s+/).filter(Boolean).length,
        gridTop: gridRect.top,
        gridBottom: gridRect.bottom,
        gridHeight: gridRect.height,
        panelTops: panels.map(({ top }) => Math.round(top)),
        panelBounds: panels.map(({ top, bottom, height }) => ({ top, bottom, height })),
      };
    });

    expect(geometry.columns).toBe(columns);
    expect(geometry.rows).toBe(rows);
    expect(geometry.gridHeight).toBeGreaterThan(0);
    expect(new Set(geometry.panelTops).size).toBe(rows);
    expect(geometry.panelBounds.every(({ height, top, bottom }) => (
      height > 0 && top >= geometry.gridTop && bottom <= geometry.gridBottom
    ))).toBe(true);
  }

  async function chooseLayout(layout) {
    await page.click('#layout-btn');
    const option = page.locator(`[data-layout="${layout}"]`);
    await option.scrollIntoViewIfNeeded();
    await option.click();
    await expect(panelGrid()).toHaveClass(`layout-${layout}`);
  }

  const panelGrid = () => page.locator('#panel-grid');

  test('keeps the layout while the new panel still fits', async () => {
    await openLayout('2x3', 6);
    await removeLastPanel();
    await expect(panelGrid()).toHaveClass('layout-2x3');

    await addPanel();

    await expect(panelGrid()).toHaveClass('layout-2x3');
  });

  test('expands 1xN layouts and persists the new layout', async () => {
    await openLayout('1x2', 2);

    await addPanel();

    await expect(panelGrid()).toHaveClass('layout-1x3');
    await expect.poll(storedLayout).toBe('1x3');
  });

  test('walks 1x2 through 4x2 and 1x9 up to 1x30, then stops at 30 panels', async () => {
    test.setTimeout(120000);
    await openLayout('1x2', 2);

    const expected = [
      '1x3', '1x4', '1x5', '1x6', '1x7', '4x2',
      ...Array.from({ length: MAX_PANELS - 8 }, (_, index) => `1x${index + 9}`),
    ];
    for (const layout of expected) {
      await test.step(`add a panel and expect ${layout}`, async () => {
        await addPanel();
        await expect(panelGrid()).toHaveClass(`layout-${layout}`);
      });
    }
    await expect.poll(storedLayout).toBe(`1x${MAX_PANELS}`);
    await expect(page.locator('#panel-grid iframe')).toHaveCount(MAX_PANELS);
    await expectGridGeometry({ columns: MAX_PANELS, rows: 1 });

    await chooseLayout('2x15');
    await expect(page.locator('#panel-grid iframe')).toHaveCount(MAX_PANELS);
    await expectGridGeometry({ columns: 15, rows: 2 });

    await chooseLayout(`1x${MAX_PANELS}`);
    await expectGridGeometry({ columns: MAX_PANELS, rows: 1 });
    await expect.poll(async () => page.evaluate(() => {
      const snapshot = JSON.parse(localStorage.getItem('panelize.startupSnapshot'));
      return snapshot?.startupProviderIds.length;
    })).toBe(MAX_PANELS);

    await page.click('#add-panel-btn');
    await expect(page.getByText(`Maximum number of panels reached (${MAX_PANELS})`)).toBeVisible();
    await expect(page.locator('.add-panel-item')).toHaveCount(0);
    await expect(page.locator('#panel-grid iframe')).toHaveCount(MAX_PANELS);
    await expect(panelGrid()).toHaveClass(`layout-1x${MAX_PANELS}`);

    await removeLastPanel();
    await expect(panelGrid()).toHaveClass(`layout-1x${MAX_PANELS - 1}`);
    await removeLastPanel();
    await expect(panelGrid()).toHaveClass(`layout-1x${MAX_PANELS - 2}`);
    await expect.poll(storedLayout).toBe(`1x${MAX_PANELS - 2}`);
  });

  test('does not auto-expand manually chosen grid layouts', async () => {
    await openLayout('2x2', 4);

    await addPanel();

    await expect(panelGrid()).toHaveClass('layout-2x2');
  });

  test('shrinks back when panels are removed', async () => {
    await openLayout('4x2', 8);

    await removeLastPanel();
    await expect(panelGrid()).toHaveClass('layout-1x7');

    await removeLastPanel();
    await expect(panelGrid()).toHaveClass('layout-1x6');
    await expect.poll(storedLayout).toBe('1x6');
  });
});
