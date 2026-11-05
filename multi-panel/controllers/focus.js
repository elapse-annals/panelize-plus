/**
 * Owns focus behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { PANELIZE_FOCUS_GUARD } from './protocol.js';
import { isChatgptProvider, isFocusInOpenModal } from './ui.js';

export function createFocusController({
  getPanelsController
}) {
  // Track iframes still loading, used for focus protection
  const panelFocusGuardIds = new Map();

  // panelId -> requestId of its active focus guard
  let panelFocusGuardCounter = 0;

  let newChatFocusRestoreTimerIds = [];

  let focusRestoreGeneration = 0;

  // Bumped on every cancel so queued refocus frames are dropped
  let isRestoringFocusAfterNewChat = false;

  let activeNewChatFocusRequestId = null;

  let sendFocusRestoreTimerIds = [];

  let isRestoringFocusAfterSend = false;

  let activeSendFocusRequestId = null;

  let sendFocusRequestCounter = 0;

  let sendFocusActivePanelIds = new Set();

  let sendFocusFillingPanelIds = new Set();

  // Panels still running the fill that started the restore
  let sendFocusBusyDetectionTimeoutIds = new Map();

  let sendFocusHardTimeoutIds = new Map();

  const SEND_FOCUS_RESTORE_DELAYS = [0, 80, 200, 400, 800, 1500, 2500, 4000, 6000, 8000, 10000, 12000];

  const SEND_FOCUS_NO_BUSY_TIMEOUT_MS = 2000;

  const SEND_FOCUS_HARD_TIMEOUT_MS = 90000;

  // How long a freshly loaded panel hands keys it steals back to the question box.
  const PANEL_FOCUS_GUARD_MS = 8000;

  function focusUnifiedInput({ force = false } = {}) {
    const inputTextarea = document.getElementById('unified-input');
    if (!inputTextarea) {
      return;
    }

    const active = document.activeElement;
    const shouldFocus = force || !active || active.tagName === 'IFRAME' || active === document.body;
    if (!shouldFocus) {
      return;
    }

    // A click into a panel can cancel the protection before this frame runs.
    const generation = focusRestoreGeneration;
    requestAnimationFrame(() => {
      if (generation !== focusRestoreGeneration || (!force && !shouldPreserveUnifiedInputFocus())) {
        return;
      }
      // The user moved on to a dialog, e.g. to edit a snapshot title.
      if (isFocusInOpenModal()) {
        return;
      }
      try {
        inputTextarea.focus({ preventScroll: true });
      } catch {
        inputTextarea.focus();
      }
    });
  }

  function shouldPreserveUnifiedInputFocus() {
    return getPanelsController().loadingPanelIds.size > 0 || isRestoringFocusAfterNewChat || isRestoringFocusAfterSend;
  }

  function cancelUnifiedInputFocusRestore() {
    focusRestoreGeneration += 1;
    newChatFocusRestoreTimerIds.forEach(timerId => clearTimeout(timerId));
    newChatFocusRestoreTimerIds = [];
    isRestoringFocusAfterNewChat = false;
    activeNewChatFocusRequestId = null;
  }

  function cancelUnifiedInputFocusRestoreAfterSend() {
    focusRestoreGeneration += 1;
    sendFocusRestoreTimerIds.forEach(timerId => clearTimeout(timerId));
    sendFocusRestoreTimerIds = [];
    sendFocusBusyDetectionTimeoutIds.forEach(timerId => clearTimeout(timerId));
    sendFocusBusyDetectionTimeoutIds.clear();
    sendFocusHardTimeoutIds.forEach(timerId => clearTimeout(timerId));
    sendFocusHardTimeoutIds.clear();
    sendFocusActivePanelIds.clear();
    sendFocusFillingPanelIds.clear();
    activeSendFocusRequestId = null;
    isRestoringFocusAfterSend = false;
  }

  function isUnifiedInputOrNewChatControl(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    return Boolean(target.closest('#unified-input, #new-chat-btn, #composer-new-chat-btn, #retry-new-chat-btn, #temporary-chat-btn'));
  }

  function isUnifiedInputOrSendControl(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    return Boolean(target.closest('#unified-input, #send-all-btn'));
  }

  function scheduleNewChatFocusRestore(restoreDelays, { stopAtEnd }) {
    restoreDelays.forEach((delay, index) => {
      const timerId = setTimeout(() => {
        if (!isRestoringFocusAfterNewChat) {
          return;
        }

        if (stopAtEnd && index === restoreDelays.length - 1) {
          cancelUnifiedInputFocusRestore();
        }

        focusUnifiedInput({ force: true });
      }, delay);

      newChatFocusRestoreTimerIds.push(timerId);
    });
  }

  // With a requestId the protection lasts until finishNewChatFocusRestore, so
  // providers that autofocus while the new chat is still being confirmed or
  // its tier restored cannot pull focus out of the unified input.
  function restoreUnifiedInputFocusAfterNewChat(requestId = null) {
    cancelUnifiedInputFocusRestore();
    isRestoringFocusAfterNewChat = true;
    activeNewChatFocusRequestId = requestId;

    if (requestId) {
      scheduleNewChatFocusRestore([0, 80, 200, 400, 800], { stopAtEnd: false });
      return;
    }
    scheduleNewChatFocusRestore([0, 80, 200, 400, 800, 1000, 1200, 1500], { stopAtEnd: true });
  }

  // Covers providers that autofocus shortly after confirming the new chat; the
  // last delay matches the panel load grace period.
  function finishNewChatFocusRestore(requestId) {
    if (!isRestoringFocusAfterNewChat || activeNewChatFocusRequestId !== requestId) {
      return;
    }
    scheduleNewChatFocusRestore([0, 400, 1000, 1500, 2000, 3000], { stopAtEnd: true });
  }

  // A loading page may autofocus its own input while the user types in the
  // question box. The panel sends those keys back (PANELIZE_FORWARD_KEYS) until
  // the user clicks in it. Only started while the question box (or nothing)
  // has focus, so a panel the user is working in is never guarded.
  function startPanelFocusGuard(panel) {
    const active = document.activeElement;
    if (active !== document.getElementById('unified-input') && active !== document.body && active) {
      return;
    }
    panelFocusGuardCounter += 1;
    const requestId = `focus-guard-${Date.now()}-${panelFocusGuardCounter}`;
    panelFocusGuardIds.set(panel.id, requestId);
    setTimeout(() => {
      if (panelFocusGuardIds.get(panel.id) === requestId) panelFocusGuardIds.delete(panel.id);
    }, PANEL_FOCUS_GUARD_MS);
    panel.iframe.contentWindow?.postMessage({
      type: PANELIZE_FOCUS_GUARD,
      context: 'multi-panel',
      active: true,
      requestId,
      durationMs: PANEL_FOCUS_GUARD_MS
    }, '*');
  }

  function stopPanelFocusGuards() {
    panelFocusGuardIds.forEach((requestId, panelId) => {
      getPanelsController().panels.find(panel => panel.id === panelId)?.iframe?.contentWindow?.postMessage({
        type: PANELIZE_FOCUS_GUARD, context: 'multi-panel', active: false, requestId
      }, '*');
    });
    panelFocusGuardIds.clear();
  }

  // Keys a guarded panel caught are typed into the question box at the caret;
  // '\b' deletes like Backspace.
  function insertForwardedKeys(keys) {
    const input = document.getElementById('unified-input');
    if (!input || isFocusInOpenModal()) {
      return;
    }
    for (const key of keys) {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      if (key === '\b') {
        if (start !== end) input.setRangeText('', start, end, 'end');
        else if (start > 0) input.setRangeText('', start - 1, start, 'end');
      } else {
        input.setRangeText(key, start, end, 'end');
      }
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    focusUnifiedInput({ force: true });
  }

  // The click that moved focus into the panel also blurred the unified input,
  // and the restore pulled focus back before the provider's USER_INTERACTION
  // message arrived. Return focus to the panel the user actually chose.
  function returnFocusToPanel(panel) {
    if (document.activeElement !== document.getElementById('unified-input')) {
      return;
    }
    panel.iframe.focus();
    panel.iframe.contentWindow?.postMessage({
      type: 'PANELIZE_RESTORE_USER_FOCUS',
      context: 'multi-panel'
    }, '*');
  }

  function createSendFocusRequestId() {
    sendFocusRequestCounter += 1;
    return `send-focus-${Date.now()}-${sendFocusRequestCounter}`;
  }

  function clearSendFocusProviderTimeout(timeoutMap, panelId) {
    const timerId = timeoutMap.get(panelId);
    if (typeof timerId === 'number') {
      clearTimeout(timerId);
    }
    timeoutMap.delete(panelId);
  }

  function maybeStopSendFocusRestore() {
    if (sendFocusRestoreTimerIds.length > 0) {
      return;
    }

    if (sendFocusActivePanelIds.size > 0 || sendFocusFillingPanelIds.size > 0) {
      return;
    }

    cancelUnifiedInputFocusRestoreAfterSend();
  }

  function getChatgptPanelsWithFrames() {
    return getPanelsController().panels.filter(panel => (
      isChatgptProvider(panel.providerId) &&
      panel.iframe &&
      panel.iframe.contentWindow
    ));
  }

  function scheduleChatgptBusyDetectionTimeout(panel, requestId) {
    clearSendFocusProviderTimeout(sendFocusBusyDetectionTimeoutIds, panel.id);

    const timerId = setTimeout(() => {
      if (activeSendFocusRequestId !== requestId) {
        return;
      }

      sendFocusBusyDetectionTimeoutIds.delete(panel.id);
    }, SEND_FOCUS_NO_BUSY_TIMEOUT_MS);

    sendFocusBusyDetectionTimeoutIds.set(panel.id, timerId);
  }

  function scheduleChatgptHardTimeout(panelId, requestId) {
    clearSendFocusProviderTimeout(sendFocusHardTimeoutIds, panelId);

    const timerId = setTimeout(() => {
      if (activeSendFocusRequestId !== requestId) {
        return;
      }

      console.warn('[Multi-Panel] Releasing send focus protection after ChatGPT hard timeout:', panelId);
      sendFocusActivePanelIds.delete(panelId);
      sendFocusHardTimeoutIds.delete(panelId);
      maybeStopSendFocusRestore();
    }, SEND_FOCUS_HARD_TIMEOUT_MS);

    sendFocusHardTimeoutIds.set(panelId, timerId);
  }

  function handleSendFocusProviderBusy(panel, requestId) {
    if (activeSendFocusRequestId !== requestId) {
      return;
    }

    clearSendFocusProviderTimeout(sendFocusBusyDetectionTimeoutIds, panel.id);
    sendFocusActivePanelIds.add(panel.id);
    isRestoringFocusAfterSend = true;
    scheduleChatgptHardTimeout(panel.id, requestId);
    focusUnifiedInput({ force: true });
  }

  function handleSendFocusProviderIdle(panel, requestId) {
    if (activeSendFocusRequestId !== requestId) {
      return;
    }

    clearSendFocusProviderTimeout(sendFocusBusyDetectionTimeoutIds, panel.id);
    clearSendFocusProviderTimeout(sendFocusHardTimeoutIds, panel.id);
    sendFocusActivePanelIds.delete(panel.id);
    maybeStopSendFocusRestore();
  }

  function restoreUnifiedInputFocusAfterSend(trackedPanels = [], requestId = createSendFocusRequestId()) {
    cancelUnifiedInputFocusRestoreAfterSend();
    isRestoringFocusAfterSend = true;
    activeSendFocusRequestId = requestId;

    trackedPanels.forEach(panel => scheduleChatgptBusyDetectionTimeout(panel, activeSendFocusRequestId));

    SEND_FOCUS_RESTORE_DELAYS.forEach((delay, index) => {
      const timerId = setTimeout(() => {
        if (!isRestoringFocusAfterSend || activeSendFocusRequestId !== requestId) {
          return;
        }

        if (index === SEND_FOCUS_RESTORE_DELAYS.length - 1) {
          sendFocusRestoreTimerIds = [];
          maybeStopSendFocusRestore();
        }

        // After the stop above, so a finished restore still gets this frame.
        focusUnifiedInput({ force: true });
      }, delay);

      sendFocusRestoreTimerIds.push(timerId);
    });

    return requestId;
  }

  return {
    get activeNewChatFocusRequestId() { return activeNewChatFocusRequestId; },
    get activeSendFocusRequestId() { return activeSendFocusRequestId; },
    cancelUnifiedInputFocusRestore,
    cancelUnifiedInputFocusRestoreAfterSend,
    createSendFocusRequestId,
    finishNewChatFocusRestore,
    focusUnifiedInput,
    getChatgptPanelsWithFrames,
    handleSendFocusProviderBusy,
    handleSendFocusProviderIdle,
    insertForwardedKeys,
    get isRestoringFocusAfterNewChat() { return isRestoringFocusAfterNewChat; },
    get isRestoringFocusAfterSend() { return isRestoringFocusAfterSend; },
    isUnifiedInputOrNewChatControl,
    isUnifiedInputOrSendControl,
    maybeStopSendFocusRestore,
    get panelFocusGuardIds() { return panelFocusGuardIds; },
    restoreUnifiedInputFocusAfterNewChat,
    restoreUnifiedInputFocusAfterSend,
    returnFocusToPanel,
    get sendFocusFillingPanelIds() { return sendFocusFillingPanelIds; },
    shouldPreserveUnifiedInputFocus,
    startPanelFocusGuard,
    stopPanelFocusGuards,
  };
}
