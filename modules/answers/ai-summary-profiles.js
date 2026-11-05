// AI summary profiles: several OpenAI-compatible API setups, one active at a
// time. Profile metadata is synced; API keys stay in chrome.storage.local so
// they are never synced or exported. The single legacy configuration is
// migrated into one profile the first time profiles are loaded.

import {
  AI_SUMMARY_API_KEY_STORAGE_KEY,
  normalizeChatCompletionsUrl
} from './ai-summary.js';

export const AI_SUMMARY_PROFILES_STORAGE_KEY = 'aiSummaryProfiles';
export const AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY = 'aiSummaryActiveProfileId';
export const AI_SUMMARY_API_KEYS_STORAGE_KEY = 'aiSummaryApiKeys';
export const AI_SUMMARY_LEGACY_BASE_URL_STORAGE_KEY = 'aiSummaryBaseUrl';
export const AI_SUMMARY_LEGACY_MODEL_STORAGE_KEY = 'aiSummaryModel';
export const DEFAULT_AI_SUMMARY_BASE_URL = 'https://apihub.agnes-ai.com/v1';
export const DEFAULT_AI_SUMMARY_MODEL = 'agnes-3.0-flash';
export const DEFAULT_AI_SUMMARY_PROFILE_ID = 'default';
export const MAX_AI_SUMMARY_PROFILES = 10;

const MAX_PROFILE_ID_LENGTH = 100;
const MAX_PROFILE_NAME_LENGTH = 60;
const MAX_BASE_URL_LENGTH = 500;
const MAX_MODEL_LENGTH = 200;

function normalizeText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function createAiSummaryProfileId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through to the timestamp id below.
  }
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Keeps only complete, uniquely identified profiles, in their stored order.
export function normalizeAiSummaryProfiles(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seenIds = new Set();
  const profiles = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    const id = normalizeText(candidate.id, MAX_PROFILE_ID_LENGTH);
    const baseUrl = normalizeText(candidate.baseUrl, MAX_BASE_URL_LENGTH);
    const model = normalizeText(candidate.model, MAX_MODEL_LENGTH);
    if (!id || seenIds.has(id) || !baseUrl || !model) {
      continue;
    }
    seenIds.add(id);
    profiles.push({
      id,
      name: normalizeText(candidate.name, MAX_PROFILE_NAME_LENGTH),
      baseUrl,
      model
    });
    if (profiles.length >= MAX_AI_SUMMARY_PROFILES) {
      break;
    }
  }
  return profiles;
}

export function normalizeAiSummaryApiKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const keys = {};
  for (const [rawId, rawKey] of Object.entries(value)) {
    const id = normalizeText(rawId, MAX_PROFILE_ID_LENGTH);
    const apiKey = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (id && apiKey) {
      keys[id] = apiKey;
    }
  }
  return keys;
}

export function resolveAiSummaryActiveProfile(profiles, activeId) {
  const list = Array.isArray(profiles) ? profiles : [];
  return list.find(profile => profile.id === activeId) || list[0] || null;
}

// The request settings for the active profile; empty when no profile exists.
export function resolveAiSummaryConfig(profiles, apiKeys, activeId) {
  const profile = resolveAiSummaryActiveProfile(profiles, activeId);
  if (!profile) {
    return { profileId: '', name: '', baseUrl: '', model: '', apiKey: '' };
  }
  return {
    profileId: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiKey: (apiKeys && apiKeys[profile.id]) || ''
  };
}

export function getAiSummaryProfileLabel(profile) {
  const name = normalizeText(profile?.name, MAX_PROFILE_NAME_LENGTH);
  const model = normalizeText(profile?.model, MAX_MODEL_LENGTH);
  if (name && model) {
    return `${name} · ${model}`;
  }
  return name || model;
}

function createDefaultProfile({ id = DEFAULT_AI_SUMMARY_PROFILE_ID, baseUrl = '', model = '' } = {}) {
  return {
    id,
    name: '',
    baseUrl: normalizeText(baseUrl, MAX_BASE_URL_LENGTH) || DEFAULT_AI_SUMMARY_BASE_URL,
    model: normalizeText(model, MAX_MODEL_LENGTH) || DEFAULT_AI_SUMMARY_MODEL
  };
}

function profileMatchesLegacyEndpoint(profile, baseUrl, model) {
  if (!baseUrl || !model) {
    return false;
  }
  return normalizeChatCompletionsUrl(profile.baseUrl) === normalizeChatCompletionsUrl(baseUrl)
    && profile.model === model.trim();
}

function storageArea(name) {
  return typeof chrome !== 'undefined' ? chrome.storage?.[name] : null;
}

// Reads through sync first, then local, matching the settings module.
async function readSettingsStorage(keys) {
  const sync = storageArea('sync');
  if (typeof sync?.get === 'function') {
    try {
      return await sync.get(keys);
    } catch (error) {
      console.warn('chrome.storage.sync unavailable, using local', error);
    }
  }
  const local = storageArea('local');
  if (typeof local?.get === 'function') {
    try {
      return await local.get(keys);
    } catch (error) {
      console.warn('chrome.storage.local unavailable', error);
    }
  }
  return {};
}

async function readLocalStorage(keys) {
  const local = storageArea('local');
  if (typeof local?.get !== 'function') {
    return {};
  }
  try {
    return await local.get(keys);
  } catch (error) {
    console.warn('chrome.storage.local unavailable', error);
    return {};
  }
}

async function writeSync(values) {
  const sync = storageArea('sync');
  if (typeof sync?.set === 'function') {
    try {
      await sync.set(values);
      return;
    } catch (error) {
      console.warn('chrome.storage.sync unavailable, using local', error);
    }
  }
  await writeLocal(values);
}

