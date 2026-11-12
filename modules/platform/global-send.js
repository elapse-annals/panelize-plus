// Protocol shared by the browser extension and the macOS global shortcut app.
// Besides a prompt request and its outcome, the local bridge carries new-chat
// control and the last three days of question/summary history. Everything stays
// between this browser and the Panelize Link app on the same machine.

import { AUTO_PROMPT_MODE, DEFAULT_PROMPT_MODE, PROMPT_MODE_IDS } from '../prompts/prompt-modes.js';

export const NATIVE_SEND_HOST = 'com.panelize.global_sender';
export const GLOBAL_SEND_PROTOCOL_VERSION = 2;
export const GLOBAL_SEND_ACTION = 'sendPromptToAll';
export const GLOBAL_SEND_RESULT_ACTION = 'globalSendResult';
export const GLOBAL_SEND_PROGRESS_ACTION = 'globalSendProgress';
export const NEW_CHAT_ACTION = 'newChatAllProviders';
export const NEW_CHAT_RESULT_ACTION = 'newChatResult';
export const GLOBAL_SEND_MAX_TEXT_LENGTH = 8000;
export const GLOBAL_SEND_MAX_REQUEST_ID_LENGTH = 100;
export const GLOBAL_SEND_MAX_PROGRESS_NAMES = 24;
export const GLOBAL_SEND_MAX_PROGRESS_NAME_LENGTH = 60;
export const NATIVE_SEND_KEEPALIVE_ALARM = 'panelize-native-send-keepalive';
export const NATIVE_SEND_KEEPALIVE_MINUTES = 1;

// Advertised in the native hello so the desktop client can avoid sending
// message types an older extension would reject.
export const NATIVE_CAPABILITIES = Object.freeze(['historySync', 'newChat']);

export const NATIVE_MESSAGE_TYPES = Object.freeze({
  HELLO: 'hello',
  PING: 'ping',
  PONG: 'pong',
  ERROR: 'error',
  SEND_PROMPT: 'sendPrompt',
  HISTORY_REQUEST: 'historyRequest',
  HISTORY_SNAPSHOT: 'historySnapshot',
  HISTORY_UPSERT: 'historyUpsert',
  NEW_CHAT: 'newChat',
  NEW_CHAT_RESULT: 'newChatResult'
});

// The desktop client shows progress for one send: the panel page is opening or
// was reused, the AI panels are getting ready, then the prompt is being sent.
export const GLOBAL_SEND_PROGRESS_STAGES = Object.freeze(['opening', 'preparing', 'sending']);

// The prompt modes a native client may apply to a single send. `default` is an
// explicit "no instruction" choice; `auto` uses the extension's trigger words.
export const GLOBAL_SEND_PROMPT_MODES = Object.freeze([
  DEFAULT_PROMPT_MODE,
  AUTO_PROMPT_MODE,
  ...PROMPT_MODE_IDS
]);

export const GLOBAL_SEND_ERRORS = Object.freeze({
  INVALID_REQUEST: 'invalid-request',
  INVALID_TEXT: 'invalid-text',
  EMPTY_TEXT: 'empty-text',
  TEXT_TOO_LONG: 'text-too-long',
  NOT_CONNECTED: 'not-connected',
  SEND_FAILED: 'send-failed'
});

function error(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * Normalizes a prompt received from the native app. The normalizer accepts
 * CRLF from macOS text fields, but sends trimmed text with Unix newlines.
 */
export function normalizeGlobalPrompt(value) {
  if (typeof value !== 'string') {
    return error(GLOBAL_SEND_ERRORS.INVALID_TEXT, 'Prompt must be text');
  }

  const text = value.replace(/\r\n?/g, '\n').trim();
  if (!text) {
    return error(GLOBAL_SEND_ERRORS.EMPTY_TEXT, 'Enter a prompt first');
  }
  if ([...text].length > GLOBAL_SEND_MAX_TEXT_LENGTH) {
    return error(
      GLOBAL_SEND_ERRORS.TEXT_TOO_LONG,
      `Prompt must be at most ${GLOBAL_SEND_MAX_TEXT_LENGTH} characters`
    );
  }
  return { ok: true, text };
}

export function normalizeRequestId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const requestId = value.trim();
  return requestId && requestId.length <= GLOBAL_SEND_MAX_REQUEST_ID_LENGTH ? requestId : null;
}

