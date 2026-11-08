import { MAX_PANELS, isKnownLayout } from './layout-auto-adjust.js';
import { getProviderById } from '../providers/providers.js';
import { isProviderAllowedUrl } from '../providers/provider-open-url.js';
import { PANEL_PROMPT_MODE_INHERIT, normalizePanelPromptMode } from '../prompts/prompt-modes.js';

export const STARTUP_SNAPSHOT_KEY = 'panelize.startupSnapshot';
const SNAPSHOT_VERSION = 2;
const PANEL_PROMPT_MODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// This is a disposable hint for extension UI startup, never authoritative
// settings or a cache of provider documents/conversation URLs.
function normalizePanelPromptModeKey(value) {
  const modeKey = normalizePanelPromptMode(value);
  if (modeKey === PANEL_PROMPT_MODE_INHERIT) return modeKey;
  // A tampered or stale mode key only loses that panel's mode; the rest of the
  // snapshot still restores.
  return PANEL_PROMPT_MODE_PATTERN.test(modeKey) ? modeKey : PANEL_PROMPT_MODE_INHERIT;
}

function normalizeFrameUrl(providerId, value) {
  if (typeof value !== 'string' || value.length > 2048 || !isProviderAllowedUrl(providerId, value)) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

// The providers settings resolved at the time the snapshot was written. A
// change here means the user changed the startup selection, so settings win.
function normalizeStartupFingerprint(value) {
  if (!Array.isArray(value) || value.length > MAX_PANELS) return null;
  const ids = [];
  for (const id of value) {
    if (typeof id !== 'string' || !getProviderById(id)) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.length ? ids : null;
}

function normalizePanels(value) {
  if (!Array.isArray(value) || value.length > MAX_PANELS) return null;
  const panels = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const { providerId } = entry;
    if (typeof providerId !== 'string' || !getProviderById(providerId)) return null;
    const frameUrl = normalizeFrameUrl(providerId, entry.frameUrl);
    if (!frameUrl) return null;
    panels.push({
      providerId,
      frameUrl,
      promptMode: normalizePanelPromptModeKey(entry.promptMode)
    });
  }
  return panels;
}

function normalizeLegacySnapshot(value) {
  if (value.version !== 1 ||
      !Array.isArray(value.startupProviderIds) ||
      value.startupProviderIds.length > MAX_PANELS ||
      !value.frameUrls || typeof value.frameUrls !== 'object') {
    return null;
  }
  const panels = [];
  for (const providerId of value.startupProviderIds) {
    if (typeof providerId !== 'string' || !getProviderById(providerId)) return null;
    const frameUrl = normalizeFrameUrl(providerId, value.frameUrls[providerId]);
    if (!frameUrl) return null;
    panels.push({ providerId, frameUrl, promptMode: PANEL_PROMPT_MODE_INHERIT });
  }
  return {
    version: SNAPSHOT_VERSION,
    layout: value.layout,
    settingsStartupProviderIds: [...new Set(panels.map(panel => panel.providerId))],
    panels
  };
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== 'object' || !isKnownLayout(value.layout)) return null;

  if (value.version === 1) return normalizeLegacySnapshot(value);
  if (value.version !== SNAPSHOT_VERSION) return null;

  const panels = normalizePanels(value.panels);
  if (!panels) return null;

  return {
    version: SNAPSHOT_VERSION,
    layout: value.layout,
    settingsStartupProviderIds: normalizeStartupFingerprint(value.settingsStartupProviderIds),
    panels
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