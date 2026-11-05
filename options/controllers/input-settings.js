/**
 * Owns input settings behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { normalizeProviderSortMode } from '../../modules/providers/provider-ranking.js';
import { getSettings, saveSetting } from '../../modules/platform/settings.js';
import { applyTheme } from '../../modules/platform/theme-manager.js';
import { t, translatePage, initializeLanguage } from '../../modules/platform/i18n.js';
import { getExtensionResourceUrl, getPromptGuidePath, showStatus, showToast } from './ui.js';

export function createInputSettingsController({
  getApplicationController,
  getDataController,
  getProvidersController,
  getSummaryController,
  getVersionController
}) {
  // T057-T064: Setup event listeners
  function setupEventListeners() {
    const tierRecipeTable = document.getElementById('tier-recipe-table');
    // Text fields save when they lose focus; checkboxes save right away.
    tierRecipeTable?.addEventListener('change', () => {
      getProvidersController().saveTierRecipesFromEditor().catch((error) => {
        console.error('Failed to save reasoning level mapping:', error);
      });
    });
    document.getElementById('reset-tier-recipes-btn')?.addEventListener('click', async () => {
      await saveSetting('providerTierRecipes', null);
      await getProvidersController().renderTierRecipeEditor();
      showToast('success', 'toastTierRecipesReset');
    });

    document.addEventListener('panelize:themechange', () => {
      getProvidersController().renderProviderList().catch((error) => {
        console.error('Failed to refresh provider icons after theme change:', error);
      });
    });

    // Theme change
    document.getElementById('theme-select').addEventListener('change', async (e) => {
      await saveSetting('theme', e.target.value);
      await applyTheme();  // Re-apply theme immediately
      await getProvidersController().renderProviderList();
      showStatus('success', t('msgThemeUpdated'));
    });

    // Language change
    document.getElementById('language-select').addEventListener('change', async (e) => {
      const newLanguage = e.target.value;
      await saveSetting('language', newLanguage);

      // Reload translations with new language
      await initializeLanguage(newLanguage);

      // Re-translate the entire page
      translatePage();
      await getProvidersController().renderProviderList();
      await getSummaryController().refreshAiSummaryProfiles();

      // Show success message (now in the new language)
      showStatus('success', t('msgLanguageUpdated'));
    });

    // Keyboard shortcut toggle
    const shortcutToggle = document.getElementById('keyboard-shortcut-toggle');
    if (shortcutToggle) {
      shortcutToggle.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        await saveSetting('keyboardShortcutEnabled', enabled);
        getApplicationController().updateShortcutHelperVisibility(enabled);
        showStatus('success', enabled ? t('msgShortcutEnabled') : t('msgShortcutDisabled'));
      });
    }

    // Source URL placement change
    const sourceUrlPlacementSelect = document.getElementById('source-url-placement-select');
    if (sourceUrlPlacementSelect) {
      sourceUrlPlacementSelect.addEventListener('change', async (e) => {
        await saveSetting('sourceUrlPlacement', e.target.value);
        showStatus('success', t('msgSourceUrlPlacementUpdated'));
      });
    }

    // Export data
    document.getElementById('export-btn').addEventListener('click', getDataController().exportData);

    // Import data
    document.getElementById('import-btn').addEventListener('click', () => {
      const fileInput = document.getElementById('import-file');
      fileInput.value = ''; // Reset file input before opening to allow re-importing same file
      fileInput.click();
    });

    document.getElementById('import-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await getDataController().importData(file);
      }
    });

    // Danger Zone - Clear buttons
    document.getElementById('clear-prompts-btn').addEventListener('click', getDataController().clearPrompts);
    document.getElementById('reset-settings-btn').addEventListener('click', getDataController().resetSettingsOnly);

    // Default library import button
    document.getElementById('import-default-library')?.addEventListener('click', getDataController().importDefaultLibraryHandler);

    // Custom library import button
    document.getElementById('import-custom-library')?.addEventListener('click', () => {
      const fileInput = document.getElementById('import-custom-library-file');
      fileInput.value = ''; // Reset file input before opening to allow re-importing same file
      fileInput.click();
    });

    document.getElementById('import-custom-library-file')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await getDataController().importCustomLibraryHandler(file);
      }
    });

    // Custom prompt guide and template
    document.getElementById('open-custom-prompt-guide')?.addEventListener('click', async () => {
      const settings = await getSettings();
      const locale = settings.language;
      const guidePath = getPromptGuidePath(locale);
      const url = getExtensionResourceUrl(guidePath);
      window.open(url, '_blank', 'noopener');
    });

    document.getElementById('download-custom-prompt-template')?.addEventListener('click', () => {
      const url = getExtensionResourceUrl('data/prompt-libraries/custom-prompt-template.json');
      const link = document.createElement('a');
      link.href = url;
      link.download = 'custom-prompt-template.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
    });

    // Enter key behavior toggle
    const enterBehaviorToggle = document.getElementById('enter-behavior-toggle');
    if (enterBehaviorToggle) {
      enterBehaviorToggle.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        const settings = await getSettings();
        const enterBehavior = settings.enterKeyBehavior || {};
        enterBehavior.enabled = enabled;
        await saveSetting('enterKeyBehavior', enterBehavior);
        updateEnterBehaviorVisibility(enabled);
        showStatus('success', enabled ? t('msgEnterCustomEnabled') : t('msgEnterCustomDisabled'));
      });
    }

    // Preset selection
    const enterPresetSelect = document.getElementById('enter-preset-select');
    if (enterPresetSelect) {
      enterPresetSelect.addEventListener('change', async (e) => {
        await applyEnterKeyPreset(e.target.value);
        updateCustomEnterSettingsVisibility(e.target.value);
      });
    }

    // Custom modifier checkboxes
    ['newline-shift', 'newline-ctrl', 'newline-alt', 'newline-meta',
     'send-shift', 'send-ctrl', 'send-alt', 'send-meta'].forEach(id => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.addEventListener('change', saveCustomEnterSettings);
      }
    });

    // T073: Version check button
    const checkUpdatesBtn = document.getElementById('check-updates-btn');
    if (checkUpdatesBtn) {
      checkUpdatesBtn.addEventListener('click', getVersionController().performVersionCheck);
    }

    // Multi-Panel: Open mode selection
    const openModeSelect = document.getElementById('open-mode-select');
    if (openModeSelect) {
      openModeSelect.addEventListener('change', async (e) => {
        await saveSetting('openMode', e.target.value);
        showStatus('success', t('msgOpenModeUpdated') || 'Open mode updated');
      });
    }

    // Multi-Panel: Share snapshot watermark
    const shareWatermarkToggle = document.getElementById('share-watermark-toggle');
    if (shareWatermarkToggle) {
      shareWatermarkToggle.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        await saveSetting('shareWatermarkEnabled', enabled);
        showStatus('success', enabled ? t('msgShareWatermarkEnabled') : t('msgShareWatermarkDisabled'));
      });
    }

    // Multi-Panel: Answer complete notification
    const answerCompleteNotificationToggle = document.getElementById('answer-complete-notification-toggle');
    if (answerCompleteNotificationToggle) {
      answerCompleteNotificationToggle.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        await saveSetting('answerCompleteNotificationEnabled', enabled);
        showStatus('success', enabled ? t('msgAnswerCompleteNotificationEnabled') : t('msgAnswerCompleteNotificationDisabled'));
      });
    }

    // macOS global input bridge
    document.getElementById('global-send-bridge-toggle')?.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await saveSetting('globalSendBridgeEnabled', enabled);
      showStatus('success', enabled ? t('msgGlobalSendBridgeEnabled') : t('msgGlobalSendBridgeDisabled'));
    });

    // AI summary
    document.getElementById('ai-summary-auto-toggle')?.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await saveSetting('aiSummaryAutoEnabled', enabled);
      showStatus('success', enabled ? t('msgAiSummaryAutoEnabled') : t('msgAiSummaryAutoDisabled'));
    });
    document.getElementById('ai-summary-save-btn')?.addEventListener('click', getSummaryController().saveAndTestAiSummary);
    document.getElementById('ai-summary-add-profile-btn')?.addEventListener('click', getSummaryController().addAiSummaryProfileRow);
    const aiSummaryProfilesContainer = document.getElementById('ai-summary-profiles');
    aiSummaryProfilesContainer?.addEventListener('click', (event) => {
      const removeButton = event.target.closest?.('[data-action="remove-profile"]');
      if (removeButton) {
        getSummaryController().removeAiSummaryProfileRow(removeButton.closest('.ai-summary-profile'));
      }
    });
    aiSummaryProfilesContainer?.addEventListener('change', (event) => {
      if (event.target.matches?.('input[name="ai-summary-active-profile"]')) {
        getSummaryController().updateAiSummaryProfileControls(aiSummaryProfilesContainer);
      }
    });

    const providerSortModeSelect = document.getElementById('provider-sort-mode-select');
    if (providerSortModeSelect) {
      providerSortModeSelect.addEventListener('change', async (event) => {
        await saveSetting('providerSortMode', normalizeProviderSortMode(event.target.value));
        await getProvidersController().renderProviderList();
        showStatus('success', t('msgProviderSettingsUpdated'));
      });
    }

    // Multi-Panel: Layout selection
    const multiPanelLayoutSelect = document.getElementById('multi-panel-layout-select');
    if (multiPanelLayoutSelect) {
      // Load saved layout
      chrome.storage.sync.get({ multiPanelLayout: '1x3' }, (result) => {
        const storedLayout = result.multiPanelLayout;
        const hasOption = Array.from(multiPanelLayoutSelect.options).some(option => option.value === storedLayout);
        multiPanelLayoutSelect.value = hasOption ? storedLayout : '1x3';
      });

      multiPanelLayoutSelect.addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ multiPanelLayout: e.target.value });
        showStatus('success', t('msgLayoutUpdated') || 'Layout updated');
      });
    }
  }

  // Enter Key Behavior Helper Functions
  function updateEnterBehaviorVisibility(enabled) {
    const settingsDiv = document.getElementById('enter-behavior-settings');
    if (settingsDiv) {
      settingsDiv.style.display = enabled ? 'block' : 'none';
    }
  }

  function updateCustomEnterSettingsVisibility(preset) {
    const customDiv = document.getElementById('custom-enter-settings');
    if (customDiv) {
      customDiv.style.display = preset === 'custom' ? 'block' : 'none';
    }
  }

  function loadCustomEnterSettings(enterBehavior) {
    // Load newline modifiers
    document.getElementById('newline-shift').checked = enterBehavior.newlineModifiers.shift || false;
    document.getElementById('newline-ctrl').checked = enterBehavior.newlineModifiers.ctrl || false;
    document.getElementById('newline-alt').checked = enterBehavior.newlineModifiers.alt || false;
    document.getElementById('newline-meta').checked = enterBehavior.newlineModifiers.meta || false;

    // Load send modifiers
    document.getElementById('send-shift').checked = enterBehavior.sendModifiers.shift || false;
    document.getElementById('send-ctrl').checked = enterBehavior.sendModifiers.ctrl || false;
    document.getElementById('send-alt').checked = enterBehavior.sendModifiers.alt || false;
    document.getElementById('send-meta').checked = enterBehavior.sendModifiers.meta || false;
  }

  async function applyEnterKeyPreset(preset) {
    const settings = await getSettings();
    const enterBehavior = settings.enterKeyBehavior || {};

    enterBehavior.preset = preset;

    // Define preset configurations
    const presets = {
      default: {
        newlineModifiers: { shift: true, ctrl: false, alt: false, meta: false },
        sendModifiers: { shift: false, ctrl: false, alt: false, meta: false }
      },
      swapped: {
        newlineModifiers: { shift: false, ctrl: false, alt: false, meta: false },
        sendModifiers: { shift: true, ctrl: false, alt: false, meta: false }
      },
      slack: {
        newlineModifiers: { shift: false, ctrl: true, alt: false, meta: false },
        sendModifiers: { shift: false, ctrl: false, alt: false, meta: false }
      },
      discord: {
        newlineModifiers: { shift: false, ctrl: false, alt: false, meta: false },
        sendModifiers: { shift: false, ctrl: true, alt: false, meta: false }
      }
    };

    if (preset !== 'custom' && presets[preset]) {
      enterBehavior.newlineModifiers = presets[preset].newlineModifiers;
      enterBehavior.sendModifiers = presets[preset].sendModifiers;
      loadCustomEnterSettings(enterBehavior);
    }

    await saveSetting('enterKeyBehavior', enterBehavior);
    showStatus('success', t('msgPresetChanged', preset));
  }

  async function saveCustomEnterSettings() {
    const settings = await getSettings();
    const enterBehavior = settings.enterKeyBehavior || {};

    enterBehavior.preset = 'custom';
    enterBehavior.newlineModifiers = {
      shift: document.getElementById('newline-shift').checked,
      ctrl: document.getElementById('newline-ctrl').checked,
      alt: document.getElementById('newline-alt').checked,
      meta: document.getElementById('newline-meta').checked
    };
    enterBehavior.sendModifiers = {
      shift: document.getElementById('send-shift').checked,
      ctrl: document.getElementById('send-ctrl').checked,
      alt: document.getElementById('send-alt').checked,
      meta: document.getElementById('send-meta').checked
    };

    await saveSetting('enterKeyBehavior', enterBehavior);

    // Update preset dropdown to show custom
    const presetSelect = document.getElementById('enter-preset-select');
    if (presetSelect) {
      presetSelect.value = 'custom';
    }

    showStatus('success', t('msgCustomMappingSaved'));
  }

  return {
    loadCustomEnterSettings,
    setupEventListeners,
    updateCustomEnterSettingsVisibility,
    updateEnterBehaviorVisibility,
  };
}
