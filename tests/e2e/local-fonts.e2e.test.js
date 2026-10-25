import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { launchExtension } from './extension-harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ICONS = JSON.parse(await readFile(path.join(ROOT, 'fonts/material-symbols-outlined-icons.json'), 'utf8')).icons;
const GOOGLE_FONT_HOST = /fonts\.(?:googleapis|gstatic)\.com/i;

test.describe('local Material Symbols font', () => {
  test.setTimeout(60_000);

  let extension;

  test.beforeAll(async () => {
    extension = await launchExtension();
  });

  test.afterAll(async () => {
    await extension?.close();
  });

  test('renders every subset icon offline in both themes and on the options page', async ({}, testInfo) => {
    const fontRequests = [];
    const page = await extension.context.newPage();
    page.on('request', request => {
      if (GOOGLE_FONT_HOST.test(request.url())) fontRequests.push(request.url());
    });
    await page.route(/^https?:\/\//, route => route.abort());
    await extension.serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        theme: 'light',
        enabledProviders: ['chatgpt'],
        providerOrder: ['chatgpt'],
        startupProviders: ['chatgpt'],
        multiPanelLayout: '1x1'
      });
    });
    await page.goto(extension.extensionUrl('multi-panel/multi-panel.html'));
    await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');

    const inspectIcons = async (theme, screenshotName) => {
      await page.evaluate(async ({ icons, theme }) => {
        document.documentElement.setAttribute('data-theme', theme);
        await document.fonts.load('24px "Material Symbols Outlined"');
        await document.fonts.ready;
        let grid = document.getElementById('font-offline-test-grid');
        if (!grid) {
          grid = document.createElement('div');
          grid.id = 'font-offline-test-grid';
          Object.assign(grid.style, {
            position: 'fixed', inset: '8px', zIndex: '99999',
            display: 'grid', gridTemplateColumns: 'repeat(6, 72px)',
            gap: '6px', padding: '10px', overflow: 'auto',
            background: theme === 'dark' ? '#1f1f1f' : '#fff',
            border: '1px solid #888'
          });
          for (const icon of icons) {
            const cell = document.createElement('div');
            Object.assign(cell.style, {
              display: 'grid', justifyItems: 'center', alignContent: 'center',
              font: '10px sans-serif', color: theme === 'dark' ? '#eee' : '#222'
            });
            const glyph = document.createElement('span');
            glyph.className = 'material-symbols-outlined';
            glyph.textContent = icon;
            glyph.style.fontSize = '24px';
            cell.append(glyph, document.createTextNode(icon));
            grid.append(cell);
          }
          document.body.append(grid);
        } else {
          grid.style.background = theme === 'dark' ? '#1f1f1f' : '#fff';
        }

      }, { icons: ICONS, theme });

      const measurements = await page.evaluate(() => ({
        loaded: document.fonts.check('24px "Material Symbols Outlined"'),
        glyphs: [...document.querySelectorAll('#font-offline-test-grid .material-symbols-outlined')].map(glyph => {
          const style = getComputedStyle(glyph);
          return {
            name: glyph.textContent,
            fontFamily: style.fontFamily,
            fontFeatureSettings: style.fontFeatureSettings,
            width: glyph.getBoundingClientRect().width
          };
        })
      }));
      expect(measurements.loaded).toBe(true);
      expect(measurements.glyphs).toHaveLength(ICONS.length);
      for (const glyph of measurements.glyphs) {
        expect(glyph.fontFamily, `${theme} ${glyph.name} font`).toContain('Material Symbols Outlined');
        expect(glyph.fontFeatureSettings, `${theme} ${glyph.name} ligature`).toContain('liga');
        expect(glyph.width, `${theme} ${glyph.name} icon`).toBeGreaterThan(0);
      }
      await page.screenshot({ path: testInfo.outputPath(screenshotName) });
    };

    await inspectIcons('light', 'material-symbols-light.png');
    await inspectIcons('dark', 'material-symbols-dark.png');

    const optionsPage = await extension.context.newPage();
    optionsPage.on('request', request => {
      if (GOOGLE_FONT_HOST.test(request.url())) fontRequests.push(request.url());
    });
    await optionsPage.route(/^https?:\/\//, route => route.abort());
    await optionsPage.goto(extension.extensionUrl('options/options.html'));
    await optionsPage.evaluate(() => document.fonts.load('24px "Material Symbols Outlined"'));
    await expect.poll(() => optionsPage.locator('.material-symbols-outlined').count()).toBeGreaterThan(0);
    const optionsFontLoaded = await optionsPage.evaluate(() =>
      document.fonts.check('24px "Material Symbols Outlined"')
    );
    expect(optionsFontLoaded).toBe(true);
    expect(fontRequests).toEqual([]);
    await optionsPage.close();
    await page.close();
  });
});
