import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  MIMO_AUTH_COOKIE_NAME,
  MIMO_FIRST_PARTY_PARTITION_KEY,
  MIMO_STUDIO_COOKIE_DOMAIN,
  MIMO_STUDIO_COOKIE_URL,
} from '../../modules/mimo-session-cookies.js';
import { OPTIONAL_PROVIDER_CONFIGS } from '../../modules/optional-provider-access.js';
import {
  createPatchedExtensionCopy,
  launchExtension,
  openMultiPanel,
  startFixtureServer,
} from './extension-harness.js';

const STUDIO_HOST = 'aistudio.xiaomimimo.com';
const ACCOUNT_HOST = 'account.xiaomi.com';
const SESSION_COOKIE = 'mimo_session=fixture-session';
const PH_COOKIE = 'xiaomichatbot_ph=fixture-ph';
const execFileAsync = promisify(execFile);

async function startMimoHttpsFixture(requests) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'panelize-mimo-https-'));
  const keyPath = path.join(directory, 'key.pem');
  const certificatePath = path.join(directory, 'certificate.pem');

  try {
    await execFileAsync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certificatePath, '-days', '1',
      '-subj', '/CN=aistudio.xiaomimimo.com',
      '-addext', 'subjectAltName=DNS:aistudio.xiaomimimo.com',
    ]);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certificatePath)]);
  const server = https.createServer({ key, cert }, (request, response) => {
    const requestUrl = new URL(request.url, `https://${request.headers.host}`);
    const cookieHeader = request.headers.cookie || '';
    const sessionCookiePresent = cookieHeader.includes(SESSION_COOKIE);
    const phCookiePresent = cookieHeader.includes(PH_COOKIE);
    response.setHeader('Cache-Control', 'no-store');

    if (requestUrl.pathname === '/open-apis/user/mi/get') {
      requests.push({ kind: 'session', sessionCookiePresent, phCookiePresent });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ loggedIn: sessionCookiePresent }));
      return;
    }

    if (requestUrl.pathname === '/open-apis/chat/send' && request.method === 'POST') {
      requests.push({
        kind: 'chat',
        sessionCookiePresent,
        phCookiePresent,
        phQuery: requestUrl.searchParams.get('xiaomichatbot_ph') || '',
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
      return;
    }

    if (requestUrl.pathname === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (requestUrl.pathname !== '/') {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body>
      <p id="auth-state">Checking session</p>
      <p id="cookie-state">Checking PH cookie</p>
      <p id="post-state">Pending</p>
      <script>
        (async () => {
          const sessionResponse = await fetch('/open-apis/user/mi/get', { credentials: 'include' });
          const { loggedIn } = await sessionResponse.json();
          document.querySelector('#auth-state').textContent = loggedIn ? 'Logged in' : 'Sign in';
          const ph = document.cookie.split('; ')
            .find(value => value.startsWith('xiaomichatbot_ph='))
            ?.slice('xiaomichatbot_ph='.length) || '';
          document.querySelector('#cookie-state').textContent = ph || 'PH cookie unavailable';
          await fetch('/open-apis/chat/send?xiaomichatbot_ph=' + encodeURIComponent(ph), {
            method: 'POST', credentials: 'include'
          });
          document.querySelector('#post-state').textContent = 'Sent';
        })().catch(error => {
          document.querySelector('#auth-state').textContent = 'Fixture error: ' + error.message;
        });
      </script>
    </body></html>`);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  return {
    port: server.address().port,
    close: () => new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
      server.closeAllConnections?.();
    }),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test('reconciles the MiMo sign-in frame rule and characterizes Lax cookies in the HTTP fixture', async () => {
  test.setTimeout(60000);
  const requests = [];
  const server = await startFixtureServer((request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const host = request.headers.host.split(':')[0];

    if (host === ACCOUNT_HOST && requestUrl.pathname === '/login') {
      response.writeHead(200, {
        'Content-Type': 'text/html',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'",
      });
      response.end('<!doctype html><html><body><p id="xiaomi-sign-in">Xiaomi sign-in fixture</p></body></html>');
      return;
    }

    if (host !== STUDIO_HOST) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    const cookieHeader = request.headers.cookie || '';
    const sessionCookiePresent = cookieHeader.split('; ').includes(SESSION_COOKIE);
    const phCookiePresent = cookieHeader.split('; ').includes(PH_COOKIE);
    const context = request.headers['x-fixture-context'] || 'unknown';

    if (requestUrl.pathname === '/open-apis/user/mi/get') {
      requests.push({
        kind: 'session',
        context,
        sessionCookiePresent,
        phCookiePresent,
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ loggedIn: sessionCookiePresent }));
      return;
    }

    if (requestUrl.pathname === '/open-apis/chat/send' && request.method === 'POST') {
      const phQuery = requestUrl.searchParams.get('xiaomichatbot_ph') || '';
      requests.push({
        kind: 'chat',
        context,
        sessionCookiePresent,
        phCookiePresent,
        phQuery,
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('ok');
      return;
    }

    if (requestUrl.pathname !== '/') {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(`<!doctype html><html><body>
      <p id="auth-state">Checking session</p>
      <p id="cookie-state">Checking browser cookie access</p>
      <p id="post-state">Pending</p>
      <iframe id="xiaomi-login-frame" title="Xiaomi sign in"
        src="http://${ACCOUNT_HOST}:${server.port}/login"></iframe>
      <script>
        (async () => {
          const context = window.top === window.self ? 'top-level' : 'embedded';
          const headers = { 'X-Fixture-Context': context };
          const sessionResponse = await fetch('/open-apis/user/mi/get', {
            credentials: 'include', headers
          });
          const { loggedIn } = await sessionResponse.json();
          document.querySelector('#auth-state').textContent = loggedIn ? 'Logged in' : 'Sign in';

          const ph = document.cookie.split('; ').find(value => value.startsWith('xiaomichatbot_ph='))
            ?.slice('xiaomichatbot_ph='.length) || '';
          document.querySelector('#cookie-state').textContent = ph || 'PH cookie unavailable';
          await fetch(
            '/open-apis/chat/send?xiaomichatbot_ph=' + encodeURIComponent(ph),
            { method: 'POST', credentials: 'include', headers }
          );
          document.querySelector('#post-state').textContent = 'Sent';
        })().catch(error => {
          document.querySelector('#auth-state').textContent = 'Fixture error: ' + error.message;
        });
      </script>
    </body></html>`);
  });

  const extensionCopy = await createPatchedExtensionCopy(manifest => {
    const origins = OPTIONAL_PROVIDER_CONFIGS.mimo.origins;
    // The fixture uses HTTP loopback while retaining the real provider hostnames.
    manifest.host_permissions.push(...origins, ...origins.map(origin => origin.replace('https:', 'http:')));
  });

  const extension = await launchExtension({
    extensionPath: extensionCopy.extensionPath,
    args: [
      '--disable-features=HttpsUpgrades',
      '--no-proxy-server',
      `--host-resolver-rules=MAP ${STUDIO_HOST} 127.0.0.1, MAP ${ACCOUNT_HOST} 127.0.0.1`,
    ],
  });

  try {
    const getMiMoRule = () => extension.serviceWorker.evaluate(async () => (
      (await chrome.declarativeNetRequest.getDynamicRules()).find(({ id }) => id === 1005)
    ));
    const staleStudioOnlyRule = {
      ...OPTIONAL_PROVIDER_CONFIGS.mimo.frameRule,
      condition: {
        urlFilter: `https://${STUDIO_HOST}/*`,
        resourceTypes: ['sub_frame'],
      },
    };

    await extension.serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({ enabledProviders: ['mimo'], providerOrder: ['mimo'] });
    });
    await expect.poll(getMiMoRule).toMatchObject({ id: 1005 });
    await extension.serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({ enabledProviders: [], providerOrder: [] });
    });
    await expect.poll(getMiMoRule).toBeUndefined();

    await extension.serviceWorker.evaluate(async (rule) => {
      const installed = await chrome.declarativeNetRequest.getDynamicRules();
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: installed.filter(({ id }) => id === rule.id).map(({ id }) => id),
        addRules: [rule],
      });
    }, staleStudioOnlyRule);
    expect(await getMiMoRule()).toMatchObject({
      condition: {
        urlFilter: `https://${STUDIO_HOST}/*`,
        resourceTypes: ['sub_frame'],
      },
    });
    await extension.serviceWorker.evaluate(async () => {
      // The storage change wakes the service-worker listener and runs the
      // production reconciliation path.
      await chrome.storage.sync.set({ enabledProviders: ['mimo'], providerOrder: ['mimo'] });
    });

    await expect.poll(getMiMoRule).toMatchObject({
      condition: {
        requestDomains: [STUDIO_HOST, ACCOUNT_HOST],
        resourceTypes: ['sub_frame'],
      },
    });
    // Synthetic SameSite=Lax cookies let this fixture compare browser and
    // JavaScript access without using a live account.
    await extension.context.addCookies([
      {
        name: 'mimo_session', value: 'fixture-session', domain: '.xiaomimimo.com',
        path: '/', httpOnly: true, sameSite: 'Lax',
      },
      {
        name: 'xiaomichatbot_ph', value: 'fixture-ph', domain: '.xiaomimimo.com',
        path: '/', httpOnly: false, sameSite: 'Lax',
      },
    ]);

    await extension.context.route(`https://${STUDIO_HOST}/**`, route => {
      const requestUrl = new URL(route.request().url());
      return route.fulfill({
        status: 302,
        headers: {
          Location: `http://${STUDIO_HOST}:${server.port}${requestUrl.pathname}${requestUrl.search}`,
        },
      });
    });

    const topLevel = await extension.context.newPage();
    await topLevel.goto(`http://${STUDIO_HOST}:${server.port}/`);
    await expect(topLevel.locator('#auth-state')).toHaveText('Logged in');
    await expect(topLevel.locator('#cookie-state')).toHaveText('fixture-ph');
    await expect(topLevel.locator('#post-state')).toHaveText('Sent');
    await expect(topLevel.frameLocator('#xiaomi-login-frame').locator('#xiaomi-sign-in'))
      .toHaveText('Xiaomi sign-in fixture');

    const panel = await openMultiPanel(extension, { providers: ['mimo'] });
    const studioPanel = panel.frameLocator('#panel-grid iframe');
    await expect(studioPanel.locator('#auth-state')).toHaveText('Logged in');
    await expect(studioPanel.locator('#post-state')).toHaveText('Sent');
    await expect(studioPanel.frameLocator('#xiaomi-login-frame').locator('#xiaomi-sign-in'))
      .toHaveText('Xiaomi sign-in fixture');
    const firstPanelCookieState = await studioPanel.locator('#cookie-state').textContent();

    await panel.reload();
    const reloadedPanel = panel.frameLocator('#panel-grid iframe');
    await expect(reloadedPanel.locator('#auth-state')).toHaveText('Logged in');
    await expect(reloadedPanel.locator('#post-state')).toHaveText('Sent');
    await expect(reloadedPanel.frameLocator('#xiaomi-login-frame').locator('#xiaomi-sign-in'))
      .toHaveText('Xiaomi sign-in fixture');
    const reloadedPanelCookieState = await reloadedPanel.locator('#cookie-state').textContent();

    const topLevelSession = requests.find(({ kind, context }) => kind === 'session' && context === 'top-level');
    const panelSessions = requests.filter(({ kind, context }) => kind === 'session' && context === 'embedded');
    const topLevelChat = requests.find(({ kind, context }) => kind === 'chat' && context === 'top-level');
    const panelChats = requests.filter(({ kind, context }) => kind === 'chat' && context === 'embedded');

    expect(topLevelSession).toMatchObject({ sessionCookiePresent: true, phCookiePresent: true });
    expect(topLevelChat).toMatchObject({ sessionCookiePresent: true, phCookiePresent: true, phQuery: 'fixture-ph' });
    expect(panelSessions).toHaveLength(2);
    expect(panelChats).toHaveLength(2);

    // Host permissions let the embedded Studio requests carry these cookies,
    // while the Lax PH cookie remains unavailable to third-party document.cookie.
    expect(panelSessions.map(({ sessionCookiePresent, phCookiePresent }, index) => ({
      sessionCookiePresent,
      phCookiePresent,
      documentCookie: [firstPanelCookieState, reloadedPanelCookieState][index],
      phQuery: panelChats[index]?.phQuery,
    }))).toEqual([
      {
        sessionCookiePresent: true,
        phCookiePresent: true,
        documentCookie: 'PH cookie unavailable',
        phQuery: '',
      },
      {
        sessionCookiePresent: true,
        phCookiePresent: true,
        documentCookie: 'PH cookie unavailable',
        phQuery: '',
      },
    ]);
  } finally {
    await extension.close();
    await server.close();
    await extensionCopy.cleanup();
  }
});

