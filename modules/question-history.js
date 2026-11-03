// Recent questions for the composer's prefix suggestions. The history stays in
// this browser profile (chrome.storage.local) and is never synced or sent out.

export const QUESTION_HISTORY_STORAGE_KEY = 'questionHistory';
export const MAX_QUESTION_HISTORY = 3;

/** The question as stored: one line ending style, no outer whitespace. */
export function normalizeQuestionText(text) {
  return typeof text === 'string' ? text.replace(/\r\n?/g, '\n').trim() : '';
}

function questionKey(text) {
  return normalizeQuestionText(text).toLowerCase();
}

/** Reads a stored value into at most three distinct questions, newest first. */
export function readQuestionHistory(value) {
  if (!Array.isArray(value)) return [];
  const entries = [];
  for (const item of value) {
    const text = normalizeQuestionText(typeof item === 'string' ? item : item?.text);
    if (!text || entries.some(entry => questionKey(entry) === questionKey(text))) continue;
    entries.push(text);
    if (entries.length >= MAX_QUESTION_HISTORY) break;
  }
  return entries;
}

/** Moves `text` to the front, dropping an older copy of the same question. */
export function mergeQuestionHistory(entries, text) {
  const current = readQuestionHistory(entries);
  const next = normalizeQuestionText(text);
  if (!next) return current;
  return [next, ...current.filter(entry => questionKey(entry) !== questionKey(next))]
    .slice(0, MAX_QUESTION_HISTORY);
}

/**
 * Questions that start with what is typed so far, ignoring case and outer
 * whitespace. The exact current draft is left out so filling a suggestion does
 * not immediately offer the same text again.
 */
export function findQuestionHistoryMatches(entries, draft, limit = MAX_QUESTION_HISTORY) {
  const prefix = questionKey(draft);
  if (!prefix) return [];
  return readQuestionHistory(entries)
    .filter(entry => {
      const key = questionKey(entry);
      return key !== prefix && key.startsWith(prefix);
    })
    .slice(0, limit);
}

function defaultStorage() {
  return typeof chrome !== 'undefined' ? chrome.storage?.local : null;
}

export async function loadQuestionHistory(storage = defaultStorage()) {
  if (!storage?.get) return [];
  try {
    const result = await storage.get({ [QUESTION_HISTORY_STORAGE_KEY]: [] });
    return readQuestionHistory(result?.[QUESTION_HISTORY_STORAGE_KEY]);
  } catch (error) {
    console.warn('[Panelize] Could not read question history:', error);
    return [];
  }
}

// One read-modify-write at a time in this page, so two quick sends cannot
// overwrite each other with the same starting list.
let writeQueue = Promise.resolve();

export function recordQuestion(text, storage = defaultStorage()) {
  const next = normalizeQuestionText(text);
  if (!next || !storage?.get || !storage?.set) return Promise.resolve([]);
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const entries = mergeQuestionHistory(await loadQuestionHistory(storage), next);
    try {
      await storage.set({ [QUESTION_HISTORY_STORAGE_KEY]: entries });
    } catch (error) {
      console.warn('[Panelize] Could not save question history:', error);
    }
    return entries;
  });
  return writeQueue;
}
