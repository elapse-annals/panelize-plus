// Builds the 3-day question/summary history shared with the macOS client.
// Only the precomputed summary text and its blind flag cross the native bridge;
// provider IDs, API endpoints, models and panel positions stay in the browser.

import {
  AI_SUMMARY_CACHE_TTL_MS,
  isAiSummaryCacheEntryFresh,
  isAiSummaryCacheEntryValid
} from '../answers/ai-summary-cache.js';
import {
  QUESTION_HISTORY_TTL_MS,
  normalizeQuestionText,
  questionKey,
  readQuestionHistoryRecords
} from '../prompts/question-history.js';

export const HISTORY_SYNC_MAX_TEXT_LENGTH = 20000;
export const HISTORY_SYNC_MAX_SUMMARY_LENGTH = 150000;
export const HISTORY_SYNC_MAX_RECORDS_PER_CHUNK = 50;
export const HISTORY_SYNC_CHUNK_BYTES = 60 * 1024;
export const HISTORY_SYNC_MAX_CHUNKS = 128;
export const HISTORY_SYNC_MAX_BATCH_ID_LENGTH = 100;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).length;
}

function validTimestamp(value) {
  return Number.isFinite(value) && value > 0 ? Number(value) : 0;
}

function normalizeTimestamp(value, now) {
  const timestamp = validTimestamp(value);
  if (!timestamp) return 0;
  return timestamp > now + CLOCK_SKEW_MS ? now : timestamp;
}

function isFresh(timestamp, now, ttl) {
  if (!validTimestamp(timestamp)) return false;
  const age = now - timestamp;
  return age >= -CLOCK_SKEW_MS && age <= ttl;
}

/** The only summary fields allowed to leave the browser. */
export function sanitizeSummaryForSync(entry, { maxLength = HISTORY_SYNC_MAX_SUMMARY_LENGTH } = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const formattedText = typeof entry.formattedText === 'string'
    ? entry.formattedText.slice(0, maxLength)
    : '';
  if (!formattedText.trim()) return null;
  const createdAt = validTimestamp(entry.createdAt);
  if (!createdAt) return null;
  return {
    blind: entry.blind === true,
    formattedText,
    createdAt
  };
}

function buildRecord({ text, createdAt, updatedAt, summary }, { now, ttl }) {
  const normalizedText = normalizeQuestionText(text).slice(0, HISTORY_SYNC_MAX_TEXT_LENGTH);
  const key = questionKey(normalizedText);
  if (!key) return null;
  const created = normalizeTimestamp(createdAt, now);
  const updated = normalizeTimestamp(updatedAt, now) || created;
  if (!created || !updated || !isFresh(updated, now, ttl)) return null;
  return {
    key,
    text: normalizedText,
    createdAt: Math.min(created, updated),
    updatedAt: updated,
    summary: sanitizeSummaryForSync(summary)
  };
}

/**
 * Joins question history with cached summaries by normalized question text.
 * A question without a summary stays in the list; a summary whose question is
 * missing from history becomes its own record.
 */
