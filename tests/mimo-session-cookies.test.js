import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MIMO_AUTH_COOKIE_NAME,
  MIMO_FIRST_PARTY_PARTITION_KEY,
  MIMO_SESSION_COOKIE_OWNERSHIP_KEY,
  MIMO_SESSION_COOKIE_SYNC_ACTION,
  MIMO_STUDIO_COOKIE_DOMAIN,
  MIMO_STUDIO_COOKIE_URL,
  isMimoSourceCookieChange,
  reconcileMimoSessionCookies,
} from '../modules/mimo-session-cookies.js';

const EXTENSION_PARTITION_KEY = {
  topLevelSite: 'chrome-extension://test-extension',
  hasCrossSiteAncestor: true,
};

let cookieJar;
let localStorageData;

function samePartition(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function domainMatchesCookieFilter(cookieDomain, requestedDomain) {
  const cookie = cookieDomain.replace(/^\./, '').toLowerCase();
  const requested = requestedDomain.replace(/^\./, '').toLowerCase();
  return cookie === requested || cookie.endsWith(`.${requested}`);
}

function pathMatchesCookie(cookiePath, requestPath) {
  const path = cookiePath || '/';
  if (path === requestPath) return true;
  if (!requestPath.startsWith(path)) return false;
  return path.endsWith('/') || requestPath.charAt(path.length) === '/';
}

function createCookieApi() {
  chrome.cookies = {
    getAll: vi.fn(async (details = {}) => cookieJar.filter((cookie) => {
      if (details.name && cookie.name !== details.name) return false;
      if (details.domain && !domainMatchesCookieFilter(cookie.domain, details.domain)) return false;
      if (details.url) {
        const url = new URL(details.url);
        const normalizedDomain = cookie.domain.replace(/^\./, '').toLowerCase();
        const hostMatches = url.hostname === normalizedDomain || url.hostname.endsWith(`.${normalizedDomain}`);
        if (!hostMatches || !pathMatchesCookie(cookie.path, url.pathname)) return false;
      }
      if (Object.hasOwn(details, 'partitionKey')) {
        if (!samePartition(cookie.partitionKey, details.partitionKey)) return false;
      } else if (cookie.partitionKey) {
        return false;
      }
      return true;
    }).map((cookie) => ({ ...cookie }))),
    set: vi.fn(async (details) => {
      const url = new URL(details.url);
      const cookie = {
        name: details.name,
        value: details.value,
        domain: details.domain || url.hostname,
        hostOnly: details.domain === undefined,
        path: details.path || '/',
        secure: Boolean(details.secure),
        httpOnly: Boolean(details.httpOnly),
        sameSite: details.sameSite || 'unspecified',
        storeId: details.storeId || '0',
        partitionKey: { ...details.partitionKey },
        ...(typeof details.expirationDate === 'number'
          ? { expirationDate: details.expirationDate }
          : {}),
      };
      const identity = (candidate) => [candidate.name, candidate.domain, candidate.path, candidate.storeId];
      const index = cookieJar.findIndex((candidate) =>
        JSON.stringify(identity(candidate)) === JSON.stringify(identity(cookie))
          && samePartition(candidate.partitionKey, cookie.partitionKey)
      );
      if (typeof details.expirationDate === 'number'
        && details.expirationDate <= Date.now() / 1000) {
        if (index >= 0) cookieJar.splice(index, 1);
        return undefined;
      }
      if (index >= 0) cookieJar.splice(index, 1);
      cookieJar.push(cookie);
      return { ...cookie };
    }),
    remove: vi.fn(async (details) => {
      const url = new URL(details.url);
      const index = cookieJar.findIndex((cookie) => {
        const identityMatches = cookie.name === details.name
          && cookie.storeId === details.storeId
          && samePartition(cookie.partitionKey, details.partitionKey);
        const normalizedDomain = cookie.domain.replace(/^\./, '').toLowerCase();
        const hostMatches = url.hostname === normalizedDomain || url.hostname.endsWith(`.${normalizedDomain}`);
        return identityMatches && hostMatches && pathMatchesCookie(cookie.path, url.pathname);
      });
      if (index < 0) return undefined;
      return cookieJar.splice(index, 1)[0];
    }),
  };
}

function unpartitionedCookie(overrides = {}) {
  return {
    name: MIMO_AUTH_COOKIE_NAME,
    value: 'session-secret-value',
    domain: 'aistudio.xiaomimimo.com',
    hostOnly: true,
    path: '/open-apis/user',
    secure: false,
    httpOnly: true,
    sameSite: undefined,
    storeId: '0',
    ...overrides,
  };
}

function firstPartyPartitionedCookie(overrides = {}) {
  return {
    name: 'studio_session',
    value: 'partitioned-session-secret',
    domain: '.xiaomimimo.com',
    hostOnly: false,
    path: '/open-apis',
    secure: false,
    httpOnly: true,
    sameSite: 'lax',
    storeId: '0',
    partitionKey: { ...MIMO_FIRST_PARTY_PARTITION_KEY },
    ...overrides,
  };
}

function extensionCookie(source) {
  return {
    ...source,
    secure: true,
    sameSite: 'no_restriction',
    partitionKey: { ...EXTENSION_PARTITION_KEY },
  };
}

function ownedIdentity(cookie) {
  return {
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    storeId: cookie.storeId,
  };
}

function findPartitionCookie(name, partitionKey) {
  return cookieJar.find((cookie) =>
    cookie.name === name && samePartition(cookie.partitionKey, partitionKey)
  );
}

describe('MiMo session cookie synchronization', () => {
  beforeEach(() => {
    cookieJar = [];
    localStorageData = {};
    chrome.runtime.getURL = vi.fn((path = '') => `chrome-extension://test-extension/${path}`);
    chrome.permissions = {
      contains: vi.fn(() => Promise.resolve(true)),
    };
    chrome.storage.sync.get.mockImplementation((defaults) => Promise.resolve({
      ...defaults,
      enabledProviders: ['mimo'],
    }));
    chrome.storage.local.get.mockImplementation((defaults) => Promise.resolve({
      ...defaults,
      ...localStorageData,
    }));
    chrome.storage.local.set.mockImplementation(async (values) => {
      Object.assign(localStorageData, structuredClone(values));
    });
    chrome.storage.local.remove.mockImplementation(async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete localStorageData[key];
    });
    createCookieApi();
  });

  it('declares the MiMo cookie-sync action and Studio cookie domain', () => {
    expect(MIMO_SESSION_COOKIE_SYNC_ACTION).toBe('syncMimoSessionCookies');
    expect(MIMO_STUDIO_COOKIE_URL).toBe('https://aistudio.xiaomimimo.com/');
    expect(MIMO_STUDIO_COOKIE_DOMAIN).toBe('xiaomimimo.com');
  });

  it('mirrors only the MiMo PH cookie and first-party partitioned Studio cookies', async () => {
    const authCookie = unpartitionedCookie();
    const studioCookie = firstPartyPartitionedCookie();
    const originalSourceCookies = structuredClone([authCookie, studioCookie]);
    cookieJar.push(
      authCookie,
      studioCookie,
      unpartitionedCookie({ name: 'analytics', value: 'unrelated-unpartitioned' }),
      firstPartyPartitionedCookie({
        name: 'third_party_session',
        value: 'cross-site-ancestor-session',
        partitionKey: {
          topLevelSite: 'https://xiaomimimo.com',
          hasCrossSiteAncestor: true,
        },
      }),
      firstPartyPartitionedCookie({
        name: 'other_partition_session',
        value: 'other-partition-session',
        partitionKey: { topLevelSite: 'https://other.example', hasCrossSiteAncestor: false },
      })
    );

    await expect(reconcileMimoSessionCookies()).resolves.toEqual({ success: true });

    expect(chrome.cookies.getAll).toHaveBeenCalledWith({
      domain: MIMO_STUDIO_COOKIE_DOMAIN,
      name: MIMO_AUTH_COOKIE_NAME,
    });
    expect(chrome.cookies.getAll).toHaveBeenCalledWith({
      domain: MIMO_STUDIO_COOKIE_DOMAIN,
      partitionKey: MIMO_FIRST_PARTY_PARTITION_KEY,
    });
    expect(chrome.cookies.set).toHaveBeenCalledTimes(2);
    expect(chrome.cookies.set).toHaveBeenCalledWith({
      url: MIMO_STUDIO_COOKIE_URL,
      name: authCookie.name,
      value: authCookie.value,
      path: authCookie.path,
      secure: true,
      httpOnly: true,
      sameSite: 'no_restriction',
      partitionKey: EXTENSION_PARTITION_KEY,
      storeId: '0',
    });
    expect(chrome.cookies.set).toHaveBeenCalledWith({
      url: MIMO_STUDIO_COOKIE_URL,
      name: studioCookie.name,
      value: studioCookie.value,
      path: studioCookie.path,
      secure: true,
      httpOnly: true,
      sameSite: 'no_restriction',
      partitionKey: EXTENSION_PARTITION_KEY,
      domain: studioCookie.domain,
      storeId: '0',
    });
    expect(cookieJar.filter((cookie) => samePartition(cookie.partitionKey, EXTENSION_PARTITION_KEY)))
      .toHaveLength(2);
    expect(cookieJar).toEqual(expect.arrayContaining(originalSourceCookies));
    expect(localStorageData[MIMO_SESSION_COOKIE_OWNERSHIP_KEY]).toEqual([
      ownedIdentity(studioCookie),
      ownedIdentity(authCookie),
    ]);
    expect(JSON.stringify(localStorageData[MIMO_SESSION_COOKIE_OWNERSHIP_KEY]))
      .not.toContain('session-secret-value');
  });

  it('does not require the PH cookie SameSite field to be readable', async () => {
    cookieJar.push(unpartitionedCookie({ sameSite: undefined }));

    await expect(reconcileMimoSessionCookies()).resolves.toEqual({ success: true });

    expect(chrome.cookies.set).toHaveBeenCalledTimes(1);
    expect(findPartitionCookie(MIMO_AUTH_COOKIE_NAME, EXTENSION_PARTITION_KEY)).toBeDefined();
  });

  it('preserves host-only scope, expiry, and store id when mirroring', async () => {
    const expires = Math.floor(Date.now() / 1000) + 600;
    const source = unpartitionedCookie({
      hostOnly: true,
      expirationDate: expires,
      storeId: '1',
    });
    cookieJar.push(source);

    await reconcileMimoSessionCookies();

    expect(chrome.cookies.set).toHaveBeenCalledWith(expect.objectContaining({
      url: MIMO_STUDIO_COOKIE_URL,
      name: source.name,
      path: source.path,
      expirationDate: expires,
      storeId: '1',
      partitionKey: EXTENSION_PARTITION_KEY,
    }));
    expect(chrome.cookies.set.mock.calls[0][0]).not.toHaveProperty('domain');
  });

  it('does not overwrite or claim an existing extension-partition cookie', async () => {
    const source = unpartitionedCookie();
    const preexisting = extensionCookie({ ...source, value: 'preexisting-extension-cookie' });
    cookieJar.push(source, preexisting);

    await reconcileMimoSessionCookies();

    expect(chrome.cookies.set).not.toHaveBeenCalled();
    expect(localStorageData[MIMO_SESSION_COOKIE_OWNERSHIP_KEY]).toBeUndefined();
    expect(findPartitionCookie(source.name, EXTENSION_PARTITION_KEY).value)
      .toBe('preexisting-extension-cookie');
  });

  it('does not write a cookie again when the owned destination already matches', async () => {
    const source = unpartitionedCookie();
    cookieJar.push(source);
    await reconcileMimoSessionCookies();
    chrome.cookies.set.mockClear();

    await expect(reconcileMimoSessionCookies()).resolves.toEqual({ success: true });

    expect(chrome.cookies.set).not.toHaveBeenCalled();
  });

  it('removes only owned destination copies after logout', async () => {
    const authCookie = unpartitionedCookie();
    const studioCookie = firstPartyPartitionedCookie();
    cookieJar.push(authCookie, studioCookie);
    await reconcileMimoSessionCookies();

    cookieJar = cookieJar.filter((cookie) =>
      cookie !== authCookie && cookie !== studioCookie
    );
    const unrelatedDestination = extensionCookie({
      ...unpartitionedCookie({ name: 'unrelated_extension_cookie', value: 'keep-me' }),
    });
    cookieJar.push(unrelatedDestination);
    chrome.cookies.set.mockClear();

    await expect(reconcileMimoSessionCookies()).resolves.toEqual({ success: true });

    expect(chrome.cookies.set).toHaveBeenCalledTimes(2);
    expect(chrome.cookies.set).toHaveBeenCalledWith(expect.objectContaining({
      url: MIMO_STUDIO_COOKIE_URL,
      name: authCookie.name,
      partitionKey: EXTENSION_PARTITION_KEY,
      value: '',
      expirationDate: 0,
    }));
    expect(cookieJar).toContain(unrelatedDestination);
    expect(findPartitionCookie(authCookie.name, EXTENSION_PARTITION_KEY)).toBeUndefined();
    expect(findPartitionCookie(studioCookie.name, EXTENSION_PARTITION_KEY)).toBeUndefined();
    expect(localStorageData[MIMO_SESSION_COOKIE_OWNERSHIP_KEY]).toEqual([]);
  });

  it('cleans a mirror when its source cookie expires', async () => {
    const source = unpartitionedCookie({
      expirationDate: Math.floor(Date.now() / 1000) + 60,
    });
    cookieJar.push(source);
    await reconcileMimoSessionCookies();
    source.expirationDate = Math.floor(Date.now() / 1000) - 1;
    chrome.cookies.set.mockClear();

    await expect(reconcileMimoSessionCookies()).resolves.toEqual({ success: true });

    expect(chrome.cookies.set).toHaveBeenCalledWith(expect.objectContaining({
      name: source.name,
      value: '',
      expirationDate: 0,
      partitionKey: EXTENSION_PARTITION_KEY,
    }));
    expect(findPartitionCookie(source.name, EXTENSION_PARTITION_KEY)).toBeUndefined();
    expect(localStorageData[MIMO_SESSION_COOKIE_OWNERSHIP_KEY]).toEqual([]);
  });

  it('cleans owned copies when MiMo is disabled without reading source cookies', async () => {
    const source = unpartitionedCookie();
    cookieJar.push(source);
    await reconcileMimoSessionCookies();
    chrome.cookies.getAll.mockClear();
    chrome.cookies.set.mockClear();
    chrome.storage.sync.get.mockImplementation((defaults) => Promise.resolve({
      ...defaults,
      enabledProviders: ['chatgpt'],
    }));

    await expect(reconcileMimoSessionCookies()).resolves.toEqual({ success: true });

    expect(chrome.cookies.getAll).toHaveBeenCalledTimes(1);
    expect(chrome.cookies.getAll).toHaveBeenCalledWith({
      domain: MIMO_STUDIO_COOKIE_DOMAIN,
      partitionKey: EXTENSION_PARTITION_KEY,
    });
    expect(chrome.cookies.set).toHaveBeenCalledWith(expect.objectContaining({
      name: source.name,
      value: '',
      expirationDate: 0,
      partitionKey: EXTENSION_PARTITION_KEY,
    }));
    expect(localStorageData[MIMO_SESSION_COOKIE_OWNERSHIP_KEY]).toEqual([]);
  });

  it('does not query or clear cookies while MiMo host permission is revoked', async () => {
    const source = unpartitionedCookie();
    cookieJar.push(source);
    await reconcileMimoSessionCookies();
    const storedIdentities = structuredClone(localStorageData[MIMO_SESSION_COOKIE_OWNERSHIP_KEY]);
    chrome.cookies.getAll.mockClear();
    chrome.cookies.set.mockClear();
    chrome.permissions.contains.mockResolvedValue(false);

    await expect(reconcileMimoSessionCookies()).resolves.toEqual({ success: false });

    expect(chrome.cookies.getAll).not.toHaveBeenCalled();
    expect(chrome.cookies.set).not.toHaveBeenCalled();
    expect(localStorageData[MIMO_SESSION_COOKIE_OWNERSHIP_KEY]).toEqual(storedIdentities);
  });

  it('cleans owned copies after permission is restored while MiMo is disabled', async () => {
    const source = unpartitionedCookie();
    cookieJar.push(source);
    await reconcileMimoSessionCookies();
    chrome.permissions.contains.mockResolvedValue(false);
    await reconcileMimoSessionCookies();
    chrome.cookies.set.mockClear();
    chrome.cookies.getAll.mockClear();
    chrome.permissions.contains.mockResolvedValue(true);
    chrome.storage.sync.get.mockImplementation((defaults) => Promise.resolve({
      ...defaults,
      enabledProviders: ['chatgpt'],
    }));

    await expect(reconcileMimoSessionCookies()).resolves.toEqual({ success: true });

    expect(chrome.cookies.getAll).toHaveBeenCalledTimes(1);
    expect(chrome.cookies.set).toHaveBeenCalledWith(expect.objectContaining({
      name: source.name,
      value: '',
      expirationDate: 0,
      partitionKey: EXTENSION_PARTITION_KEY,
    }));
    expect(localStorageData[MIMO_SESSION_COOKIE_OWNERSHIP_KEY]).toEqual([]);
  });

  it('filters cookie-change events to the supported source cookies and partition', () => {
    expect(isMimoSourceCookieChange({ cookie: unpartitionedCookie({ sameSite: undefined }) })).toBe(true);
    expect(isMimoSourceCookieChange({ cookie: unpartitionedCookie({ name: 'analytics' }) })).toBe(false);
    expect(isMimoSourceCookieChange({ cookie: firstPartyPartitionedCookie() })).toBe(true);
    expect(isMimoSourceCookieChange({
      cookie: firstPartyPartitionedCookie({
        partitionKey: {
          topLevelSite: 'https://xiaomimimo.com',
          hasCrossSiteAncestor: true,
        },
      }),
    })).toBe(false);
    expect(isMimoSourceCookieChange({
      cookie: firstPartyPartitionedCookie({ partitionKey: EXTENSION_PARTITION_KEY }),
    })).toBe(false);
    expect(isMimoSourceCookieChange({
      cookie: unpartitionedCookie({ domain: '.unrelated.example' }),
    })).toBe(false);
    expect(isMimoSourceCookieChange({ removed: true, cookie: unpartitionedCookie() })).toBe(true);
  });

  it('keeps ownership state intact when partition-key cookie queries are unsupported', async () => {
    const source = unpartitionedCookie();
    const mirrored = extensionCookie(source);
    cookieJar.push(source, mirrored);
    localStorageData[MIMO_SESSION_COOKIE_OWNERSHIP_KEY] = [ownedIdentity(source)];
    chrome.cookies.getAll.mockRejectedValueOnce(new Error('partitionKey unsupported'));

    await expect(reconcileMimoSessionCookies()).resolves.toEqual({ success: false });

    expect(chrome.cookies.set).not.toHaveBeenCalled();
    expect(chrome.cookies.remove).not.toHaveBeenCalled();
    expect(localStorageData[MIMO_SESSION_COOKIE_OWNERSHIP_KEY]).toEqual([ownedIdentity(source)]);
  });
});
