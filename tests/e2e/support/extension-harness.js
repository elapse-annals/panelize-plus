import { chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBrowserLaunchOptions } from './browser-launch-options.js';
import { PACKAGE_INCLUDE_PATHS, PACKAGE_EXCLUDED_PREFIXES } from '../../../scripts/release/release-utils.js';
import { expandContentScriptFiles } from '../../../modules/providers/content-script-files.js';

export const REPO_EXTENSION_PATH = process.env.PANELIZE_E2E_EXTENSION_PATH
  ? path.resolve(process.env.PANELIZE_E2E_EXTENSION_PATH)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Copies the extension and lets the caller patch its manifest, e.g. to map
 * provider content scripts onto local http fixtures.
 * @param {(manifest: object) => void} patchManifest - Mutates the parsed manifest.
 * @param {object} [options]
 * @param {string} [options.destination] - Fixed target directory, replaced on
 *   every call. Unpacked extension ids derive from the path, so a fixed path
 *   keeps the id stable across runs. Defaults to a fresh temp directory.
 * @returns {Promise<{extensionPath: string, cleanup: () => Promise<void>}>}
 */
export async function createPatchedExtensionCopy(patchManifest, { destination } = {}) {
  let extensionPath;
  if (destination) {
    extensionPath = path.resolve(destination);
    await rm(extensionPath, { recursive: true, force: true });
  } else {
    extensionPath = await mkdtemp(path.join(os.tmpdir(), 'panelize-e2e-extension-'));
  }
  await cp(REPO_EXTENSION_PATH, extensionPath, {
    recursive: true,
    // Copy the same runtime roots as a release, leaving local worktrees and
    // browser data outside the temporary extension profile.
    filter: (source) => {
      const relativePath = path.relative(REPO_EXTENSION_PATH, source).split(path.sep).join('/');
      if (!relativePath) return true;
      return PACKAGE_INCLUDE_PATHS.includes(relativePath.split('/')[0])
        && !PACKAGE_EXCLUDED_PREFIXES.some(prefix => relativePath === prefix || relativePath.startsWith(prefix));
    },
  });

  const manifestPath = path.join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  patchManifest(manifest);
  for (const script of manifest.content_scripts || []) {
    if (script.js) script.js = expandContentScriptFiles(script.js);
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    extensionPath,
    cleanup: () => rm(extensionPath, { recursive: true, force: true }),
  };
}

/**
 * Starts a local HTTP server on a random port. Pair it with Chromium's
 * `--host-resolver-rules` so real provider hostnames resolve to fixtures.
 * @param {(request: import('node:http').IncomingMessage,
 *   response: import('node:http').ServerResponse) => void} handler
 * @returns {Promise<{port: number, close: () => Promise<void>}>}
 */
export async function startFixtureServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    port: server.address().port,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

/**
 * Launches Chromium with the unpacked extension.
 * @param {object} [options]
 * @param {string} [options.extensionPath] - Unpacked extension directory.
 * @param {string[]} [options.args] - Extra Chromium arguments.
 * @param {{width: number, height: number} | null} [options.viewport]
 * @param {string} [options.userDataDir] - Profile to reuse and keep. Defaults
 *   to a throwaway profile that is deleted on close.
 * @param {boolean} [options.headless] - Live suite only; see getBrowserLaunchOptions.
 * @param {string[]} [options.ignoreDefaultArgs] - Playwright default switches to drop.
 * @returns {Promise<{context: import('@playwright/test').BrowserContext,
 *   serviceWorker: import('@playwright/test').Worker, extensionId: string,
 *   extensionUrl: (relativePath: string) => string, close: () => Promise<void>}>}
 */
export async function launchExtension({
  extensionPath = REPO_EXTENSION_PATH,
  args = [],
  viewport,
  userDataDir: persistentUserDataDir,
  headless,
  ignoreDefaultArgs,
} = {}) {
  const userDataDir = persistentUserDataDir
    || await mkdtemp(path.join(os.tmpdir(), 'panelize-e2e-'));
  const context = await chromium.launchPersistentContext(
    userDataDir,
    getBrowserLaunchOptions({
      viewport,
      headless,
      ignoreDefaultArgs,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        ...args,
      ],
    })
  );

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }
  const extensionId = new URL(serviceWorker.url()).host;

  return {
    context,
    serviceWorker,
    extensionId,
    extensionUrl: (relativePath) => `chrome-extension://${extensionId}/${relativePath}`,
    async close() {
      await context.close().catch(() => {});
      if (!persistentUserDataDir) {
        await rm(userDataDir, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Stores a panel configuration and opens the real multi-panel page.
 * @param {Awaited<ReturnType<typeof launchExtension>>} extension
 * @param {object} options
 * @param {string[]} options.providers - Provider ids, one panel each.
 * @param {string} [options.layout] - Grid layout id such as '1x1'.
 * @param {string[]} [options.enabledProviders] - Providers offered by the add
 *   panel menu; defaults to the open panels.
 * @param {object} [options.settings] - Extra settings seeded before the page opens.
 * @returns {Promise<import('@playwright/test').Page>}
 */
export async function openMultiPanel(extension, { providers, layout = '1x1', enabledProviders = providers, settings = {} }) {
  // This helper changes settings outside the Multi-Panel page. Drop the old
  // startup hint so the page reflects those settings instead of briefly
  // requesting providers from the previous test.
  await extension.context.addInitScript(() => {
    if (location.protocol === 'chrome-extension:') {
      localStorage.removeItem('panelize.startupSnapshot');
    }
  });
  await extension.serviceWorker.evaluate(async (settings) => {
    await chrome.storage.sync.set(settings);
  }, {
    enabledProviders,
    providerOrder: enabledProviders,
    multiPanelProviders: providers,
    multiPanelLayout: layout,
    ...settings,
  });

  const page = await extension.context.newPage();
  await page.goto(extension.extensionUrl('multi-panel/multi-panel.html'));
  // Snapshot frames can have the right count before settings reconciliation.
  await page.waitForFunction(() => document.documentElement.dataset.panelizeReady === 'true');
  await page.waitForFunction(
    (count) => document.querySelectorAll('#panel-grid iframe').length === count,
    providers.length
  );
  return page;
}
