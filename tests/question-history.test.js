import { describe, expect, it, vi } from 'vitest';
import {
  QUESTION_HISTORY_STORAGE_KEY,
  findQuestionHistoryMatches,
  loadQuestionHistory,
  mergeQuestionHistory,
  normalizeQuestionText,
  readQuestionHistory,
  recordQuestion
} from '../modules/question-history.js';

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
  });
});

describe('readQuestionHistory', () => {
  it('keeps distinct questions, newest first, at most three', () => {
    expect(readQuestionHistory(['a', 'A', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
    expect(readQuestionHistory([{ text: ' trimmed ' }, null, 42])).toEqual(['trimmed']);
    expect(readQuestionHistory('not an array')).toEqual([]);
  });
});

describe('mergeQuestionHistory', () => {
  it('moves a repeated question to the front without duplicating it', () => {
    const first = mergeQuestionHistory([], 'What is AI?');
    const second = mergeQuestionHistory(first, 'How does it work?');
    const third = mergeQuestionHistory(second, 'what is ai?');
    expect(third).toEqual(['what is ai?', 'How does it work?']);
  });

  it('drops the oldest entry after three questions', () => {
    let entries = [];
    ['one', 'two', 'three', 'four'].forEach(text => {
      entries = mergeQuestionHistory(entries, text);
    });
    expect(entries).toEqual(['four', 'three', 'two']);
  });

  it('ignores empty text', () => {
    expect(mergeQuestionHistory(['kept'], '   ')).toEqual(['kept']);
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

  it('caps the number of suggestions', () => {
    const many = ['one', 'one two', 'one three', 'one four'];
    expect(findQuestionHistoryMatches(many, 'one', 2)).toEqual(['one two', 'one three']);
  });
});

describe('question history storage', () => {
  it('loads and records questions in local storage', async () => {
    const storage = createStorage(['older']);
    expect(await loadQuestionHistory(storage)).toEqual(['older']);

    const entries = await recordQuestion('new question', storage);
    expect(entries).toEqual(['new question', 'older']);
    expect(storage.store[QUESTION_HISTORY_STORAGE_KEY]).toEqual(['new question', 'older']);
  });

  it('degrades to an empty list when storage fails', async () => {
    const storage = {
      get: vi.fn(async () => { throw new Error('unavailable'); }),
      set: vi.fn(async () => { throw new Error('unavailable'); })
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadQuestionHistory(storage)).toEqual([]);
    expect(await recordQuestion('question', storage)).toEqual(['question']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores empty questions', async () => {
    const storage = createStorage(['kept']);
    expect(await recordQuestion('   ', storage)).toEqual([]);
    expect(storage.set).not.toHaveBeenCalled();
  });
});