/**
 * A prompt mode a native client may apply to one send. Missing, malformed or
 * unknown values return undefined so the extension keeps its own selected mode.
 */
export function normalizeGlobalPromptMode(value) {
  return typeof value === 'string' && GLOBAL_SEND_PROMPT_MODES.includes(value)
    ? value
    : undefined;
}

export function isProtocolMessage(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createNativeHello(extensionVersion, capabilities = NATIVE_CAPABILITIES) {
  return {
    protocol: GLOBAL_SEND_PROTOCOL_VERSION,
    type: NATIVE_MESSAGE_TYPES.HELLO,
    extensionVersion: String(extensionVersion || ''),
    capabilities: [...capabilities]
  };
}

export function createNativeError(requestId, code, message) {
  return {
    protocol: GLOBAL_SEND_PROTOCOL_VERSION,
    type: 'error',
    requestId: requestId || null,
    code,
    message
  };
}

export function createNativeSendAccepted(requestId) {
  return {
    protocol: GLOBAL_SEND_PROTOCOL_VERSION,
    type: 'sendAccepted',
    requestId
  };
}

export function createNativeHistoryRequest() {
  return {
    protocol: GLOBAL_SEND_PROTOCOL_VERSION,
    type: NATIVE_MESSAGE_TYPES.HISTORY_REQUEST
  };
}

export function createNativeHistorySnapshotChunk({ snapshotId, index, total, records }) {
  return {
    protocol: GLOBAL_SEND_PROTOCOL_VERSION,
    type: NATIVE_MESSAGE_TYPES.HISTORY_SNAPSHOT,
    snapshotId,
    index,
    total,
    records
  };
}

export function createNativeHistoryUpsertChunk({ batchId, index, total, records }) {
  return {
    protocol: GLOBAL_SEND_PROTOCOL_VERSION,
    type: NATIVE_MESSAGE_TYPES.HISTORY_UPSERT,
    batchId,
    index,
    total,
    records
  };
}

export function createNativeNewChatResult(payload = {}) {
  const ready = Number.isFinite(payload.ready) ? Math.max(0, Math.trunc(payload.ready)) : 0;
  const total = Number.isFinite(payload.total) ? Math.max(0, Math.trunc(payload.total)) : 0;
  return {
    protocol: GLOBAL_SEND_PROTOCOL_VERSION,
    type: NATIVE_MESSAGE_TYPES.NEW_CHAT_RESULT,
    requestId: normalizeRequestId(payload.requestId) || '',
    ok: payload.ok === true,
    ready: total > 0 ? Math.min(ready, total) : ready,
    total,
    reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 120) : ''
  };
}

export function createNativeSendResult(requestId, outcome = {}) {
  const sent = Number.isFinite(outcome.sent) ? Math.max(0, Math.trunc(outcome.sent)) : 0;
  const total = Number.isFinite(outcome.total) ? Math.max(0, Math.trunc(outcome.total)) : 0;
  return {
    protocol: GLOBAL_SEND_PROTOCOL_VERSION,
    type: 'sendResult',
    requestId,
    ok: outcome.ok === true,
    sent,
    total,
    reason: typeof outcome.reason === 'string' ? outcome.reason.slice(0, 120) : ''
  };
}

export function normalizeSendProgressStage(value) {
  return typeof value === 'string' && GLOBAL_SEND_PROGRESS_STAGES.includes(value)
    ? value
    : null;
}

