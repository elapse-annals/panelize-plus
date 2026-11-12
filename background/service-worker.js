/** Composition root. Feature state and behavior live in controllers. */
import { notifyMessage } from '../modules/platform/messaging.js';
import { removeDeprecatedClaudeModelMode } from '../modules/platform/settings.js';
import { MIMO_SESSION_COOKIE_SYNC_ACTION, isMimoSourceCookieChange } from '../modules/providers/mimo-session-cookies.js';
import { isDeepSeekConsentCookieChange } from '../modules/providers/consent-cookies.js';
import { GLOBAL_SEND_PROGRESS_ACTION, GLOBAL_SEND_RESULT_ACTION, NATIVE_SEND_KEEPALIVE_ALARM, NEW_CHAT_RESULT_ACTION, isTrustedGlobalSendResultSender } from '../modules/platform/global-send.js';
import {
  GROK_WEBSOCKET_COOKIE_SYNC_ACTION,
  handleGrokTabNavigationComplete,
  handleGrokTabNavigationStart,
  handleGrokTabRemoved,
  handleMultiPanelSyncRequest,
  isGrokWebSocketCookieChange,
  isMultiPanelTopFrameSender
} from '../modules/providers/grok-websocket-cookies.js';
import { createSettingsController } from './controllers/settings.js';
import { createPageActionsController } from './controllers/page-actions.js';
import { createProviderSessionsController } from './controllers/provider-sessions.js';
import { createNativeBridgeController } from './controllers/native-bridge.js';
import { createHistorySyncController } from './controllers/history-sync-controller.js';
import { createVersionController } from './controllers/version.js';

const settings = createSettingsController();

const pageActions = createPageActionsController({
  getSettingsController: () => settings
});

const providerSessions = createProviderSessionsController();

const nativeBridge = createNativeBridgeController({
  getPageActionsController: () => pageActions,
  getHistorySyncController: () => historySync,
  getSettingsController: () => settings
});

const historySync = createHistorySyncController({
  getNativeSendBridge: () => nativeBridge.nativeSendBridge
});

const version = createVersionController();

chrome.runtime.onInstalled.addListener(async (details) => {
  await settings.migrateProviderSettingsForUpdate(details);
  if (details?.reason === 'update') {
    await removeDeprecatedClaudeModelMode();
  }
  await providerSessions.scheduleOptionalProviderReconcile();
  await providerSessions.scheduleMimoSessionReconcile();
  await providerSessions.scheduleGrokWebSocketCookieReconcile();
  await providerSessions.upgradeDeepSeekConsentCookiesSafely();
  await pageActions.createContextMenus();
  await settings.loadShortcutSetting();
  await settings.loadOpenModeSetting();
  await pageActions.openOptionsAfterInstall(details);
});

chrome.runtime.onStartup.addListener(async () => {
  await providerSessions.scheduleOptionalProviderReconcile();
  await providerSessions.scheduleMimoSessionReconcile();
  await providerSessions.scheduleGrokWebSocketCookieReconcile();
  await settings.loadShortcutSetting();
  await settings.loadOpenModeSetting();
});

// Listen for settings changes and update context menus
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    historySync.handleStorageChange(changes);
  }

  if (changes.language) {
    pageActions.createContextMenus();
  }

  // 新增：监听 openMode 变化
  if (namespace === 'sync' && changes.openMode) {
    settings.openMode = changes.openMode.newValue || 'tab';
  }

  if (namespace === 'sync' && changes.enabledProviders) {
    providerSessions.scheduleOptionalProviderReconcile();
    providerSessions.scheduleMimoSessionReconcile();
    providerSessions.scheduleGrokWebSocketCookieReconcile();
  }
});

if (chrome.cookies?.onChanged) {
  chrome.cookies.onChanged.addListener((changeInfo) => {
    if (isMimoSourceCookieChange(changeInfo)) {
      providerSessions.scheduleMimoSessionReconcile();
    }
    if (isGrokWebSocketCookieChange(changeInfo)) {
      providerSessions.scheduleGrokWebSocketCookieReconcile();
    }
    if (isDeepSeekConsentCookieChange(changeInfo)) {
      providerSessions.upgradeDeepSeekConsentCookiesSafely();
    }
  });
}

if (chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo?.status === 'loading') {
      handleGrokTabNavigationStart(tabId).catch((error) => {
        console.error('[Background] Failed to drop navigating tab from Grok cookie rule:', error);
        providerSessions.scheduleGrokWebSocketCookieReconcile();
      });
    } else if (changeInfo?.status === 'complete' && handleGrokTabNavigationComplete(tabId)) {
      providerSessions.scheduleGrokWebSocketCookieReconcile();
    }
  });
}

if (chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    handleGrokTabRemoved(tabId)
      .then((inRule) => {
        if (inRule) {
          providerSessions.scheduleGrokWebSocketCookieReconcile();
        }
      })
      .catch((error) => {
        console.error('[Background] Failed to handle closed Grok tab:', error);
      });
  });
}

