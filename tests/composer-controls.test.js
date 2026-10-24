import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSetting: vi.fn(),
  saveSettings: vi.fn(),
  requestProviderTierState: vi.fn(),
  runProviderTierBatch: vi.fn(),
  keyboardControllers: []
}));

vi.mock('../modules/settings.js', () => ({
  getSettings: mocks.getSettings,
  saveSetting: mocks.saveSetting,
  saveSettings: mocks.saveSettings
}));

vi.mock('../modules/providers.js', () => ({
  getProviderById: providerId => ({ id: providerId, name: providerId })
}));

vi.mock('../modules/provider-tiers.js', () => ({
  PROVIDER_TIER_IDS: ['fast', 'balanced', 'deep'],
  getEffectiveTierRecipes: () => null,
  requestProviderTierState: mocks.requestProviderTierState,
  runProviderTierBatch: mocks.runProviderTierBatch
}));

vi.mock('../modules/keyboard-shortcuts.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    setupKeyboardShortcuts: vi.fn((options) => {
      const controller = actual.setupKeyboardShortcuts(options);
      mocks.keyboardControllers.push(controller);
      return controller;
    })
  };
});

import { setupComposerControls } from '../modules/composer-controls.js';
import {
  DEFAULT_KEYBOARD_SHORTCUT_BINDINGS,
  formatShortcutForTooltip
} from '../modules/keyboard-shortcuts.js';

const MULTI_PANEL_HTML = readFileSync(
  resolve(process.cwd(), 'multi-panel/multi-panel.html'),
  'utf8'
);

let settingsState;
let panels;
let globalListenerRecords;

function mountActualControls() {
  const extractDiv = id => {
    const idPosition = MULTI_PANEL_HTML.indexOf(`id="${id}"`);
    const start = MULTI_PANEL_HTML.lastIndexOf('<div', idPosition);
    const tags = /<\/?div\b[^>]*>/g;
    tags.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = tags.exec(MULTI_PANEL_HTML))) {
      depth += match[0].startsWith('</') ? -1 : 1;
      if (depth === 0) return MULTI_PANEL_HTML.slice(start, tags.lastIndex);
    }
    throw new Error(`Could not extract #${id} from multi-panel.html`);
  };
  const controls = ['composer-shell', 'tier-details-modal', 'keyboard-shortcuts-modal']
    .map(extractDiv)
    .join('');
  document.body.innerHTML = controls;
}