test('keeps MiMo logged in across panel reload and clears mirrored cookies on logout', async () => {
  test.setTimeout(60000);
  const sessionName = 'mimo_session';
  const sessionValue = 'fixture-session';
  const phValue = 'fixture-ph';
  const requests = [];
  let fixture;
  try {
    fixture = await startMimoHttpsFixture(requests);
  } catch (error) {
    if (error.code === 'ENOENT') test.skip(true, 'OpenSSL is required to create a temporary HTTPS fixture certificate');
    throw error;
  }

  let extensionCopy;
  let extension;
  try {
    extensionCopy = await createPatchedExtensionCopy(manifest => {
      manifest.host_permissions.push(...OPTIONAL_PROVIDER_CONFIGS.mimo.origins);
    });
    extension = await launchExtension({
      extensionPath: extensionCopy.extensionPath,
      args: [
        '--no-proxy-server',
        '--ignore-certificate-errors',
        '--host-resolver-rules=MAP aistudio.xiaomimimo.com 127.0.0.1',
      ],
    });

    const extensionPartitionKey = {
      topLevelSite: extension.extensionUrl('').replace(/\/$/, ''),
      hasCrossSiteAncestor: true,
    };
    const getMirroredCookies = () => extension.serviceWorker.evaluate(async ({ domain, partitionKey }) => (
      chrome.cookies.getAll({ domain, partitionKey })
    ), { domain: MIMO_STUDIO_COOKIE_DOMAIN, partitionKey: extensionPartitionKey });

    await extension.serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({ enabledProviders: [], providerOrder: [] });
    });
    const seeded = await extension.serviceWorker.evaluate(async ({ url, domain, phName, phValue, sessionName, sessionValue, sourcePartitionKey }) => {
      const ph = await chrome.cookies.set({
        url, domain: `.${domain}`, name: phName, value: phValue, path: '/',
        secure: true, httpOnly: false, sameSite: 'lax',
      });
      const session = await chrome.cookies.set({
        url, domain: `.${domain}`, name: sessionName, value: sessionValue, path: '/',
        secure: true, httpOnly: true, sameSite: 'no_restriction',
        partitionKey: sourcePartitionKey,
      });
      return Boolean(ph && session);
    }, {
      url: MIMO_STUDIO_COOKIE_URL,
      domain: MIMO_STUDIO_COOKIE_DOMAIN,
      phName: MIMO_AUTH_COOKIE_NAME,
      phValue,
      sessionName,
      sessionValue,
      sourcePartitionKey: MIMO_FIRST_PARTY_PARTITION_KEY,
    });
    expect(seeded).toBe(true);
    expect(await getMirroredCookies()).toEqual([]);

    // Redirect only the extension's default-port navigation to the local TLS
    // server. All unrelated network requests are aborted by the fallback route.
    await extension.context.route('**/*', route => {
      if (new URL(route.request().url()).protocol === 'chrome-extension:') {
        return route.continue();
      }
      return route.abort();
    });
    await extension.context.route(url => {
      const requestUrl = new URL(url);
      return requestUrl.protocol === 'https:' && requestUrl.hostname === 'aistudio.xiaomimimo.com';
    }, route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.port) return route.continue();
      return route.fulfill({
        status: 302,
        headers: {
          Location: `https://aistudio.xiaomimimo.com:${fixture.port}${requestUrl.pathname}${requestUrl.search}`,
        },
      });
    });

    const panel = await openMultiPanel(extension, { providers: ['mimo'] });
    const studioPanel = panel.frameLocator('#panel-grid iframe');
    await expect(studioPanel.locator('#auth-state')).toHaveText('Logged in');
    await expect(studioPanel.locator('#cookie-state')).toHaveText(phValue);
    await expect(studioPanel.locator('#post-state')).toHaveText('Sent');
    await expect.poll(getMirroredCookies).toHaveLength(2);

    const mirrorSummary = (await getMirroredCookies()).map(({ name, value, secure, httpOnly, sameSite, partitionKey }) => ({
      name, value, secure, httpOnly, sameSite, partitionKey,
    })).sort((left, right) => left.name.localeCompare(right.name));
    expect(mirrorSummary).toEqual([
      {
        name: sessionName, value: sessionValue, secure: true, httpOnly: true,
        sameSite: 'no_restriction', partitionKey: extensionPartitionKey,
      },
      {
        name: MIMO_AUTH_COOKIE_NAME, value: phValue, secure: true, httpOnly: false,
        sameSite: 'no_restriction', partitionKey: extensionPartitionKey,
      },
    ].sort((left, right) => left.name.localeCompare(right.name)));
    await expect.poll(() => requests.length).toBe(2);
    expect(requests).toEqual([
      { kind: 'session', sessionCookiePresent: true, phCookiePresent: true },
      { kind: 'chat', sessionCookiePresent: true, phCookiePresent: true, phQuery: phValue },
    ]);

    await panel.reload();
    const reloadedPanel = panel.frameLocator('#panel-grid iframe');
    await expect(reloadedPanel.locator('#auth-state')).toHaveText('Logged in');
    await expect(reloadedPanel.locator('#cookie-state')).toHaveText(phValue);
    await expect(reloadedPanel.locator('#post-state')).toHaveText('Sent');
    await expect.poll(() => requests.length).toBe(4);
    expect(requests.slice(2)).toEqual(requests.slice(0, 2));

    const removed = await extension.serviceWorker.evaluate(async ({ url, phName, sessionName, sourcePartitionKey }) => {
      const ph = await chrome.cookies.remove({ url, name: phName });
      const session = await chrome.cookies.remove({ url, name: sessionName, partitionKey: sourcePartitionKey });
      return Boolean(ph && session);
    }, {
      url: MIMO_STUDIO_COOKIE_URL,
      phName: MIMO_AUTH_COOKIE_NAME,
      sessionName,
      sourcePartitionKey: MIMO_FIRST_PARTY_PARTITION_KEY,
    });
    expect(removed).toBe(true);
    await expect.poll(getMirroredCookies).toHaveLength(0);

    await panel.reload();
    const signedOutPanel = panel.frameLocator('#panel-grid iframe');
    await expect(signedOutPanel.locator('#auth-state')).toHaveText('Sign in');
    await expect(signedOutPanel.locator('#cookie-state')).toHaveText('PH cookie unavailable');
    await expect(signedOutPanel.locator('#post-state')).toHaveText('Sent');
    await expect.poll(() => requests.length).toBe(6);
    expect(requests.slice(4)).toEqual([
      { kind: 'session', sessionCookiePresent: false, phCookiePresent: false },
      { kind: 'chat', sessionCookiePresent: false, phCookiePresent: false, phQuery: '' },
    ]);
  } finally {
    await extension?.close();
    await extensionCopy?.cleanup();
    await fixture.close();
    await fixture.cleanup();
  }
});

