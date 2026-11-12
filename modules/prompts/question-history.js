// Recent questions for the composer's prefix suggestions and the desktop
// client's history browser. Records stay in this browser profile
// (chrome.storage.local) for three days and are also mirrored to Panelize Link
// over the local native bridge; nothing is sent to a third-party server.

export const QUESTION_HISTORY_STORAGE_KEY = 'questionHistory';
export const QUESTION_HISTORY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
// At most three rows are offered as inline prefix suggestions. Storage itself
// keeps every question from the last three days.
export const MAX_QUESTION_HISTORY = 3;

const MAX_HISTORY_TEXT_LENGTH = 100000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** The question as stored: one line ending style, no outer whitespace. */
export function normalizeQuestionText(text) {
  return typeof text === 'string' ? text.replace(/\r\n?/g, '\n').trim() : '';
}

/** Stable merge key shared with the macOS client. */
export function questionKey(text) {
  return normalizeQuestionText(text).toLowerCase();
}

function validTimestamp(value) {
  return Number.isFinite(value) && value > 0 ? Number(value) : 0;
}

function isFresh(timestamp, now, ttl) {
  if (!validTimestamp(timestamp)) return false;
  const age = now - timestamp;
  return age >= -CLOCK_SKEW_MS && age <= ttl;
}

function createRecord(text, createdAt, updatedAt, now) {
  const normalized = normalizeQuestionText(text).slice(0, MAX_HISTORY_TEXT_LENGTH);
  if (!normalized) return null;
  const key = questionKey(normalized);
  if (!key) return null;
  const created = validTimestamp(createdAt);
  const updated = validTimestamp(updatedAt) || created || now;
  return {
    key,
    text: normalized,
    createdAt: created && created <= updated ? created : updated,
    updatedAt: updated
  };
}

/**
 * Reads a stored value into records, newest first. Legacy string entries and
 * records without timestamps are treated as just-seen so a first read cannot
 * expire the old three-item list; callers that can write should persist the
 * result (see migrateQuestionHistoryStorage).
 */
export function readQuestionHistoryRecords(
  value,
  { now = Date.now(), ttl = QUESTION_HISTORY_TTL_MS } = {}
) {
  if (!Array.isArray(value)) return [];
  const records = [];
  value.forEach((item, index) => {
    const text = normalizeQuestionText(typeof item === 'string' ? item : item?.text);
    if (!text) return;
    const fallback = now - index;
    const createdAt = typeof item === 'object' && item ? validTimestamp(item.createdAt) : 0;
    const updatedAt = typeof item === 'object' && item ? validTimestamp(item.updatedAt) : 0;
    const record = createRecord(text, createdAt || fallback, updatedAt || fallback, now);
    if (!record || !isFresh(record.updatedAt, now, ttl)) return;
    const existingIndex = records.findIndex(candidate => candidate.key === record.key);
    if (existingIndex < 0) {
      records.push(record);
      return;
    }
    const existing = records[existingIndex];
    const createdAtMillis = Math.min(existing.createdAt, record.createdAt);
    records[existingIndex] = record.updatedAt > existing.updatedAt
      ? { ...record, createdAt: createdAtMillis }
      : { ...existing, createdAt: createdAtMillis };
  });
  return records.sort((left, right) => right.updatedAt - left.updatedAt);
}

/** Reads the stored value into question texts, newest first. */
export function readQuestionHistory(value, options) {
  return readQuestionHistoryRecords(value, options).map(record => record.text);
}

