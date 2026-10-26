import { notifyMessage } from '../modules/messaging.js';
import { t, initializeLanguage } from '../modules/i18n.js';
import { migrateEnabledProvidersOnUpdate } from '../modules/provider-defaults.js';
import { SHARE_SNAPSHOT_ACTION, isMultiPanelTab } from '../modules/share-trigger.js';
import { removeDeprecatedClaudeModelMode } from '../modules/settings.js';
import {
  reconcileOptionalProviderAccess
} from '../modules/optional-provider-access.js';
import {
  MIMO_SESSION_COOKIE_SYNC_ACTION,
  isMimoSourceCookieChange,
  reconcileMimoSessionCookies
} from '../modules/mimo-session-cookies.js';
import {
  isDeepSeekConsentCookieChange,
  upgradeDeepSeekConsentCookies
} from '../modules/consent-cookies.js';
import { openMultiPanelPage } from '../modules/open-multi-panel.js';
import {
  GROK_WEBSOCKET_COOKIE_SYNC_ACTION,
  createGrokWebSocketCookieReconcileScheduler,
  handleGrokTabNavigationComplete,
  handleGrokTabNavigationStart,
  handleGrokTabRemoved,
  handleMultiPanelSyncRequest,
  isGrokWebSocketCookieChange,
  isMultiPanelTopFrameSender,
  reconcileGrokWebSocketCookies
} from '../modules/grok-websocket-cookies.js';

// Install event - setup context menus
const DEFAULT_SHORTCUT_SETTING = { keyboardShortcutEnabled: true };
const DEFAULT_OPEN_MODE = { openMode: 'tab' };
let keyboardShortcutEnabled = true;
let openMode = 'tab';
const PENDING_MULTI_PANEL_ACTION_KEY = 'pendingMultiPanelAction';
const PAGE_EXTRACTOR_SCRIPTS = [
  'libs/Readability.js',
  'content-scripts/page-content-extractor.js'
];

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

async function setPendingMultiPanelAction(action, payload = {}) {
  const pendingAction = {
    action,
    payload,
    createdAt: Date.now()
  };

  try {
    await chrome.storage.session.set({ [PENDING_MULTI_PANEL_ACTION_KEY]: pendingAction });
    return;
  } catch (error) {
    // Fallback to local storage if session storage is unavailable
  }

  try {
    await chrome.storage.local.set({ [PENDING_MULTI_PANEL_ACTION_KEY]: pendingAction });
  } catch (error) {
    // Ignore storage errors
  }
}

