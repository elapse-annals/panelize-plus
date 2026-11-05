/**
 * Owns settings behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { migrateEnabledProvidersOnUpdate } from '../../modules/providers/provider-defaults.js';

export function createSettingsController() {
  // Install event - setup context menus
  const DEFAULT_SHORTCUT_SETTING = { keyboardShortcutEnabled: true };

  const DEFAULT_OPEN_MODE = { openMode: 'tab' };

  const DEFAULT_GLOBAL_SEND_SETTING = { globalSendBridgeEnabled: false };

  let keyboardShortcutEnabled = true;

  let openMode = 'tab';

  let globalSendBridgeEnabled = false;

  async function loadShortcutSetting() {
    try {
      const result = await chrome.storage.sync.get(DEFAULT_SHORTCUT_SETTING);
      keyboardShortcutEnabled = result.keyboardShortcutEnabled;
    } catch (error) {
      // Fallback to default if storage unavailable
      keyboardShortcutEnabled = true;
    }
  }

  async function loadOpenModeSetting() {
    try {
      const result = await chrome.storage.sync.get(DEFAULT_OPEN_MODE);
      openMode = result.openMode || 'tab';
    } catch (error) {
      // Fallback to default if storage unavailable
      openMode = 'tab';
    }
  }

  async function loadGlobalSendSetting() {
    try {
      const result = await chrome.storage.sync.get(DEFAULT_GLOBAL_SEND_SETTING);
      globalSendBridgeEnabled = result.globalSendBridgeEnabled === true;
    } catch (error) {
      // Fallback to off if storage unavailable
      globalSendBridgeEnabled = false;
    }
  }

  async function migrateProviderSettingsForUpdate(details) {
    if (details?.reason !== 'update') {
      return;
    }

    try {
      const currentSettings = await chrome.storage.sync.get({
        enabledProviders: null,
        providerOrder: null
      });
      const migratedSettings = migrateEnabledProvidersOnUpdate(
        currentSettings.enabledProviders,
        currentSettings.providerOrder
      );

      if (migratedSettings) {
        await chrome.storage.sync.set(migratedSettings);
      }
    } catch (error) {
      // Ignore storage errors during best-effort settings migration
    }
  }

  return {
    get globalSendBridgeEnabled() { return globalSendBridgeEnabled; },
    set globalSendBridgeEnabled(value) { globalSendBridgeEnabled = value; },
    get keyboardShortcutEnabled() { return keyboardShortcutEnabled; },
    set keyboardShortcutEnabled(value) { keyboardShortcutEnabled = value; },
    loadGlobalSendSetting,
    loadOpenModeSetting,
    loadShortcutSetting,
    migrateProviderSettingsForUpdate,
    get openMode() { return openMode; },
    set openMode(value) { openMode = value; },
  };
}