if (chrome.permissions?.onAdded) {
  chrome.permissions.onAdded.addListener(() => {
    providerSessions.scheduleOptionalProviderReconcile();
    providerSessions.scheduleMimoSessionReconcile();
  });
}

if (chrome.permissions?.onRemoved) {
  chrome.permissions.onRemoved.addListener(() => {
    providerSessions.scheduleOptionalProviderReconcile();
    providerSessions.scheduleMimoSessionReconcile();
  });
}

// Context menu click handler - opens Multi-Panel and sends message
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (!tab) {
      return;
    }

    if (await pageActions.requestShareSnapshotOnMultiPanel(tab)) {
      return;
    }

    // 先打开 Multi-Panel 窗口
    await pageActions.openMultiPanel();

    if (info.menuItemId === 'open-smarter-panel') {
      const contentToSend = await pageActions.getContentFromContext(info, tab);
      pageActions.dispatchToMultiPanel('sendToPanel', { selectedText: contentToSend });
    }
  } catch (error) {
    // Silently handle context menu errors
  }
});

// Handle action clicks (toolbar button) - opens Multi-Panel
chrome.action.onClicked.addListener(async (tab) => {
  if (!settings.keyboardShortcutEnabled) {
    return;
  }

  if (await pageActions.requestShareSnapshotOnMultiPanel(tab)) {
    return;
  }

  await pageActions.openMultiPanel();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'sync') return;

  if (changes.keyboardShortcutEnabled) {
    settings.keyboardShortcutEnabled = changes.keyboardShortcutEnabled.newValue !== false;
  }
  if (changes.globalSendBridgeEnabled) {
    settings.globalSendBridgeEnabled = changes.globalSendBridgeEnabled.newValue === true;
    if (settings.globalSendBridgeEnabled) {
      nativeBridge.ensureNativeSendBridge();
    } else {
      nativeBridge.disableNativeSendBridge();
    }
  }
});

// Listen for version check requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === GLOBAL_SEND_PROGRESS_ACTION) {
    const trusted = isTrustedGlobalSendResultSender(sender, chrome.runtime);
    if (trusted) {
      nativeBridge.nativeSendBridge.deliverProgress(message.payload || {});
    }
    sendResponse({ ok: trusted });
    return false;
  }

  if (message.action === GLOBAL_SEND_RESULT_ACTION) {
    const trusted = isTrustedGlobalSendResultSender(sender, chrome.runtime);
    if (trusted) {
      nativeBridge.nativeSendBridge.deliverResult(message.payload || {});
    }
    sendResponse({ ok: trusted });
    return false;
  }

  if (message.action === NEW_CHAT_RESULT_ACTION) {
    const trusted = isTrustedGlobalSendResultSender(sender, chrome.runtime);
    if (trusted) {
      nativeBridge.nativeSendBridge.deliverNewChatResult(message.payload || {});
    }
    sendResponse({ ok: trusted });
    return false;
  }

  if (message.action === MIMO_SESSION_COOKIE_SYNC_ACTION) {
    if (!isMultiPanelTopFrameSender(sender)) {
      sendResponse({ success: false, error: 'MiMo session sync is only available to the Multi-Panel page' });
      return false;
    }
    providerSessions.scheduleMimoSessionReconcile().then(sendResponse);
    return true;
  }

  if (message.action === 'fetchLatestCommit') {
    // Handle version check request from options page
    version.handleFetchLatestCommit().then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.action === GROK_WEBSOCKET_COOKIE_SYNC_ACTION) {
    if (!isMultiPanelTopFrameSender(sender)) {
      sendResponse({ success: false, error: 'Grok cookie sync is only available to the Multi-Panel page' });
      return false;
    }

    handleMultiPanelSyncRequest(sender.tab.id);
    providerSessions.scheduleGrokWebSocketCookieReconcile({ upgradeConsentCookies: true }).then(sendResponse);
    return true;
  }

  return false;
});

// Chrome starts the native host when the extension connects. If the host
// crashes, the alarm wakes this worker so it can reconnect without waiting for
// another browser or Panelize action.
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === NATIVE_SEND_KEEPALIVE_ALARM) {
    nativeBridge.ensureNativeSendBridge();
  }
});

// Listen for keyboard shortcuts - simplified for Multi-Panel mode
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!settings.keyboardShortcutEnabled) {
    return;
  }

  if (command === 'open-prompt-library') {
    // Open Multi-Panel
    await pageActions.setPendingMultiPanelAction('openPromptLibrary', {});
    await pageActions.openMultiPanel();

    // If it's prompt library command, also send message to open it
    setTimeout(() => {
      notifyMessage({
        action: 'openPromptLibrary',
        payload: {}
      }).catch(() => {
        // Multi-Panel may not be ready yet, ignore error
      });
    }, 500);
  } else if (command === 'toggle-focus') {
    // In Multi-Panel mode, toggle-focus just opens/focuses the Multi-Panel
    await pageActions.openMultiPanel();
  }
});

nativeBridge.initializeNativeSendBridge();