async function openMultiPanel() {
  await openMultiPanelPage(chrome, openMode);
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

let optionalProviderReconcileQueue = Promise.resolve();

// The Grok scheduler is provider-agnostic: it serializes runs and coalesces
// bursts of cookie events into one queued reconcile.
const scheduleMimoSessionReconcile = createGrokWebSocketCookieReconcileScheduler(
  async () => {
    const result = await reconcileMimoSessionCookies();
    if (!result?.success) throw new Error('MiMo session synchronization failed');
  },
  () => {
    console.warn('[Background] Failed to synchronize MiMo panel session');
  }
);

function scheduleOptionalProviderReconcile() {
  optionalProviderReconcileQueue = optionalProviderReconcileQueue
    .then(() => reconcileOptionalProviderAccess())
    .catch((error) => {
      console.error('[Background] Optional provider reconciliation queue failed:', error);
    });

  return optionalProviderReconcileQueue;
}

const scheduleGrokWebSocketCookieReconcile = createGrokWebSocketCookieReconcileScheduler(
  reconcileGrokWebSocketCookies,
  (error) => {
    console.error('[Background] Failed to synchronize Grok WebSocket cookies:', error);
  }
);

// Failures only mean the DeepSeek panel shows its cookie banner again.
async function upgradeDeepSeekConsentCookiesSafely() {
  try {
    await upgradeDeepSeekConsentCookies();
  } catch (error) {
    console.warn('[Background] Failed to update DeepSeek consent cookie:', error);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await migrateProviderSettingsForUpdate(details);
  if (details?.reason === 'update') {
    await removeDeprecatedClaudeModelMode();
  }
  await scheduleOptionalProviderReconcile();
  await scheduleMimoSessionReconcile();
  await scheduleGrokWebSocketCookieReconcile();
  await upgradeDeepSeekConsentCookiesSafely();
  await createContextMenus();
  await loadShortcutSetting();
  await loadOpenModeSetting();
  await openOptionsAfterInstall(details);
});

// Optional providers in the default setup need site access, which the
// browser only grants from a user gesture, so show the grant prompt in options.
async function openOptionsAfterInstall(details) {
  if (details?.reason !== 'install') {
    return;
  }

  try {
    await chrome.runtime.openOptionsPage?.();
  } catch (error) {
    console.warn('[Background] Failed to open options after install:', error);
  }
}

chrome.runtime.onStartup.addListener(async () => {
  await scheduleOptionalProviderReconcile();
  await scheduleMimoSessionReconcile();
  await scheduleGrokWebSocketCookieReconcile();
  await loadShortcutSetting();
  await loadOpenModeSetting();
});

// Create/update context menus
async function createContextMenus() {
  // Remove all existing menus
  await chrome.contextMenus.removeAll();

  // Initialize language before creating menus
  await initializeLanguage();

  // Create main context menu item
  chrome.contextMenus.create({
    id: 'open-smarter-panel',
    title: t('contextMenuSendTo'),
    contexts: ['page', 'selection', 'link']
  });
}

// Listen for settings changes and update context menus
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.language) {
    createContextMenus();
  }

  // 新增：监听 openMode 变化
  if (namespace === 'sync' && changes.openMode) {
    openMode = changes.openMode.newValue || 'tab';
  }

  if (namespace === 'sync' && changes.enabledProviders) {
    scheduleOptionalProviderReconcile();
    scheduleMimoSessionReconcile();
    scheduleGrokWebSocketCookieReconcile();
  }
});

if (chrome.cookies?.onChanged) {
  chrome.cookies.onChanged.addListener((changeInfo) => {
    if (isMimoSourceCookieChange(changeInfo)) {
      scheduleMimoSessionReconcile();
    }
    if (isGrokWebSocketCookieChange(changeInfo)) {
      scheduleGrokWebSocketCookieReconcile();
    }
    if (isDeepSeekConsentCookieChange(changeInfo)) {
      upgradeDeepSeekConsentCookiesSafely();
    }
  });
}

if (chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo?.status === 'loading') {
      handleGrokTabNavigationStart(tabId).catch((error) => {
        console.error('[Background] Failed to drop navigating tab from Grok cookie rule:', error);
        scheduleGrokWebSocketCookieReconcile();
      });
    } else if (changeInfo?.status === 'complete' && handleGrokTabNavigationComplete(tabId)) {
      scheduleGrokWebSocketCookieReconcile();
    }
  });
}

if (chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    handleGrokTabRemoved(tabId)
      .then((inRule) => {
        if (inRule) {
          scheduleGrokWebSocketCookieReconcile();
        }
      })
      .catch((error) => {
        console.error('[Background] Failed to handle closed Grok tab:', error);
      });
  });
}

if (chrome.permissions?.onAdded) {
  chrome.permissions.onAdded.addListener(() => {
    scheduleOptionalProviderReconcile();
    scheduleMimoSessionReconcile();
  });
}

if (chrome.permissions?.onRemoved) {
  chrome.permissions.onRemoved.addListener(() => {
    scheduleOptionalProviderReconcile();
    scheduleMimoSessionReconcile();
  });
}

async function formatSelectedTextWithSource(info) {
  const settings = await chrome.storage.sync.get({ sourceUrlPlacement: 'none' });
  const placement = settings.sourceUrlPlacement;

  if (placement === 'none') {
    return info.selectionText;
  }
  if (placement === 'beginning') {
    return `Source: ${info.pageUrl}\n\n${info.selectionText}`;
  }
  return `${info.selectionText}\n\nSource: ${info.pageUrl}`;
}

async function getContentFromContext(info, tab) {
  if (info.selectionText) {
    return formatSelectedTextWithSource(info);
  }

  try {
    await ensurePageExtractorInjected(tab);

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'extractPageContent'
    });

    if (response && response.success) {
      return response.content;
    }
  } catch (error) {
    // Content script not ready or extraction failed
  }

  return '';
}

