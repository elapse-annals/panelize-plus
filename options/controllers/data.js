/**
 * Owns data behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { getSettings, resetSettings, exportSettings, importSettings } from '../../modules/platform/settings.js';
import {
  getAllPrompts,
  savePrompt,
  exportPrompts,
  importPrompts,
  clearAllPrompts,
  importDefaultLibrary
} from '../../modules/prompts/prompt-manager.js';
import { restoreDefaultModePrompts } from '../../modules/prompts/prompt-modes.js';
import { t } from '../../modules/platform/i18n.js';
import { showStatus, showToast, translated } from './ui.js';

export function createDataController({
  getApplicationController,
  getProvidersController
}) {
  // T056: Load and display data statistics
  async function loadDataStats() {
    try {
      const prompts = await getAllPrompts();

      document.getElementById('stat-prompts').textContent = prompts.length;

      // Estimate storage size
      const promptsSize = JSON.stringify(prompts).length;
      const sizeKB = Math.round(promptsSize / 1024);
      document.getElementById('stat-storage').textContent = `~${sizeKB} KB`;
    } catch (error) {
      // Silently handle data stats errors
      document.getElementById('stat-prompts').textContent = '0';
      document.getElementById('stat-storage').textContent = '0 KB';
    }
  }

  // T057: Export all data
  async function exportData() {
    try {
      // Export prompts
      const promptsData = await exportPrompts();

      // Export settings
      const settingsData = await exportSettings();

      // Combine into single export file
      const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        prompts: promptsData.prompts,
        settings: settingsData
      };

      // Create download
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `panelize-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);

      showStatus('success', t('msgDataExported'));
    } catch (error) {
      showStatus('error', t('msgDataExportFailed'));
    }
  }

  // T058-T062: Import data from file
  async function importData(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.version) {
        throw new Error('Invalid export file format');
      }

      // Confirm import
      const confirmMsg = t('msgImportConfirm', [
        new Date(data.exportDate).toLocaleString(),
        (data.prompts?.length || 0).toString()
      ]);

      if (!confirm(confirmMsg)) {
        return;
      }

      // Import prompts
      let promptImportSummary = null;
      if (data.prompts && Array.isArray(data.prompts)) {
        promptImportSummary = await importPrompts({ prompts: data.prompts }, 'skip');
      }

      // Import settings (but preserve current enabled providers)
      if (data.settings) {
        const currentSettings = await getSettings();
        const settingsToImport = {
          ...data.settings,
          enabledProviders: currentSettings.enabledProviders // Don't overwrite provider settings
        };
        await importSettings(settingsToImport);
      }

      await getApplicationController().loadSettings();
      await loadDataStats();

      // Show success toast
      if (promptImportSummary && promptImportSummary.imported > 0) {
        showToast('success', 'msgDataImportedWithCount', [promptImportSummary.imported.toString()]);
      } else {
        showToast('success', 'msgDataImported');
      }
    } catch (error) {
      showStatus('error', t('msgDataImportFailed'));
    }
  }

  // Danger Zone: Clear Prompts
  async function clearPrompts() {
    if (!confirm(t('msgConfirmClearPrompts'))) {
      return;
    }

    try {
      await clearAllPrompts();
      await loadDataStats();
      showStatus('success', t('msgPromptsCleared'));
    } catch (error) {
      showStatus('error', t('msgClearPromptsFailed'));
    }
  }

  // Danger Zone: Reset Settings
  async function resetSettingsOnly() {
    if (!confirm(t('msgConfirmResetSettings'))) {
      return;
    }

    try {
      await resetSettings();
      await getApplicationController().loadSettings();
      await getProvidersController().renderProviderList();
      showStatus('success', t('msgSettingsReset'));
    } catch (error) {
      showStatus('error', t('msgResetSettingsFailed'));
    }
  }

  // Validate prompt structure against expected format
  function validatePromptStructure(prompt) {
    const errors = [];

    // Required fields
    if (!prompt.title || typeof prompt.title !== 'string') {
      errors.push('Missing or invalid "title" (string)');
    }
    // Either text alone is a complete prompt: `content` is shown and sent,
    // `contentEn` covers a prompt whose `content` is empty.
    if ((!prompt.content || typeof prompt.content !== 'string') &&
        (!prompt.contentEn || typeof prompt.contentEn !== 'string')) {
      errors.push('Missing or invalid "content" (string)');
    }
    if (prompt.contentEn !== undefined && typeof prompt.contentEn !== 'string') {
      errors.push('"contentEn" should be string');
    }
    if (!prompt.category || typeof prompt.category !== 'string') {
      errors.push('Missing or invalid "category" (string)');
    }

    // Tags should be array
    if (!Array.isArray(prompt.tags)) {
      errors.push('"tags" must be an array of strings');
    }

    // Variables should be array (can be empty)
    if (!Array.isArray(prompt.variables)) {
      errors.push('"variables" must be an array');
    }

    // Optional but typed fields
    if (prompt.isFavorite !== undefined && typeof prompt.isFavorite !== 'boolean') {
      errors.push('"isFavorite" should be boolean');
    }
    if (prompt.isMode !== undefined && typeof prompt.isMode !== 'boolean') {
      errors.push('"isMode" should be boolean');
    }
    if (prompt.modeKey !== undefined && typeof prompt.modeKey !== 'string') {
      errors.push('"modeKey" should be string');
    }
    if (prompt.triggers !== undefined && (!Array.isArray(prompt.triggers) || prompt.triggers.some(trigger => typeof trigger !== 'string'))) {
      errors.push('"triggers" should be an array of strings');
    }
    if (prompt.useCount !== undefined && typeof prompt.useCount !== 'number') {
      errors.push('"useCount" should be number');
    }
    if (prompt.lastUsed !== undefined && prompt.lastUsed !== null && typeof prompt.lastUsed !== 'number') {
      errors.push('"lastUsed" should be number or null');
    }

    return errors;
  }

  // Generate example prompt structure
  function getPromptStructureExample() {
    return `Expected JSON structure (array of prompt objects):

[
  {
    "title": "Short descriptive title",
    "content": "Full prompt text. Use {variables} for placeholders.",
    "contentEn": "Optional English text shown and sent when content is empty.",
    "category": "Category name",
    "tags": ["tag1", "tag2"],
    "variables": ["variable1", "variable2"],
    "isFavorite": false,
    "useCount": 0,
    "lastUsed": null
  }
]

Required fields:
- title (string)
- content (string, or contentEn when the prompt has no Chinese text)
- category (string)
- tags (array of strings)
- variables (array of strings)

Optional fields:
- contentEn (string, default: ""; shown and sent when content is empty)
- isFavorite (boolean, default: false)
- isMode (boolean, default: false; true lists it in the composer's prompt-mode menu)
- triggers (array of strings, default: []; words like "/study" that apply the mode to one send in Auto mode)
- useCount (number, default: 0)
- lastUsed (number or null, default: null)

${t('msgPromptGuideTip')}`;
  }

  // Import Custom Prompt Library
  async function importCustomLibraryHandler(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Check if it's an array
      if (!Array.isArray(data)) {
        showStatus('error', t('msgInvalidPromptFormat'));
        alert(`${t('msgInvalidFormat')}\n\n${getPromptStructureExample()}`);
        return;
      }

      // Validate first prompt as a sample
      if (data.length > 0) {
        const errors = validatePromptStructure(data[0]);
        if (errors.length > 0) {
          const errorMsg = `${t('msgInvalidPromptStructure')}:\n\n${errors.join('\n')}\n\n${getPromptStructureExample()}`;
          showStatus('error', t('msgInvalidPromptStructure'));
          alert(errorMsg);
          return;
        }
      }

      // Validate all prompts
      const validationErrors = [];
      data.forEach((prompt, index) => {
        const errors = validatePromptStructure(prompt);
        if (errors.length > 0) {
          validationErrors.push(`Prompt #${index + 1}: ${errors.join(', ')}`);
        }
      });

      if (validationErrors.length > 0) {
        const errorMsg = t('msgValidationErrors', validationErrors.length.toString()) + `:\n\n${validationErrors.slice(0, 5).join('\n')}${validationErrors.length > 5 ? '\n...' : ''}\n\n${getPromptStructureExample()}`;
        showStatus('error', t('msgValidationErrors', validationErrors.length.toString()));
        alert(errorMsg);
        return;
      }

      // Wrap in expected format
      const libraryData = { prompts: data };

      // Import using the prompt manager
      const result = await importDefaultLibrary(libraryData);

      // Show results with toast notification
      if (result.imported > 0) {
        showToast('success', 'msgCustomPromptsImported', [result.imported.toString(), result.skipped.toString()]);
      } else {
        showToast('info', 'msgAllPromptsExist');
      }

      // Refresh stats
      await loadDataStats();

    } catch (error) {
      if (error instanceof SyntaxError) {
        showStatus('error', t('msgInvalidJSON'));
        alert(`${t('msgJSONParseError')}\n\n${getPromptStructureExample()}`);
      } else {
        showStatus('error', t('msgCustomImportFailed'));
        console.error('Import error:', error);
      }
    }
  }

  // Import Default Prompt Library
  async function importDefaultLibraryHandler() {
    const button = document.getElementById('import-default-library');

    try {
      button.disabled = true;
      button.textContent = t('msgImporting');

      // The default prompts are the built-in modes; ones already present are skipped.
      const imported = await restoreDefaultModePrompts({ getAllPrompts, savePrompt, tr: translated });
      const result = { imported, skipped: 0 };

      // Update UI
      if (result.imported > 0) {
        button.textContent = t('msgImported');
        button.style.background = '#4caf50';
        button.style.color = 'white';
        showToast('success', 'msgDefaultPromptsImported', [result.imported.toString(), result.skipped.toString()]);
      } else {
        button.textContent = t('msgAlreadyImported');
        button.disabled = true;
        showToast('info', 'msgAllPromptsExist');
      }

      // Refresh stats
      await loadDataStats();

    } catch (error) {
      showStatus('error', t('msgDefaultImportFailed'));
      button.disabled = false;
      button.textContent = t('btnImportDefault');
    }
  }

  return {
    clearPrompts,
    exportData,
    importCustomLibraryHandler,
    importData,
    importDefaultLibraryHandler,
    loadDataStats,
    resetSettingsOnly,
  };
}
