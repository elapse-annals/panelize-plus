/**
 * Owns messaging behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import {
  GLOBAL_SEND_ACTION,
  GLOBAL_SEND_MAX_PROGRESS_NAMES,
  GLOBAL_SEND_PROGRESS_ACTION,
  GLOBAL_SEND_RESULT_ACTION,
  NEW_CHAT_ACTION,
  NEW_CHAT_RESULT_ACTION,
  normalizeGlobalPrompt,
  normalizeGlobalPromptMode,
  normalizeRequestId
} from '../../modules/platform/global-send.js';
import { isProviderAllowedUrl, isProviderCurrentUrl } from '../../modules/providers/provider-open-url.js';
import { SHARE_SNAPSHOT_ACTION } from '../../modules/snapshots/share-trigger.js';
import {
  PANELIZE_COMPOSER_READY,
  PANEL_READY_STATE,
  PANEL_READY_TIMEOUT_MS,
  isSendHeldByReadiness,
  summarizePanelReadiness
} from '../../modules/panels/panel-readiness.js';
import { MULTI_PANEL_PROVIDER_STATUS_CONTEXT, PANELIZE_ANSWER_ENGAGEMENT, PANELIZE_ANSWER_TEXT, PANELIZE_FORWARD_KEYS, PANELIZE_LOCATE_ANSWER_RESULT, PANELIZE_PAGE_WIDTH, PANELIZE_PROVIDER_BUSY, PANELIZE_PROVIDER_IDLE, PANELIZE_PROVIDER_LOCATION, PANELIZE_PROVIDER_USER_INTERACTION, PANELIZE_REFOCUS_UNIFIED_INPUT, PANELIZE_RESPONSE_TIMING, PANELIZE_TEMP_CHAT_ENABLED } from './protocol.js';
import { isChatgptProvider } from './ui.js';

export function createMessagingController({
  getAnswersController,
  getConversationsController,
  getFocusController,
  getLayoutController,
  getPanelsController,
  getPresentationController,
  getPromptsController,
  getSendingController,
  getSharingController,
  getSummaryController
}) {
  const PENDING_MULTI_PANEL_ACTION_KEY = 'pendingMultiPanelAction';
  const PENDING_NEW_CHAT_REQUEST_KEY = 'pendingNewChatRequest';

  const handledGlobalSendRequestIds = new Set();

  const handledNewChatRequestIds = new Set();

  const GLOBAL_SEND_READY_TIMEOUT_MS = PANEL_READY_TIMEOUT_MS + 5000;

  let isInitialized = false;

  function handleProviderStatusMessage(event) {
    const data = event?.data;
    if (!data || typeof data !== 'object') {
      return;
    }

    const isTempChatMessage = data.type === PANELIZE_TEMP_CHAT_ENABLED;
    const isLocationMessage = data.type === PANELIZE_PROVIDER_LOCATION;
    const isPageWidthMessage = data.type === PANELIZE_PAGE_WIDTH;
    const isComposerReadyMessage = data.type === PANELIZE_COMPOSER_READY;
    if (data.context !== MULTI_PANEL_PROVIDER_STATUS_CONTEXT
      || (!data.requestId && !isTempChatMessage && !isLocationMessage && !isPageWidthMessage && !isComposerReadyMessage)) {
      return;
    }

    const panel = getPanelsController().panels.find(candidate => candidate.iframe?.contentWindow === event.source);
    if (!panel || data.provider !== panel.providerId) {
      return;
    }

    switch (data.type) {
      case PANELIZE_PROVIDER_LOCATION:
        if (!isProviderAllowedUrl(panel.providerId, data.url)) {
          return;
        }
        panel.currentUrl = isProviderCurrentUrl(panel.providerId, data.url) ? data.url : null;
        break;
      case PANELIZE_PAGE_WIDTH:
        if (!Number.isFinite(data.neededWidth) || data.neededWidth < 0) {
          return;
        }
        panel.pageNeededWidth = data.neededWidth;
        getLayoutController().updatePanelFit(panel);
        break;
      case PANELIZE_COMPOSER_READY:
        if (panel.readyState !== PANEL_READY_STATE.READY) {
          getSendingController().setPanelReadyState(panel, PANEL_READY_STATE.READY);
        }
        break;
      case PANELIZE_PROVIDER_BUSY:
        if (!isChatgptProvider(panel.providerId)) {
          return;
        }
        getFocusController().handleSendFocusProviderBusy(panel, data.requestId);
        break;
      case PANELIZE_PROVIDER_IDLE:
        if (!isChatgptProvider(panel.providerId)) {
          return;
        }
        getFocusController().handleSendFocusProviderIdle(panel, data.requestId);
        break;
      case PANELIZE_PROVIDER_USER_INTERACTION:
        if (data.requestId === getFocusController().activeSendFocusRequestId) {
          getFocusController().cancelUnifiedInputFocusRestoreAfterSend();
          getFocusController().returnFocusToPanel(panel);
        } else if (data.requestId === getFocusController().activeNewChatFocusRequestId) {
          getFocusController().cancelUnifiedInputFocusRestore();
          getFocusController().returnFocusToPanel(panel);
        } else if (data.requestId === getFocusController().panelFocusGuardIds.get(panel.id)) {
          // The user chose this panel: stop pulling focus back to the question box.
          getFocusController().stopPanelFocusGuard(panel.id);
          getPanelsController().loadingPanelIds.delete(panel.id);
          getFocusController().returnFocusToPanel(panel);
        }
        break;
      case PANELIZE_REFOCUS_UNIFIED_INPUT:
        if (data.requestId === getFocusController().panelFocusGuardIds.get(panel.id)) {
          getFocusController().focusUnifiedInput({ force: true });
        }
        break;
      case PANELIZE_FORWARD_KEYS:
        if (data.requestId !== getFocusController().panelFocusGuardIds.get(panel.id) || typeof data.keys !== 'string') {
          return;
        }
        getFocusController().insertForwardedKeys(data.keys.slice(0, 2000));
        break;
      case PANELIZE_RESPONSE_TIMING:
        getAnswersController().handleAnswerTimingMessage(panel, data);
        break;
      case PANELIZE_ANSWER_ENGAGEMENT:
        getAnswersController().handleAnswerEngagementMessage(panel, data);
        break;
      case PANELIZE_ANSWER_TEXT:
        getSummaryController().handleAnswerTextMessage(panel, data);
        break;
      case PANELIZE_LOCATE_ANSWER_RESULT:
        getSummaryController().handleLocateAnswerResult(panel, data);
        break;
      case PANELIZE_TEMP_CHAT_ENABLED:
        if (!getConversationsController().tempChatPendingPanelIds.has(panel.id)) {
          return;
        }
        getConversationsController().clearTemporaryChatRetriesForPanel(panel.id);
        getConversationsController().tempChatPendingPanelIds.delete(panel.id);
        break;
      default:
        break;
    }
  }

  async function getPendingMultiPanelAction() {
    try {
      const result = await chrome.storage.session.get(PENDING_MULTI_PANEL_ACTION_KEY);
      if (result && result[PENDING_MULTI_PANEL_ACTION_KEY]) {
        return result[PENDING_MULTI_PANEL_ACTION_KEY];
      }
    } catch (error) {
      // Ignore session storage errors
    }

    try {
      const result = await chrome.storage.local.get(PENDING_MULTI_PANEL_ACTION_KEY);
      return result ? result[PENDING_MULTI_PANEL_ACTION_KEY] : null;
    } catch (error) {
      return null;
    }
  }

  async function clearPendingMultiPanelAction() {
    try {
      await chrome.storage.session.remove(PENDING_MULTI_PANEL_ACTION_KEY);
    } catch (error) {
      // Ignore session storage errors
    }

    try {
      await chrome.storage.local.remove(PENDING_MULTI_PANEL_ACTION_KEY);
    } catch (error) {
      // Ignore local storage errors
    }
  }

  async function handlePendingMultiPanelAction() {
    const pendingAction = await getPendingMultiPanelAction();
    if (!pendingAction || !pendingAction.action) {
      return;
    }

    const handled = await handleMultiPanelAction(pendingAction.action, pendingAction.payload || {});
    if (handled) {
      await clearPendingMultiPanelAction();
    }
  }

  async function getPendingNewChatRequest() {
    try {
      const result = await chrome.storage.session.get(PENDING_NEW_CHAT_REQUEST_KEY);
      if (result && result[PENDING_NEW_CHAT_REQUEST_KEY]) {
        return result[PENDING_NEW_CHAT_REQUEST_KEY];
      }
    } catch (error) {
      // Ignore session storage errors
    }

    try {
      const result = await chrome.storage.local.get(PENDING_NEW_CHAT_REQUEST_KEY);
      return result ? result[PENDING_NEW_CHAT_REQUEST_KEY] : null;
    } catch (error) {
      return null;
    }
  }

  async function clearPendingNewChatRequest() {
    try {
      await chrome.storage.session.remove(PENDING_NEW_CHAT_REQUEST_KEY);
    } catch (error) {
      // Ignore session storage errors
    }

    try {
      await chrome.storage.local.remove(PENDING_NEW_CHAT_REQUEST_KEY);
    } catch (error) {
      // Ignore local storage errors
    }
  }

  function rememberNewChatRequest(requestId) {
    handledNewChatRequestIds.add(requestId);
    while (handledNewChatRequestIds.size > 64) {
      handledNewChatRequestIds.delete(handledNewChatRequestIds.values().next().value);
    }
  }

  async function reportNewChatResult(requestId, outcome) {
    if (!requestId) return;
    try {
      await chrome.runtime.sendMessage({
        action: NEW_CHAT_RESULT_ACTION,
        payload: {
          requestId,
          ok: outcome?.ok === true,
          ready: Number.isFinite(outcome?.ready) ? outcome.ready : 0,
          total: Number.isFinite(outcome?.total) ? outcome.total : 0,
          reason: outcome?.reason || ''
        }
      });
    } catch (error) {
      // The background may be stopped; the desktop client times out.
    }
  }

  /**
   * A new-chat command from the desktop. Reusing a fresh, untouched reset is
   * idempotent, so a duplicate pending action or runtime message never resets
   * the panels twice.
   */
  async function handleNewChatAction(payload = {}) {
    const requestId = normalizeRequestId(payload.requestId);
    if (!requestId) {
      return true;
    }
    if (handledNewChatRequestIds.has(requestId)) {
      return true;
    }
    rememberNewChatRequest(requestId);
    const outcome = await getConversationsController().ensureNewChatForSend();
    await reportNewChatResult(requestId, outcome || { ok: false, reason: 'failed' });
    return true;
  }

  async function handlePendingNewChatRequest() {
    const pendingRequest = await getPendingNewChatRequest();
    if (!pendingRequest?.requestId) {
      return;
    }
    const handled = await handleNewChatAction(pendingRequest);
    if (handled) {
      await clearPendingNewChatRequest();
    }
  }

  function rememberGlobalSendRequest(requestId) {
    handledGlobalSendRequestIds.add(requestId);
    while (handledGlobalSendRequestIds.size > 64) {
      handledGlobalSendRequestIds.delete(handledGlobalSendRequestIds.values().next().value);
    }
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getProgressNames(panels, blind) {
    if (blind) {
      return [];
    }
    return panels
      .slice(0, GLOBAL_SEND_MAX_PROGRESS_NAMES)
      .map(panel => getPresentationController().getPanelDisplayName(panel));
  }

  /**
   * The current readiness of the AI panels for the desktop client: counts stay
   * available in blind mode, names are omitted there so the client never shows
   * which AI is behind.
   */
  function describePreparation() {
    const summary = summarizePanelReadiness(getPanelsController().panels);
    const blind = getPresentationController().isBlindModeEnabled;
    return {
      ready: summary.ready.length,
      total: summary.total,
      pendingCount: summary.pending.length,
      timedOutCount: summary.notReady.length,
      pendingNames: getProgressNames(summary.pending, blind),
      timedOutNames: getProgressNames(summary.notReady, blind),
      blind
    };
  }

  async function reportGlobalSendProgress(requestId, stage, state) {
    if (!requestId) {
      return;
    }
    try {
      await chrome.runtime.sendMessage({
        action: GLOBAL_SEND_PROGRESS_ACTION,
        payload: { requestId, stage, ...state }
      });
    } catch (error) {
      // The background may have been stopped; the desktop client times out.
    }
  }

  /**
   * Waits for the same 70% readiness used by an in-extension send, forwarding
   * a progress report only when the counts, names or stage change.
   */
  async function waitForGlobalSendReady(requestId) {
    const deadline = Date.now() + GLOBAL_SEND_READY_TIMEOUT_MS;
    let lastSignature = '';
    const report = async stage => {
      const state = describePreparation();
      const signature = `${stage}|${JSON.stringify(state)}`;
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;
      await reportGlobalSendProgress(requestId, stage, state);
    };

    await report('preparing');
    while (Date.now() < deadline) {
      if (!getConversationsController().isNewChatBusy && !getSendingController().broadcastGate.isActive()
          && !isSendHeldByReadiness(summarizePanelReadiness(getPanelsController().panels))) {
        break;
      }
      await wait(200);
      await report('preparing');
    }
    await report('sending');
  }

  async function reportGlobalSendResult(requestId, outcome) {
    if (!requestId) {
      return;
    }
    try {
      await chrome.runtime.sendMessage({
        action: GLOBAL_SEND_RESULT_ACTION,
        payload: { requestId, ...outcome }
      });
    } catch (error) {
      // The background may have been stopped; the desktop client times out.
    }
  }

  async function handleGlobalSendAction(payload = {}) {
    const requestId = normalizeRequestId(payload.requestId);
    if (requestId && handledGlobalSendRequestIds.has(requestId)) {
      return true;
    }
    // Mark before waiting so the runtime message and pending action delivered by
    // the background cannot both send the same prompt.
    if (requestId) {
      rememberGlobalSendRequest(requestId);
    }

    const prompt = normalizeGlobalPrompt(payload.text);
    if (!prompt.ok) {
      await reportGlobalSendResult(requestId, {
        ok: false,
        sent: 0,
        total: getPanelsController().panels.length,
        reason: prompt.error.code
      });
      return true;
    }

    getPromptsController().applyPromptToInput(prompt.text);
    if (payload.newChat === true) {
      // The extension owns freshness: a reset prepared by the checkbox is
      // reused without clicking new chat again.
      await getConversationsController().ensureNewChatForSend();
    }
    await waitForGlobalSendReady(requestId);
    const promptMode = normalizeGlobalPromptMode(payload.promptMode);
    const outcome = await getSendingController().broadcastMessage(prompt.text, true, { promptMode });
    await reportGlobalSendResult(requestId, outcome || { ok: false, reason: 'send-failed' });
    return true;
  }

  async function handleMultiPanelAction(action, payload = {}) {
    if (action === GLOBAL_SEND_ACTION) {
      return handleGlobalSendAction(payload);
    }

    if (action === NEW_CHAT_ACTION) {
      return handleNewChatAction(payload);
    }

    if (action === 'openPromptLibrary') {
      if (payload.selectedText) {
        getPromptsController().applyPromptToInput(payload.selectedText);
      }
      getPromptsController().openPromptModal();
      return true;
    }

    if (action === 'sendToPanel') {
      if (payload.selectedText) {
        getPromptsController().applyPromptToInput(payload.selectedText);
      }
      return true;
    }

    if (action === 'switchProvider') {
      if (payload.providerId && getPanelsController().panels.length > 0) {
        await getPanelsController().switchPanelProvider(getPanelsController().panels[0].id, payload.providerId);
      }
      if (payload.selectedText) {
        getPromptsController().applyPromptToInput(payload.selectedText);
      }
      return true;
    }

    return false;
  }

  function registerRuntimeMessageListener() {
    if (!chrome?.runtime?.onMessage) return;

    chrome.runtime.onMessage.addListener((message) => {
      if (!message?.action || !isInitialized) {
        return;
      }

      if (message.action === SHARE_SNAPSHOT_ACTION) {
        getSharingController().handleShareSnapshotRequest(message.payload || {});
        return;
      }

      handleMultiPanelAction(message.action, message.payload || {}).then((handled) => {
        if (!handled) return;
        if (message.action === NEW_CHAT_ACTION) {
          clearPendingNewChatRequest();
        } else {
          clearPendingMultiPanelAction();
        }
      });
    });
  }

  return {
    handlePendingMultiPanelAction,
    handlePendingNewChatRequest,
    handleProviderStatusMessage,
    get isInitialized() { return isInitialized; },
    set isInitialized(value) { isInitialized = value; },
    registerRuntimeMessageListener,
  };
}
