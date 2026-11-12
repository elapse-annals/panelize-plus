import {
  GLOBAL_SEND_ERRORS,
  GLOBAL_SEND_PROTOCOL_VERSION,
  NATIVE_MESSAGE_TYPES,
  NATIVE_SEND_HOST,
  createNativeError,
  createNativeHello,
  createNativeHistorySnapshotChunk,
  createNativeHistoryUpsertChunk,
  createNativeNewChatResult,
  createNativeSendAccepted,
  createNativeSendProgress,
  createNativeSendResult,
  normalizeGlobalPrompt,
  normalizeGlobalPromptMode,
  normalizeRequestId,
  readGlobalSendProgressPayload,
  readGlobalSendResultPayload,
  readNewChatResultPayload
} from '../modules/platform/global-send.js';
import { createHistoryChunks, readIncomingHistoryBatch } from '../modules/history/history-sync.js';

const COMPLETED_REQUEST_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 45 * 1000;
// A send that first has to start a fresh conversation, and a standalone new
// chat, legitimately take longer than a plain send.
const NEW_CHAT_TIMEOUT_MS = 90 * 1000;
const MAX_REMEMBERED_REQUESTS = 32;
const PROGRESS_STAGE_RANK = Object.freeze({ opening: 0, preparing: 1, sending: 2 });

/**
 * Owns the native port that a Panelize Link desktop app talks to. Chrome
 * starts the native host when the extension connects; the host's heartbeat
 * keeps this worker responsive, and an alarm reconnects after a host crash.
 *
 * `onSendPrompt` resolves once the prompt was handed to (or opened) the
 * Multi-Panel page. The page later reports what each provider received through
 * `deliverResult`.
 */
