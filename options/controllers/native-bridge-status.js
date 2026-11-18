/**
 * Shows the native bridge connection state on the options page. The options
 * page and the service worker are separate contexts, so the state is polled
 * while the page is visible instead of pushed.
 */
import { NATIVE_BRIDGE_STATUS_ACTION, readNativeBridgeStatusResponse } from '../../modules/platform/native-bridge-status.js';
import { sendMessageWithTimeout } from '../../modules/platform/messaging.js';
import { t } from '../../modules/platform/i18n.js';

function defaultRequestStatus() {
  return sendMessageWithTimeout({ action: NATIVE_BRIDGE_STATUS_ACTION });
}

export function createNativeBridgeStatusController({
  requestStatus = defaultRequestStatus,
  documentRef = document,
  translate = t,
  intervalMs = 3000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  let timer = null;
  let stopped = false;

  function renderText(text) {
    const element = documentRef.getElementById('native-bridge-status');
    if (element) {
      element.textContent = text;
    }
  }

  function renderResponse(response) {
    const status = readNativeBridgeStatusResponse(response);
    if (!status) {
      renderText(translate('msgNativeBridgeUnknown'));
      return;
    }
    if (!status.enabled) {
      renderText(translate('msgNativeBridgeDisabled'));
    } else if (!status.connected) {
      renderText(translate('msgNativeBridgeDisconnected'));
    } else if (status.clientVersion) {
      renderText(translate('msgNativeBridgeConnected', status.clientVersion));
    } else {
      renderText(translate('msgNativeBridgeConnectedNoVersion'));
    }
  }

  async function refresh() {
    try {
      const response = await requestStatus();
      if (!stopped) {
        renderResponse(response);
      }
    } catch {
      if (!stopped) {
        renderText(translate('msgNativeBridgeUnknown'));
      }
    }
  }

  function onVisibilityChange() {
    if (documentRef.visibilityState === 'visible') {
      refresh();
    }
  }

  function start() {
    if (timer) {
      return;
    }
    stopped = false;
    refresh();
    timer = setIntervalFn(() => {
      if (documentRef.visibilityState === 'visible') {
        refresh();
      }
    }, intervalMs);
    documentRef.addEventListener?.('visibilitychange', onVisibilityChange);
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearIntervalFn(timer);
      timer = null;
    }
    documentRef.removeEventListener?.('visibilitychange', onVisibilityChange);
  }

  return {
    refresh,
    renderResponse,
    start,
    stop
  };
}
