/**
 * Owns application behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { normalizeProviderSortMode } from '../../modules/providers/provider-ranking.js';
import { getSettings } from '../../modules/platform/settings.js';
import { applyTheme } from '../../modules/platform/theme-manager.js';
import {
  AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY,
  AI_SUMMARY_API_KEYS_STORAGE_KEY,
  AI_SUMMARY_PROFILES_STORAGE_KEY
} from '../../modules/answers/ai-summary-profiles.js';
import { translatePage, initializeLanguage } from '../../modules/platform/i18n.js';
import { isEdgeBrowser, refreshAutoSizedSelects, setupShortcutHelpers } from './ui.js';

export function createApplicationController({
  getDataController,
  getInputSettingsController,
  getProvidersController,
  getSummaryController,
  getVersionController
}) {
  // Helper to detect if extension is installed from Chrome Web Store
  async function isWebStoreInstall() {
    try {
      const info = await chrome.management.getSelf();
      // installType: 'normal' = Chrome Web Store, 'development' = loaded unpacked
      return info.installType === 'normal';
    } catch (error) {
      console.error('Error detecting install type:', error);
      // Default to false (show update checking) if detection fails
      return false;
    }
  }

  // Hide update checking UI for web store installations
  async function hideUpdateCheckingIfNeeded() {
    const isFromStore = await isWebStoreInstall();

    if (isFromStore) {
      // Hide "Check for Updates" button
      const checkUpdatesBtn = document.getElementById('check-updates-btn');
      if (checkUpdatesBtn) {
        checkUpdatesBtn.style.display = 'none';
      }

      // Hide update status message area
      const updateStatus = document.getElementById('update-status');
      if (updateStatus) {
        updateStatus.style.display = 'none';
      }

      // Hide "Download Latest Version" link
      const downloadLink = document.getElementById('download-latest-link');
      if (downloadLink) {
        const downloadContainer = downloadLink.closest('.version-download');
        if (downloadContainer) {
          downloadContainer.style.display = 'none';
        }
      }
    }

    return isFromStore;
  }

  function updateShortcutHelperVisibility(isEnabled) {
    const edgeHelper = document.getElementById('edge-shortcut-helper');
    if (!edgeHelper) return;

    if (isEdgeBrowser() && isEnabled) {
      edgeHelper.style.display = 'flex';
    } else {
      edgeHelper.style.display = 'none';
    }
  }

  // T050: Initialize settings page
  async function init() {
    await applyTheme();  // Apply theme first
    await initializeLanguage();  // Initialize language from user settings
    translatePage();  // Translate all static text
    await loadSettings();
    await getDataController().loadDataStats();
    const isFromWebStore = await hideUpdateCheckingIfNeeded();
    await getVersionController().loadVersionDisplay(!isFromWebStore);  // T073: Load and display version info
    await getProvidersController().renderProviderList();
    await getProvidersController().renderTierRecipeEditor();
    getInputSettingsController().setupEventListeners();
    setupStorageChangeListener();
    getProvidersController().setupPermissionChangeListeners();
    getProvidersController().setupProviderAccessNotice();
    setupShortcutHelpers();
    refreshAutoSizedSelects();
    focusHashTarget();
    window.addEventListener('hashchange', focusHashTarget);
  }

  // The macOS client opens this page with a fragment so the user lands on the
  // switch that reconnects the global input bridge instead of the page top.
  function focusHashTarget() {
    const id = location.hash.slice(1);
    if (!id) return;
    const element = document.getElementById(id);
    const row = element?.closest('.setting-item') || element;
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('setting-highlight');
    setTimeout(() => row.classList.remove('setting-highlight'), 2400);
  }

  // T051: Load and display current settings
  async function loadSettings() {
    const settings = await getSettings();

    // Theme
    document.getElementById('theme-select').value = settings.theme || 'auto';

    // Language
    const currentLanguage = settings.language;
    document.getElementById('language-select').value = currentLanguage;

    const keyboardShortcutEnabled = settings.keyboardShortcutEnabled !== false;
    const shortcutToggle = document.getElementById('keyboard-shortcut-toggle');
    if (shortcutToggle) {
      shortcutToggle.checked = keyboardShortcutEnabled;
    }
    updateShortcutHelperVisibility(keyboardShortcutEnabled);

    const providerSortModeSelect = document.getElementById('provider-sort-mode-select');
    if (providerSortModeSelect) {
      providerSortModeSelect.value = normalizeProviderSortMode(settings.providerSortMode);
    }

    // Source URL placement setting
    const sourceUrlPlacementSelect = document.getElementById('source-url-placement-select');
    if (sourceUrlPlacementSelect) {
      sourceUrlPlacementSelect.value = settings.sourceUrlPlacement || 'none';
    }

    // Open mode setting
    const openModeSelect = document.getElementById('open-mode-select');
    if (openModeSelect) {
      openModeSelect.value = settings.openMode || 'tab';
    }

    // Share snapshot watermark setting
    const shareWatermarkToggle = document.getElementById('share-watermark-toggle');
    if (shareWatermarkToggle) {
      shareWatermarkToggle.checked = settings.shareWatermarkEnabled !== false;
    }

    // Answer complete notification setting
    const answerCompleteNotificationToggle = document.getElementById('answer-complete-notification-toggle');
    if (answerCompleteNotificationToggle) {
      answerCompleteNotificationToggle.checked = settings.answerCompleteNotificationEnabled !== false;
    }

    // macOS global input bridge (off unless explicitly enabled)
    const globalSendBridgeToggle = document.getElementById('global-send-bridge-toggle');
    if (globalSendBridgeToggle) {
      globalSendBridgeToggle.checked = settings.globalSendBridgeEnabled === true;
    }

    await getSummaryController().loadAiSummarySettings(settings);

    // Enter key behavior settings
    const enterBehavior = settings.enterKeyBehavior || {
      enabled: true,
      preset: 'default',
      newlineModifiers: { shift: true, ctrl: false, alt: false, meta: false },
      sendModifiers: { shift: false, ctrl: false, alt: false, meta: false }
    };

    const enterBehaviorToggle = document.getElementById('enter-behavior-toggle');
    if (enterBehaviorToggle) {
      enterBehaviorToggle.checked = enterBehavior.enabled;
      getInputSettingsController().updateEnterBehaviorVisibility(enterBehavior.enabled);
    }

    const enterPresetSelect = document.getElementById('enter-preset-select');
    if (enterPresetSelect) {
      enterPresetSelect.value = enterBehavior.preset || 'default';
      getInputSettingsController().updateCustomEnterSettingsVisibility(enterBehavior.preset);
    }

    // Load custom settings
    getInputSettingsController().loadCustomEnterSettings(enterBehavior);
    refreshAutoSizedSelects();
  }

  function setupStorageChangeListener() {
    if (!chrome?.storage?.onChanged?.addListener) {
      return;
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' && areaName !== 'local') {
        return;
      }

      if (changes.googleProviderMode || changes.providerBillingTypes) {
        getProvidersController().renderProviderList().catch((error) => {
          console.error('Error syncing provider controls:', error);
        });
      }

      // Skip echoes of this page's own saves so typing is never interrupted.
      if (changes.providerTierRecipes && !document.getElementById('tier-recipe-table')?.contains(document.activeElement)) {
        getProvidersController().renderTierRecipeEditor().catch((error) => {
          console.error('Error syncing reasoning level mapping:', error);
        });
      }

      if (changes.providerSortMode || changes.providerOrder || changes.enabledProviders) {
        getProvidersController().renderProviderList().catch((error) => {
          console.error('Error syncing provider order:', error);
        });
      }

      // Keep the AI summary list in step with another window, but never replace
      // inputs the user is currently editing.
      if (changes[AI_SUMMARY_PROFILES_STORAGE_KEY]
        || changes[AI_SUMMARY_ACTIVE_PROFILE_STORAGE_KEY]
        || (areaName === 'local' && changes[AI_SUMMARY_API_KEYS_STORAGE_KEY])) {
        const profilesContainer = document.getElementById('ai-summary-profiles');
        if (!profilesContainer?.contains(document.activeElement)) {
          getSummaryController().refreshAiSummaryProfiles().catch((error) => {
            console.error('Error syncing the AI summary models:', error);
          });
        }
      }
    });
  }

  return {
    init,
    loadSettings,
    updateShortcutHelperVisibility,
  };
}
