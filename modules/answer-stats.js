// Answer stats: response speed and adopted answer for each question sent to
// several providers at once. Kept in its own local IndexedDB database; nothing
// leaves the browser.

const DB_NAME = 'PanelizeAnswerStatsDB';
const DB_VERSION = 1;
const ROUNDS_STORE = 'rounds';

// Providers whose content script reports response timing.
export const ANSWER_TIMING_PROVIDER_IDS = Object.freeze(['chatgpt', 'gemini', 'deepseek']);
export const PROMPT_SUMMARY_MAX_LENGTH = 100;
export const MAX_STORED_ROUNDS = 1000;

export const ANSWER_STATUS = Object.freeze({
  PENDING: 'pending',
  COMPLETE: 'complete',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled'
});

const TIMING_PHASE_STATUS = {
  complete: ANSWER_STATUS.COMPLETE,
  timeout: ANSWER_STATUS.TIMEOUT,
  cancelled: ANSWER_STATUS.CANCELLED
};

let db = null;

export function isAnswerTimingProvider(providerId) {
  return ANSWER_TIMING_PROVIDER_IDS.includes(providerId);
}

export function summarizePromptText(text, maxLength = PROMPT_SUMMARY_MAX_LENGTH) {
  const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

/**
 * A question sent to the given panels. Panels of providers without timing
 * support still take part, so their answers can be adopted.
 *
 * @param {{ id: string, createdAt: number, text: string, panels: Array<{ id: string, providerId: string }> }} options
 */
export function createRound({ id, createdAt, text, panels }) {
  const answers = {};
  panels.forEach(panel => {
    answers[panel.id] = {
      providerId: panel.providerId,
      timed: isAnswerTimingProvider(panel.providerId),
      status: isAnswerTimingProvider(panel.providerId) ? ANSWER_STATUS.PENDING : null,
      firstOutputMs: null,
      completeMs: null
    };
  });

  return {
    id,
    createdAt,
    promptSummary: summarizePromptText(text),
    adoptedPanelId: null,
    adoptedProviderId: null,
    answers
  };
}

/**
 * Applies a timing report from a panel. Returns the updated round, or null
 * when the report changes nothing (unknown panel, untimed provider, or an
 * answer that already finished).
 */
export function applyTimingEvent(round, panelId, phase, at) {
  const answer = round?.answers?.[panelId];
  if (!answer || !answer.timed || answer.status !== ANSWER_STATUS.PENDING || !Number.isFinite(at)) {
    return null;
  }

  const elapsedMs = Math.max(0, Math.round(at - round.createdAt));
  const next = { ...answer };

  if (phase === 'first-output') {
    if (next.firstOutputMs !== null) {
      return null;
    }
    next.firstOutputMs = elapsedMs;
  } else if (TIMING_PHASE_STATUS[phase]) {
    next.status = TIMING_PHASE_STATUS[phase];
    if (next.status === ANSWER_STATUS.COMPLETE) {
      next.completeMs = Math.max(elapsedMs, next.firstOutputMs ?? 0);
    }
  } else {
    return null;
  }

  return {
    ...round,
    answers: { ...round.answers, [panelId]: next }
  };
}

/**
 * Marks one panel's answer as adopted, or clears the adoption when that panel
 * is already adopted or panelId is null.
 */
export function toggleRoundAdoption(round, panelId) {
  const answer = panelId ? round?.answers?.[panelId] : null;
  if (!answer || round.adoptedPanelId === panelId) {
    return { ...round, adoptedPanelId: null, adoptedProviderId: null };
  }
  return { ...round, adoptedPanelId: panelId, adoptedProviderId: answer.providerId };
}

function average(values) {
  if (values.length === 0) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * Per-provider totals. A provider shown in two panels of one round counts
 * once for that round; its fastest answer counts for timing.
 * Adoption rate only counts rounds where some answer was adopted.
 */
export function aggregateAnswerStats(rounds) {
  const byProvider = new Map();

  const getEntry = (providerId) => {
    if (!byProvider.has(providerId)) {
      byProvider.set(providerId, {
        providerId,
        timed: isAnswerTimingProvider(providerId),
        rounds: 0,
        decidedRounds: 0,
        adoptedCount: 0,
        completeCount: 0,
        timeoutCount: 0,
        firstOutputValues: [],
        completeValues: []
      });
    }
    return byProvider.get(providerId);
  };

  rounds.forEach(round => {
    const answersByProvider = new Map();
    Object.values(round.answers || {}).forEach(answer => {
      if (!answer?.providerId) return;
      if (!answersByProvider.has(answer.providerId)) {
        answersByProvider.set(answer.providerId, []);
      }
      answersByProvider.get(answer.providerId).push(answer);
    });

    answersByProvider.forEach((answers, providerId) => {
      const entry = getEntry(providerId);
      entry.rounds += 1;
      if (round.adoptedProviderId) {
        entry.decidedRounds += 1;
        if (round.adoptedProviderId === providerId) {
          entry.adoptedCount += 1;
        }
      }

      const completed = answers.filter(answer => answer.status === ANSWER_STATUS.COMPLETE);
      if (completed.length > 0) {
        entry.completeCount += 1;
        const firstOutputs = completed
          .map(answer => answer.firstOutputMs)
          .filter(Number.isFinite);
        if (firstOutputs.length > 0) {
          entry.firstOutputValues.push(Math.min(...firstOutputs));
        }
        entry.completeValues.push(Math.min(...completed.map(answer => answer.completeMs)));
      } else if (answers.some(answer => answer.status === ANSWER_STATUS.TIMEOUT)) {
        entry.timeoutCount += 1;
      }
    });
  });

  return [...byProvider.values()]
    .map(({ firstOutputValues, completeValues, ...entry }) => ({
      ...entry,
      avgFirstOutputMs: average(firstOutputValues),
      medianFirstOutputMs: median(firstOutputValues),
      avgCompleteMs: average(completeValues),
      medianCompleteMs: median(completeValues),
      adoptionRate: entry.decidedRounds > 0 ? entry.adoptedCount / entry.decidedRounds : null
    }))
    .sort((a, b) => b.adoptedCount - a.adoptedCount || b.rounds - a.rounds);
}

// ===== IndexedDB =====

function openAnswerStatsDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      db.onclose = () => {
        db = null;
      };
      // Let a newer version of the extension upgrade the database.
      db.onversionchange = () => {
        db.close();
        db = null;
      };
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const upgradeDb = event.target.result;
      if (event.oldVersion < 1) {
        const store = upgradeDb.createObjectStore(ROUNDS_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

async function getDb() {
  if (db) {
    try {
      db.objectStoreNames;
      return db;
    } catch (_) {
      db = null;
    }
  }
  return openAnswerStatsDb();
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function pruneOldRounds(store) {
  const count = await requestToPromise(store.count());
  let excess = count - MAX_STORED_ROUNDS;
  if (excess <= 0) {
    return;
  }

  await new Promise((resolve, reject) => {
    const cursorRequest = store.index('createdAt').openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || excess <= 0) {
        resolve();
        return;
      }
      cursor.delete();
      excess -= 1;
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

export async function saveAnswerRound(round) {
  const database = await getDb();
  const transaction = database.transaction([ROUNDS_STORE], 'readwrite');
  const store = transaction.objectStore(ROUNDS_STORE);
  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  store.put(round);
  await pruneOldRounds(store);
  await done;
}

export async function getAllAnswerRounds() {
  const database = await getDb();
  const transaction = database.transaction([ROUNDS_STORE], 'readonly');
  const rounds = await requestToPromise(transaction.objectStore(ROUNDS_STORE).getAll());
  return rounds.sort((a, b) => b.createdAt - a.createdAt);
}

export async function clearAnswerRounds() {
  const database = await getDb();
  const transaction = database.transaction([ROUNDS_STORE], 'readwrite');
  await requestToPromise(transaction.objectStore(ROUNDS_STORE).clear());
}
