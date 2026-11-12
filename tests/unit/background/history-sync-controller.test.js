import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiSummaryCacheEntry } from '../../../modules/answers/ai-summary-cache.js';
import { createHistorySyncController } from '../../../background/controllers/history-sync-controller.js';

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

function createStorage({ questions = [], summaries = [] } = {}) {
  const store = {
    questionHistory: questions,
    aiSummaryCache: summaries
  };
  return {
    get: vi.fn(async defaults => ({ ...defaults, ...store })),
    set: vi.fn(async update => {
      Object.assign(store, update);
    }),
    store
  };
}

function createBridge() {
  return {
    isConnected: vi.fn(() => true),
    sendHistorySnapshot: vi.fn(),
    sendHistoryUpsert: vi.fn()
  };
}

function createSummary(question, createdAt = NOW - 1000) {
  return createAiSummaryCacheEntry({
    question,
    config: { baseUrl: 'https://api.example.com/v1', model: 'test-model' },
    language: 'zh-CN',
    panels: [{ position: 1, providerId: 'chatgpt' }],
    sources: [{ position: 1, panelId: 'p1', sourceId: 'S1' }],
    summary: {
      verdict: null,
      overview: 'Agree.',
      consensus: [],
      unique: [],
      disagreements: []
    },
    blind: false,
    formattedText: 'Verdict: agree.',
    now: createdAt
  });
}

describe('history sync controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('migrates legacy questions and sends a full snapshot on request', async () => {
    const storage = createStorage({
      questions: ['one', 'two'],
      summaries: [createSummary('two')]
    });
    const bridge = createBridge();
    const sync = createHistorySyncController({
      getNativeSendBridge: () => bridge,
      storage,
      now: () => NOW
    });

    await sync.handleHistoryRequest();

    expect(storage.store.questionHistory.every(record => typeof record === 'object')).toBe(true);
    expect(bridge.sendHistorySnapshot).toHaveBeenCalledTimes(1);
    const records = bridge.sendHistorySnapshot.mock.calls[0][0];
    expect(records.map(record => record.text)).toEqual(['one', 'two']);
    expect(records.find(record => record.text === 'two').summary.formattedText).toBe('Verdict: agree.');
  });

  it('pushes only records that changed since the snapshot', async () => {
    const storage = createStorage({
      questions: [{ key: 'one', text: 'one', createdAt: NOW - 2000, updatedAt: NOW - 2000 }]
    });
    const bridge = createBridge();
    const sync = createHistorySyncController({
      getNativeSendBridge: () => bridge,
      storage,
      now: () => NOW
    });
    await sync.handleHistoryRequest();
    bridge.sendHistoryUpsert.mockClear();

    storage.store.questionHistory = [
      ...storage.store.questionHistory,
      { key: 'two', text: 'two', createdAt: NOW - 1000, updatedAt: NOW - 1000 }
    ];
    sync.handleStorageChange({ questionHistory: { newValue: storage.store.questionHistory } });
    await vi.advanceTimersByTimeAsync(300);

    expect(bridge.sendHistoryUpsert).toHaveBeenCalledTimes(1);
    expect(bridge.sendHistoryUpsert.mock.calls[0][0].map(record => record.text)).toEqual(['two']);
  });

  it('does not push when nothing changed or after a reset', async () => {
    const storage = createStorage({
      questions: [{ key: 'one', text: 'one', createdAt: NOW - 2000, updatedAt: NOW - 2000 }]
    });
    const bridge = createBridge();
    const sync = createHistorySyncController({
      getNativeSendBridge: () => bridge,
      storage,
      now: () => NOW
    });
    await sync.handleHistoryRequest();
    bridge.sendHistoryUpsert.mockClear();

    sync.handleStorageChange({ questionHistory: { newValue: storage.store.questionHistory } });
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.sendHistoryUpsert).not.toHaveBeenCalled();

    storage.store.questionHistory = [
      { key: 'two', text: 'two', createdAt: NOW, updatedAt: NOW }
    ];
    sync.reset();
    sync.handleStorageChange({ questionHistory: { newValue: storage.store.questionHistory } });
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.sendHistoryUpsert).not.toHaveBeenCalled();
  });

  it('merges desktop questions without echoing them back', async () => {
    const storage = createStorage();
    const bridge = createBridge();
    const sync = createHistorySyncController({
      getNativeSendBridge: () => bridge,
      storage,
      now: () => NOW
    });
    await sync.handleHistoryRequest();
    bridge.sendHistoryUpsert.mockClear();

    await sync.handleHistoryUpsert({
      batchId: 'b1',
      index: 0,
      total: 1,
      records: [{
        key: 'from mac',
        text: 'From Mac',
        createdAt: NOW - 1000,
        updatedAt: NOW - 1000
      }]
    });

    expect(storage.store.questionHistory).toHaveLength(1);
    expect(storage.store.questionHistory[0].text).toBe('From Mac');

    sync.handleStorageChange({ questionHistory: { newValue: storage.store.questionHistory } });
    await vi.advanceTimersByTimeAsync(300);
    expect(bridge.sendHistoryUpsert).not.toHaveBeenCalled();
  });

  it('ignores desktop updates before a request or with no records', async () => {
    const storage = createStorage();
    const sync = createHistorySyncController({
      getNativeSendBridge: () => createBridge(),
      storage,
      now: () => NOW
    });

    await sync.handleHistoryUpsert({
      batchId: 'b1',
      index: 0,
      total: 1,
      records: [{ key: 'x', text: 'X', createdAt: NOW, updatedAt: NOW }]
    });
    expect(storage.store.questionHistory).toEqual([]);
  });
});