async function writeLocal(values) {
  const local = storageArea('local');
  if (typeof local?.set !== 'function') {
    return;
  }
  try {
    await local.set(values);
  } catch (error) {
    console.warn('chrome.storage.local unavailable', error);
  }
}

function apiKeysOnly(apiKeys, profiles) {
  const keys = {};
  profiles.forEach(profile => {
    if (apiKeys[profile.id]) {
      keys[profile.id] = apiKeys[profile.id];
    }
  });
  return keys;
}

async function persistSetup(profiles, activeProfileId, apiKeys) {
  await writeSync({
    [AI_SUMMARY_PROFILES_STORAGE_KEY]: profiles,
    [AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]: activeProfileId
  });
  await writeLocal({
    [AI_SUMMARY_API_KEYS_STORAGE_KEY]: apiKeysOnly(apiKeys, profiles)
  });
}

/**
 * Loads the profiles, the active id and this device's API keys, migrating the
 * single legacy configuration the first time profiles are absent.
 *
 * @returns {Promise<{profiles: Array<object>, activeProfileId: string, apiKeys: Record<string, string>}>}
 */
export async function loadAiSummarySetup() {
  const syncRaw = await readSettingsStorage([
    AI_SUMMARY_PROFILES_STORAGE_KEY,
    AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY,
    AI_SUMMARY_LEGACY_BASE_URL_STORAGE_KEY,
    AI_SUMMARY_LEGACY_MODEL_STORAGE_KEY
  ]);
  const localRaw = await readLocalStorage([
    AI_SUMMARY_API_KEYS_STORAGE_KEY,
    AI_SUMMARY_API_KEY_STORAGE_KEY
  ]);

  const storedProfiles = syncRaw?.[AI_SUMMARY_PROFILES_STORAGE_KEY];
  const storedProfileRaw = Array.isArray(storedProfiles) ? storedProfiles : [];
  const legacyBaseUrl = normalizeText(
    syncRaw?.[AI_SUMMARY_LEGACY_BASE_URL_STORAGE_KEY],
    MAX_BASE_URL_LENGTH
  );
  const legacyModel = normalizeText(
    syncRaw?.[AI_SUMMARY_LEGACY_MODEL_STORAGE_KEY],
    MAX_MODEL_LENGTH
  );
  const legacyApiKey = typeof localRaw?.[AI_SUMMARY_API_KEY_STORAGE_KEY] === 'string'
    ? localRaw[AI_SUMMARY_API_KEY_STORAGE_KEY].trim()
    : '';

  let profiles = normalizeAiSummaryProfiles(storedProfileRaw);
  let apiKeys = normalizeAiSummaryApiKeys(localRaw?.[AI_SUMMARY_API_KEYS_STORAGE_KEY]);
  let shouldPersist = JSON.stringify(profiles) !== JSON.stringify(storedProfileRaw);

  if (!Object.hasOwn(syncRaw || {}, AI_SUMMARY_PROFILES_STORAGE_KEY)) {
    // First run after the upgrade: turn the old single setup into one profile.
    profiles = [createDefaultProfile({ baseUrl: legacyBaseUrl, model: legacyModel })];
    if (legacyApiKey) {
      apiKeys = { ...apiKeys, [DEFAULT_AI_SUMMARY_PROFILE_ID]: apiKeys[DEFAULT_AI_SUMMARY_PROFILE_ID] || legacyApiKey };
    }
    shouldPersist = true;
  } else if (profiles.length === 0) {
    // A present but empty or damaged list is repaired without restoring the
    // legacy configuration.
    profiles = [createDefaultProfile()];
    shouldPersist = true;
  } else if (legacyApiKey) {
    // An earlier migration may have missed the key; attach it to the matching
    // endpoint only, and never overwrite a key this device already stores.
    const matchingProfile = profiles.find(profile => !apiKeys[profile.id]
      && profileMatchesLegacyEndpoint(profile, legacyBaseUrl, legacyModel));
    if (matchingProfile) {
      apiKeys = { ...apiKeys, [matchingProfile.id]: legacyApiKey };
      shouldPersist = true;
    }
  }

  const activeProfile = resolveAiSummaryActiveProfile(
    profiles,
    syncRaw?.[AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]
  );
  const activeProfileId = activeProfile?.id || '';
  if (activeProfileId !== (syncRaw?.[AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY] || '')) {
    shouldPersist = true;
  }

  if (shouldPersist) {
    await persistSetup(profiles, activeProfileId, apiKeys);
  }

  return { profiles, activeProfileId, apiKeys };
}

/**
 * Saves profile metadata (sync) and API keys (local), keeping at least one
 * profile and dropping keys that no longer belong to a profile.
 */
export async function saveAiSummarySetup({ profiles, activeProfileId, apiKeys }) {
  let normalizedProfiles = normalizeAiSummaryProfiles(profiles);
  if (normalizedProfiles.length === 0) {
    normalizedProfiles = [createDefaultProfile()];
  }
  const normalizedKeys = apiKeysOnly(
    normalizeAiSummaryApiKeys(apiKeys),
    normalizedProfiles
  );
  const normalizedActiveId = resolveAiSummaryActiveProfile(normalizedProfiles, activeProfileId)?.id
    || normalizedProfiles[0].id;

  await persistSetup(normalizedProfiles, normalizedActiveId, normalizedKeys);

  return {
    profiles: normalizedProfiles,
    activeProfileId: normalizedActiveId,
    apiKeys: normalizedKeys
  };
}

export async function saveAiSummaryActiveProfileId(activeProfileId) {
  await writeSync({
    [AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]: typeof activeProfileId === 'string' ? activeProfileId : ''
  });
}