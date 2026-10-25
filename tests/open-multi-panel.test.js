import { describe, expect, it, vi } from 'vitest';
import { openMultiPanelPage } from '../modules/open-multi-panel.js';

const MULTI_PANEL_URL = 'chrome-extension://test-id/multi-panel/multi-panel.html';

function createChromeApi({ tabs = [], windows = [] } = {}) {
  return {
    runtime: {
      getURL: vi.fn((path) => `chrome-extension://test-id/${path}`),
      getContexts: vi.fn(async ({ tabIds }) => tabIds[0] === 9
        ? [{ tabId: 9, frameId: 0, documentUrl: MULTI_PANEL_URL }]
        : [])
    },
    tabs: {
      query: vi.fn(async () => tabs),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({}))
    },
    windows: {
      getAll: vi.fn(async () => windows),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({}))
    }
  };
}

describe('openMultiPanelPage', () => {
  it('activates and focuses an existing Multi-Panel tab, including tabs with a hash', async () => {
    const chromeApi = createChromeApi({
      tabs: [
        { id: 4, windowId: 8, url: 'chrome-extension://test-id/options/options.html' },
        { id: 9, windowId: 12, url: `${MULTI_PANEL_URL}?source=shortcut#panel` }
      ]
    });

    await openMultiPanelPage(chromeApi, 'tab');

    expect(chromeApi.tabs.query).toHaveBeenCalledWith({});
    expect(chromeApi.tabs.update).toHaveBeenCalledWith(9, { active: true });
    expect(chromeApi.windows.update).toHaveBeenCalledWith(12, { focused: true });
    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
  });

  it('creates a new tab when there is no exact Multi-Panel page', async () => {
    const chromeApi = createChromeApi({
      tabs: [
        { id: 4, windowId: 8, url: 'chrome-extension://test-id/multi-panel/other.html' },
        { id: 5, windowId: 8, url: 'https://example.com/multi-panel/multi-panel.html' }
      ]
    });

    await openMultiPanelPage(chromeApi, 'tab');

    expect(chromeApi.tabs.create).toHaveBeenCalledWith({ url: MULTI_PANEL_URL, active: true });
    expect(chromeApi.tabs.update).not.toHaveBeenCalled();
    expect(chromeApi.windows.update).not.toHaveBeenCalled();
  });

  it('does not reuse a Multi-Panel tab that is already navigating away', async () => {
    const chromeApi = createChromeApi({
      tabs: [{
        id: 4,
        windowId: 8,
        url: MULTI_PANEL_URL,
        pendingUrl: 'https://example.com/'
      }]
    });

    await openMultiPanelPage(chromeApi, 'tab');

    expect(chromeApi.tabs.create).toHaveBeenCalledWith({ url: MULTI_PANEL_URL, active: true });
  });

  it('finds a Multi-Panel tab through runtime contexts when Chrome hides its URL', async () => {
    const chromeApi = createChromeApi({
      tabs: [
        { id: 4, windowId: 8 },
        { id: 9, windowId: 12 }
      ]
    });

    await openMultiPanelPage(chromeApi, 'tab');

    expect(chromeApi.runtime.getContexts).toHaveBeenCalledWith({ contextTypes: ['TAB'], tabIds: [4] });
    expect(chromeApi.runtime.getContexts).toHaveBeenCalledWith({ contextTypes: ['TAB'], tabIds: [9] });
    expect(chromeApi.tabs.update).toHaveBeenCalledWith(9, { active: true });
    expect(chromeApi.windows.update).toHaveBeenCalledWith(12, { focused: true });
    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
  });

  it('keeps popup mode focused on its existing Multi-Panel window', async () => {
    const chromeApi = createChromeApi({
      windows: [{
        id: 21,
        tabs: [{ id: 5, url: MULTI_PANEL_URL }]
      }]
    });

    await openMultiPanelPage(chromeApi, 'popup');

    expect(chromeApi.windows.getAll).toHaveBeenCalledWith({ populate: true });
    expect(chromeApi.windows.update).toHaveBeenCalledWith(21, { focused: true });
    expect(chromeApi.windows.create).not.toHaveBeenCalled();
    expect(chromeApi.tabs.query).not.toHaveBeenCalled();
    expect(chromeApi.tabs.update).not.toHaveBeenCalled();
  });

  it('keeps popup reuse working when Chrome hides the tab URL', async () => {
    const chromeApi = createChromeApi({
      windows: [{ id: 21, tabs: [{ id: 9 }] }]
    });

    await openMultiPanelPage(chromeApi, 'popup');

    expect(chromeApi.runtime.getContexts).toHaveBeenCalledWith({
      contextTypes: ['TAB'],
      tabIds: [9]
    });
    expect(chromeApi.windows.update).toHaveBeenCalledWith(21, { focused: true });
    expect(chromeApi.windows.create).not.toHaveBeenCalled();
  });

  it('creates a popup window when there is no existing Multi-Panel window', async () => {
    const chromeApi = createChromeApi({
      windows: [{ id: 21, tabs: [{ id: 5, url: 'https://example.com/' }] }]
    });

    await openMultiPanelPage(chromeApi, 'popup');

    expect(chromeApi.windows.create).toHaveBeenCalledWith({
      url: MULTI_PANEL_URL,
      type: 'popup',
      width: 1400,
      height: 900
    });
  });
});
