import { describe, expect, it } from 'vitest';
import {
  AI_SUMMARY_CACHE_TTL_MS,
  createAiSummaryCacheEntry
} from '../../../modules/answers/ai-summary-cache.js';
import {
  QUESTION_HISTORY_TTL_MS,
  readQuestionHistoryRecords
} from '../../../modules/prompts/question-history.js';
import {
  buildSyncedHistoryRecords,
  createHistoryChunks,
  historyRecordSignature,
  mergeRemoteQuestionRecords,
  readIncomingHistoryBatch,
  sanitizeSummaryForSync,
  toStoredQuestionRecords
} from '../../../modules/history/history-sync.js';

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const SUMMARY = {
  verdict: null,
  overview: 'Both answers agree.',
  consensus: [],
  unique: [],
  disagreements: []
};

function createSummaryEntry({ question, createdAt = NOW - 1000, formattedText = 'Verdict: both agree.' }) {
  return createAiSummaryCacheEntry({
    question,
    config: { baseUrl: 'https://api.example.com/v1', model: 'test-model' },
    language: 'zh-CN',
    panels: [
      { position: 1, providerId: 'chatgpt' },
      { position: 2, providerId: 'deepseek' }
    ],
    sources: [
      { position: 1, panelId: 'p1', sourceId: 'S1' },
      { position: 2, panelId: 'p2', sourceId: 'S2' }
    ],
    summary: SUMMARY,
    blind: false,
    formattedText,
    now: createdAt
  });
}

describe('sanitizeSummaryForSync', () => {
  it('keeps only blind, formatted text and creation time', () => {
    const entry = {
      ...createSummaryEntry({ question: 'q', formattedText: 'Anonymous model 1: yes' }),
      blind: true,
      baseUrl: 'https://secret',
      model: 'secret-model',
      panels: [{ position: 1, providerId: 'chatgpt' }]
    };
    expect(sanitizeSummaryForSync(entry, { maxLength: 10 })).toEqual({
      blind: true,
      formattedText: 'Anonymous ',
      createdAt: NOW - 1000
    });
  });

  it('omits legacy entries without precomputed text', () => {
    expect(sanitizeSummaryForSync({ question: 'q', createdAt: NOW })).toBeNull();
    expect(sanitizeSummaryForSync({ question: 'q', formattedText: '   ', createdAt: NOW })).toBeNull();
  });
});

describe('buildSyncedHistoryRecords', () => {
  it('joins summaries to questions by normalized text', () => {
    const records = buildSyncedHistoryRecords({
      questions: [{ key: 'how are you?', text: 'How are you?', createdAt: NOW - 5000, updatedAt: NOW }],
      summaries: [createSummaryEntry({ question: '  how are you?  ', formattedText: 'Verdict: fine' })],
      now: NOW
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      text: 'How are you?',
      createdAt: NOW - 5000,
      updatedAt: NOW
    });
    expect(records[0].summary).toEqual({
      blind: false,
      formattedText: 'Verdict: fine',
      createdAt: NOW - 1000
    });
    expect(JSON.stringify(records[0])).not.toContain('chatgpt');
    expect(JSON.stringify(records[0])).not.toContain('api.example.com');
  });

  it('keeps questions without summaries and adds summary-only records', () => {
    const records = buildSyncedHistoryRecords({
      questions: [
        { key: 'one', text: 'one', createdAt: NOW - 3000, updatedAt: NOW - 2000 }
      ],
      summaries: [
        createSummaryEntry({ question: 'two', formattedText: 'Two summary', createdAt: NOW - 1000 }),
        createSummaryEntry({ question: 'legacy', formattedText: '', createdAt: NOW - 500 })
      ],
      now: NOW
    });
    expect(records.map(record => record.text)).toEqual(['two', 'one']);
    expect(records.find(record => record.text === 'one').summary).toBeNull();
    expect(records.find(record => record.text === 'legacy')).toBeUndefined();
  });

  it('drops entries outside the three-day window', () => {
    const records = buildSyncedHistoryRecords({
      questions: [
        { key: 'stale', text: 'stale', createdAt: NOW - QUESTION_HISTORY_TTL_MS - 1, updatedAt: NOW - QUESTION_HISTORY_TTL_MS - 1 }
      ],
      summaries: [
        createSummaryEntry({ question: 'old', createdAt: NOW - AI_SUMMARY_CACHE_TTL_MS - 1 })
      ],
      now: NOW
    });
    expect(records).toEqual([]);
  });
});

