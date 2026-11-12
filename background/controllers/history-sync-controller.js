/**
 * Keeps the desktop client's three-day history in step with the extension.
 * A snapshot is sent after the desktop asks for one; later changes are pushed
 * as incremental upserts. All state is rebuildable, so a restarted service
 * worker self-heals on the next request.
 */
import { AI_SUMMARY_CACHE_STORAGE_KEY } from '../../modules/answers/ai-summary-cache.js';
import {
  QUESTION_HISTORY_STORAGE_KEY,
  migrateQuestionHistoryStorage
} from '../../modules/prompts/question-history.js';
import {
  buildSyncedHistoryRecords,
  historyRecordSignature,
  mergeRemoteQuestionRecords,
  toStoredQuestionRecords
} from '../../modules/history/history-sync.js';

function defaultStorage() {
  return typeof chrome !== 'undefined' ? chrome.storage?.local : null;
}

export function createHistorySyncController({
  getNativeSendBridge,
  storage = defaultStorage(),
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  debounceMs = 300
} = {}) {
  let desktopListening = false;
  let migrated = false;
  let pushTimer = null;
  const lastSignatures = new Map();

  async function readStores() {
    if (!storage?.get) return { questions: [], summaries: [] };
    try {
      const result = await storage.get({
        [QUESTION_HISTORY_STORAGE_KEY]: [],
        [AI_SUMMARY_CACHE_STORAGE_KEY]: []
      });
      return {
        questions: result?.[QUESTION_HISTORY_STORAGE_KEY] ?? [],
        summaries: result?.[AI_SUMMARY_CACHE_STORAGE_KEY] ?? []
      };
    } catch (error) {
      console.warn('[Panelize] Could not read history for sync:', error);
      return { questions: [], summaries: [] };
    }
  }

  async function buildRecords(nowMillis = now()) {
    const { questions, summaries } = await readStores();
    return buildSyncedHistoryRecords({ questions, summaries, now: nowMillis });
  }

  function rememberAll(records) {
    lastSignatures.clear();
    for (const record of records) {
      lastSignatures.set(record.key, historyRecordSignature(record));
    }
  }

  async function handleHistoryRequest() {
    desktopListening = true;
    if (!migrated) {
      migrated = true;
      await migrateQuestionHistoryStorage(storage, now());
    }
    const records = await buildRecords();
    rememberAll(records);
    getNativeSendBridge()?.sendHistorySnapshot(records);
  }

  function schedulePush() {
    if (!desktopListening || pushTimer) return;
    pushTimer = setTimeoutFn(() => {
      pushTimer = null;
      void pushChanges();
    }, debounceMs);
  }

  async function pushChanges() {
    if (!desktopListening) return;
    const bridge = getNativeSendBridge();
    if (!bridge?.isConnected?.()) return;

    const records = await buildRecords();
    const changed = [];
    const nextSignatures = new Map();
    for (const record of records) {
      const signature = historyRecordSignature(record);
      nextSignatures.set(record.key, signature);
      if (lastSignatures.get(record.key) !== signature) {
        changed.push(record);
      }
    }
    lastSignatures.clear();
    nextSignatures.forEach((signature, key) => lastSignatures.set(key, signature));
    if (changed.length) {
      bridge.sendHistoryUpsert(changed);
    }
  }

  /** Merges questions typed on the Mac. Summaries always originate here. */
  async function handleHistoryUpsert(batch) {
    if (!desktopListening || !batch?.records?.length || !storage?.get || !storage?.set) {
      return;
    }
    try {
      const result = await storage.get({ [QUESTION_HISTORY_STORAGE_KEY]: [] });
      const merged = mergeRemoteQuestionRecords(
        result?.[QUESTION_HISTORY_STORAGE_KEY] ?? [],
        batch.records,
        { now: now() }
      );
      await storage.set({
        [QUESTION_HISTORY_STORAGE_KEY]: toStoredQuestionRecords(merged)
      });
      // Seed signatures from the merged stores so the storage listener does
      // not echo this write straight back to the desktop.
      const records = await buildRecords();
      rememberAll(records);
    } catch (error) {
      console.warn('[Panelize] Could not merge desktop question history:', error);
    }
  }

  function handleStorageChange(changes) {
    if (!changes) return;
    if (changes[QUESTION_HISTORY_STORAGE_KEY] || changes[AI_SUMMARY_CACHE_STORAGE_KEY]) {
      schedulePush();
    }
  }

  function reset() {
    desktopListening = false;
    if (pushTimer) {
      clearTimeoutFn(pushTimer);
      pushTimer = null;
    }
    lastSignatures.clear();
  }

  return {
    buildRecords,
    handleHistoryRequest,
    handleHistoryUpsert,
    handleStorageChange,
    pushChanges,
    reset,
    schedulePush
  };
}