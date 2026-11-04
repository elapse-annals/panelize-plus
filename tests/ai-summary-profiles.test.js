import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY,
  AI_SUMMARY_API_KEYS_STORAGE_KEY,
  AI_SUMMARY_LEGACY_BASE_URL_STORAGE_KEY,
  AI_SUMMARY_LEGACY_MODEL_STORAGE_KEY,
  AI_SUMMARY_PROFILES_STORAGE_KEY,
  DEFAULT_AI_SUMMARY_BASE_URL,
  DEFAULT_AI_SUMMARY_MODEL,
  DEFAULT_AI_SUMMARY_PROFILE_ID,
  MAX_AI_SUMMARY_PROFILES,
  createAiSummaryProfileId,
  getAiSummaryProfileLabel,
  loadAiSummarySetup,
  normalizeAiSummaryApiKeys,
  normalizeAiSummaryProfiles,
  resolveAiSummaryActiveProfile,
  resolveAiSummaryConfig,
  saveAiSummaryActiveProfileId,
  saveAiSummarySetup
} from '../modules/ai-summary-profiles.js';
import { AI_SUMMARY_API_KEY_STORAGE_KEY } from '../modules/ai-summary.js';

function pick(keys, values) {
  if (!Array.isArray(keys)) {
    return { ...keys, ...values };
  }
  return Object.fromEntries(
    keys.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]])
  );
}

function mockStorage({ sync = {}, local = {}, syncGetFails = false, localGetFails = false } = {}) {
  chrome.storage.sync.get.mockImplementation(async keys => {
    if (syncGetFails) {
      throw new Error('sync unavailable');
    }
    return pick(keys, sync);
  });
  chrome.storage.local.get.mockImplementation(async keys => {
    if (localGetFails) {
      throw new Error('local unavailable');
    }
    return pick(keys, local);
  });
  chrome.storage.sync.set.mockResolvedValue();
  chrome.storage.local.set.mockResolvedValue();
}

describe('normalizeAiSummaryProfiles', () => {
  it('trims, drops incomplete and duplicate profiles, and keeps order', () => {
    expect(normalizeAiSummaryProfiles(null)).toEqual([]);
    expect(normalizeAiSummaryProfiles([
      { id: ' a ', name: ' N ', baseUrl: ' https://a.test/v1 ', model: ' m ' },
      { id: 'a', baseUrl: 'https://duplicate.test/v1', model: 'm2' },
      { id: '', baseUrl: 'https://x.test/v1', model: 'm' },
      { id: 'b', baseUrl: '  ', model: 'm' },
      { id: 'c', baseUrl: 'https://c.test/v1', model: '' },
      null,
      'nope'
    ])).toEqual([
      { id: 'a', name: 'N', baseUrl: 'https://a.test/v1', model: 'm' }
    ]);
  });

  it('caps the list and trims long fields', () => {
    const profiles = Array.from({ length: MAX_AI_SUMMARY_PROFILES + 3 }, (_, index) => ({
      id: `p${index}`,
      name: 'n'.repeat(80),
      baseUrl: `https://${index}.test/${'u'.repeat(600)}`,
      model: 'm'.repeat(300)
    }));
    const normalized = normalizeAiSummaryProfiles(profiles);

    expect(normalized).toHaveLength(MAX_AI_SUMMARY_PROFILES);
    expect(normalized[0].name).toHaveLength(60);
    expect(normalized[0].baseUrl.length).toBeLessThanOrEqual(500);
    expect(normalized[0].model).toHaveLength(200);
  });
});

describe('normalizeAiSummaryApiKeys', () => {
  it('keeps non-empty string keys only', () => {
    expect(normalizeAiSummaryApiKeys(null)).toEqual({});
    expect(normalizeAiSummaryApiKeys(['x'])).toEqual({});
    expect(normalizeAiSummaryApiKeys({
      a: ' key ',
      b: '',
      ' ': 'key',
      c: 42
    })).toEqual({ a: 'key' });
  });
});