/** Adds a question to a record list, moving a repeated question to the front. */
export function mergeQuestionHistoryRecords(entries, text, now = Date.now()) {
  const current = readQuestionHistoryRecords(entries, { now });
  const next = normalizeQuestionText(text);
  if (!next) return current;
  const key = questionKey(next);
  const existing = current.find(record => record.key === key);
  const record = createRecord(next, existing?.createdAt, now, now);
  if (!record) return current;
  return [record, ...current.filter(candidate => candidate.key !== key)]
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

// Kept for callers that only need the text list.
export function mergeQuestionHistory(entries, text, now = Date.now()) {
  return mergeQuestionHistoryRecords(entries, text, now).map(record => record.text);
}

/**
 * Questions that start with what is typed so far, ignoring case and outer
 * whitespace. The exact current draft is left out so filling a suggestion does
 * not immediately offer the same text again.
 */
export function findQuestionHistoryMatches(
  entries,
  draft,
  limit = MAX_QUESTION_HISTORY,
  { now = Date.now(), ttl = QUESTION_HISTORY_TTL_MS } = {}
) {
  const prefix = questionKey(draft);
  if (!prefix) return [];
  return readQuestionHistoryRecords(entries, { now, ttl })
    .filter(record => record.key !== prefix && record.key.startsWith(prefix))
    .slice(0, limit)
    .map(record => record.text);
}

function defaultStorage() {
  return typeof chrome !== 'undefined' ? chrome.storage?.local : null;
}

async function readRaw(storage) {
  return (await storage.get({ [QUESTION_HISTORY_STORAGE_KEY]: [] }))?.[QUESTION_HISTORY_STORAGE_KEY] ?? [];
}

export async function loadQuestionHistoryRecords(
  storage = defaultStorage(),
  now = Date.now(),
  ttl = QUESTION_HISTORY_TTL_MS
) {
  if (!storage?.get) return [];
  try {
    return readQuestionHistoryRecords(await readRaw(storage), { now, ttl });
  } catch (error) {
    console.warn('[Panelize] Could not read question history:', error);
    return [];
  }
}

export async function loadQuestionHistory(storage = defaultStorage(), now = Date.now(), ttl = QUESTION_HISTORY_TTL_MS) {
  return (await loadQuestionHistoryRecords(storage, now, ttl)).map(record => record.text);
}

/**
 * Persists legacy string entries as timestamped records once, so the 72-hour
 * window actually starts instead of being re-extended on every read.
 */
export async function migrateQuestionHistoryStorage(
  storage = defaultStorage(),
  now = Date.now(),
  ttl = QUESTION_HISTORY_TTL_MS
) {
  if (!storage?.get || !storage?.set) return [];
  try {
    const raw = await readRaw(storage);
    const records = readQuestionHistoryRecords(raw, { now, ttl });
    const migrated = Array.isArray(raw)
      && raw.some(item => typeof item === 'string' || !validTimestamp(item?.updatedAt));
    if (migrated && records.length) {
      await storage.set({ [QUESTION_HISTORY_STORAGE_KEY]: records });
    }
    return records;
  } catch (error) {
    console.warn('[Panelize] Could not migrate question history:', error);
    return [];
  }
}

// One read-modify-write at a time in this page, so two quick sends cannot
// overwrite each other with the same starting list.
let writeQueue = Promise.resolve();

async function writeRecords(storage, records) {
  try {
    await storage.set({ [QUESTION_HISTORY_STORAGE_KEY]: records });
    return true;
  } catch (error) {
    // A corrupt or oversized entry must not block recording new questions.
    const newestHalf = records.slice(0, Math.max(1, Math.ceil(records.length / 2)));
    try {
      await storage.set({ [QUESTION_HISTORY_STORAGE_KEY]: newestHalf });
      return true;
    } catch (retryError) {
      console.warn('[Panelize] Could not save question history:', error);
      return false;
    }
  }
}

export function recordQuestion(text, storage = defaultStorage(), now = Date.now()) {
  const next = normalizeQuestionText(text);
  if (!next || !storage?.get || !storage?.set) return Promise.resolve([]);
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const entries = mergeQuestionHistoryRecords(await loadQuestionHistoryRecords(storage, now), next, now);
    await writeRecords(storage, entries);
    return entries.map(record => record.text);
  });
  return writeQueue;
}