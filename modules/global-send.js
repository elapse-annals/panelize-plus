// Protocol shared by the browser extension and the macOS global shortcut app.
// The native host only carries a prompt request and its outcome; it never
// receives provider cookies, answers, prompts or any other saved extension data.

import { AUTO_PROMPT_MODE, DEFAULT_PROMPT_MODE, PROMPT_MODE_IDS } from './prompt-modes.js';

export const NATIVE_SEND_HOST = 'com.panelize.global_sender';
export const GLOBAL_SEND_PROTOCOL_VERSION = 1;
export const GLOBAL_SEND_ACTION = 'sendPromptToAll';
export const GLOBAL_SEND_RESULT_ACTION = 'globalSendResult';
export const GLOBAL_SEND_MAX_TEXT_LENGTH = 8000;
export const GLOBAL_SEND_MAX_REQUEST_ID_LENGTH = 100;
export const NATIVE_SEND_KEEPALIVE_ALARM = 'panelize-native-send-keepalive';
export const NATIVE_SEND_KEEPALIVE_MINUTES = 1;

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

export function createNativeHello(extensionVersion) {
  return {
    protocol: GLOBAL_SEND_PROTOCOL_VERSION,
    type: 'hello',
    extensionVersion: String(extensionVersion || '')
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