describe('resolveAiSummary helpers', () => {
  const profiles = [
    { id: 'p1', name: '', baseUrl: 'https://one.test/v1', model: 'model-1' },
    { id: 'p2', name: 'Second', baseUrl: 'https://two.test/v1', model: 'model-2' }
  ];

  it('falls back to the first profile for an unknown active id', () => {
    expect(resolveAiSummaryActiveProfile(profiles, 'p2')?.id).toBe('p2');
    expect(resolveAiSummaryActiveProfile(profiles, 'missing')?.id).toBe('p1');
    expect(resolveAiSummaryActiveProfile([], 'p1')).toBeNull();
  });

  it('builds the request config for the active profile', () => {
    expect(resolveAiSummaryConfig(profiles, { p2: 'key-2' }, 'p2')).toEqual({
      profileId: 'p2',
      name: 'Second',
      baseUrl: 'https://two.test/v1',
      model: 'model-2',
      apiKey: 'key-2'
    });
    expect(resolveAiSummaryConfig(profiles, {}, 'missing')).toEqual({
      profileId: 'p1',
      name: '',
      baseUrl: 'https://one.test/v1',
      model: 'model-1',
      apiKey: ''
    });
    expect(resolveAiSummaryConfig([], {}, 'p1')).toEqual({
      profileId: '', name: '', baseUrl: '', model: '', apiKey: ''
    });
  });

  it('labels profiles by name and model', () => {
    expect(getAiSummaryProfileLabel(profiles[0])).toBe('model-1');
    expect(getAiSummaryProfileLabel(profiles[1])).toBe('Second · model-2');
    expect(getAiSummaryProfileLabel(null)).toBe('');
  });

  it('creates unique ids', () => {
    expect(createAiSummaryProfileId()).not.toBe(createAiSummaryProfileId());
  });
});

describe('loadAiSummarySetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('migrates the legacy single configuration when the profiles key is absent', async () => {
    mockStorage({
      sync: {
        [AI_SUMMARY_LEGACY_BASE_URL_STORAGE_KEY]: 'https://legacy.test/v1',
        [AI_SUMMARY_LEGACY_MODEL_STORAGE_KEY]: 'legacy-model'
      },
      local: { [AI_SUMMARY_API_KEY_STORAGE_KEY]: 'legacy-key' }
    });

    const state = await loadAiSummarySetup();

    expect(state).toEqual({
      profiles: [{
        id: DEFAULT_AI_SUMMARY_PROFILE_ID,
        name: '',
        baseUrl: 'https://legacy.test/v1',
        model: 'legacy-model'
      }],
      activeProfileId: DEFAULT_AI_SUMMARY_PROFILE_ID,
      apiKeys: { [DEFAULT_AI_SUMMARY_PROFILE_ID]: 'legacy-key' }
    });
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      [AI_SUMMARY_PROFILES_STORAGE_KEY]: state.profiles,
      [AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]: DEFAULT_AI_SUMMARY_PROFILE_ID
    });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [AI_SUMMARY_API_KEYS_STORAGE_KEY]: { [DEFAULT_AI_SUMMARY_PROFILE_ID]: 'legacy-key' }
    });
    expect(JSON.stringify(chrome.storage.sync.set.mock.calls[0][0])).not.toContain('legacy-key');
  });

  it('uses the built-in endpoint and model for a fresh install', async () => {
    mockStorage();

    const state = await loadAiSummarySetup();

    expect(state.profiles).toEqual([{
      id: DEFAULT_AI_SUMMARY_PROFILE_ID,
      name: '',
      baseUrl: DEFAULT_AI_SUMMARY_BASE_URL,
      model: DEFAULT_AI_SUMMARY_MODEL
    }]);
    expect(state.apiKeys).toEqual({});
  });

  it('does not rewrite a valid, unchanged state', async () => {
    const profiles = [{ id: 'p1', name: 'One', baseUrl: 'https://one.test/v1', model: 'm1' }];
    mockStorage({
      sync: {
        [AI_SUMMARY_PROFILES_STORAGE_KEY]: profiles,
        [AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]: 'p1'
      },
      local: { [AI_SUMMARY_API_KEYS_STORAGE_KEY]: { p1: 'key' } }
    });

    const state = await loadAiSummarySetup();

    expect(state.profiles).toEqual(profiles);
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('repairs a present but broken profile list without restoring legacy values', async () => {
    mockStorage({
      sync: {
        [AI_SUMMARY_PROFILES_STORAGE_KEY]: [{ id: 'broken' }],
        [AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]: 'broken',
        [AI_SUMMARY_LEGACY_BASE_URL_STORAGE_KEY]: 'https://legacy.test/v1',
        [AI_SUMMARY_LEGACY_MODEL_STORAGE_KEY]: 'legacy-model'
      }
    });

    const state = await loadAiSummarySetup();

    expect(state.profiles).toEqual([{
      id: DEFAULT_AI_SUMMARY_PROFILE_ID,
      name: '',
      baseUrl: DEFAULT_AI_SUMMARY_BASE_URL,
      model: DEFAULT_AI_SUMMARY_MODEL
    }]);
    expect(chrome.storage.sync.set).toHaveBeenCalled();
  });

  it('attaches a legacy key to a matching profile only when it has no key', async () => {
    const profiles = [
      { id: 'p1', name: '', baseUrl: 'https://one.test/v1', model: 'm1' },
      { id: 'p2', name: '', baseUrl: 'https://two.test/v1', model: 'm2' }
    ];
    mockStorage({
      sync: {
        [AI_SUMMARY_PROFILES_STORAGE_KEY]: profiles,
        [AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]: 'p2',
        [AI_SUMMARY_LEGACY_BASE_URL_STORAGE_KEY]: 'https://one.test/v1',
        [AI_SUMMARY_LEGACY_MODEL_STORAGE_KEY]: 'm1'
      },
      local: {
        [AI_SUMMARY_API_KEYS_STORAGE_KEY]: { p2: 'existing' },
        [AI_SUMMARY_API_KEY_STORAGE_KEY]: 'legacy-key'
      }
    });

    const state = await loadAiSummarySetup();

    expect(state.apiKeys).toEqual({ p1: 'legacy-key', p2: 'existing' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [AI_SUMMARY_API_KEYS_STORAGE_KEY]: { p1: 'legacy-key', p2: 'existing' }
    });
  });

  it('does not overwrite an existing key for the matching endpoint', async () => {
    const profiles = [{ id: 'p1', name: '', baseUrl: 'https://one.test/v1', model: 'm1' }];
    mockStorage({
      sync: {
        [AI_SUMMARY_PROFILES_STORAGE_KEY]: profiles,
        [AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]: 'p1',
        [AI_SUMMARY_LEGACY_BASE_URL_STORAGE_KEY]: 'https://one.test/v1/chat/completions',
        [AI_SUMMARY_LEGACY_MODEL_STORAGE_KEY]: 'm1'
      },
      local: {
        [AI_SUMMARY_API_KEYS_STORAGE_KEY]: { p1: 'current-key' },
        [AI_SUMMARY_API_KEY_STORAGE_KEY]: 'legacy-key'
      }
    });

    const state = await loadAiSummarySetup();

    expect(state.apiKeys).toEqual({ p1: 'current-key' });
  });

  it('falls back to the first profile and persists a repaired active id', async () => {
    const profiles = [
      { id: 'p1', name: '', baseUrl: 'https://one.test/v1', model: 'm1' },
      { id: 'p2', name: '', baseUrl: 'https://two.test/v1', model: 'm2' }
    ];
    mockStorage({
      sync: {
        [AI_SUMMARY_PROFILES_STORAGE_KEY]: profiles,
        [AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]: 'missing'
      }
    });

    const state = await loadAiSummarySetup();

    expect(state.activeProfileId).toBe('p1');
    expect(chrome.storage.sync.set).toHaveBeenCalledWith(expect.objectContaining({
      [AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]: 'p1'
    }));
  });

  it('reads from local storage when sync is unavailable', async () => {
    const profiles = [{ id: 'p1', name: '', baseUrl: 'https://one.test/v1', model: 'm1' }];
    mockStorage({
      syncGetFails: true,
      local: {
        [AI_SUMMARY_PROFILES_STORAGE_KEY]: profiles,
        [AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]: 'p1'
      }
    });

    const state = await loadAiSummarySetup();

    expect(state.profiles).toEqual(profiles);
    expect(state.activeProfileId).toBe('p1');
  });
});