function readProgressCount(value) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function readProgressNames(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(name => typeof name === 'string')
    .map(name => name.trim().slice(0, GLOBAL_SEND_MAX_PROGRESS_NAME_LENGTH))
    .filter(Boolean)
    .slice(0, GLOBAL_SEND_MAX_PROGRESS_NAMES);
}

/**
 * Reads one preparation/sending progress report from the Multi-Panel page.
 * Counts are bounded by the total, and names are capped so a large setup
 * cannot grow the native frame. Blind mode never carries names.
 */
export function readGlobalSendProgressPayload(payload) {
  if (!isProtocolMessage(payload)) {
    return null;
  }
  const requestId = normalizeRequestId(payload.requestId);
  const stage = normalizeSendProgressStage(payload.stage);
  if (!requestId || !stage) {
    return null;
  }

  const total = readProgressCount(payload.total);
  const reportedReady = readProgressCount(payload.ready);
  const ready = total > 0 ? Math.min(reportedReady, total) : reportedReady;
  const pendingCount = total > 0
    ? Math.min(readProgressCount(payload.pendingCount), Math.max(0, total - ready))
    : readProgressCount(payload.pendingCount);
  const timedOutCount = total > 0
    ? Math.min(readProgressCount(payload.timedOutCount), Math.max(0, total - ready - pendingCount))
    : readProgressCount(payload.timedOutCount);
  const blind = payload.blind === true;

  return {
    requestId,
    stage,
    ready,
    total,
    pendingCount,
    timedOutCount,
    pendingNames: blind ? [] : readProgressNames(payload.pendingNames),
    timedOutNames: blind ? [] : readProgressNames(payload.timedOutNames),
    blind
  };
}

/** The progress event forwarded to the desktop app over the native port. */
export function createNativeSendProgress(progress) {
  return {
    protocol: GLOBAL_SEND_PROTOCOL_VERSION,
    type: 'sendProgress',
    requestId: progress.requestId,
    stage: progress.stage,
    ready: progress.ready,
    total: progress.total,
    pendingCount: progress.pendingCount,
    timedOutCount: progress.timedOutCount,
    pendingNames: progress.pendingNames,
    timedOutNames: progress.timedOutNames,
    blind: progress.blind === true
  };
}

/**
 * Converts Page -> background result messages into the native response.
 * Only the fields needed by the desktop status are accepted.
 */
export function readGlobalSendResultPayload(payload) {
  if (!isProtocolMessage(payload)) {
    return null;
  }
  const requestId = normalizeRequestId(payload.requestId);
  if (!requestId) {
    return null;
  }
  return {
    requestId,
    ok: payload.ok === true,
    sent: Number.isFinite(payload.sent) ? Math.max(0, Math.trunc(payload.sent)) : 0,
    total: Number.isFinite(payload.total) ? Math.max(0, Math.trunc(payload.total)) : 0,
    reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 120) : ''
  };
}

/** Result messages only come from Panelize's own top-level extension page. */
export function isTrustedGlobalSendResultSender(sender, runtime) {
  if (!sender || sender.id !== runtime?.id) {
    return false;
  }
  try {
    // The URL check also excludes provider iframes and ordinary web pages.
    return typeof sender.url === 'string'
      && sender.url.startsWith(runtime.getURL('multi-panel/'))
      && (sender.frameId ?? 0) === 0;
  } catch (sendError) {
    return false;
  }
}

/** Reads a new-chat result reported by the Multi-Panel page. */
export function readNewChatResultPayload(payload) {
  if (!isProtocolMessage(payload)) {
    return null;
  }
  const requestId = normalizeRequestId(payload.requestId);
  if (!requestId) {
    return null;
  }
  const ready = Number.isFinite(payload.ready) ? Math.max(0, Math.trunc(payload.ready)) : 0;
  const total = Number.isFinite(payload.total) ? Math.max(0, Math.trunc(payload.total)) : 0;
  return {
    requestId,
    ok: payload.ok === true,
    ready: total > 0 ? Math.min(ready, total) : ready,
    total,
    reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 120) : ''
  };
}