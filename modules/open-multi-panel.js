import {
  isMultiPanelTab,
  MULTI_PANEL_PAGE_PATH
} from './share-trigger.js';

/** chrome.storage.local key holding the last popup window bounds. */
export const POPUP_WINDOW_BOUNDS_KEY = 'popupWindowBounds';

const DEFAULT_POPUP_SIZE = { width: 1400, height: 900 };
const MIN_POPUP_WIDTH = 400;
const MIN_POPUP_HEIGHT = 300;

/**
 * Normalize a chrome.windows.Window (or stored value) into savable bounds.
 * Returns null for minimized/fullscreen windows or unusable sizes.
 */
export function normalizePopupWindowBounds(win) {
  if (!win || (win.state && win.state !== 'normal' && win.state !== 'maximized')) {
    return null;
  }
  const { left, top, width, height } = win;
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < MIN_POPUP_WIDTH || height < MIN_POPUP_HEIGHT) {
    return null;
  }
  const bounds = { width, height, state: win.state === 'maximized' ? 'maximized' : 'normal' };
  if (Number.isInteger(left) && Number.isInteger(top)) {
    bounds.left = left;
    bounds.top = top;
  }
  return bounds;
}

/** Remember the popup window's position, size and maximized state. */
export async function savePopupWindowBounds(chromeApi, win) {
  const bounds = normalizePopupWindowBounds(win);
  if (!bounds) return;
  if (bounds.state === 'maximized') {
    // Keep the last normal bounds so un-maximizing restores them.
    try {
      const stored = (await chromeApi.storage.local.get(POPUP_WINDOW_BOUNDS_KEY))[POPUP_WINDOW_BOUNDS_KEY];
      const previous = normalizePopupWindowBounds({ ...stored, state: 'normal' });
      if (previous) {
        const { state, ...normalBounds } = previous;
        Object.assign(bounds, normalBounds);
      }
    } catch (error) {
      // Fall back to the maximized bounds themselves
    }
  }
  try {
    await chromeApi.storage.local.set({ [POPUP_WINDOW_BOUNDS_KEY]: bounds });
  } catch (error) {
    // Ignore storage errors; the next open uses the default size
  }
}

/** Create the Multi-Panel popup window at its remembered bounds. */
export async function createMultiPanelPopupWindow(chromeApi, url) {
  let bounds = null;
  try {
    const stored = await chromeApi.storage?.local?.get(POPUP_WINDOW_BOUNDS_KEY);
    bounds = normalizePopupWindowBounds(stored?.[POPUP_WINDOW_BOUNDS_KEY]);
  } catch (error) {
    // Fall back to the default size
  }

  const createOptions = { url, type: 'popup', ...DEFAULT_POPUP_SIZE };
  if (bounds) {
    createOptions.width = bounds.width;
    createOptions.height = bounds.height;
    if ('left' in bounds) {
      createOptions.left = bounds.left;
      createOptions.top = bounds.top;
    }
  }

  const win = await chromeApi.windows.create(createOptions);
  // Chrome rejects state together with bounds, so maximize after creation.
  if (bounds?.state === 'maximized' && Number.isInteger(win?.id)) {
    try {
      await chromeApi.windows.update(win.id, { state: 'maximized' });
    } catch (error) {
      // Keep the normal window
    }
  }
  return win;
}

/** Open the Multi-Panel page in the configured tab or popup mode. */
export async function openMultiPanelPage(chromeApi, openMode) {
  const multiPanelUrl = chromeApi.runtime.getURL(MULTI_PANEL_PAGE_PATH);

  if (openMode === 'popup') {
    // Popup mode keeps its existing behavior: focus a window that already
    // contains Multi-Panel, or create a new popup window.
    const windows = await chromeApi.windows.getAll({ populate: true });
    for (const win of windows) {
      for (const tab of win.tabs || []) {
        if (await isMultiPanelTab(tab, chromeApi.runtime)) {
          await chromeApi.windows.update(win.id, { focused: true });
          return;
        }
      }
    }

    await createMultiPanelPopupWindow(chromeApi, multiPanelUrl);
    return;
  }

  const tabs = await chromeApi.tabs.query({});
  let existingTab = null;
  for (const tab of tabs) {
    if (await isMultiPanelTab(tab, chromeApi.runtime)) {
      existingTab = tab;
      break;
    }
  }

  if (existingTab) {
    await chromeApi.tabs.update(existingTab.id, { active: true });
    if (Number.isInteger(existingTab.windowId) && existingTab.windowId >= 0) {
      await chromeApi.windows.update(existingTab.windowId, { focused: true });
    }
    return;
  }

  await chromeApi.tabs.create({
    url: multiPanelUrl,
    active: true
  });
}
