import { hasOptionalProviderPermission } from './optional-provider-access.js';
import { DEFAULT_PROVIDER_IDS } from './provider-defaults.js';

export const MIMO_SESSION_COOKIE_SYNC_ACTION = 'syncMimoSessionCookies';
export const MIMO_STUDIO_COOKIE_URL = 'https://aistudio.xiaomimimo.com/';
export const MIMO_STUDIO_COOKIE_DOMAIN = 'xiaomimimo.com';
export const MIMO_AUTH_COOKIE_NAME = 'xiaomichatbot_ph';
export const MIMO_SESSION_COOKIE_OWNERSHIP_KEY = 'mimoSessionCookieMirrors';
export const MIMO_FIRST_PARTY_PARTITION_KEY = Object.freeze({
  topLevelSite: 'https://xiaomimimo.com',
  hasCrossSiteAncestor: false,
});

function extensionPartitionKey() {
  if (typeof chrome?.runtime?.getURL !== 'function') return null;
  const topLevelSite = chrome.runtime.getURL('').replace(/\/$/, '');
  return topLevelSite ? { topLevelSite, hasCrossSiteAncestor: true } : null;
}

function isStudioDomain(domain) {
  const value = typeof domain === 'string' ? domain.replace(/^\./, '').toLowerCase() : '';
  return value === MIMO_STUDIO_COOKIE_DOMAIN || value === 'aistudio.xiaomimimo.com';
}

function cookieIdentity(cookie) {
  if (
    !cookie || typeof cookie.name !== 'string' || !cookie.name ||
    typeof cookie.domain !== 'string' || !isStudioDomain(cookie.domain) ||
    typeof cookie.path !== 'string' || !cookie.path.startsWith('/') ||
    typeof cookie.storeId !== 'string'
  ) return null;
  return {
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    storeId: cookie.storeId,
  };
}

function identityKey(identity) {
  return JSON.stringify([identity.name, identity.domain, identity.path, identity.storeId]);
}

function isFirstPartyPartition(key) {
  return key?.topLevelSite === MIMO_FIRST_PARTY_PARTITION_KEY.topLevelSite
    && key?.hasCrossSiteAncestor === false;
}

function isExtensionPartition(cookie, key) {
  return cookie?.partitionKey?.topLevelSite === key.topLevelSite
    && cookie?.partitionKey?.hasCrossSiteAncestor === true;
}

function isSourceCookie(cookie, partitioned) {
  if (!cookieIdentity(cookie) || typeof cookie.value !== 'string') return false;
  if (typeof cookie.expirationDate === 'number' && cookie.expirationDate <= Date.now() / 1000) {
    return false;
  }
  return partitioned
    ? isFirstPartyPartition(cookie.partitionKey)
    : !cookie.partitionKey && cookie.name === MIMO_AUTH_COOKIE_NAME;
}

function setDetails(cookie, partitionKey) {
  const details = {
    url: MIMO_STUDIO_COOKIE_URL,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: true,
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: 'no_restriction',
    partitionKey,
    ...(cookie.storeId ? { storeId: cookie.storeId } : {}),
    ...(typeof cookie.expirationDate === 'number'
      ? { expirationDate: cookie.expirationDate }
      : {}),
    ...(cookie.hostOnly === false ? { domain: cookie.domain } : {}),
  };
  return details;
}

function matchesSource(source, target, partitionKey) {
  const sourceIdentity = cookieIdentity(source);
  const targetIdentity = cookieIdentity(target);
  return Boolean(
    sourceIdentity && targetIdentity &&
    identityKey(sourceIdentity) === identityKey(targetIdentity) &&
    source.value === target.value && target.secure === true &&
    Boolean(source.httpOnly) === Boolean(target.httpOnly) &&
    target.sameSite === 'no_restriction' &&
    Boolean(source.hostOnly) === Boolean(target.hostOnly) &&
    source.expirationDate === target.expirationDate &&
    isExtensionPartition(target, partitionKey)
  );
}

async function readOwned() {
  const result = await chrome.storage.local.get({ [MIMO_SESSION_COOKIE_OWNERSHIP_KEY]: [] });
  const saved = result?.[MIMO_SESSION_COOKIE_OWNERSHIP_KEY];
  if (!Array.isArray(saved) || !saved.every((entry) => cookieIdentity(entry))) return null;
  return new Map(saved.map((entry) => {
    const identity = cookieIdentity(entry);
    return [identityKey(identity), identity];
  }));
}

