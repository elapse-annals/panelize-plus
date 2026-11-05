export const PANELIZE_NEW_CHAT_RESULT = 'PANELIZE_NEW_CHAT_RESULT';
export const PANEL_NEW_CHAT_RESULT_CONTEXT = 'multi-panel-new-chat-result';
export const NEW_CHAT_RESULT_TIMEOUT_MS = 20000;

const RESULT_STATUSES = new Set(['verified', 'failed', 'unconfirmed']);

function getResult(panel, status, reason) {
  return {
    ok: status === 'verified',
    panelId: panel?.id ?? null,
    provider: panel?.providerId ?? null,
    status,
    ...(reason ? { reason } : {})
  };
}

function getExpectedPanelOrigin(panel) {
  const iframe = panel?.iframe;
  const src = iframe?.src || iframe?.getAttribute?.('src') || panel?.src;
  if (typeof src !== 'string' || src.length === 0) return null;
  try {
    const baseUrl = globalThis.location?.href || 'https://panelize.invalid/';
    const origin = new URL(src, baseUrl).origin;
    return origin && origin !== 'null' ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Checks that a new-chat ACK belongs to the active request and expected iframe.
 * A click or navigation message is not an ACK; only the provider's verified
 * empty-conversation state is considered successful.
 */
export function isMatchingNewChatResult(event, panel, requestId) {
  const data = event?.data;
  const expectedOrigin = getExpectedPanelOrigin(panel);
  return Boolean(
    data &&
    typeof data === 'object' &&
    data.type === PANELIZE_NEW_CHAT_RESULT &&
    data.context === PANEL_NEW_CHAT_RESULT_CONTEXT &&
    data.requestId === requestId &&
    data.provider === panel?.providerId &&
    data.panelId === panel?.id &&
    panel?.iframe?.contentWindow === event.source &&
    (!expectedOrigin || event.origin === expectedOrigin) &&
    RESULT_STATUSES.has(data.status)
  );
}

/**
 * Creates a cancellable waiter for a single panel's verified new-chat result.
 */
export function createNewChatResultWaiter({
  target = window,
  panel,
  requestId,
  timeoutMs = NEW_CHAT_RESULT_TIMEOUT_MS
}) {
  let settled = false;
  let timeoutId;
  let resolvePromise;

  const cleanup = () => {
    target.removeEventListener('message', handleMessage);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  };

  const settle = result => {
    if (settled) return;
    settled = true;
    cleanup();
    resolvePromise(result);
  };

  const handleMessage = event => {
    if (!isMatchingNewChatResult(event, panel, requestId)) return;
    const { status, reason } = event.data;
    settle(getResult(panel, status, reason));
  };

  const promise = new Promise(resolve => {
    resolvePromise = resolve;
    target.addEventListener('message', handleMessage);
    timeoutId = setTimeout(() => {
      settle(getResult(panel, 'unconfirmed', 'confirmation-timeout'));
    }, timeoutMs);
  });

  return {
    promise,
    cancel(status = 'failed', reason = 'dispatch-error') {
      const normalizedStatus = RESULT_STATUSES.has(status) ? status : 'failed';
      settle(getResult(panel, normalizedStatus, reason));
    }
  };
}

function getProviderMode(providerModes, panel) {
  if (typeof providerModes === 'function') {
    return providerModes(panel);
  }
  if (providerModes instanceof Map) {
    return providerModes.get(panel.id) ?? providerModes.get(panel.providerId);
  }
  return providerModes?.[panel.id] ?? providerModes?.[panel.providerId];
}

export function summarizeNewChatResults(results = []) {
  const summary = {
    verifiedCount: 0,
    failedCount: 0,
    unconfirmedCount: 0,
    total: results.length
  };
  for (const result of results) {
    if (result.status === 'verified') summary.verifiedCount += 1;
    else if (result.status === 'failed') summary.failedCount += 1;
    else summary.unconfirmedCount += 1;
  }
  return summary;
}

/**
 * Starts a batch new-chat request and resolves only after provider ACKs or the
 * timeout. All waiters are installed before any panel is dispatched.
 *
 * @param {object} options
 * @param {EventTarget} [options.target=window] Message event target.
 * @param {Array<object>} options.panels Panels with id, providerId and iframe.
 * @param {string} options.requestId Unique ID shared by this batch.
 * @param {object|Map|Function} [options.providerModes] Provider mode by panel/provider.
 * @param {number} [options.timeoutMs=20000] Per-panel result timeout.
 * @param {(panel: object, message: object) => void|Promise<void>} [options.dispatch]
 *   Optional host dispatch hook, useful when a panel needs a reload first.
 * @returns {Promise<{requestId: string, results: Array<object>, summary: object}>}
 */
export async function runNewChatBatch({
  target = window,
  panels = [],
  requestId,
  providerModes = {},
  timeoutMs = NEW_CHAT_RESULT_TIMEOUT_MS,
  dispatch
}) {
  if (typeof requestId !== 'string' || requestId.length === 0) {
    throw new TypeError('runNewChatBatch requires a non-empty requestId');
  }

  const requests = panels.map(panel => {
    if (!panel?.iframe?.contentWindow) {
      return {
        panel,
        result: getResult(panel, 'unconfirmed', 'missing-iframe')
      };
    }

    const waiter = createNewChatResultWaiter({ target, panel, requestId, timeoutMs });
    const message = {
      type: 'NEW_CHAT',
      context: 'multi-panel',
      requestId,
      provider: panel.providerId,
      panelId: panel.id
    };
    const providerMode = getProviderMode(providerModes, panel);
    if (providerMode !== undefined) message.providerMode = providerMode;

    return { panel, message, waiter };
  });

  const dispatchRequests = requests.filter(request => request.waiter);
  dispatchRequests.forEach(request => {
    try {
      const dispatchResult = dispatch
        ? dispatch(request.panel, request.message)
        : request.panel.iframe.contentWindow.postMessage(request.message, '*');
      Promise.resolve(dispatchResult).catch(() => {
        request.waiter.cancel('failed', 'dispatch-error');
      });
    } catch (error) {
      request.waiter.cancel('failed', 'dispatch-error');
    }
  });

  const results = await Promise.all(requests.map(request =>
    request.waiter ? request.waiter.promise : Promise.resolve(request.result)
  ));

  return {
    requestId,
    results,
    summary: summarizeNewChatResults(results)
  };
}
