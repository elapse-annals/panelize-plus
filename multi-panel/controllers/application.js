/**
 * Owns application behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { reconcileOptionalProviderAccess } from '../../modules/providers/optional-provider-access.js';
import { DEFAULT_GOOGLE_PROVIDER_MODE, normalizeGoogleProviderMode } from '../../modules/providers/google-mode.js';
import { applyTheme } from '../../modules/platform/theme-manager.js';
import { t, initializeLanguage, translatePage } from '../../modules/platform/i18n.js';
import { getAllPrompts, savePrompt, updatePrompt, deletePrompt, getModePrompts } from '../../modules/prompts/prompt-manager.js';
import { PANEL_WIDE_SCALE, setupPanelResize } from '../../modules/panels/panel-resize.js';
import { QUESTION_HISTORY_STORAGE_KEY, readQuestionHistory } from '../../modules/prompts/question-history.js';
import { setupComposerControls } from '../../modules/composer/composer-controls.js';
import {
  cleanupSamplePrompts,
  ensureDefaultModePrompts,
  ensureDefaultModeTriggers,
  migrateCompetePrompt,
  migrateDeepPrompt
} from '../../modules/prompts/prompt-modes.js';
import { getLocalizedText, refreshThemeAwareProviderIcons, showToast } from './ui.js';

export function createApplicationController({
  getAnswersController,
  getComposerController,
  getConversationsController,
  getFocusController,
  getLayoutController,
  getMessagingController,
  getPanelsController,
  getPresentationController,
  getPromptsController,
  getProviderControlsController,
  getQuestionHistoryController,
  getRatingController,
  getSendingController,
  getSharingController,
  getSummaryController,
  getWindowModeController
}) {
  // ===== Initialization =====
  async function init() {
    document.addEventListener('panelize:themechange', refreshThemeAwareProviderIcons);
    await Promise.all([applyTheme(), initializeLanguage()]);
    translatePage();
    getMessagingController().registerRuntimeMessageListener();
    registerStorageChangeListener();
    getAnswersController().registerAnswerCompleteNotificationClick();

    // Detect window type and load mode, and restore state if needed (after mode
    // switch). The restored state must be saved before the settings are loaded.
    await Promise.all([getWindowModeController().detectWindowType(), getWindowModeController().restoreStateIfNeeded()]);

    // Load saved settings
    await loadSettings();
    // Startup-snapshot panels were created before notes were loaded.
    getPresentationController().renderAllPanelNotes();

    // Initialize panels while the column widths load; the resize handles follow
    // layout changes made meanwhile.
    await Promise.all([
      setupPanelResize({
        grid: document.getElementById('panel-grid'),
        getLayout: () => getLayoutController().currentLayout,
        getWideScale: () => getPresentationController().isWideContentEnabled ? PANEL_WIDE_SCALE : 1,
        storage: chrome.storage.local,
        label: t('panelResizeHandle')
      }).then(controller => { getLayoutController().panelResize = controller; }),
      getPanelsController().initializePanels()
    ]);

    // Setup event listeners
    getComposerController().setupEventListeners();
    void getQuestionHistoryController().setupQuestionHistory();
    getRatingController().setupRatingPrompt();
    getSharingController().setupShareSnapshot();
    getAnswersController().setupAnswerStats();
    getAnswersController().setupAnswerLog();
    getSummaryController().setupAiSummary();
    // Built-in modes join the library once; failure leaves Default only.
    await ensureDefaultModePrompts({
      getAllPrompts, savePrompt, storage: chrome.storage?.local, tr: getLocalizedText
    }).catch(error => console.warn('Could not add the built-in prompt modes', error));
    await migrateCompetePrompt({
      getAllPrompts, updatePrompt, storage: chrome.storage?.local
    }).catch(error => console.warn('Could not update the built-in Challenge prompt', error));
    await migrateDeepPrompt({
      getAllPrompts, updatePrompt, storage: chrome.storage?.local
    }).catch(error => console.warn('Could not update the built-in Deep thinking prompt', error));
    await ensureDefaultModeTriggers({
      getAllPrompts, updatePrompt, storage: chrome.storage?.local
    }).catch(error => console.warn('Could not add the built-in mode trigger words', error));
    await cleanupSamplePrompts({
      getAllPrompts,
      deletePrompt,
      loadSamples: getPromptsController().loadSamplePromptLibraries,
      storage: chrome.storage?.local
    }).catch(error => console.warn('Could not remove the imported sample prompts', error));
    getComposerController().composerControls = await setupComposerControls({
      getPanels: () => getPresentationController().getDisplayedPanels(),
      send: () => getSendingController().broadcastMessage(document.getElementById('unified-input').value, true),
      fill: () => getSendingController().broadcastMessage(document.getElementById('unified-input').value, false),
      newConversation: () => getConversationsController().newChatAllProviders(),
      focusInput: () => getFocusController().focusUnifiedInput({ force: true }),
      openPromptLibrary: getPromptsController().openPromptModal,
      openLayout: getLayoutController().openLayoutModal,
      toggleWideContent: () => getPresentationController().setPageStyleModes({ wide: !getPresentationController().isWideContentEnabled }),
      scrollPanels: getPresentationController().scrollPanels,
      jumpToPanel: getPresentationController().jumpToPanel,
      isOperationBusy: () => getConversationsController().isNewChatBusy || getSendingController().broadcastGate.isActive(),
      text: getLocalizedText,
      notify: showToast,
      getPanelName: getPresentationController().getPanelDisplayName,
      isBlindMode: () => getPresentationController().isBlindModeEnabled,
      loadModePrompts: getModePrompts,
      editModePrompt: prompt => getPromptsController().openPromptEditor(prompt.id),
      newModePrompt: () => getPromptsController().openPromptEditor(null, { asMode: true }),
      deleteModePrompt: getPromptsController().deleteModePrompt
    });
    getPresentationController().updatePageStyleButtons();
    getConversationsController().updateTemporaryChatButtonState();
    getFocusController().focusUnifiedInput({ force: true });

    getMessagingController().isInitialized = true;
    await getMessagingController().handlePendingMultiPanelAction();
    document.documentElement.dataset.panelizeReady = 'true';
  }

  function registerStorageChangeListener() {
    if (!chrome?.storage?.onChanged?.addListener) {
      return;
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' && areaName !== 'local') {
        return;
      }

      if (areaName === 'sync' && changes.enabledProviders) {
        // See initializePanels: providers enabled later need current-code access too.
        void reconcileOptionalProviderAccess();
      }

      if (changes.providerNotes) {
        getPresentationController().providerNotes = changes.providerNotes.newValue || {};
        getPresentationController().renderAllPanelNotes();
      }

      // Another Multi-Panel window sent a question; offer it here too.
      if (areaName === 'local' && changes[QUESTION_HISTORY_STORAGE_KEY]) {
        getQuestionHistoryController().questionHistoryEntries = readQuestionHistory(changes[QUESTION_HISTORY_STORAGE_KEY].newValue);
        getQuestionHistoryController().questionHistoryIndex = -1;
        getQuestionHistoryController().refreshQuestionHistoryMatches();
      }

      if (changes.answerCompleteNotificationEnabled) {
        getAnswersController().isAnswerCompleteNotificationEnabled = changes.answerCompleteNotificationEnabled.newValue !== false;
      }

      getSummaryController().applyAiSummaryConfigChanges(changes, areaName);

      if (changes.blindModeEnabled || changes.wideContentEnabled) {
        getPresentationController().setPageStyleModes({
          blind: changes.blindModeEnabled ? changes.blindModeEnabled.newValue === true : getPresentationController().isBlindModeEnabled,
          wide: changes.wideContentEnabled ? changes.wideContentEnabled.newValue === true : getPresentationController().isWideContentEnabled
        }, { persist: false });
      }

      if (changes.googleProviderMode?.newValue) {
        const nextMode = normalizeGoogleProviderMode(changes.googleProviderMode.newValue);
        if (nextMode === getProviderControlsController().currentGoogleProviderMode) {
          getProviderControlsController().syncGoogleModeControls();
        } else {
          getProviderControlsController().updateGoogleProviderMode(nextMode, { reloadPanels: true }).catch((error) => {
            console.error('Error syncing Google provider mode:', error);
          });
        }
      }
    });
  }

  async function loadSettings() {
    try {
      const settings = await chrome.storage.sync.get({
        multiPanelLayout: '1x3',
        multiPanelProviders: getPanelsController().DEFAULT_PROVIDERS,
        openMode: 'tab',
        googleProviderMode: DEFAULT_GOOGLE_PROVIDER_MODE,
        blindModeEnabled: false,
        wideContentEnabled: true,
        providerNotes: null,
        answerCompleteNotificationEnabled: true,
        aiSummaryAutoEnabled: true
      });

      getPresentationController().providerNotes = settings.providerNotes || {};
      getLayoutController().currentLayout = getLayoutController().normalizeLayout(settings.multiPanelLayout);
      getPresentationController().isBlindModeEnabled = settings.blindModeEnabled === true;
      getPresentationController().isWideContentEnabled = settings.wideContentEnabled === true;
      getAnswersController().isAnswerCompleteNotificationEnabled = settings.answerCompleteNotificationEnabled !== false;
      getSummaryController().aiSummaryConfig.autoEnabled = settings.aiSummaryAutoEnabled === true;
      await getSummaryController().reloadAiSummarySetup();
      document.body.classList.toggle('blind-mode', getPresentationController().isBlindModeEnabled);
      document.body.classList.toggle('wide-content', getPresentationController().isWideContentEnabled);
      getWindowModeController().currentOpenMode = settings.openMode || 'tab';
      getProviderControlsController().currentGoogleProviderMode = normalizeGoogleProviderMode(settings.googleProviderMode);

      // Apply layout
      const panelGrid = document.getElementById('panel-grid');
      panelGrid.className = `layout-${getLayoutController().currentLayout}`;
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  return {
    init,
  };
}
