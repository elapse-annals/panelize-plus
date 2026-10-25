import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STARTUP_SNAPSHOT_KEY,
  clearStartupSnapshot,
  readStartupSnapshot,
  writeStartupSnapshot
} from '../modules/startup-snapshot.js';

const configuration = {
  layout: '1x3',
  startupProviderIds: ['chatgpt', 'google'],
  frameUrls: { chatgpt: 'https://chatgpt.com', google: 'https://www.google.com/search?udm=50' }
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

  it('stores a synchronous startup hint with normalized frame URLs', () => {
    expect(writeStartupSnapshot(configuration)).toBe(true);
    expect(readStartupSnapshot()).toEqual({
      ...configuration,
      version: 1,
      frameUrls: { ...configuration.frameUrls, chatgpt: 'https://chatgpt.com/' }
    });
    clearStartupSnapshot();
    expect(readStartupSnapshot()).toBeNull();
  });

  it.each([null, '{bad json', 'null', '[]', '{"version":2}'])(
    'falls back for missing or malformed data: %s', raw => {
      if (raw !== null) localStorage.setItem(STARTUP_SNAPSHOT_KEY, raw);
      expect(readStartupSnapshot()).toBeNull();
    }
  );

  it.each([
    { layout: '1x13' },
    { layout: '__proto__' },
    { startupProviderIds: 'chatgpt' },
    { startupProviderIds: ['unknown'] },
    { startupProviderIds: ['__proto__'] },
    { startupProviderIds: ['chatgpt', 'chatgpt'] },
    { startupProviderIds: Array(13).fill('chatgpt') },
    { frameUrls: null },
    { frameUrls: { chatgpt: 'http://chatgpt.com/', google: configuration.frameUrls.google } },
    { frameUrls: { chatgpt: 'https://evil.example/', google: configuration.frameUrls.google } },
    { frameUrls: { chatgpt: 'https://chatgpt.com.evil.example/', google: configuration.frameUrls.google } },
    { frameUrls: { chatgpt: 'https://user:password@chatgpt.com/', google: configuration.frameUrls.google } },
    { frameUrls: { chatgpt: 'javascript:alert(1)', google: configuration.frameUrls.google } },
    { frameUrls: { chatgpt: 'https://chatgpt.com/' + 'a'.repeat(2048), google: configuration.frameUrls.google } }
  ])('discards unusable or unsafe configuration %j', override => {
    localStorage.setItem(STARTUP_SNAPSHOT_KEY, JSON.stringify({ ...configuration, version: 1, ...override }));
    expect(readStartupSnapshot()).toBeNull();
    expect(writeStartupSnapshot({ ...configuration, ...override })).toBe(false);
    expect(localStorage.getItem(STARTUP_SNAPSHOT_KEY)).toBeNull();
  });

  it('keeps only configuration fields and URLs for the selected providers', () => {
    writeStartupSnapshot({ ...configuration, input: 'private prompt', frameUrls: {
      ...configuration.frameUrls, claude: 'https://claude.ai/chat/private'
    } });
    expect(JSON.parse(localStorage.getItem(STARTUP_SNAPSHOT_KEY))).toEqual({
      version: 1,
      layout: configuration.layout,
      startupProviderIds: configuration.startupProviderIds,
      frameUrls: { chatgpt: 'https://chatgpt.com/', google: configuration.frameUrls.google }
    });
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
