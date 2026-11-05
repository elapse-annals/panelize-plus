/**
 * Owns page actions behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { notifyMessage } from '../../modules/platform/messaging.js';
import { t, initializeLanguage } from '../../modules/platform/i18n.js';
import { SHARE_SNAPSHOT_ACTION, isMultiPanelTab } from '../../modules/snapshots/share-trigger.js';
import { openMultiPanelPage } from '../../modules/platform/open-multi-panel.js';
import { GLOBAL_SEND_ACTION } from '../../modules/platform/global-send.js';

export function createPageActionsController({
  getSettingsController
}) {
  const PENDING_MULTI_PANEL_ACTION_KEY = 'pendingMultiPanelAction';

  const PAGE_EXTRACTOR_SCRIPTS = [
    'libs/Readability.js',
    'content-scripts/features/page-content-extractor.js'
  ];

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
    await openMultiPanelPage(chrome, getSettingsController().openMode);
  }

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
   * Delivers a prompt typed in the macOS global client through the same Send All
   * path as the main composer. Opening Panelize first makes the pending action
   * survive while the page and its AI panels initialize.
   */
  async function handOffGlobalPrompt({ text, requestId, promptMode }) {
    const payload = { text, requestId };
    if (promptMode !== undefined) {
      payload.promptMode = promptMode;
    }
    await setPendingMultiPanelAction(GLOBAL_SEND_ACTION, payload);
    await openMultiPanel();
    setTimeout(() => {
      notifyMessage({
        action: GLOBAL_SEND_ACTION,
        payload
      }).catch(() => {
        // A newly opened Multi-Panel consumes the pending action instead.
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

  return {
    createContextMenus,
    dispatchToMultiPanel,
    getContentFromContext,
    handOffGlobalPrompt,
    openMultiPanel,
    openOptionsAfterInstall,
    requestShareSnapshotOnMultiPanel,
    setPendingMultiPanelAction,
  };
}