async function writeOwned(owned) {
  const identities = [...owned.values()]
    .sort((left, right) => identityKey(left).localeCompare(identityKey(right)));
  await chrome.storage.local.set({ [MIMO_SESSION_COOKIE_OWNERSHIP_KEY]: identities });
}

function collectSources(unpartitioned, firstParty) {
  const sources = new Map();
  for (const cookie of firstParty) {
    if (isSourceCookie(cookie, true)) {
      const identity = cookieIdentity(cookie);
      sources.set(identityKey(identity), cookie);
    }
  }
  // Prefer the public MiMo auth cookie if both source partitions share an identity.
  for (const cookie of unpartitioned) {
    if (isSourceCookie(cookie, false)) {
      const identity = cookieIdentity(cookie);
      sources.set(identityKey(identity), cookie);
    }
  }
  return sources;
}

function sourceQuery(partitionKey, name) {
  return {
    domain: MIMO_STUDIO_COOKIE_DOMAIN,
    ...(name ? { name } : {}),
    ...(partitionKey ? { partitionKey } : {}),
  };
}

export function isMimoSourceCookieChange(changeInfo) {
  const cookie = changeInfo?.cookie;
  if (!cookieIdentity(cookie)) return false;
  return cookie.partitionKey
    ? isFirstPartyPartition(cookie.partitionKey)
    : cookie.name === MIMO_AUTH_COOKIE_NAME;
}

/** Mirror first-party MiMo sessions into the cookie partition used by the embedded frame. */
export async function reconcileMimoSessionCookies() {
  if (
    typeof chrome === 'undefined' || !chrome.storage?.sync?.get ||
    !chrome.storage?.local?.get || !chrome.storage?.local?.set ||
    !chrome.cookies?.getAll || !chrome.cookies?.set || !chrome.runtime?.getURL
  ) return { success: false };

  try {
    const [settings, owned, permitted] = await Promise.all([
      chrome.storage.sync.get({ enabledProviders: DEFAULT_PROVIDER_IDS }),
      readOwned(),
      hasOptionalProviderPermission('mimo'),
    ]);
    if (!owned || !permitted) return { success: false };

    const targetPartition = extensionPartitionKey();
    if (!targetPartition) return { success: false };
    const enabled = Array.isArray(settings?.enabledProviders)
      ? settings.enabledProviders.includes('mimo')
      : DEFAULT_PROVIDER_IDS.includes('mimo');

    const [targetCookies, unpartitioned, firstParty] = await Promise.all([
      chrome.cookies.getAll({ domain: MIMO_STUDIO_COOKIE_DOMAIN, partitionKey: targetPartition }),
      enabled ? chrome.cookies.getAll(sourceQuery(null, MIMO_AUTH_COOKIE_NAME)) : [],
      enabled ? chrome.cookies.getAll(sourceQuery(MIMO_FIRST_PARTY_PARTITION_KEY)) : [],
    ]);
    if (![targetCookies, unpartitioned, firstParty].every(Array.isArray)) return { success: false };

    const sources = enabled ? collectSources(unpartitioned, firstParty) : new Map();
    const targets = new Map();
    for (const cookie of targetCookies) {
      const identity = cookieIdentity(cookie);
      if (identity && isExtensionPartition(cookie, targetPartition)) {
        targets.set(identityKey(identity), cookie);
      }
    }

    for (const [key, source] of sources) {
      const identity = cookieIdentity(source);
      const target = targets.get(key);
      const ownedCopy = owned.has(key);
      if (target && !ownedCopy) continue;
      if (target && matchesSource(source, target, targetPartition)) continue;
      if (!ownedCopy) {
        owned.set(key, identity);
        await writeOwned(owned);
      }
      await chrome.cookies.set(setDetails(source, targetPartition));
    }

    for (const [key] of [...owned]) {
      if (sources.has(key)) continue;
      const target = targets.get(key);
      if (target) {
        await chrome.cookies.set({
          ...setDetails(target, targetPartition),
          value: '',
          expirationDate: 0,
        });
      }
      owned.delete(key);
      await writeOwned(owned);
    }

    return { success: true };
  } catch {
    // Preserve ownership metadata if Chrome cannot query or write partitioned cookies.
    return { success: false };
  }
}