describe('createHistoryChunks', () => {
  it('splits by UTF-8 bytes and record count', () => {
    const records = Array.from({ length: 5 }, (_, index) => ({
      key: `q${index}`,
      text: '中'.repeat(600),
      createdAt: NOW,
      updatedAt: NOW,
      summary: null
    }));
    const chunks = createHistoryChunks(records, { maxBytes: 4000, maxRecords: 2 });
    expect(chunks.flat()).toHaveLength(5);
    expect(chunks.every(chunk => chunk.length <= 2)).toBe(true);
    expect(chunks.every(chunk => new TextEncoder().encode(JSON.stringify(chunk)).length <= 4000 || chunk.length === 1)).toBe(true);
  });
});

describe('readIncomingHistoryBatch', () => {
  const record = {
    key: 'ignored',
    text: 'How are you?',
    createdAt: NOW - 1000,
    updatedAt: NOW
  };

  it('validates a complete batch and recomputes keys', () => {
    const batch = readIncomingHistoryBatch({
      type: 'historyUpsert',
      batchId: 'batch-1',
      index: 0,
      total: 1,
      records: [record]
    }, { now: NOW });
    expect(batch.records).toEqual([{
      key: 'how are you?',
      text: 'How are you?',
      createdAt: NOW - 1000,
      updatedAt: NOW,
      summary: null
    }]);
  });

  it('rejects malformed batches and drops invalid records', () => {
    expect(readIncomingHistoryBatch({ type: 'historySnapshot', batchId: 'b', index: 0, total: 1, records: [] }, { now: NOW })).toBeNull();
    expect(readIncomingHistoryBatch({ type: 'historyUpsert', batchId: '', index: 0, total: 1, records: [] }, { now: NOW })).toBeNull();
    expect(readIncomingHistoryBatch({ type: 'historyUpsert', batchId: 'b', index: 2, total: 1, records: [] }, { now: NOW })).toBeNull();
    const batch = readIncomingHistoryBatch({
      type: 'historyUpsert',
      batchId: 'b',
      index: 0,
      total: 1,
      records: [record, { text: '   ' }, null]
    }, { now: NOW });
    expect(batch.records).toHaveLength(1);
  });
});

describe('mergeRemoteQuestionRecords', () => {
  it('merges by key, keeps the earliest creation and newest update', () => {
    const merged = mergeRemoteQuestionRecords(
      [{ key: 'one', text: 'One', createdAt: NOW - 5000, updatedAt: NOW - 4000 }],
      [
        { key: 'one', text: 'one', createdAt: NOW - 3000, updatedAt: NOW },
        { key: 'two', text: 'Two', createdAt: NOW - 2000, updatedAt: NOW - 2000 }
      ],
      { now: NOW }
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      key: 'one',
      text: 'one',
      createdAt: NOW - 5000,
      updatedAt: NOW
    });
    expect(merged[1].text).toBe('Two');
  });

  it('converts to storage records without summaries', () => {
    const stored = toStoredQuestionRecords([{
      key: 'one',
      text: 'One',
      createdAt: NOW,
      updatedAt: NOW,
      summary: { blind: false, formattedText: 'x', createdAt: NOW }
    }]);
    expect(stored).toEqual([{ key: 'one', text: 'One', createdAt: NOW, updatedAt: NOW }]);
  });
});

describe('historyRecordSignature', () => {
  it('changes when text, update time or summary change', () => {
    const record = readQuestionHistoryRecords([
      { text: 'one', createdAt: NOW, updatedAt: NOW }
    ], { now: NOW })[0];
    const signature = historyRecordSignature(record);
    expect(historyRecordSignature({ ...record, text: 'One' })).not.toBe(signature);
    expect(historyRecordSignature({ ...record, updatedAt: NOW + 1 })).not.toBe(signature);
    expect(historyRecordSignature({
      ...record,
      summary: { blind: false, formattedText: 'x', createdAt: NOW }
    })).not.toBe(signature);
    expect(historyRecordSignature({
      ...record,
      summary: { blind: false, formattedText: 'x', createdAt: NOW }
    })).not.toBe(historyRecordSignature({
      ...record,
      summary: { blind: false, formattedText: 'y', createdAt: NOW }
    }));
  });
});