test('logs MiMo in from the Multi-Panel page when the service worker runs outdated code', async () => {
  test.setTimeout(60000);
  const sessionName = 'mimo_session';
  const sessionValue = 'fixture-session';
  const phValue = 'fixture-ph';
  const requests = [];
  let fixture;
  try {
    fixture = await startMimoHttpsFixture(requests);
  } catch (error) {
    if (error.code === 'ENOENT') test.skip(true, 'OpenSSL is required to create a temporary HTTPS fixture certificate');
    throw error;
  }

  let extensionCopy;
  let extension;
  try {
    extensionCopy = await createPatchedExtensionCopy(manifest => {
      manifest.host_permissions.push(...OPTIONAL_PROVIDER_CONFIGS.mimo.origins);
    });
    // Chrome keeps running an unpacked extension's cached service worker until
    // the extension is reloaded. Stand in for one that never mirrors the MiMo
    // session or registers optional provider access.
    const workerPath = path.join(extensionCopy.extensionPath, 'background/service-worker.js');
    const worker = await readFile(workerPath, 'utf8');
    const outdatedWorker = worker
      .replace('const result = await reconcileMimoSessionCookies();', 'const result = { success: true };')
      .replace('.then(() => reconcileOptionalProviderAccess())', '.then(() => {})');
    expect(outdatedWorker).not.toBe(worker);
    expect(outdatedWorker).not.toContain('await reconcileMimoSessionCookies()');
    expect(outdatedWorker).not.toContain('reconcileOptionalProviderAccess())');
    await writeFile(workerPath, outdatedWorker);

    extension = await launchExtension({
      extensionPath: extensionCopy.extensionPath,
      args: [
        '--no-proxy-server',
        '--ignore-certificate-errors',
        '--host-resolver-rules=MAP aistudio.xiaomimimo.com 127.0.0.1',
      ],
    });

    await extension.serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({ enabledProviders: ['mimo'], providerOrder: ['mimo'] });
    });
    const seeded = await extension.serviceWorker.evaluate(async ({ url, domain, phName, phValue, sessionName, sessionValue, sourcePartitionKey }) => {
      const ph = await chrome.cookies.set({
        url, domain: `.${domain}`, name: phName, value: phValue, path: '/',
        secure: true, httpOnly: false, sameSite: 'lax',
      });
      const session = await chrome.cookies.set({
        url, domain: `.${domain}`, name: sessionName, value: sessionValue, path: '/',
        secure: true, httpOnly: true, sameSite: 'no_restriction',
        partitionKey: sourcePartitionKey,
      });
      return Boolean(ph && session);
    }, {
      url: MIMO_STUDIO_COOKIE_URL,
      domain: MIMO_STUDIO_COOKIE_DOMAIN,
      phName: MIMO_AUTH_COOKIE_NAME,
      phValue,
      sessionName,
      sessionValue,
      sourcePartitionKey: MIMO_FIRST_PARTY_PARTITION_KEY,
    });
    expect(seeded).toBe(true);
    const registeredBeforePage = await extension.serviceWorker.evaluate(async () => (
      (await chrome.scripting.getRegisteredContentScripts()).map(({ id }) => id)
    ));
    expect(registeredBeforePage).not.toContain('mimo-scripts');

    await extension.context.route('**/*', route => {
      if (new URL(route.request().url()).protocol === 'chrome-extension:') {
        return route.continue();
      }
      return route.abort();
    });
    await extension.context.route(url => {
      const requestUrl = new URL(url);
      return requestUrl.protocol === 'https:' && requestUrl.hostname === 'aistudio.xiaomimimo.com';
    }, route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.port) return route.continue();
      return route.fulfill({
        status: 302,
        headers: {
          Location: `https://aistudio.xiaomimimo.com:${fixture.port}${requestUrl.pathname}${requestUrl.search}`,
        },
      });
    });

    const panel = await openMultiPanel(extension, { providers: ['mimo'] });
    const studioPanel = panel.frameLocator('#panel-grid iframe');
    await expect(studioPanel.locator('#auth-state')).toHaveText('Logged in');
    await expect(studioPanel.locator('#cookie-state')).toHaveText(phValue);
    await expect.poll(() => requests.find(({ kind }) => kind === 'session')).toEqual({
      kind: 'session', sessionCookiePresent: true, phCookiePresent: true,
    });
    const access = await extension.serviceWorker.evaluate(async () => ({
      scripts: (await chrome.scripting.getRegisteredContentScripts()).map(({ id }) => id),
      rules: (await chrome.declarativeNetRequest.getDynamicRules()).map(({ id }) => id),
    }));
    expect(access.scripts).toContain('mimo-scripts');
    expect(access.rules).toContain(OPTIONAL_PROVIDER_CONFIGS.mimo.frameRule.id);
  } finally {
    await extension?.close();
    await extensionCopy?.cleanup();
    await fixture.close();
    await fixture.cleanup();
  }
});