describe('saveAiSummarySetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes profiles, repairs the active id and drops orphan keys', async () => {
    mockStorage();

    const saved = await saveAiSummarySetup({
      profiles: [
        { id: 'p1', name: ' One ', baseUrl: ' https://one.test/v1 ', model: ' m1 ' },
        { id: 'p2', name: '', baseUrl: 'https://two.test/v1', model: 'm2' }
      ],
      activeProfileId: 'missing',
      apiKeys: { p1: 'key-1', p2: '', orphan: 'key-x' }
    });

    expect(saved).toEqual({
      profiles: [
        { id: 'p1', name: 'One', baseUrl: 'https://one.test/v1', model: 'm1' },
        { id: 'p2', name: '', baseUrl: 'https://two.test/v1', model: 'm2' }
      ],
      activeProfileId: 'p1',
      apiKeys: { p1: 'key-1' }
    });
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      [AI_SUMMARY_PROFILES_STORAGE_KEY]: saved.profiles,
      [AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]: 'p1'
    });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [AI_SUMMARY_API_KEYS_STORAGE_KEY]: { p1: 'key-1' }
    });
  });

  it('keeps at least one default profile', async () => {
    mockStorage();

    const saved = await saveAiSummarySetup({ profiles: [], activeProfileId: '', apiKeys: {} });

    expect(saved.profiles).toEqual([{
      id: DEFAULT_AI_SUMMARY_PROFILE_ID,
      name: '',
      baseUrl: DEFAULT_AI_SUMMARY_BASE_URL,
      model: DEFAULT_AI_SUMMARY_MODEL
    }]);
    expect(saved.activeProfileId).toBe(DEFAULT_AI_SUMMARY_PROFILE_ID);
  });

  it('saves only the active profile id for a quick switch', async () => {
    mockStorage();

    await saveAiSummaryActiveProfileId('p2');

    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      [AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]: 'p2'
    });
  });
});