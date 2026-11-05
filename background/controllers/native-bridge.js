/**
 * Owns native bridge behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { NATIVE_SEND_KEEPALIVE_ALARM, NATIVE_SEND_KEEPALIVE_MINUTES } from '../../modules/platform/global-send.js';
import { createNativeSendBridge } from '../native-send.js';

export function createNativeBridgeController({
  getPageActionsController,
  getSettingsController
}) {
  const nativeSendBridge = createNativeSendBridge({
    connectNative: name => chrome.runtime.connectNative(name),
    runtime: chrome.runtime,
    // The opener resolves after the Multi-Panel page was created or reused;
    // only then does the desktop client bring the browser forward.
    onSendPrompt: async request => {
      await getPageActionsController().handOffGlobalPrompt(request);
      nativeSendBridge.deliverOpened(request.requestId);
    }
  });

  function ensureNativeSendBridge() {
    if (!getSettingsController().globalSendBridgeEnabled) {
      return;
    }
    try {
      chrome.alarms.create(NATIVE_SEND_KEEPALIVE_ALARM, {
        periodInMinutes: NATIVE_SEND_KEEPALIVE_MINUTES
      });
    } catch (error) {
      // Native messaging still works after the next service worker event.
    }
    nativeSendBridge.connect();
  }

  function disableNativeSendBridge() {
    try {
      Promise.resolve(chrome.alarms.clear(NATIVE_SEND_KEEPALIVE_ALARM)).catch(() => {});
    } catch (error) {
      // The alarm API may be unavailable before the worker is fully started.
    }
    nativeSendBridge.disconnect();
  }

  async function initializeNativeSendBridge() {
    await getSettingsController().loadGlobalSendSetting();
    if (getSettingsController().globalSendBridgeEnabled) {
      ensureNativeSendBridge();
    } else {
      disableNativeSendBridge();
    }
  }

  return {
    disableNativeSendBridge,
    ensureNativeSendBridge,
    initializeNativeSendBridge,
    get nativeSendBridge() { return nativeSendBridge; },
  };
}