export function createNativeSendBridge({
  connectNative,
  runtime,
  onSendPrompt,
  onNewChat = async () => {},
  onHistoryRequest = () => {},
  onHistoryUpsert = () => {},
  onStatus = () => {},
  onDisconnect = () => {},
  now = Date.now,
  setTimeoutFn = setTimeout
} = {}) {
  let port = null;
  let disposed = false;
  const activeRequests = new Set();
  const completedRequests = new Map();
  const requestTimers = new Map();
  // Last progress forwarded per request: stage rank plus its payload, so a
  // repeated tick or a late opening event cannot move the client backwards.
  const requestProgress = new Map();

  const activeNewChats = new Set();
  const completedNewChats = new Map();
  const newChatTimers = new Map();

  function lastErrorMessage() {
    try {
      return runtime?.lastError?.message || '';
    } catch {
      return '';
    }
  }

  function post(message) {
    if (!port) {
      return false;
    }
    try {
      port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  function rememberCompleted(requestId, response) {
    completedRequests.set(requestId, { response, at: now() });
    while (completedRequests.size > MAX_REMEMBERED_REQUESTS) {
      completedRequests.delete(completedRequests.keys().next().value);
    }
  }

  function clearRequest(requestId) {
    activeRequests.delete(requestId);
    requestProgress.delete(requestId);
    const timer = requestTimers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      requestTimers.delete(requestId);
    }
  }

  function finishRequest(requestId, outcome) {
    clearRequest(requestId);
    const response = createNativeSendResult(requestId, outcome);
    rememberCompleted(requestId, response);
    post(response);
    return response;
  }

  function handleSendRequest(message) {
    const requestId = normalizeRequestId(message.requestId);
    if (!requestId) {
      post(createNativeError(null, GLOBAL_SEND_ERRORS.INVALID_REQUEST, 'Missing request ID'));
      return;
    }

    const completed = completedRequests.get(requestId);
    if (completed && now() - completed.at < COMPLETED_REQUEST_TTL_MS) {
      // The host may retry after a reconnection; never send the prompt twice.
      post(completed.response);
      return;
    }

    if (activeRequests.has(requestId)) {
      post(createNativeSendAccepted(requestId));
      return;
    }

    const prompt = normalizeGlobalPrompt(message.text);
    if (!prompt.ok) {
      post(createNativeError(requestId, prompt.error.code, prompt.error.message));
      return;
    }

    activeRequests.add(requestId);
    post(createNativeSendAccepted(requestId));

    const request = { text: prompt.text, requestId };
    const promptMode = normalizeGlobalPromptMode(message.promptMode);
    if (promptMode !== undefined) {
      request.promptMode = promptMode;
    }
    if (message.newChat === true) {
      request.newChat = true;
    }

    Promise.resolve(onSendPrompt(request))
      .catch(() => {
        finishRequest(requestId, { ok: false, reason: GLOBAL_SEND_ERRORS.SEND_FAILED });
      });

    const timer = setTimeoutFn(() => {
      if (activeRequests.has(requestId)) {
        finishRequest(requestId, { ok: false, reason: 'no-response' });
      }
    }, request.newChat ? NEW_CHAT_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    requestTimers.set(requestId, timer);
  }

  function clearNewChat(requestId) {
    activeNewChats.delete(requestId);
    const timer = newChatTimers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      newChatTimers.delete(requestId);
    }
  }

  function finishNewChat(requestId, outcome) {
    clearNewChat(requestId);
    const response = createNativeNewChatResult({ requestId, ...outcome });
    completedNewChats.set(requestId, { response, at: now() });
    while (completedNewChats.size > MAX_REMEMBERED_REQUESTS) {
      completedNewChats.delete(completedNewChats.keys().next().value);
    }
    post(response);
    return response;
  }

  function handleNewChatRequest(message) {
    const requestId = normalizeRequestId(message.requestId);
    if (!requestId) {
      post(createNativeError(null, GLOBAL_SEND_ERRORS.INVALID_REQUEST, 'Missing request ID'));
      return;
    }

    const completed = completedNewChats.get(requestId);
    if (completed && now() - completed.at < COMPLETED_REQUEST_TTL_MS) {
      // The host can retry after a reconnect; do not reset the chats twice.
      post(completed.response);
      return;
    }
    if (activeNewChats.has(requestId)) {
      return;
    }

    activeNewChats.add(requestId);
    Promise.resolve(onNewChat({ requestId }))
      .catch(() => {
        finishNewChat(requestId, { ok: false, reason: GLOBAL_SEND_ERRORS.SEND_FAILED });
      });

    const timer = setTimeoutFn(() => {
      if (activeNewChats.has(requestId)) {
        finishNewChat(requestId, { ok: false, reason: 'no-response' });
      }
    }, NEW_CHAT_TIMEOUT_MS);
    newChatTimers.set(requestId, timer);
  }

  /**
   * Posts a history snapshot or incremental update as chunks. An empty
   * snapshot still sends one chunk so the desktop assembler sees a complete
   * (empty) result.
   */
  function sendHistory(type, records) {
    if (!port) return false;
    const chunks = createHistoryChunks(records);
    if (!chunks.length) {
      if (type === NATIVE_MESSAGE_TYPES.HISTORY_UPSERT) return true;
      chunks.push([]);
    }
    const id = `history-${now()}-${Math.random().toString(36).slice(2, 10)}`;
    chunks.forEach((chunk, index) => {
      post(type === NATIVE_MESSAGE_TYPES.HISTORY_SNAPSHOT
        ? createNativeHistorySnapshotChunk({
          snapshotId: id,
          index,
          total: chunks.length,
          records: chunk
        })
        : createNativeHistoryUpsertChunk({
          batchId: id,
          index,
          total: chunks.length,
          records: chunk
        }));
    });
    return true;
  }

  function sendHistorySnapshot(records) {
    return sendHistory(NATIVE_MESSAGE_TYPES.HISTORY_SNAPSHOT, records);
  }

  function sendHistoryUpsert(records) {
    return sendHistory(NATIVE_MESSAGE_TYPES.HISTORY_UPSERT, records);
  }

  function deliverNewChatResult(payload) {
    const result = readNewChatResultPayload(payload);
    if (!result || !activeNewChats.has(result.requestId)) {
      return false;
    }
    finishNewChat(result.requestId, result);
    return true;
  }

  function handleNativeMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      post(createNativeError(null, GLOBAL_SEND_ERRORS.INVALID_REQUEST, 'Malformed message'));
      return;
    }

    if (message.type === NATIVE_MESSAGE_TYPES.PING) {
      post({ protocol: GLOBAL_SEND_PROTOCOL_VERSION, type: NATIVE_MESSAGE_TYPES.PONG, at: now() });
      return;
    }

    if (message.type === NATIVE_MESSAGE_TYPES.SEND_PROMPT) {
      handleSendRequest(message);
      return;
    }

    if (message.type === NATIVE_MESSAGE_TYPES.NEW_CHAT) {
      handleNewChatRequest(message);
      return;
    }

    if (message.type === NATIVE_MESSAGE_TYPES.HISTORY_REQUEST) {
      Promise.resolve(onHistoryRequest()).catch(() => {});
      return;
    }

    if (message.type === NATIVE_MESSAGE_TYPES.HISTORY_UPSERT) {
      const batch = readIncomingHistoryBatch(message, { now: now() });
      if (!batch) {
        post(createNativeError(
          null,
          GLOBAL_SEND_ERRORS.INVALID_REQUEST,
          'Invalid history update'
        ));
        return;
      }
      Promise.resolve(onHistoryUpsert(batch)).catch(() => {});
      return;
    }

    post(createNativeError(
      normalizeRequestId(message.requestId),
      GLOBAL_SEND_ERRORS.INVALID_REQUEST,
      'Unsupported native request'
    ));
  }

  function clearAllNewChats() {
    activeNewChats.clear();
    newChatTimers.forEach(timer => clearTimeout(timer));
    newChatTimers.clear();
  }

  function handleDisconnect() {
    if (!port) return;
    const message = lastErrorMessage();
    port = null;
    clearAllNewChats();
    onStatus({ connected: false, error: message });
    onDisconnect();
  }

  function connect() {
    if (disposed || port || typeof connectNative !== 'function') {
      return false;
    }

    let nativePort;
    try {
      nativePort = connectNative(NATIVE_SEND_HOST);
    } catch {
      onStatus({ connected: false, error: 'Native host is not installed' });
      return false;
    }

    if (!nativePort?.postMessage) {
      onStatus({ connected: false, error: 'Native host did not start' });
      return false;
    }

    port = nativePort;
    try {
      port.onMessage.addListener(handleNativeMessage);
      port.onDisconnect.addListener(handleDisconnect);
      port.postMessage(createNativeHello(runtime?.getManifest?.().version || ''));
    } catch {
      port = null;
      onStatus({ connected: false, error: 'Could not start the native host' });
      return false;
    }

    onStatus({ connected: true, error: '' });
    return true;
  }

  function deliverResult(payload) {
    const result = readGlobalSendResultPayload(payload);
    if (!result || !activeRequests.has(result.requestId)) {
      return false;
    }
    finishRequest(result.requestId, result);
    return true;
  }

  /**
   * Forwards a preparation or sending report for a request this host is still
   * handling. Duplicate reports, stage regressions and updates after the final
   * result are dropped.
   */
  function deliverProgress(payload) {
    const progress = readGlobalSendProgressPayload(payload);
    if (!progress || !activeRequests.has(progress.requestId)) {
      return false;
    }

    const rank = PROGRESS_STAGE_RANK[progress.stage];
    const signature = JSON.stringify(progress);
    const previous = requestProgress.get(progress.requestId);
    if (previous && (rank < previous.rank || (rank === previous.rank && signature === previous.signature))) {
      return false;
    }

    requestProgress.set(progress.requestId, { rank, signature });
    post(createNativeSendProgress(progress));
    return true;
  }

  /**
   * Reports that the extension finished opening or reusing the Multi-Panel
   * page. The page may already have reported preparing when it loaded first,
   * in which case the client has its earlier progress to act on.
   */
  function deliverOpened(requestId) {
    const normalized = normalizeRequestId(requestId);
    if (!normalized || !activeRequests.has(normalized) || requestProgress.has(normalized)) {
      return false;
    }
    return deliverProgress({ requestId: normalized, stage: 'opening' });
  }

  function disconnect() {
    const current = port;
    port = null;
    if (current) {
      try {
        current.disconnect();
      } catch {
        // The host may already be gone.
      }
    }
    activeRequests.clear();
    requestProgress.clear();
    requestTimers.forEach(timer => clearTimeout(timer));
    requestTimers.clear();
    clearAllNewChats();
    onStatus({ connected: false, error: '' });
    onDisconnect();
  }

  function dispose() {
    disposed = true;
    disconnect();
  }

  return {
    connect,
    deliverNewChatResult,
    deliverOpened,
    deliverProgress,
    deliverResult,
    disconnect,
    dispose,
    handleNativeMessage,
    isConnected: () => Boolean(port),
    sendHistorySnapshot,
    sendHistoryUpsert
  };
}