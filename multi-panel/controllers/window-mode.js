/**
 * Owns window mode behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { getProviderById } from '../../modules/providers/providers.js';
import { normalizeGoogleProviderMode } from '../../modules/providers/google-mode.js';
import { createMultiPanelPopupWindow, savePopupWindowBounds } from '../../modules/platform/open-multi-panel.js';
import { t } from '../../modules/platform/i18n.js';

export function createWindowModeController({
  getAttachmentsController,
  getComposerController,
  getLayoutController,
  getPanelsController,
  getProviderControlsController
}) {
  // 打开模式状态
  let currentOpenMode = 'tab';

  // 'tab' 或 'popup'
  let isPopupWindow = false;

  // ===== Open Mode Management =====
  let popupBoundsTracked = false;

  function trackPopupWindowBounds(windowId) {
    if (popupBoundsTracked || !Number.isInteger(windowId) || !chrome.windows?.onBoundsChanged) return;
    popupBoundsTracked = true;
    chrome.windows.onBoundsChanged.addListener((win) => {
      if (win?.id === windowId) {
        savePopupWindowBounds(chrome, win);
      }
    });
    // Also capture the opening bounds, e.g. a window restored maximized.
    chrome.windows.get(windowId).then((win) => savePopupWindowBounds(chrome, win)).catch(() => {});
  }

  async function detectWindowType() {
    try {
      // 同时读取窗口类型和设置中的模式
      const [currentWindow, settings] = await Promise.all([
        chrome.windows.getCurrent(),
        chrome.storage.sync.get({ openMode: 'tab' })
      ]);
      // popup 类型的窗口 type 为 'popup'
      isPopupWindow = currentWindow.type === 'popup';
      document.body.classList.toggle('popup-window', isPopupWindow);
      currentOpenMode = settings.openMode;
      if (isPopupWindow) {
        trackPopupWindowBounds(currentWindow.id);
      }

      updateToggleButton();
    } catch (error) {
      console.error('Error detecting window type:', error);
    }
  }

  function updateToggleButton() {
    const btn = document.getElementById('toggle-open-mode-btn');
    if (!btn) return;

    const icon = btn.querySelector('.material-symbols-outlined');
    const text = btn.querySelector('.btn-text');

    if (isPopupWindow) {
      // 当前是弹出窗口，提示可以切换到标签页
      icon.textContent = 'tab';
      text.textContent = t('switchToTabMode') || 'Tab Mode';
      btn.title = t('switchToTabModeTitle') || 'Switch to Tab Mode';
    } else {
      // 当前是标签页，提示可以切换到弹出窗口
      icon.textContent = 'open_in_new';
      text.textContent = t('switchToPopupMode') || 'Popup Mode';
      btn.title = t('switchToPopupModeTitle') || 'Switch to Popup Mode';
    }
  }

  function collectCurrentState() {
    const state = {
      inputText: document.getElementById('unified-input')?.value || '',
      uploadedImages: [...getAttachmentsController().uploadedImages],
      currentLayout: getLayoutController().currentLayout,
      panels: getPanelsController().panels.map(p => ({
        providerId: p.providerId
      })),
      googleProviderMode: getProviderControlsController().currentGoogleProviderMode,
      timestamp: Date.now()
    };
    return state;
  }

  async function toggleOpenMode() {
    // 1. 收集当前状态
    const state = collectCurrentState();

    // 2. 保存状态到 storage（临时）
    try {
      await chrome.storage.session.set({
        preservedState: state
      });
    } catch (error) {
      console.error('Error saving state:', error);
      // Fallback to local storage if session storage fails
      await chrome.storage.local.set({
        preservedState: state
      });
    }

    // 3. 切换设置
    const newMode = isPopupWindow ? 'tab' : 'popup';
    await chrome.storage.sync.set({ openMode: newMode });

    // 4. 在新模式下打开
    const multiPanelUrl = chrome.runtime.getURL('multi-panel/multi-panel.html');

    if (isPopupWindow) {
      // 从弹出窗口切换到标签页：创建新标签页，关闭当前窗口
      await chrome.tabs.create({ url: multiPanelUrl, active: true });
      window.close(); // 关闭当前弹出窗口
    } else {
      // 从标签页切换到弹出窗口：创建弹出窗口，关闭当前标签页
      await createMultiPanelPopupWindow(chrome, multiPanelUrl);
      // 获取当前标签页并关闭
      const currentTab = await chrome.tabs.getCurrent();
      if (currentTab) {
        await chrome.tabs.remove(currentTab.id);
      }
    }
  }

  async function restoreStateIfNeeded() {
    try {
      // Prefer session storage, then local storage; read both at once
      const [sessionResult, localResult] = await Promise.all([
        chrome.storage.session.get('preservedState'),
        chrome.storage.local.get('preservedState')
      ]);
      const result = sessionResult.preservedState ? sessionResult : localResult;

      if (result.preservedState) {
        const state = result.preservedState;
        const restoredSettings = {};

        // 恢复输入文本
        const input = document.getElementById('unified-input');
        if (input && state.inputText) {
          input.value = state.inputText;
          // Trigger resize to adjust textarea height
          getComposerController().resizeTextarea();
        }

        // 恢复图片
        if (state.uploadedImages && state.uploadedImages.length > 0) {
          getAttachmentsController().uploadedImages = state.uploadedImages;
          getAttachmentsController().renderImagePreviews();
        }

        // 恢复布局
        if (state.currentLayout) {
          getLayoutController().currentLayout = getLayoutController().normalizeLayout(state.currentLayout);
          restoredSettings.multiPanelLayout = getLayoutController().currentLayout;
          const panelGrid = document.getElementById('panel-grid');
          if (panelGrid) {
            panelGrid.className = `layout-${getLayoutController().currentLayout}`;
          }
        }

        // 恢复面板配置（保存到 multiPanelProviders）
        if (Array.isArray(state.panels) && state.panels.length > 0) {
          getPanelsController().restoredStartupProviderIds = state.panels.map(p => p?.providerId).filter(id => getProviderById(id));
          restoredSettings.multiPanelProviders = getPanelsController().restoredStartupProviderIds;
        }

        if (state.googleProviderMode) {
          restoredSettings.googleProviderMode = normalizeGoogleProviderMode(state.googleProviderMode);
        }
        await chrome.storage.sync.set(restoredSettings);

        // 清除已恢复的状态
        await chrome.storage.session.remove('preservedState');
        await chrome.storage.local.remove('preservedState');
      }
    } catch (error) {
      console.error('Error restoring state:', error);
    }
  }

  return {
    get currentOpenMode() { return currentOpenMode; },
    set currentOpenMode(value) { currentOpenMode = value; },
    detectWindowType,
    restoreStateIfNeeded,
    toggleOpenMode,
  };
}
