import { describe, expect, it, vi } from 'vitest';
import {
  AI_SUMMARY_CACHE_STORAGE_KEY,
  AI_SUMMARY_CACHE_TTL_MS,
  createAiSummaryCacheEntry,
  isAiSummaryCacheEntryValid,
  loadAiSummaryCache,
  matchAiSummaryCache,
  readAiSummaryCache,
  saveAiSummaryCacheEntry,
  upsertAiSummaryCache
} from '../modules/ai-summary-cache.js';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const CONFIG = { baseUrl: 'https://api.example.com/v1', model: 'test-model' };
const SUMMARY = {
  verdict: null,
  overview: 'Both answers agree.',
  consensus: [],
  unique: [],
  disagreements: []
};
const PANELS = [
  { position: 1, providerId: 'chatgpt' },
  { position: 2, providerId: 'deepseek' }
];
const SOURCES = [
  { position: 1, panelId: 'p1', sourceId: 'S1' },
  { position: 2, panelId: 'p2', sourceId: 'S2' }
];

function createEntry(overrides = {}) {
  return createAiSummaryCacheEntry({
    question: 'How do these compare?',
    config: CONFIG,
    language: 'zh-CN',
    panels: PANELS,
    sources: SOURCES,
    summary: SUMMARY,
    now: NOW,
    ...overrides
  });
}

function createStorage(initial = null) {
  const store = { [AI_SUMMARY_CACHE_STORAGE_KEY]: initial };
  return {
    get: vi.fn(async defaults => ({
      ...defaults,
      [AI_SUMMARY_CACHE_STORAGE_KEY]: store[AI_SUMMARY_CACHE_STORAGE_KEY] ?? []
    })),
    set: vi.fn(async update => {
      Object.assign(store, update);
    }),
    store
  };
}

describe('createAiSummaryCacheEntry', () => {
  it('stores the question setup, source positions and creation time', () => {
    const entry = createEntry();
    expect(entry.version).toBe(1);
    expect(entry.question).toBe('How do these compare?');
    expect(entry.baseUrl).toBe('https://api.example.com/v1/chat/completions');
    expect(entry.model).toBe('test-model');
    expect(entry.panels).toEqual(PANELS);
    expect(entry.sourcePositions).toEqual([1, 2]);
    expect(entry.createdAt).toBe(NOW);
    expect(isAiSummaryCacheEntryValid(entry)).toBe(true);
  });

  it('rejects entries without summary content or panels', () => {
    expect(isAiSummaryCacheEntryValid({ ...createEntry(), summary: {} })).toBe(false);
    expect(isAiSummaryCacheEntryValid({ ...createEntry(), panels: [] })).toBe(false);
    expect(isAiSummaryCacheEntryValid({ ...createEntry(), version: 2 })).toBe(false);
  });
});

describe('matchAiSummaryCache', () => {
  const query = {
    question: 'How do these compare?',
    baseUrl: CONFIG.baseUrl,
    model: CONFIG.model,
    language: 'zh-CN',
    panels: PANELS
  };

  it('matches the same question and setup within three days', () => {
    const entry = createEntry();
    expect(matchAiSummaryCache([entry], query, { now: NOW + 1000 })).toBe(entry);
    expect(matchAiSummaryCache([entry], query, { now: NOW + AI_SUMMARY_CACHE_TTL_MS })).toBe(entry);
  });

  it('misses an expired entry', () => {
    const entry = createEntry();
    expect(matchAiSummaryCache([entry], query, { now: NOW + AI_SUMMARY_CACHE_TTL_MS + 1 })).toBeNull();
  });

  it('misses a different question, model, API, language or panel sequence', () => {
    const entry = createEntry();
    expect(matchAiSummaryCache([entry], { ...query, question: 'Another question' }, { now: NOW })).toBeNull();
    expect(matchAiSummaryCache([entry], { ...query, model: 'other-model' }, { now: NOW })).toBeNull();
    expect(matchAiSummaryCache([entry], { ...query, baseUrl: 'https://other.example.com/v1' }, { now: NOW })).toBeNull();
    expect(matchAiSummaryCache([entry], { ...query, language: 'en' }, { now: NOW })).toBeNull();
    expect(matchAiSummaryCache([entry], {
      ...query,
      panels: [{ position: 1, providerId: 'chatgpt' }]
    }, { now: NOW })).toBeNull();
    expect(matchAiSummaryCache([entry], {
      ...query,
      panels: [{ position: 1, providerId: 'deepseek' }, { position: 2, providerId: 'chatgpt' }]
    }, { now: NOW })).toBeNull();
  });

  it('normalizes API URLs with and without the chat completions path', () => {
    const entry = createEntry();
    expect(matchAiSummaryCache([entry], {
      ...query,
      baseUrl: 'https://api.example.com/v1/chat/completions'
    }, { now: NOW })).toBe(entry);
  });
});

describe('upsertAiSummaryCache', () => {
  it('keeps the newest summary per question and at most three questions', () => {
    const first = createEntry({ question: 'one', now: NOW - 3000 });
    const second = createEntry({ question: 'two', now: NOW - 2000 });
    const third = createEntry({ question: 'three', now: NOW - 1000 });
    const replacement = createEntry({ question: '  one  ', now: NOW });
    let entries = upsertAiSummaryCache([], first, { now: NOW });
    entries = upsertAiSummaryCache(entries, second, { now: NOW });
    entries = upsertAiSummaryCache(entries, third, { now: NOW });
    entries = upsertAiSummaryCache(entries, replacement, { now: NOW });
    entries = upsertAiSummaryCache(entries, createEntry({ question: 'four', now: NOW }), { now: NOW });

    // Same question after trimming is replaced, not duplicated.
    expect(entries.map(entry => entry.question)).toEqual(['four', 'one', 'three']);
  });

  it('drops expired entries', () => {
    const stale = createEntry({ question: 'stale', now: NOW - AI_SUMMARY_CACHE_TTL_MS - 1 });
    const fresh = createEntry({ question: 'fresh', now: NOW });
    expect(upsertAiSummaryCache([stale], fresh, { now: NOW })).toEqual([fresh]);
  });
});

describe('summary cache storage', () => {
  it('saves and loads entries from local storage', async () => {
    const storage = createStorage();
    const entry = createEntry();
    expect(await saveAiSummaryCacheEntry(entry, storage, NOW)).toEqual([entry]);
    expect(await loadAiSummaryCache(storage, NOW)).toEqual([entry]);
  });

  it('falls back to no cache when storage fails', async () => {
    const storage = {
      get: vi.fn(async () => { throw new Error('unavailable'); }),
      set: vi.fn(async () => { throw new Error('unavailable'); })
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadAiSummaryCache(storage, NOW)).toEqual([]);
    expect(await saveAiSummaryCacheEntry(createEntry(), storage, NOW)).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores malformed stored values', () => {
    expect(readAiSummaryCache('nope', NOW)).toEqual([]);
    expect(readAiSummaryCache([{ question: 'x' }], NOW)).toEqual([]);
  });
});