function makePanel(id, providerId = 'chatgpt') {
  const url = providerId === 'claude' ? 'https://claude.ai/new' : 'https://chatgpt.com/';
  return {
    id,
    providerId,
    currentUrl: url,
    iframe: { src: url, contentWindow: {} }
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function successfulResults({ panels: targets, tier }) {
  return targets.map(panel => ({
    panelId: panel.panelId,
    provider: panel.provider,
    status: 'success',
    tier,
    requestedTier: tier,
    actualLabel: `${tier} mode`,
    supportedTiers: ['fast', 'balanced', 'deep']
  }));
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function setupControls(initialPanels = panels) {
  panels = initialPanels;
  mountActualControls();
  const controls = await setupComposerControls({
    getPanels: () => panels,
    send: vi.fn(),
    fill: vi.fn(),
    newConversation: vi.fn(),
    focusInput: vi.fn(),
    openPromptLibrary: vi.fn(),
    openLayout: vi.fn(),
    text: (key, fallback, values) => (values || []).reduce(
      (result, value, index) => result.replaceAll(`$${index + 1}`, value),
      fallback || key
    ),
    notify: vi.fn(),
    isOperationBusy: () => false
  });
  await flushMicrotasks();
  return controls;
}

function getStorageChangeListener() {
  const calls = chrome.storage.onChanged.addListener.mock.calls;
  return calls.at(-1)?.[0];
}

function fireSelectedTierChange(value, area = 'sync') {
  getStorageChangeListener()({ selectedProviderTier: { newValue: value } }, area);
}

function trackGlobalListeners(target) {
  const originalAdd = target.addEventListener.bind(target);
  vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
    globalListenerRecords.push({ target, type, listener, options });
    return originalAdd(type, listener, options);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.keyboardControllers.length = 0;
  globalListenerRecords = [];
  settingsState = {
    selectedProviderTier: null,
    providerSortMode: 'manual',
    keyboardShortcutBindings: {},
    pageShortcutsEnabled: true
  };
  panels = [];
  mocks.getSettings.mockImplementation(() => Promise.resolve({ ...settingsState }));
  mocks.saveSetting.mockImplementation((key, value) => {
    settingsState[key] = value;
    return Promise.resolve();
  });
  mocks.saveSettings.mockImplementation(values => {
    Object.assign(settingsState, values);
    return Promise.resolve();
  });
  mocks.requestProviderTierState.mockImplementation(({ panelId, provider }) => Promise.resolve({
    panelId,
    provider,
    status: 'unavailable',
    reason: 'selector_not_visible',
    tier: null,
    actualLabel: null,
    supportedTiers: []
  }));
  mocks.runProviderTierBatch.mockImplementation(options => Promise.resolve(successfulResults(options)));
  chrome.storage.onChanged.addListener.mockClear();
  chrome.commands = { getAll: vi.fn().mockResolvedValue([]) };
  trackGlobalListeners(document);
  trackGlobalListeners(window);
});

afterEach(() => {
  mocks.keyboardControllers.forEach(controller => controller.destroy());
  globalListenerRecords.forEach(({ target, type, listener, options }) => {
    target.removeEventListener(type, listener, options);
  });
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('composer control async state', () => {
  it('clears the selected tier and prevents the pending load checks from restoring it', async () => {
    settingsState.selectedProviderTier = 'balanced';
    const panel = makePanel('panel-a');
    const controls = await setupControls([panel]);

    fireSelectedTierChange(null);

    const balancedButton = document.querySelector('.tier-option[data-tier="balanced"]');
    expect(balancedButton.dataset.requested).toBe('false');
    expect(balancedButton.getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById('tier-status').textContent).toBe('');

    await vi.advanceTimersByTimeAsync(10000);

    expect(mocks.runProviderTierBatch).not.toHaveBeenCalled();
    expect(controls.isTierBusy()).toBe(false);
  });

  it('starts on Default and never switches the AIs while Default is selected', async () => {
    const panel = makePanel('panel-a');
    await setupControls([panel]);

    const defaultButton = document.querySelector('.tier-option[data-tier="default"]');
    expect(defaultButton.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('.tier-option[data-tier="fast"]').getAttribute('aria-checked')).toBe('false');

    defaultButton.click();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(10000);

    expect(mocks.saveSetting).toHaveBeenCalledWith('selectedProviderTier', null);
    expect(mocks.runProviderTierBatch).not.toHaveBeenCalled();
  });

  it('returns from a selected tier to Default without switching the AIs again', async () => {
    settingsState.selectedProviderTier = 'deep';
    const panel = makePanel('panel-a');
    await setupControls([panel]);
    expect(document.querySelector('.tier-option[data-tier="default"]').getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('.tier-option[data-tier="default"]').dataset.requested).toBe('false');

    document.querySelector('.tier-option[data-tier="default"]').click();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(10000);

    expect(mocks.saveSetting).toHaveBeenCalledWith('selectedProviderTier', null);
    expect(document.querySelector('.tier-option[data-tier="default"]').getAttribute('aria-checked')).toBe('true');
    const deepButton = document.querySelector('.tier-option[data-tier="deep"]');
    expect(deepButton.dataset.requested).toBe('false');
    expect(deepButton.getAttribute('aria-checked')).toBe('false');
    expect(mocks.runProviderTierBatch).not.toHaveBeenCalled();
  });

  it('moves focus across all four reasoning levels with the arrow keys', async () => {
    await setupControls([]);
    const options = [...document.querySelectorAll('.tier-option')];
    expect(options.map(option => option.dataset.tier)).toEqual(['default', 'fast', 'balanced', 'deep']);

    options[0].focus();
    options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(options[3]);
    options[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(options[0]);
  });

  it('keeps the latest external tier request queued while another tier batch is busy', async () => {
    settingsState.selectedProviderTier = 'balanced';
    const panel = makePanel('panel-a');
    const firstBatch = createDeferred();
    const latestBatch = createDeferred();
    mocks.runProviderTierBatch
      .mockImplementationOnce(options => firstBatch.promise)
      .mockImplementationOnce(options => latestBatch.promise);
    const controls = await setupControls([panel]);

    const firstOperation = controls.restoreTier([panel]);
    await flushMicrotasks();
    expect(mocks.runProviderTierBatch).toHaveBeenCalledTimes(1);

    fireSelectedTierChange('fast');
    fireSelectedTierChange('deep');
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.runProviderTierBatch).toHaveBeenCalledTimes(1);

    firstBatch.resolve(successfulResults(mocks.runProviderTierBatch.mock.calls[0][0]));
    await firstOperation;
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.runProviderTierBatch).toHaveBeenCalledTimes(2);
    expect(mocks.runProviderTierBatch.mock.calls[1][0].tier).toBe('deep');
    expect(document.querySelector('.tier-option[data-tier="deep"]').dataset.requested).toBe('true');

    latestBatch.resolve(successfulResults(mocks.runProviderTierBatch.mock.calls[1][0]));
    await flushMicrotasks();
  });

  it('ignores a successful tier reply from the previous same-provider iframe load', async () => {
    const panel = makePanel('panel-a');
    const oldDocumentBatch = createDeferred();
    const newDocumentBatch = createDeferred();
    mocks.runProviderTierBatch
      .mockImplementationOnce(options => oldDocumentBatch.promise)
      .mockImplementationOnce(options => newDocumentBatch.promise);
    const controls = await setupControls([panel]);

    document.querySelector('.tier-option[data-tier="balanced"]').click();
    await flushMicrotasks();
    expect(mocks.runProviderTierBatch).toHaveBeenCalledTimes(1);

    // The same panel and provider now represent a new document load.
    controls.panelLoaded(panel);
    oldDocumentBatch.resolve(successfulResults(mocks.runProviderTierBatch.mock.calls[0][0]));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(380);

    expect(mocks.runProviderTierBatch).toHaveBeenCalledTimes(2);
    expect(mocks.runProviderTierBatch.mock.calls[1][0].panels.map(({ panelId }) => panelId)).toEqual(['panel-a']);

    newDocumentBatch.resolve(successfulResults(mocks.runProviderTierBatch.mock.calls[1][0]));
    await flushMicrotasks();
  });

  it('restores simultaneously loaded panels together in one tier batch', async () => {
    settingsState.selectedProviderTier = 'deep';
    const controls = await setupControls([]);
    const first = makePanel('panel-a', 'chatgpt');
    const second = makePanel('panel-b', 'claude');
    panels = [first, second];
    controls.panelsChanged();
    controls.panelLoaded(first);
    controls.panelLoaded(second);

    await vi.advanceTimersByTimeAsync(380);

    expect(mocks.runProviderTierBatch).toHaveBeenCalledOnce();
    expect(mocks.runProviderTierBatch.mock.calls[0][0].tier).toBe('deep');
    expect(mocks.runProviderTierBatch.mock.calls[0][0].panels.map(({ panelId }) => panelId))
      .toEqual(['panel-a', 'panel-b']);
  });

  it('rejects duplicate shortcut assignments and saves the other current bindings', async () => {
    settingsState.keyboardShortcutBindings = { toggleLayout: 'Alt+L' };
    await setupControls([]);

    document.getElementById('keyboard-shortcuts-btn').click();
    const sendField = document.querySelector('#keyboard-shortcuts-fields [data-action="send"]');
    const originalSendBinding = sendField.value;
    sendField.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
    }));

    expect(document.getElementById('keyboard-shortcuts-error').textContent).toContain('already used');
    expect(sendField.value).toBe(originalSendBinding);

    sendField.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true
    }));
    expect(sendField.value).toBe(formatShortcutForTooltip('Mod+K'));
    document.getElementById('save-keyboard-shortcuts').click();
    await flushMicrotasks();

    expect(mocks.saveSettings).toHaveBeenCalledOnce();
    const savedBindings = mocks.saveSettings.mock.calls[0][0].keyboardShortcutBindings;
    expect(savedBindings).toMatchObject({
      send: 'Mod+K',
      fill: DEFAULT_KEYBOARD_SHORTCUT_BINDINGS.fill,
      newConversation: DEFAULT_KEYBOARD_SHORTCUT_BINDINGS.newConversation,
      toggleLayout: 'Alt+L'
    });
  });
});
