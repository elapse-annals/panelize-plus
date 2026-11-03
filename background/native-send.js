import {
  GLOBAL_SEND_ERRORS,
  NATIVE_SEND_HOST,
  createNativeError,
  createNativeHello,
  createNativeSendAccepted,
  createNativeSendResult,
  normalizeGlobalPrompt,
  normalizeGlobalPromptMode,
  normalizeRequestId,
  readGlobalSendResultPayload
} from '../modules/global-send.js';

const COMPLETED_REQUEST_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 45 * 1000;
const MAX_REMEMBERED_REQUESTS = 32;

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
  onStatus = () => {},
  now = Date.now,
  setTimeoutFn = setTimeout
} = {}) {
  let port = null;
  let disposed = false;
  const activeRequests = new Set();
  const completedRequests = new Map();
  const requestTimers = new Map();

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

    Promise.resolve(onSendPrompt(request))
      .catch(() => {
        finishRequest(requestId, { ok: false, reason: GLOBAL_SEND_ERRORS.SEND_FAILED });
      });

    const timer = setTimeoutFn(() => {
      if (activeRequests.has(requestId)) {
        finishRequest(requestId, { ok: false, reason: 'no-response' });
      }
    }, REQUEST_TIMEOUT_MS);
    requestTimers.set(requestId, timer);
  }

  function handleNativeMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      post(createNativeError(null, GLOBAL_SEND_ERRORS.INVALID_REQUEST, 'Malformed message'));
      return;
    }

    if (message.type === 'ping') {
      post({ protocol: 1, type: 'pong', at: now() });
      return;
    }

    if (message.type === 'sendPrompt') {
      handleSendRequest(message);
      return;
    }

    post(createNativeError(
      normalizeRequestId(message.requestId),
      GLOBAL_SEND_ERRORS.INVALID_REQUEST,
      'Unsupported native request'
    ));
  }

  function handleDisconnect() {
    if (!port) return;
    const message = lastErrorMessage();
    port = null;
    onStatus({ connected: false, error: message });
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
    requestTimers.forEach(timer => clearTimeout(timer));
    requestTimers.clear();
    onStatus({ connected: false, error: '' });
  }

  function dispose() {
    disposed = true;
    disconnect();
  }

  return {
    connect,
    deliverResult,
    disconnect,
    dispose,
    handleNativeMessage,
    isConnected: () => Boolean(port)
  };
}