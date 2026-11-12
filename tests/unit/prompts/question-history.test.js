import { describe, expect, it, vi } from 'vitest';
import {
  QUESTION_HISTORY_STORAGE_KEY,
  QUESTION_HISTORY_TTL_MS,
  findQuestionHistoryMatches,
  loadQuestionHistory,
  loadQuestionHistoryRecords,
  mergeQuestionHistory,
  mergeQuestionHistoryRecords,
  migrateQuestionHistoryStorage,
  normalizeQuestionText,
  questionKey,
  readQuestionHistory,
  readQuestionHistoryRecords,
  recordQuestion
} from '../../../modules/prompts/question-history.js';

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

function createStorage(initial = null) {
  const store = { [QUESTION_HISTORY_STORAGE_KEY]: initial };
  return {
    get: vi.fn(async defaults => ({ ...defaults, [QUESTION_HISTORY_STORAGE_KEY]: store[QUESTION_HISTORY_STORAGE_KEY] ?? [] })),
    set: vi.fn(async update => {
      Object.assign(store, update);
    }),
    store
  };
}

describe('normalizeQuestionText', () => {
  it('normalizes line endings and trims outer whitespace', () => {
    expect(normalizeQuestionText('  How are\r\nthey?\r  ')).toBe('How are\nthey?');
    expect(normalizeQuestionText(null)).toBe('');
    expect(normalizeQuestionText('   ')).toBe('');
    expect(questionKey('  How Are ')).toBe('how are');
  });
});

describe('readQuestionHistoryRecords', () => {
  it('migrates legacy strings with timestamps and keeps the newest first', () => {
    const records = readQuestionHistoryRecords(['first', 'second'], { now: NOW });
    expect(records).toEqual([
      { key: 'first', text: 'first', createdAt: NOW, updatedAt: NOW },
      { key: 'second', text: 'second', createdAt: NOW - 1, updatedAt: NOW - 1 }
    ]);
    expect(readQuestionHistory(records, { now: NOW })).toEqual(['first', 'second']);
  });

  it('does not cap the stored list at three entries', () => {
    const stored = ['one', 'two', 'three', 'four', 'five'].map((text, index) => ({
      key: text,
      text,
      createdAt: NOW - index * 1000,
      updatedAt: NOW - index * 1000
    }));
    expect(readQuestionHistoryRecords(stored, { now: NOW })).toHaveLength(5);
  });

  it('dedupes case-insensitively and keeps the newest copy', () => {
    const records = readQuestionHistoryRecords([
      { text: 'First', createdAt: NOW - 5000, updatedAt: NOW - 4000 },
      { text: 'first', createdAt: NOW - 3000, updatedAt: NOW - 1000 }
    ], { now: NOW });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ text: 'first', createdAt: NOW - 5000, updatedAt: NOW - 1000 });
  });

  it('drops entries older than three days and ignores invalid values', () => {
    const records = readQuestionHistoryRecords([
      { text: 'fresh', createdAt: NOW - 1000, updatedAt: NOW - 1000 },
      { text: 'stale', createdAt: NOW - QUESTION_HISTORY_TTL_MS - 1, updatedAt: NOW - QUESTION_HISTORY_TTL_MS - 1 },
      { text: '   ' },
      null,
      42
    ], { now: NOW });
    expect(records.map(record => record.text)).toEqual(['fresh']);
  });

  it('accepts an entry exactly at the TTL boundary', () => {
    const records = readQuestionHistoryRecords([
      { text: 'edge', createdAt: NOW - QUESTION_HISTORY_TTL_MS, updatedAt: NOW - QUESTION_HISTORY_TTL_MS }
    ], { now: NOW });
    expect(records.map(record => record.text)).toEqual(['edge']);
  });
});

describe('mergeQuestionHistoryRecords', () => {
  it('moves a repeated question to the front, preserving its creation time', () => {
    let records = mergeQuestionHistoryRecords([], 'What is AI?', NOW - 2000);
    records = mergeQuestionHistoryRecords(records, 'How does it work?', NOW - 1000);
    records = mergeQuestionHistoryRecords(records, 'what is ai?', NOW);
    expect(records.map(record => record.text)).toEqual(['what is ai?', 'How does it work?']);
    expect(records[0].createdAt).toBe(NOW - 2000);
    expect(records[0].updatedAt).toBe(NOW);
  });

  it('keeps every question inside the three-day window', () => {
    let records = [];
    ['one', 'two', 'three', 'four'].forEach((text, index) => {
      records = mergeQuestionHistoryRecords(records, text, NOW - 3000 + index * 1000);
    });
    expect(records.map(record => record.text)).toEqual(['four', 'three', 'two', 'one']);
  });

  it('ignores empty text and keeps the string helper compatible', () => {
    expect(mergeQuestionHistory(['kept'], '   ', NOW)).toEqual(['kept']);
    expect(mergeQuestionHistoryRecords([], '', NOW)).toEqual([]);
  });
});

