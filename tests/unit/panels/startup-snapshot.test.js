import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from '../../../modules/providers/providers.js';
import { AUTO_LAYOUT_ID } from '../../../modules/panels/layout-auto-adjust.js';
import {
  STARTUP_SNAPSHOT_KEY,
  clearStartupSnapshot,
  readStartupSnapshot,
  writeStartupSnapshot
} from '../../../modules/panels/startup-snapshot.js';

const configuration = {
  layout: '1x3',
  settingsStartupProviderIds: ['chatgpt', 'google'],
  panels: [
    { providerId: 'chatgpt', frameUrl: 'https://chatgpt.com', promptMode: 'inherit' },
    { providerId: 'google', frameUrl: 'https://www.google.com/search?udm=50', promptMode: 'concise' }
  ]
};

const normalized = {
  version: 2,
  layout: '1x3',
  settingsStartupProviderIds: ['chatgpt', 'google'],
  panels: [
    { providerId: 'chatgpt', frameUrl: 'https://chatgpt.com/', promptMode: 'inherit' },
    { providerId: 'google', frameUrl: 'https://www.google.com/search?udm=50', promptMode: 'concise' }
  ]
};

describe('startup snapshot', () => {
  beforeEach(() => {
    const entries = new Map();
    vi.stubGlobal('localStorage', {
      getItem: key => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, String(value)),
      removeItem: key => entries.delete(key)
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stores the synchronous startup hint per panel', () => {
    expect(writeStartupSnapshot(configuration)).toBe(true);
    expect(readStartupSnapshot()).toEqual(normalized);
    clearStartupSnapshot();
    expect(readStartupSnapshot()).toBeNull();
  });

  it('accepts duplicate providers with their own prompt modes', () => {
    const duplicated = {
      ...configuration,
      panels: [
        { providerId: 'chatgpt', frameUrl: 'https://chatgpt.com', promptMode: 'concise' },
        { providerId: 'chatgpt', frameUrl: 'https://chatgpt.com', promptMode: 'deep' }
      ]
    };
    expect(writeStartupSnapshot(duplicated)).toBe(true);
    expect(readStartupSnapshot().panels.map(panel => panel.promptMode)).toEqual(['concise', 'deep']);
  });

  it('migrates a version 1 snapshot to per-panel entries', () => {
    localStorage.setItem(STARTUP_SNAPSHOT_KEY, JSON.stringify({
      version: 1,
      layout: '1x3',
      startupProviderIds: ['chatgpt', 'google'],
      frameUrls: {
        chatgpt: 'https://chatgpt.com',
        google: 'https://www.google.com/search?udm=50'
      }
    }));
    expect(readStartupSnapshot()).toEqual({
      ...normalized,
      panels: normalized.panels.map(panel => ({ ...panel, promptMode: 'inherit' }))
    });
  });

  it('accepts duplicate providers in a version 1 snapshot', () => {
    localStorage.setItem(STARTUP_SNAPSHOT_KEY, JSON.stringify({
      version: 1,
      layout: '1x2',
      startupProviderIds: ['chatgpt', 'chatgpt'],
      frameUrls: { chatgpt: 'https://chatgpt.com' }
    }));
    expect(readStartupSnapshot().panels).toEqual([
      { providerId: 'chatgpt', frameUrl: 'https://chatgpt.com/', promptMode: 'inherit' },
      { providerId: 'chatgpt', frameUrl: 'https://chatgpt.com/', promptMode: 'inherit' }
    ]);
    expect(readStartupSnapshot().settingsStartupProviderIds).toEqual(['chatgpt']);
  });

  it.each([null, '{bad json', 'null', '[]', '{"version":3}'])(
    'falls back for missing or malformed data: %s', raw => {
      if (raw !== null) localStorage.setItem(STARTUP_SNAPSHOT_KEY, raw);
      expect(readStartupSnapshot()).toBeNull();
    }
  );

  it.each([
    { layout: '1x31' },
    { layout: '__proto__' },
    { panels: 'chatgpt' },
    { panels: ['chatgpt'] },
    { panels: [{ providerId: 'unknown', frameUrl: 'https://chatgpt.com/' }] },
    { panels: [{ providerId: '__proto__', frameUrl: 'https://chatgpt.com/' }] },
    { panels: Array(31).fill({ providerId: 'chatgpt', frameUrl: 'https://chatgpt.com/' }) },
    { panels: [{ providerId: 'chatgpt', frameUrl: 'http://chatgpt.com/' }] },
    { panels: [{ providerId: 'chatgpt', frameUrl: 'https://evil.example/' }] },
    { panels: [{ providerId: 'chatgpt', frameUrl: 'https://chatgpt.com.evil.example/' }] },
    { panels: [{ providerId: 'chatgpt', frameUrl: 'https://user:password@chatgpt.com/' }] },
    { panels: [{ providerId: 'chatgpt', frameUrl: 'javascript:alert(1)' }] },
    { panels: [{ providerId: 'chatgpt', frameUrl: 'https://chatgpt.com/' + 'a'.repeat(2048) }] }
  ])('discards unusable or unsafe configuration %j', override => {
    localStorage.setItem(STARTUP_SNAPSHOT_KEY, JSON.stringify({ ...configuration, version: 2, ...override }));
    expect(readStartupSnapshot()).toBeNull();
    expect(writeStartupSnapshot({ ...configuration, ...override })).toBe(false);
    expect(localStorage.getItem(STARTUP_SNAPSHOT_KEY)).toBeNull();
  });

  it('degrades an invalid prompt mode instead of discarding the snapshot', () => {
    expect(writeStartupSnapshot({
      ...configuration,
      panels: [
        { providerId: 'chatgpt', frameUrl: 'https://chatgpt.com/', promptMode: 'bad mode key' },
        { providerId: 'google', frameUrl: 'https://www.google.com/search?udm=50', promptMode: 42 }
      ]
    })).toBe(true);
    expect(readStartupSnapshot().panels.map(panel => panel.promptMode))
      .toEqual(['inherit', 'inherit']);
  });

  it('keeps an invalid startup fingerprint as a fallback to the panel providers', () => {
    expect(writeStartupSnapshot({ ...configuration, settingsStartupProviderIds: ['unknown'] })).toBe(true);
    expect(readStartupSnapshot()).toEqual({ ...normalized, settingsStartupProviderIds: null });
  });

  it('keeps only configuration fields and URLs for the selected panels', () => {
    writeStartupSnapshot({
      ...configuration,
      input: 'private prompt',
      settingsStartupProviderIds: ['chatgpt', 'google', 'claude'],
      panels: [
        { ...configuration.panels[0], currentUrl: 'https://chatgpt.com/c/private' },
        configuration.panels[1]
      ]
    });
    expect(JSON.parse(localStorage.getItem(STARTUP_SNAPSHOT_KEY))).toEqual({
      ...normalized,
      settingsStartupProviderIds: ['chatgpt', 'google', 'claude']
    });
  });

  it.each(['1x30', '2x15'])('stores more than twelve providers in the %s layout', layout => {
    const expanded = {
      layout,
      settingsStartupProviderIds: PROVIDERS.map(({ id }) => id),
      panels: PROVIDERS.map(({ id, url }) => ({ providerId: id, frameUrl: url, promptMode: 'inherit' }))
    };
    expect(expanded.panels.length).toBeGreaterThan(12);
    expect(writeStartupSnapshot(expanded)).toBe(true);
    expect(readStartupSnapshot().panels).toEqual(expanded.panels.map(panel => ({
      ...panel,
      frameUrl: new URL(panel.frameUrl).href
    })));
  });

  it('accepts the auto layout', () => {
    const auto = { ...configuration, layout: AUTO_LAYOUT_ID };
    expect(writeStartupSnapshot(auto)).toBe(true);
    expect(readStartupSnapshot()).toMatchObject({ layout: AUTO_LAYOUT_ID });
  });

  it('tolerates disabled storage and clears stale data when a write fails', () => {
    const unavailable = {
      getItem: vi.fn(() => { throw new Error('Storage disabled'); }),
      setItem: vi.fn(() => { throw new Error('Quota exceeded'); }),
      removeItem: vi.fn(() => { throw new Error('Storage disabled'); })
    };
    expect(readStartupSnapshot(unavailable)).toBeNull();
    expect(writeStartupSnapshot(configuration, unavailable)).toBe(false);
    expect(unavailable.removeItem).toHaveBeenCalledWith(STARTUP_SNAPSHOT_KEY);
    expect(() => clearStartupSnapshot(unavailable)).not.toThrow();
  });
});