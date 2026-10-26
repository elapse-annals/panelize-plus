import { MAX_PANELS, LAYOUT_PANEL_COUNTS } from './layout-auto-adjust.js';
import { getProviderById } from './providers.js';
import { isProviderAllowedUrl } from './provider-open-url.js';

export const STARTUP_SNAPSHOT_KEY = 'panelize.startupSnapshot';
const SNAPSHOT_VERSION = 1;

// This is a disposable hint for extension UI startup, never authoritative
// settings or a cache of provider documents/conversation URLs.
function normalizeSnapshot(value) {
  if (!value || value.version !== SNAPSHOT_VERSION ||
      !Object.hasOwn(LAYOUT_PANEL_COUNTS, value.layout) ||
      !Array.isArray(value.startupProviderIds) ||
      value.startupProviderIds.length > MAX_PANELS ||
      new Set(value.startupProviderIds).size !== value.startupProviderIds.length ||
      !value.frameUrls || typeof value.frameUrls !== 'object') {
    return null;
  }

  const frameUrls = {};
  for (const id of value.startupProviderIds) {
    const url = value.frameUrls[id];
    if (typeof id !== 'string' || !getProviderById(id) ||
        typeof url !== 'string' || url.length > 2048 || !isProviderAllowedUrl(id, url)) {
      return null;
    }
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return null;
    frameUrls[id] = parsed.href;
  }

  return {
    version: SNAPSHOT_VERSION,
    layout: value.layout,
    startupProviderIds: [...value.startupProviderIds],
    frameUrls
  };
}

export function readStartupSnapshot(storage) {
  try {
    return normalizeSnapshot(JSON.parse((storage || globalThis.localStorage).getItem(STARTUP_SNAPSHOT_KEY)));
  } catch {
    return null;
  }
}

export function clearStartupSnapshot(storage) {
  try {
    (storage || globalThis.localStorage).removeItem(STARTUP_SNAPSHOT_KEY);
  } catch {
    // Storage may be disabled or full; the normal async startup still works.
  }
}

export function writeStartupSnapshot(configuration, storage) {
  try {
    const snapshot = normalizeSnapshot({ ...configuration, version: SNAPSHOT_VERSION });
    if (!snapshot) {
      clearStartupSnapshot(storage);
      return false;
    }
    (storage || globalThis.localStorage).setItem(STARTUP_SNAPSHOT_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    clearStartupSnapshot(storage);
    return false;
  }
}