function canInjectIntoTab(tab) {
  if (!tab || tab.id === undefined || tab.id === null || !tab.url) {
    return false;
  }
  return tab.url.startsWith('http://') || tab.url.startsWith('https://');
}

async function ensurePageExtractorInjected(tab) {
  if (!canInjectIntoTab(tab)) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: false },
    files: PAGE_EXTRACTOR_SCRIPTS
  });
}

function dispatchToMultiPanel(action, payload) {
  setTimeout(() => {
    setPendingMultiPanelAction(action, payload);
    notifyMessage({
      action,
      payload
    }).catch(() => {
      // Multi-Panel may not be ready yet, silently ignore
    });
  }, 500);
}

/**
 * On the Multi-Panel page itself, invoking the extension shares a snapshot
 * of it: this gesture is what grants activeTab for a silent capture.
 * @returns {Promise<boolean>} Whether the page was asked to share.
 */
async function requestShareSnapshotOnMultiPanel(tab) {
  if (!(await isMultiPanelTab(tab))) {
    return false;
  }
  notifyMessage({
    action: SHARE_SNAPSHOT_ACTION,
    payload: { tabId: tab.id }
  }).catch(() => {
    // The page may still be loading; the user can invoke it again
  });
  return true;
}

// Context menu click handler - opens Multi-Panel and sends message
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (!tab) {
      return;
    }

    if (await requestShareSnapshotOnMultiPanel(tab)) {
      return;
    }

    // 先打开 Multi-Panel 窗口
    await openMultiPanel();

    if (info.menuItemId === 'open-smarter-panel') {
      const contentToSend = await getContentFromContext(info, tab);
      dispatchToMultiPanel('sendToPanel', { selectedText: contentToSend });
    }
  } catch (error) {
    // Silently handle context menu errors
  }
});

// Handle action clicks (toolbar button) - opens Multi-Panel
chrome.action.onClicked.addListener(async (tab) => {
  if (!keyboardShortcutEnabled) {
    return;
  }

  if (await requestShareSnapshotOnMultiPanel(tab)) {
    return;
  }

  await openMultiPanel();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'sync') return;

  if (changes.keyboardShortcutEnabled) {
    keyboardShortcutEnabled = changes.keyboardShortcutEnabled.newValue !== false;
  }
});

// Listen for version check requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === MIMO_SESSION_COOKIE_SYNC_ACTION) {
    if (!isMultiPanelTopFrameSender(sender)) {
      sendResponse({ success: false, error: 'MiMo session sync is only available to the Multi-Panel page' });
      return false;
    }
    scheduleMimoSessionReconcile().then(sendResponse);
    return true;
  }

  if (message.action === 'fetchLatestCommit') {
    // Handle version check request from options page
    handleFetchLatestCommit().then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.action === GROK_WEBSOCKET_COOKIE_SYNC_ACTION) {
    if (!isMultiPanelTopFrameSender(sender)) {
      sendResponse({ success: false, error: 'Grok cookie sync is only available to the Multi-Panel page' });
      return false;
    }

    handleMultiPanelSyncRequest(sender.tab.id);
    scheduleGrokWebSocketCookieReconcile({ upgradeConsentCookies: true }).then(sendResponse);
    return true;
  }

  return false;
});

// Handle version check by fetching latest commit from GitHub API
async function handleFetchLatestCommit() {
  try {
    const GITHUB_API_URL = 'https://api.github.com/repos/Manho/Panelize/commits/main';

    const response = await fetch(GITHUB_API_URL, {
      headers: {
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json();

    return {
      success: true,
      data: {
        sha: data.sha,
        shortSha: data.sha.substring(0, 7),
        date: data.commit.committer.date,
        message: data.commit.message
      }
    };
  } catch (error) {
    console.error('[Background] Error fetching latest commit:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Listen for keyboard shortcuts - simplified for Multi-Panel mode
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!keyboardShortcutEnabled) {
    return;
  }

  if (command === 'open-prompt-library') {
    // Open Multi-Panel
    await setPendingMultiPanelAction('openPromptLibrary', {});
    await openMultiPanel();

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
    await openMultiPanel();
  }
});