export function buildSyncedHistoryRecords({
  questions,
  summaries,
  now = Date.now(),
  ttl = QUESTION_HISTORY_TTL_MS
} = {}) {
  const records = new Map();
  for (const record of readQuestionHistoryRecords(questions, { now, ttl })) {
    // Reuse the same caps as summary-only records so one very long prompt
    // cannot push a chunk toward the native frame limit.
    const synced = buildRecord({
      text: record.text,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }, { now, ttl });
    if (synced) {
      records.set(synced.key, synced);
    }
  }

  const summaryTtl = Math.min(ttl, AI_SUMMARY_CACHE_TTL_MS);
  const latestSummaries = new Map();
  for (const entry of Array.isArray(summaries) ? summaries : []) {
    if (!isAiSummaryCacheEntryValid(entry) || !isAiSummaryCacheEntryFresh(entry, now, summaryTtl)) {
      continue;
    }
    const summary = sanitizeSummaryForSync(entry);
    const summaryText = normalizeQuestionText(entry.question).slice(0, HISTORY_SYNC_MAX_TEXT_LENGTH);
    const key = questionKey(summaryText);
    if (!summary || !key) continue;
    const existing = latestSummaries.get(key);
    if (!existing || summary.createdAt > existing.summary.createdAt) {
      latestSummaries.set(key, { key, text: summaryText, summary });
    }
  }

  for (const { key, text: summaryText, summary } of latestSummaries.values()) {
    const existing = records.get(key);
    if (existing) {
      if (!existing.summary || summary.createdAt > existing.summary.createdAt) {
        existing.summary = summary;
      }
      continue;
    }
    const record = {
      key,
      text: summaryText,
      createdAt: summary.createdAt,
      updatedAt: summary.createdAt,
      summary
    };
    if (record.text && isFresh(record.updatedAt, now, summaryTtl)) {
      records.set(key, record);
    }
  }

  return [...records.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

/** A stable string for incremental push comparison. */
export function historyRecordSignature(record) {
  return JSON.stringify([
    record?.key || '',
    record?.text || '',
    Number(record?.updatedAt) || 0,
    Number(record?.summary?.createdAt) || 0,
    record?.summary?.blind === true,
    record?.summary?.formattedText || ''
  ]);
}

/**
 * Splits records into frames that stay well under the native bridge's 1 MiB
 * limit. Byte size is measured as UTF-8, not JavaScript string length.
 */
export function createHistoryChunks(
  records,
  {
    maxBytes = HISTORY_SYNC_CHUNK_BYTES,
    maxRecords = HISTORY_SYNC_MAX_RECORDS_PER_CHUNK
  } = {}
) {
  const chunks = [];
  let current = [];
  let currentBytes = 2;
  for (const record of Array.isArray(records) ? records : []) {
    const bytes = utf8ByteLength(JSON.stringify(record)) + 1;
    if (current.length && (currentBytes + bytes > maxBytes || current.length >= maxRecords)) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(record);
    currentBytes += bytes;
  }
  if (current.length) chunks.push(current);
  // Records are newest first; if an extreme history exceeds the receiver's
  // chunk limit, keep the newest chunks instead of failing the whole snapshot.
  return chunks.slice(0, HISTORY_SYNC_MAX_CHUNKS);
}

/** Validates one record from the wire and recomputes its merge key. */
export function readSyncedHistoryRecord(value, { now = Date.now(), ttl = QUESTION_HISTORY_TTL_MS } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return buildRecord({
    text: value.text,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    summary: value.summary
  }, { now, ttl });
}

/** Validates one desktop-to-extension upsert batch. */
export function readIncomingHistoryBatch(
  message,
  { now = Date.now(), ttl = QUESTION_HISTORY_TTL_MS } = {}
) {
  if (!message || typeof message !== 'object' || message.type !== 'historyUpsert') {
    return null;
  }
  const batchId = typeof message.batchId === 'string' ? message.batchId.trim() : '';
  if (!batchId || batchId.length > HISTORY_SYNC_MAX_BATCH_ID_LENGTH) return null;
  const index = Number(message.index);
  const total = Number(message.total);
  if (!Number.isInteger(index) || !Number.isInteger(total)) return null;
  if (index < 0 || total < 1 || index >= total || total > HISTORY_SYNC_MAX_CHUNKS) return null;
  if (!Array.isArray(message.records) || message.records.length > HISTORY_SYNC_MAX_RECORDS_PER_CHUNK) {
    return null;
  }
  const records = message.records
    .map(record => readSyncedHistoryRecord(record, { now, ttl }))
    .filter(Boolean);
  return { batchId, index, total, records };
}

/**
 * Merges questions typed in the desktop client into extension history. Summary
 * fields are ignored: summaries originate in the extension.
 */
export function mergeRemoteQuestionRecords(
  value,
  records,
  { now = Date.now(), ttl = QUESTION_HISTORY_TTL_MS } = {}
) {
  const merged = new Map();
  for (const record of readQuestionHistoryRecords(value, { now, ttl })) {
    merged.set(record.key, record);
  }

  for (const record of Array.isArray(records) ? records : []) {
    const incoming = buildRecord({
      text: record?.text,
      createdAt: record?.createdAt,
      updatedAt: record?.updatedAt
    }, { now, ttl });
    if (!incoming) continue;
    const existing = merged.get(incoming.key);
    if (!existing) {
      merged.set(incoming.key, incoming);
      continue;
    }
    const updatedAt = Math.max(existing.updatedAt, incoming.updatedAt);
    const newer = incoming.updatedAt > existing.updatedAt ? incoming : existing;
    merged.set(incoming.key, {
      key: incoming.key,
      text: newer.text,
      createdAt: Math.min(existing.createdAt, incoming.createdAt),
      updatedAt
    });
  }

  return [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

/** Storage-shaped records only (no summary), ready for questionHistory. */
export function toStoredQuestionRecords(records) {
  return records.map(record => ({
    key: record.key,
    text: record.text,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }));
}