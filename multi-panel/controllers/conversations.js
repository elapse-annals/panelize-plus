/**
 * Owns conversations behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { getProviderById } from '../../modules/providers/providers.js';
import { getGoogleProviderUrl } from '../../modules/providers/google-mode.js';
import { runNewChatBatch } from '../../modules/panels/new-chat-actions.js';
import { getLocalizedText, isGoogleProvider, showToast } from './ui.js';

export function createConversationsController({
  getAnswersController,
  getComposerController,
  getFocusController,
  getPanelsController,
  getProviderControlsController,
  getSendingController
}) {
  let tempChatRetryTimerIds = new Map();

  let tempChatCleanupTimerId = null;

  let tempChatPendingPanelIds = new Set();

  let tempChatButtonRestoreTimerId = null;

  let isTemporaryChatModeEnabled = false;

  let isNewChatBusy = false;

  let failedNewChatPanelIds = new Set();

  const newChatResults = new Map();

  let newChatStatusHideTimerId = null;

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

  async function newChatAllProviders({ retryFailed = false } = {}) {
    if (isNewChatBusy || getSendingController().broadcastGate.isActive() || getComposerController().composerControls?.isTierBusy()) return;
    const targetPanels = getPanelsController().panels.filter(panel => !retryFailed || failedNewChatPanelIds.has(panel.id))
      .map(({ id, providerId, iframe }) => ({ id, providerId, iframe }));
    if (!targetPanels.length) return;
    isNewChatBusy = true;
    getSendingController().catchUpSends.clear();
    getSendingController().updateSendHold();
    setTemporaryChatButtonDisabled(true);
    const buttons = ['new-chat-btn', 'composer-new-chat-btn', 'retry-new-chat-btn'].map(id => document.getElementById(id));
    buttons.forEach(button => { button.disabled = true; });
    const row = document.getElementById('new-chat-status-row');
    const status = document.getElementById('new-chat-status');
    const retry = document.getElementById('retry-new-chat-btn');
    clearTimeout(newChatStatusHideTimerId);
    row.hidden = false;
    status.textContent = getLocalizedText('composerStartingChatsHold', 'Starting new conversations… Sending is paused; keep typing.');
    retry.hidden = true;
    if (!retryFailed) {
      failedNewChatPanelIds.clear();
      newChatResults.clear();
    }
    const requestId = `new-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      if (isTemporaryChatModeEnabled) startTemporaryChatActivationCycle();
      getFocusController().restoreUnifiedInputFocusAfterNewChat(requestId);
      const { results } = await runNewChatBatch({
        panels: targetPanels,
        requestId,
        providerModes: getProviderControlsController().getPanelProviderMode,
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
      const failedNames = getPanelsController().panels.filter(panel => failedNewChatPanelIds.has(panel.id)).map(panel => getProviderById(panel.providerId)?.name || panel.providerId);
      const confirmedCount = getPanelsController().panels.filter(panel => {
        const result = newChatResults.get(panel.id);
        return result?.provider === panel.providerId && result.ok;
      }).length;
      status.textContent = failedNames.length
        ? getLocalizedText('composerNewChatsPartial', '$1 confirmed; not confirmed: $2', [String(confirmedCount), failedNames.join(', ')])
        : getLocalizedText('composerNewChatsDone', '$1 new conversations ready', [String(confirmedCount)]);
      retry.hidden = failedNames.length === 0;
      // A full success needs no action; failures stay until retried or dismissed.
      if (!failedNames.length) newChatStatusHideTimerId = setTimeout(() => { row.hidden = true; }, getSendingController().NEW_CHAT_STATUS_AUTO_HIDE_MS);
      const successful = targetPanels.filter(panel => currentResults.some(result => result.panelId === panel.id && result.ok));
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
      status.textContent = getLocalizedText('composerNotConfirmed', 'Not confirmed');
      targetPanels.forEach(panel => {
        if (getPanelsController().findCurrentPanel(panel)) failedNewChatPanelIds.add(panel.id);
      });
      retry.hidden = false;
    } finally {
      isNewChatBusy = false;
      getFocusController().finishNewChatFocusRestore(requestId);
      getSendingController().updateSendHold();
      buttons.forEach(button => { button.disabled = false; });
      setTemporaryChatButtonDisabled(false);
    }
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
    get failedNewChatPanelIds() { return failedNewChatPanelIds; },
    getTemporaryChatUrl,
    get isNewChatBusy() { return isNewChatBusy; },
    get isTemporaryChatModeEnabled() { return isTemporaryChatModeEnabled; },
    isUrlDrivenTemporaryChatProvider,
    newChatAllProviders,
    get newChatResults() { return newChatResults; },
    get newChatStatusHideTimerId() { return newChatStatusHideTimerId; },
    requiresTemporaryChatActivationRetry,
    startTemporaryChatActivationForPanel,
    get tempChatPendingPanelIds() { return tempChatPendingPanelIds; },
    temporaryChatAllProviders,
    updateTemporaryChatButtonState,
  };
}
