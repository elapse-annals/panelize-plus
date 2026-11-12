/**
 * Owns conversations behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { getProviderById } from '../../modules/providers/providers.js';
import { getGoogleProviderUrl } from '../../modules/providers/google-mode.js';
import { runNewChatBatch } from '../../modules/panels/new-chat-actions.js';
import {
  clearFreshChat,
  createFreshChatState,
  isFreshChatUsable,
  markFreshChatCompleted,
  markSendCompleted as markFreshChatSendCompleted
} from '../../modules/panels/new-chat-freshness.js';
import { COMPOSER_STATUS_PRIORITY } from './composer-status.js';
import { getLocalizedText, isGoogleProvider, showToast } from './ui.js';

export function createConversationsController({
  getAnswersController,
  getComposerController,
  getComposerStatusController,
  getFocusController,
  getPanelsController,
  getPresentationController,
  getProviderControlsController,
  getSendingController
}) {
  let tempChatRetryTimerIds = new Map();

  let tempChatCleanupTimerId = null;

  let tempChatPendingPanelIds = new Set();

  let tempChatButtonRestoreTimerId = null;

  let isTemporaryChatModeEnabled = false;

  let isNewChatBusy = false;

  let newChatPromise = null;

  const freshChatState = createFreshChatState();

  let failedNewChatPanelIds = new Set();

  const newChatResults = new Map();

  const TEMP_CHAT_RETRY_DELAYS = [1200, 2500, 4000];

  const TEMP_CHAT_OPERATION_TIMEOUT_MS = 5000;

  const TEMP_CHAT_SUPPORTED_PROVIDERS = new Set(['chatgpt', 'gemini', 'claude', 'grok', 'yuanbao']);

  const TEMP_CHAT_RETRY_PROVIDERS = new Set(['gemini', 'grok', 'yuanbao']);

  const TEMP_CHAT_URLS = {
    chatgpt: 'https://chatgpt.com/?temporary-chat=true',
    claude: 'https://claude.ai/new?incognito',
    grok: 'https://grok.com/c#private'
  };

  const TEMP_CHAT_NORMAL_URLS = {
    chatgpt: 'https://chatgpt.com/',
    claude: 'https://claude.ai/new',
    gemini: 'https://gemini.google.com/',
    grok: 'https://grok.com/',
    yuanbao: getProviderById('yuanbao').url
  };

  function isTemporaryChatSupportedProvider(providerId) {
    return TEMP_CHAT_SUPPORTED_PROVIDERS.has(providerId);
  }

  function requiresTemporaryChatActivationRetry(providerId) {
    return TEMP_CHAT_RETRY_PROVIDERS.has(providerId);
  }

  function isUrlDrivenTemporaryChatProvider(providerId) {
    return Object.prototype.hasOwnProperty.call(TEMP_CHAT_URLS, providerId);
  }

  function getTemporaryChatUrl(providerId) {
    return TEMP_CHAT_URLS[providerId] || null;
  }

  function getTemporaryChatNormalUrl(providerId) {
    if (Object.prototype.hasOwnProperty.call(TEMP_CHAT_NORMAL_URLS, providerId)) {
      return TEMP_CHAT_NORMAL_URLS[providerId];
    }

    const provider = getProviderById(providerId);
    if (!provider) {
      return '';
    }

    return isGoogleProvider(providerId)
      ? getGoogleProviderUrl(getProviderControlsController().currentGoogleProviderMode)
      : provider.url;
  }

  function postNewChatToPanel(panel) {
    if (!panel || !panel.iframe || !panel.iframe.contentWindow) {
      return;
    }

    panel.iframe.contentWindow.postMessage({
      type: 'NEW_CHAT',
      providerMode: getProviderControlsController().getPanelProviderMode(panel),
      context: 'multi-panel'
    }, '*');
  }

  function setTemporaryChatButtonDisabled(disabled) {
    const temporaryChatBtn = document.getElementById('temporary-chat-btn');
    if (temporaryChatBtn) {
      temporaryChatBtn.disabled = disabled || isNewChatBusy;
    }
  }

  function updateTemporaryChatButtonState() {
    const temporaryChatBtn = document.getElementById('temporary-chat-btn');
    if (!temporaryChatBtn) {
      return;
    }

    temporaryChatBtn.classList.toggle('active', isTemporaryChatModeEnabled);
    temporaryChatBtn.setAttribute('aria-pressed', isTemporaryChatModeEnabled ? 'true' : 'false');
  }

  function setTemporaryChatModeEnabled(enabled) {
    isTemporaryChatModeEnabled = Boolean(enabled);
    getPanelsController().saveStartupSnapshot();
    updateTemporaryChatButtonState();
  }

  function clearTemporaryChatButtonRestoreTimer() {
    if (typeof tempChatButtonRestoreTimerId === 'number') {
      clearTimeout(tempChatButtonRestoreTimerId);
    }
    tempChatButtonRestoreTimerId = null;
  }

  function scheduleTemporaryChatButtonRestore(delay = 1000) {
    clearTemporaryChatButtonRestoreTimer();
    tempChatButtonRestoreTimerId = setTimeout(() => {
      tempChatButtonRestoreTimerId = null;
      setTemporaryChatButtonDisabled(false);
    }, delay);
  }

  function clearTemporaryChatRetriesForPanel(panelId) {
    const timerIds = tempChatRetryTimerIds.get(panelId) || [];
    timerIds.forEach(timerId => clearTimeout(timerId));
    tempChatRetryTimerIds.delete(panelId);
  }

  function cancelTemporaryChatActivation({ restoreButton = true } = {}) {
    tempChatRetryTimerIds.forEach((timerIds) => {
      timerIds.forEach(timerId => clearTimeout(timerId));
    });
    tempChatRetryTimerIds.clear();
    tempChatPendingPanelIds.clear();
    clearTemporaryChatButtonRestoreTimer();

    if (typeof tempChatCleanupTimerId === 'number') {
      clearTimeout(tempChatCleanupTimerId);
    }
    tempChatCleanupTimerId = null;

    if (restoreButton) {
      setTemporaryChatButtonDisabled(false);
    }
  }

  function startTemporaryChatActivationForPanel(panel) {
    if (!panel || !requiresTemporaryChatActivationRetry(panel.providerId) || !panel.iframe || !panel.iframe.contentWindow) {
      return;
    }

    clearTemporaryChatRetriesForPanel(panel.id);
    tempChatPendingPanelIds.add(panel.id);
    TEMP_CHAT_RETRY_DELAYS.forEach(delay => scheduleTemporaryChatRetry(panel, delay));
  }

  function startTemporaryChatActivationCycle() {
    cancelTemporaryChatActivation({ restoreButton: false });
    setTemporaryChatButtonDisabled(true);
    scheduleTemporaryChatButtonRestore();
    tempChatCleanupTimerId = setTimeout(() => {
      cancelTemporaryChatActivation();
    }, TEMP_CHAT_OPERATION_TIMEOUT_MS);
  }

  function startFreshChatForPanel(panel) {
    if (!panel) {
      return;
    }

    if (!isTemporaryChatModeEnabled) {
      postNewChatToPanel(panel);
      return;
    }

    if (requiresTemporaryChatActivationRetry(panel.providerId) && !isUrlDrivenTemporaryChatProvider(panel.providerId)) {
      postNewChatToPanel(panel);
      startTemporaryChatActivationForPanel(panel);
      return;
    }

    if (isUrlDrivenTemporaryChatProvider(panel.providerId)) {
      getProviderControlsController().reloadPanelIframe(panel, getTemporaryChatUrl(panel.providerId));
      return;
    }

    postNewChatToPanel(panel);
  }

  // Initial panel creation loads the provider's own entry page, which some
  // providers restore to the last conversation. Ask for a blank conversation
  // quietly: no status row, no focus restore, and no click when it is already
  // fresh. Temporary chat keeps its dedicated activation flow.
  async function ensureFreshChat(panel) {
    if (isTemporaryChatModeEnabled || !panel?.iframe?.contentWindow) return;
    if (!getPanelsController().findCurrentPanel(panel)) return;

    try {
      await runNewChatBatch({
        panels: [panel],
        requestId: `ensure-fresh-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        providerModes: getProviderControlsController().getPanelProviderMode,
        timeoutMs: 30000,
        ensureFresh: true,
        dispatch(targetPanel, message) {
          if (!getPanelsController().findCurrentPanel(targetPanel)) throw new Error('Panel changed');
          targetPanel.iframe.contentWindow?.postMessage(message, '*');
        }
      });
    } catch (error) {
      console.warn('[New Chat] Could not clear the restored conversation:', error);
    }
  }

  async function newChatAllProviders(options = {}) {
    if (isNewChatBusy) {
      return newChatPromise || {
        ok: false,
        ready: 0,
        total: getPanelsController().panels.length,
        reason: 'busy'
      };
    }
    if (getSendingController().broadcastGate.isActive() || getComposerController().composerControls?.isTierBusy()) {
      return {
        ok: false,
        ready: 0,
        total: getPanelsController().panels.length,
        reason: 'busy'
      };
    }
    const promise = runNewChatAllProviders(options);
    newChatPromise = promise;
    try {
      return await promise;
    } finally {
      if (newChatPromise === promise) newChatPromise = null;
    }
  }

  async function runNewChatAllProviders({ retryFailed = false } = {}) {
    const targetPanels = getPanelsController().panels.filter(panel => !retryFailed || failedNewChatPanelIds.has(panel.id))
      .map(({ id, providerId, iframe }) => ({ id, providerId, iframe }));
    if (!targetPanels.length) {
      return { ok: false, ready: 0, total: 0, reason: 'no-panels' };
    }
    isNewChatBusy = true;
    let outcome = { ok: false, ready: 0, total: targetPanels.length, reason: 'failed' };
    getSendingController().catchUpSends.clear();
    getSendingController().updateSendHold();
    setTemporaryChatButtonDisabled(true);
    const buttons = ['new-chat-btn', 'composer-new-chat-btn', 'retry-new-chat-btn'].map(id => document.getElementById(id));
    buttons.forEach(button => { button.disabled = true; });
    getComposerStatusController().setStatus('new-chat', {
      key: 'new-chat-hold',
      priority: COMPOSER_STATUS_PRIORITY.NEW_CHAT_HOLD,
      text: getLocalizedText('composerStartingChatsHold', 'Starting new conversations… Sending is paused; keep typing.')
    });
    if (!retryFailed) {
      failedNewChatPanelIds.clear();
      newChatResults.clear();
    }
    const requestId = `new-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      if (isTemporaryChatModeEnabled) startTemporaryChatActivationCycle();
      getFocusController().restoreUnifiedInputFocusAfterNewChat(requestId);
      targetPanels.forEach(target => {
        const panel = getPanelsController().findCurrentPanel(target);
        if (panel) getFocusController().startPanelFocusGuard(panel);
      });
      const { results } = await runNewChatBatch({
        panels: targetPanels,
        requestId,
        providerModes: getProviderControlsController().getPanelProviderMode,
        // A provider already showing a blank conversation stays there instead of
        // re-clicking a control that may reopen its last conversation.
        ensureFresh: true,
        dispatch(panel, message) {
          if (!getPanelsController().findCurrentPanel(panel)) throw new Error('Panel changed');
          if (isTemporaryChatModeEnabled && isUrlDrivenTemporaryChatProvider(panel.providerId) && panel.providerId !== 'grok') {
            const onLoad = () => {
              if (!getPanelsController().findCurrentPanel(panel) || !isNewChatBusy) return;
              panel.iframe.contentWindow?.postMessage({ ...message, type: 'VERIFY_NEW_CHAT' }, '*');
            };
            panel.iframe.addEventListener('load', onLoad, { once: true });
            // Do not retain listeners if a provider never finishes loading.
            setTimeout(() => panel.iframe.removeEventListener('load', onLoad), 20000);
            getProviderControlsController().reloadPanelIframe(panel, getTemporaryChatUrl(panel.providerId));
          } else {
            panel.iframe.contentWindow.postMessage(message, '*');
            if (isTemporaryChatModeEnabled) startTemporaryChatActivationForPanel(panel);
          }
        }
      });
      const currentResults = results.filter(result => getPanelsController().findCurrentPanel({ id: result.panelId, providerId: result.provider }));
      currentResults.forEach(result => {
        newChatResults.set(result.panelId, result);
        if (result.ok) failedNewChatPanelIds.delete(result.panelId);
        else failedNewChatPanelIds.add(result.panelId);
      });
      // Display names keep blind mode anonymous while still naming failures.
      const failedNames = getPanelsController().panels
        .filter(panel => failedNewChatPanelIds.has(panel.id))
        .map(panel => getPresentationController().getPanelDisplayName(panel));
      const confirmedCount = getPanelsController().panels.filter(panel => {
        const result = newChatResults.get(panel.id);
        return result?.provider === panel.providerId && result.ok;
      }).length;
      // A full success needs no action; failures stay until retried or dismissed.
      getComposerStatusController().setStatus('new-chat', failedNames.length
        ? {
          key: 'new-chat-failure',
          priority: COMPOSER_STATUS_PRIORITY.NEW_CHAT_FAILURE,
          text: getLocalizedText('composerNewChatsPartial', '$1 confirmed; not confirmed: $2', [String(confirmedCount), failedNames.join(', ')]),
          showRetry: true
        }
        : {
          key: 'new-chat-done',
          priority: COMPOSER_STATUS_PRIORITY.DONE,
          text: getLocalizedText('composerNewChatsDone', '$1 new conversations ready', [String(confirmedCount)]),
          autoHideMs: getSendingController().NEW_CHAT_STATUS_AUTO_HIDE_MS
        });
      const successful = targetPanels.filter(panel => currentResults.some(result => result.panelId === panel.id && result.ok));
      // Only a fully confirmed reset is reusable by the next send.
      const allPanelResults = getPanelsController().panels.map(panel => (
        newChatResults.get(panel.id) || { ok: false }
      ));
      if (!failedNames.length && markFreshChatCompleted(freshChatState, {
        panels: getPanelsController().panels,
        results: allPanelResults
      })) {
        outcome = {
          ok: true,
          ready: confirmedCount,
          total: getPanelsController().panels.length,
          reason: ''
        };
      } else {
        clearFreshChat(freshChatState);
        outcome = {
          ok: false,
          ready: confirmedCount,
          total: getPanelsController().panels.length,
          reason: failedNames.length ? 'partial' : 'failed'
        };
      }
      // Clear answer attribution only after the provider confirmed a fresh chat.
      if (successful.length) {
        successful.forEach(target => {
          const panel = getPanelsController().findCurrentPanel(target);
          if (panel) panel.clearedAnswerRoundId = getAnswersController().latestAnswerRoundId;
        });
        getAnswersController().updateAnswerFeedbackButtons();
        getPanelsController().renderPanelActivity();
        await getComposerController().composerControls?.restoreTier(successful);
      }
    } catch (error) {
      clearFreshChat(freshChatState);
      outcome = {
        ok: false,
        ready: 0,
        total: getPanelsController().panels.length,
        reason: 'failed'
      };
      targetPanels.forEach(panel => {
        if (getPanelsController().findCurrentPanel(panel)) failedNewChatPanelIds.add(panel.id);
      });
      getComposerStatusController().setStatus('new-chat', {
        key: 'new-chat-failure',
        priority: COMPOSER_STATUS_PRIORITY.NEW_CHAT_FAILURE,
        text: getLocalizedText('composerNotConfirmed', 'Not confirmed'),
        showRetry: true
      });
    } finally {
      isNewChatBusy = false;
      getFocusController().finishNewChatFocusRestore(requestId);
      getSendingController().updateSendHold();
      buttons.forEach(button => { button.disabled = false; });
      setTemporaryChatButtonDisabled(false);
    }
    return outcome;
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Guarantees fresh conversations before a Mac-originated send. A reset that
   * just completed (and has not been used) is reused; an in-flight reset is
   * awaited; a partial reset retries only the failed panels.
   */
  async function ensureNewChatForSend() {
    const panels = getPanelsController().panels;
    if (isFreshChatUsable(freshChatState, panels)) {
      return { ok: true, ready: panels.length, total: panels.length, skipped: true };
    }

    if (newChatPromise) {
      const pendingResult = await newChatPromise.catch(() => null);
      if (isFreshChatUsable(freshChatState, getPanelsController().panels)) {
        return { ...(pendingResult || {}), ok: true, skipped: true };
      }
      if (pendingResult?.reason === 'partial') {
        return newChatAllProviders({ retryFailed: true });
      }
    }

    if (isNewChatBusy) {
      const deadline = Date.now() + 30 * 1000;
      while (isNewChatBusy && Date.now() < deadline) {
        await wait(100);
      }
      if (isFreshChatUsable(freshChatState, getPanelsController().panels)) {
        return { ok: true, ready: panels.length, total: panels.length, skipped: true };
      }
    }

    return newChatAllProviders();
  }

  function markSendCompleted() {
    markFreshChatSendCompleted(freshChatState);
  }

  function scheduleTemporaryChatRetry(panel, delay) {
    const timerId = setTimeout(() => {
      if (!tempChatPendingPanelIds.has(panel.id) || !panel.iframe || !panel.iframe.contentWindow) {
        return;
      }

      getFocusController().focusUnifiedInput({ force: true });
      panel.iframe.contentWindow.postMessage({
        type: 'ENABLE_TEMP_CHAT',
        providerMode: getProviderControlsController().getPanelProviderMode(panel),
        context: 'multi-panel'
      }, '*');
    }, delay);

    const timerIds = tempChatRetryTimerIds.get(panel.id) || [];
    timerIds.push(timerId);
    tempChatRetryTimerIds.set(panel.id, timerIds);
  }

  async function temporaryChatAllProviders() {
    if (isNewChatBusy || getSendingController().broadcastGate.isActive() || getComposerController().composerControls?.isTierBusy()) return;
    if (isTemporaryChatModeEnabled) {
      cancelTemporaryChatActivation({ restoreButton: false });
      setTemporaryChatModeEnabled(false);
      setTemporaryChatButtonDisabled(true);

      getPanelsController().panels.forEach(panel => {
        if (isTemporaryChatSupportedProvider(panel.providerId)) {
          getProviderControlsController().reloadPanelIframe(panel, getTemporaryChatNormalUrl(panel.providerId));
          return;
        }

        postNewChatToPanel(panel);
      });

      getFocusController().restoreUnifiedInputFocusAfterNewChat();
      showToast('Temporary chat disabled');

      scheduleTemporaryChatButtonRestore();
      return;
    }

    setTemporaryChatModeEnabled(true);
    startTemporaryChatActivationCycle();

    getPanelsController().panels.forEach(panel => {
      startFreshChatForPanel(panel);
    });

    getFocusController().restoreUnifiedInputFocusAfterNewChat();

    showToast('Temporary chat enabled where supported');
  }

  return {
    clearTemporaryChatRetriesForPanel,
    ensureFreshChat,
    ensureNewChatForSend,
    get failedNewChatPanelIds() { return failedNewChatPanelIds; },
    getTemporaryChatUrl,
    get isFreshChatReady() { return isFreshChatUsable(freshChatState, getPanelsController().panels); },
    get isNewChatBusy() { return isNewChatBusy; },
    get isTemporaryChatModeEnabled() { return isTemporaryChatModeEnabled; },
    isUrlDrivenTemporaryChatProvider,
    markSendCompleted,
    newChatAllProviders,
    get newChatResults() { return newChatResults; },
    requiresTemporaryChatActivationRetry,
    startTemporaryChatActivationForPanel,
    get tempChatPendingPanelIds() { return tempChatPendingPanelIds; },
    temporaryChatAllProviders,
    updateTemporaryChatButtonState,
  };
}