describe('findQuestionHistoryMatches', () => {
  const entries = ['How do these compare?', 'How does it work?', '什么是人工智能？'];

  it('matches a case-insensitive prefix and ignores outer whitespace', () => {
    expect(findQuestionHistoryMatches(entries, '  how d')).toEqual([
      'How do these compare?',
      'How does it work?'
    ]);
  });

  it('matches a Chinese prefix', () => {
    expect(findQuestionHistoryMatches(entries, '什么是')).toEqual(['什么是人工智能？']);
  });

  it('returns nothing for an empty draft or no match', () => {
    expect(findQuestionHistoryMatches(entries, '   ')).toEqual([]);
    expect(findQuestionHistoryMatches(entries, 'why')).toEqual([]);
  });

  it('does not offer a question identical to the draft', () => {
    expect(findQuestionHistoryMatches(entries, 'How does it work?')).toEqual([]);
    expect(findQuestionHistoryMatches(entries, 'how does it work?')).toEqual([]);
  });

  it('caps suggestions at three by default and accepts explicit limits', () => {
    const many = ['one', 'one two', 'one three', 'one four', 'one five'];
    expect(findQuestionHistoryMatches(many, 'one')).toEqual(['one two', 'one three', 'one four']);
    expect(findQuestionHistoryMatches(many, 'one', 2)).toEqual(['one two', 'one three']);
  });

  it('skips expired records', () => {
    const stored = [{
      key: 'old question',
      text: 'old question',
      createdAt: NOW - QUESTION_HISTORY_TTL_MS - 1,
      updatedAt: NOW - QUESTION_HISTORY_TTL_MS - 1
    }];
    expect(findQuestionHistoryMatches(stored, 'old', 3, { now: NOW })).toEqual([]);
  });
});

describe('question history storage', () => {
  it('loads and records questions as timestamped records', async () => {
    const storage = createStorage(['older']);
    expect(await loadQuestionHistory(storage, NOW)).toEqual(['older']);

    const entries = await recordQuestion('new question', storage, NOW);
    expect(entries).toEqual(['new question', 'older']);
    expect(storage.store[QUESTION_HISTORY_STORAGE_KEY]).toEqual([
      { key: 'new question', text: 'new question', createdAt: NOW, updatedAt: NOW },
      { key: 'older', text: 'older', createdAt: NOW, updatedAt: NOW }
    ]);
  });

  it('prunes expired records when writing', async () => {
    const stale = {
      key: 'stale',
      text: 'stale',
      createdAt: NOW - QUESTION_HISTORY_TTL_MS - 1,
      updatedAt: NOW - QUESTION_HISTORY_TTL_MS - 1
    };
    const storage = createStorage([stale]);
    expect(await recordQuestion('fresh', storage, NOW)).toEqual(['fresh']);
    expect(storage.store[QUESTION_HISTORY_STORAGE_KEY].map(record => record.text)).toEqual(['fresh']);
  });

  it('persists migrated legacy strings once', async () => {
    const storage = createStorage(['one', 'two']);
    const records = await migrateQuestionHistoryStorage(storage, NOW);
    expect(records.map(record => record.text)).toEqual(['one', 'two']);
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(await loadQuestionHistoryRecords(storage, NOW)).toHaveLength(2);
  });

  it('does not rewrite already migrated records', async () => {
    const storage = createStorage([
      { key: 'one', text: 'one', createdAt: NOW - 100, updatedAt: NOW - 100 }
    ]);
    await migrateQuestionHistoryStorage(storage, NOW);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('degrades to an empty list when storage fails', async () => {
    const storage = {
      get: vi.fn(async () => { throw new Error('unavailable'); }),
      set: vi.fn(async () => { throw new Error('unavailable'); })
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadQuestionHistory(storage, NOW)).toEqual([]);
    expect(await recordQuestion('question', storage, NOW)).toEqual(['question']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('retries with the newest half when the full list cannot be written', async () => {
    const storage = createStorage();
    storage.set
      .mockImplementationOnce(async () => { throw new Error('quota'); })
      .mockImplementationOnce(async update => {
        Object.assign(storage.store, update);
      });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await recordQuestion('question', storage, NOW);
    expect(storage.set).toHaveBeenCalledTimes(2);
    expect(storage.store[QUESTION_HISTORY_STORAGE_KEY]).toHaveLength(1);
    warn.mockRestore();
  });

  it('ignores empty questions', async () => {
    const storage = createStorage(['kept']);
    expect(await recordQuestion('   ', storage, NOW)).toEqual([]);
    expect(storage.set).not.toHaveBeenCalled();
  });
});