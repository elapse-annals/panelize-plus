import {
  isMultiPanelTab,
  MULTI_PANEL_PAGE_PATH
} from './share-trigger.js';

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

    await chromeApi.windows.create({
      url: multiPanelUrl,
      type: 'popup',
      width: 1400,
      height: 900
    });
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
