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

vi.mock('../../../modules/platform/settings.js', () => ({
  getSettings: mocks.getSettings,
  saveSetting: mocks.saveSetting,
  saveSettings: mocks.saveSettings
}));

vi.mock('../../../modules/providers/providers.js', () => ({
  getProviderById: providerId => ({ id: providerId, name: providerId })
}));

vi.mock('../../../modules/providers/provider-tiers.js', async (importOriginal) => ({
  PROVIDER_TIER_IDS: ['fast', 'balanced', 'deep'],
  describeTierMapping: (await importOriginal()).describeTierMapping,
  getEffectiveTierRecipes: () => null,
  requestProviderTierState: mocks.requestProviderTierState,
  runProviderTierBatch: mocks.runProviderTierBatch
}));

vi.mock('../../../modules/composer/keyboard-shortcuts.js', async (importOriginal) => {
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

import { setupComposerControls } from '../../../modules/composer/composer-controls.js';
import {
  DEFAULT_KEYBOARD_SHORTCUT_BINDINGS,
  formatShortcutForTooltip
} from '../../../modules/composer/keyboard-shortcuts.js';

const MULTI_PANEL_HTML = readFileSync(
  resolve(process.cwd(), 'multi-panel/multi-panel.html'),
  'utf8'
);

let settingsState;
let panels;
let globalListenerRecords;
let operationBusy;

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
  document.body.innerHTML = `${controls}<button id="wide-content-btn" data-shortcut-action="toggleWideContent">Wide mode</button>`;
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

async function setupControls(initialPanels = panels, overrides = {}) {
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
    isOperationBusy: () => operationBusy,
    ...overrides
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
    selectedPromptMode: null,
    providerSortMode: 'manual',
    keyboardShortcutBindings: {},
    pageShortcutsEnabled: true
  };
  panels = [];
  operationBusy = false;
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
  it('applies the latest clicked tier after the running batch and shows it immediately', async () => {
    const firstBatch = createDeferred();
    mocks.runProviderTierBatch.mockImplementationOnce(() => firstBatch.promise);
    await setupControls([makePanel('panel-a')]);

    document.querySelector('[data-tier="fast"].tier-option').click();
    await flushMicrotasks();
    document.querySelector('[data-tier="balanced"].tier-option').click();
    document.querySelector('[data-tier="deep"].tier-option').click();

    const shell = document.getElementById('composer-shell');
    expect(shell.dataset).toMatchObject({ tier: 'deep', tierState: 'switching' });
    expect(document.querySelector('[data-tier="deep"].tier-option').disabled).toBe(false);
    expect(document.querySelector('[data-tier="deep"].tier-option').getAttribute('aria-checked')).toBe('false');
    expect(mocks.runProviderTierBatch).toHaveBeenCalledOnce();

    firstBatch.resolve(successfulResults(mocks.runProviderTierBatch.mock.calls[0][0]));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.runProviderTierBatch.mock.calls.map(([request]) => request.tier)).toEqual(['fast', 'deep']);
    expect(settingsState.selectedProviderTier).toBe('deep');
    expect(shell.dataset).toMatchObject({ tier: 'deep', tierState: 'confirmed' });
  });

  it('retains a tier chosen while sending and applies it when sending finishes', async () => {
    const controls = await setupControls([makePanel('panel-a')]);
    operationBusy = true;
    document.querySelector('[data-tier="deep"].tier-option').click();
    await vi.advanceTimersByTimeAsync(600);
    expect(mocks.runProviderTierBatch).not.toHaveBeenCalled();
    expect(document.getElementById('composer-shell').dataset.tier).toBe('deep');
    expect(controls.isTierBusy()).toBe(true);

    operationBusy = false;
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.runProviderTierBatch).toHaveBeenCalledOnce();
    expect(settingsState.selectedProviderTier).toBe('deep');
    expect(controls.isTierBusy()).toBe(false);
  });

  it('lets a queued user choice replace restoring the previous tier after a new chat', async () => {
    settingsState.selectedProviderTier = 'fast';
    const controls = await setupControls([makePanel('panel-a')]);
    operationBusy = true;
    document.querySelector('[data-tier="deep"].tier-option').click();
    await controls.restoreTier();
    expect(mocks.runProviderTierBatch).not.toHaveBeenCalled();
    operationBusy = false;
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.runProviderTierBatch.mock.calls.map(([request]) => request.tier)).toEqual(['deep']);
  });

  it('queues Default during a batch and stops restoring tiers after it settles', async () => {
    const firstBatch = createDeferred();
    mocks.runProviderTierBatch.mockImplementationOnce(() => firstBatch.promise);
    await setupControls([makePanel('panel-a')]);
    document.querySelector('[data-tier="deep"].tier-option').click();
    await flushMicrotasks();
    document.querySelector('[data-tier="default"].tier-option').click();
    expect(document.getElementById('composer-shell').dataset.tier).toBe('default');

    firstBatch.resolve(successfulResults(mocks.runProviderTierBatch.mock.calls[0][0]));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.runProviderTierBatch).toHaveBeenCalledOnce();
    expect(settingsState.selectedProviderTier).toBe(null);
    expect(document.querySelector('[data-tier="default"].tier-option').getAttribute('aria-checked')).toBe('true');
  });

  it('does not show confirmation when one panel cannot switch', async () => {
    mocks.runProviderTierBatch.mockImplementation(async options => {
      const results = successfulResults(options);
      results[1] = { ...results[1], status: 'unsupported', tier: null };
      return results;
    });
    await setupControls([makePanel('panel-a'), makePanel('panel-b', 'claude')]);
    document.querySelector('[data-tier="deep"].tier-option').click();
    await flushMicrotasks();
    expect(document.getElementById('composer-shell').dataset.tierState).toBe('mixed');
    expect(document.querySelector('[data-tier="deep"].tier-option').getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById('tier-status').textContent).toContain('1/2');
  });

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

  it('shows each AI\'s configured mapping for the selected tier and hides it in blind mode', async () => {
    settingsState.selectedProviderTier = 'balanced';
    let blind = false;
    await setupControls([makePanel('panel-a', 'claude'), makePanel('panel-b', 'deepseek'), makePanel('panel-c', 'grok')], {
      isBlindMode: () => blind
    });
    const mappingCells = () => [...document.querySelectorAll('#tier-details-body tr')]
      .map(row => row.children[1].textContent);

    document.getElementById('tier-details-btn').click();
    expect(mappingCells()).toEqual(['Reasoning effort Medium', '深度思考 on · shared with Deep', 'Not supported']);

    blind = true;
    document.getElementById('tier-details-btn').click();
    expect(mappingCells()).toEqual(['—', '—', '—']);
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

  it('opens the reasoning levels from a trigger that names the current level', async () => {
    settingsState.selectedProviderTier = 'balanced';
    await setupControls([]);
    const trigger = document.getElementById('tier-menu-btn');
    const menu = document.getElementById('provider-tier-controls');
    const options = [...document.querySelectorAll('.tier-option')];
    expect(options.map(option => option.dataset.tier)).toEqual(['default', 'fast', 'balanced', 'deep']);
    expect(document.getElementById('tier-menu-label').textContent).toBe('Balanced');
    expect(menu.hidden).toBe(true);
    expect(options[3].querySelector('.tier-option-key').textContent)
      .toBe(formatShortcutForTooltip(DEFAULT_KEYBOARD_SHORTCUT_BINDINGS.tierDeep));

    trigger.click();
    expect(menu.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(options[2]);
    options[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(options[3]);
    options[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(options[0]);
    options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu.hidden).toBe(true);

    trigger.click();
    options[0].click();
    await flushMicrotasks();
    expect(menu.hidden).toBe(true);
    expect(document.getElementById('tier-menu-label').textContent).toBe('Default');
  });

  it('selects Default with its shortcut', async () => {
    settingsState.selectedProviderTier = 'deep';
    await setupControls([]);
    const mac = /mac/i.test(navigator.platform);
    const event = new KeyboardEvent('keydown', {
      key: '0', code: 'Digit0', ctrlKey: !mac, metaKey: mac, altKey: true, bubbles: true, cancelable: true
    });
    // happy-dom reports Ctrl+Alt as AltGraph; a real keyboard does not.
    Object.defineProperty(event, 'getModifierState', { value: () => false });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await flushMicrotasks();
    expect(document.getElementById('composer-shell').dataset.tier).toBe('default');
  });

  it('shows a button\'s shortcut only after a mouse click', async () => {
    await setupControls([]);
    const send = document.getElementById('send-all-btn');
    const click = (detail, trusted) => {
      const event = new MouseEvent('click', { bubbles: true, detail });
      Object.defineProperty(event, 'isTrusted', { value: trusted });
      send.dispatchEvent(event);
    };
    click(0, true);
    click(1, false);
    expect(document.getElementById('shortcut-bubble')).toBeNull();

    click(1, true);
    const bubble = document.getElementById('shortcut-bubble');
    expect(bubble.textContent).toBe(formatShortcutForTooltip(DEFAULT_KEYBOARD_SHORTCUT_BINDINGS.send));
    vi.advanceTimersByTime(20);
    expect(bubble.dataset.visible).toBe('true');
    expect(send.classList.contains('shortcut-hinted')).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(bubble.dataset.visible).toBe('false');
    expect(send.classList.contains('shortcut-hinted')).toBe(false);
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

  it('lets users assign, clear, reset, and run the wide mode shortcut', async () => {
    const keyEvent = (key, modifiers = {}) => {
      const event = new KeyboardEvent('keydown', {
        key,
        code: modifiers.code,
        bubbles: true,
        cancelable: true,
        ctrlKey: modifiers.ctrlKey || false,
        altKey: modifiers.altKey || false,
        shiftKey: modifiers.shiftKey || false,
        metaKey: modifiers.metaKey || false
      });
      Object.defineProperty(event, 'getModifierState', {
        value: modifier => modifier === 'AltGraph' && modifiers.altGraph === true
      });
      return event;
    };
    settingsState.keyboardShortcutBindings = { toggleWideContent: 'Alt+L' };
    const toggleWideContent = vi.fn();
    await setupControls([], { toggleWideContent });

    const button = document.getElementById('wide-content-btn');
    expect(button.title).toContain('Alt+L');
    const initialShortcut = keyEvent('l', { code: 'KeyL', altKey: true });
    expect(mocks.keyboardControllers.at(-1).getBindings().toggleWideContent).toBe('Alt+L');
    window.dispatchEvent(initialShortcut);
    expect(initialShortcut.defaultPrevented).toBe(true);
    expect(toggleWideContent).toHaveBeenCalledOnce();

    document.getElementById('keyboard-shortcuts-btn').click();
    const field = document.querySelector('#keyboard-shortcuts-fields [data-action="toggleWideContent"]');
    field.dispatchEvent(keyEvent('Y', { code: 'KeyY', ctrlKey: true, shiftKey: true }));
    expect(field.value).toBe(formatShortcutForTooltip('Mod+Shift+Y'));
    document.getElementById('save-keyboard-shortcuts').click();
    await flushMicrotasks();

    expect(settingsState.keyboardShortcutBindings.toggleWideContent).toBe('Mod+Shift+Y');
    expect(button.title).toContain(formatShortcutForTooltip('Mod+Shift+Y'));
    window.dispatchEvent(keyEvent('Y', { code: 'KeyY', ctrlKey: true, shiftKey: true }));
    expect(toggleWideContent).toHaveBeenCalledTimes(2);

    document.getElementById('keyboard-shortcuts-btn').click();
    const editedField = document.querySelector('#keyboard-shortcuts-fields [data-action="toggleWideContent"]');
    editedField.dispatchEvent(keyEvent('Backspace', { code: 'Backspace' }));
    expect(editedField.value).toBe('');
    document.getElementById('page-shortcuts-enabled').checked = false;
    document.getElementById('save-keyboard-shortcuts').click();
    await flushMicrotasks();
    expect(settingsState.keyboardShortcutBindings.toggleWideContent).toBeNull();
    window.dispatchEvent(keyEvent('Y', { code: 'KeyY', ctrlKey: true, shiftKey: true }));
    expect(toggleWideContent).toHaveBeenCalledTimes(2);

    document.getElementById('keyboard-shortcuts-btn').click();
    document.getElementById('reset-keyboard-shortcuts').click();
    expect(document.getElementById('page-shortcuts-enabled').checked).toBe(true);
    expect(document.querySelector('#keyboard-shortcuts-fields [data-action="toggleWideContent"]').value)
      .toBe(formatShortcutForTooltip(DEFAULT_KEYBOARD_SHORTCUT_BINDINGS.toggleWideContent));
    document.getElementById('save-keyboard-shortcuts').click();
    await flushMicrotasks();
    expect(settingsState.keyboardShortcutBindings.toggleWideContent)
      .toBe(DEFAULT_KEYBOARD_SHORTCUT_BINDINGS.toggleWideContent);
    window.dispatchEvent(keyEvent('w', { code: 'KeyW', ctrlKey: true, altKey: true }));
    expect(toggleWideContent).toHaveBeenCalledTimes(3);
  });

  it('shows the send and fill shortcuts in the placeholder and describes buttons in tooltips', async () => {
    const controlsApi = await setupControls([]);
    const fillShortcut = formatShortcutForTooltip(DEFAULT_KEYBOARD_SHORTCUT_BINDINGS.fill);
    const input = document.getElementById('unified-input');
    const focusShortcut = formatShortcutForTooltip(DEFAULT_KEYBOARD_SHORTCUT_BINDINGS.focusInput);
    expect(input.placeholder.startsWith(`${focusShortcut}  Enter your question`)).toBe(true);
    expect(input.placeholder).toContain(`${formatShortcutForTooltip('Shift+Enter')} new line`);
    expect(input.placeholder).toContain(`${fillShortcut} fill only`);

    const send = document.getElementById('send-all-btn');
    expect(send.title).toBe(`Send to all (${formatShortcutForTooltip(DEFAULT_KEYBOARD_SHORTCUT_BINDINGS.send)})\nFill every panel with the question and send it`);
    expect(send.getAttribute('aria-label')).not.toContain('\n');
    expect(document.querySelector('[data-tier="deep"]').title).toContain('Switch every AI to its deepest reasoning mode');
    const clear = document.getElementById('clear-all-btn');
    clear.dataset.baseTitle = "Clear all inputs\nClear this box, its images and every panel's input";
    controlsApi.refreshTooltips();
    expect(clear.title).toBe(`Clear all inputs (${formatShortcutForTooltip(DEFAULT_KEYBOARD_SHORTCUT_BINDINGS.clearInputs)})\nClear this box, its images and every panel's input`);
    expect(clear.getAttribute('aria-label')).not.toContain('\n');

    document.getElementById('keyboard-shortcuts-btn').click();
    document.getElementById('page-shortcuts-enabled').checked = false;
    document.getElementById('save-keyboard-shortcuts').click();
    await flushMicrotasks();
    expect(input.placeholder).not.toContain('fill only');
    expect(input.placeholder.startsWith('Enter your question')).toBe(true);
  });

  it('accepts wide mode shortcuts only from the current provider iframe', async () => {
    const panel = makePanel('panel-a');
    const toggleWideContent = vi.fn();
    await setupControls([panel], { toggleWideContent });

    const dispatchShortcut = (source, origin) => {
      const event = new MessageEvent('message', {
        data: {
          type: 'PANELIZE_SHORTCUT',
          context: 'multi-panel',
          provider: 'chatgpt',
          actionId: 'toggleWideContent'
        },
        origin
      });
      Object.defineProperty(event, 'source', { value: source });
      window.dispatchEvent(event);
    };

    dispatchShortcut({}, 'https://chatgpt.com');
    dispatchShortcut(panel.iframe.contentWindow, 'https://evil.example');
    expect(toggleWideContent).not.toHaveBeenCalled();

    dispatchShortcut(panel.iframe.contentWindow, 'https://chatgpt.com');
    expect(toggleWideContent).toHaveBeenCalledOnce();
  });
});

describe('prompt mode control', () => {
  const promptSelect = () => document.getElementById('prompt-mode-btn');
  const modeOption = value => document.querySelector(`.prompt-mode-option[data-mode="${value}"]`);
  const chooseMode = async value => {
    modeOption(value).click();
    await flushMicrotasks();
  };
  const modePrompts = () => [
    { id: 1, title: 'Learning', content: 'Teach me.', isMode: true, modeKey: 'learning', createdAt: 1 },
    { id: 2, title: 'Concise', content: 'Be brief.', isMode: true, modeKey: 'concise', createdAt: 2 },
    { id: 3, title: 'Not a mode', content: 'Plain prompt.', isMode: false, modeKey: '', createdAt: 3 },
    { id: 4, title: 'Challenge', content: 'Win the comparison.', isMode: true, modeKey: 'compete', createdAt: 4 }
  ];
  const setupWithModes = (prompts = modePrompts()) => {
    const loadModePrompts = vi.fn(async () => prompts);
    return setupControls([], { loadModePrompts }).then(controls => ({ controls, loadModePrompts }));
  };
  const optionLabels = () => [...document.querySelectorAll('.prompt-mode-option-name')].map(option => option.textContent);
  const optionValues = () => [...document.querySelectorAll('.prompt-mode-option')].map(option => option.dataset.mode);

  it('lists only the library prompts marked as modes after Default and Auto, built-ins in menu order', async () => {
    await setupWithModes();

    expect(optionValues()).toEqual(['', 'auto', 'concise', 'learning', 'compete']);
    expect(optionLabels().slice(2)).toEqual(['Concise', 'Learning', 'Challenge']);
    expect(document.querySelectorAll('.prompt-mode-edit')).toHaveLength(3);
    expect(document.querySelectorAll('.prompt-mode-delete')).toHaveLength(3);
    expect(document.querySelector('.prompt-mode-new')).not.toBeNull();
  });

  it('opens and closes the mode menu from its button', async () => {
    await setupWithModes();
    const list = document.getElementById('prompt-mode-list');

    expect(list.hidden).toBe(true);
    promptSelect().click();
    expect(list.hidden).toBe(false);
    expect(promptSelect().getAttribute('aria-expanded')).toBe('true');
    await chooseMode('concise');
    expect(list.hidden).toBe(true);
    expect(document.getElementById('prompt-mode-label').textContent).toBe('Concise');
  });

  it('edits, deletes and creates modes from the menu', async () => {
    const prompts = modePrompts();
    const editModePrompt = vi.fn();
    const newModePrompt = vi.fn();
    const deleteModePrompt = vi.fn(async prompt => { prompts.splice(prompts.indexOf(prompt), 1); });
    const loadModePrompts = vi.fn(async () => prompts);
    await setupControls([], { loadModePrompts, editModePrompt, newModePrompt, deleteModePrompt });

    document.querySelector('.prompt-mode-edit[data-prompt-id="2"]').click();
    expect(editModePrompt).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));

    document.querySelector('.prompt-mode-new').click();
    expect(newModePrompt).toHaveBeenCalledOnce();

    document.querySelector('.prompt-mode-delete[data-prompt-id="1"]').click();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(deleteModePrompt).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(optionLabels()).not.toContain('Learning');
  });

  it('starts on the saved mode and marks the select as active', async () => {
    settingsState.selectedPromptMode = 'concise';
    const { controls } = await setupWithModes();

    expect(promptSelect().dataset.mode).toBe('concise');
    expect(controls.getPromptMode()).toBe('Be brief.');
    expect(promptSelect().closest('.prompt-mode-control').dataset.active).toBe('true');
    expect(promptSelect().title).toBe('Prompt mode: Concise\nBe brief.');
  });

  it('shows the appended instruction in the input placeholder', async () => {
    settingsState.selectedPromptMode = 'concise';
    await setupWithModes();
    const input = document.getElementById('unified-input');

    expect(input.placeholder).toContain('Appends: Be brief.');

    await chooseMode('');
    expect(input.placeholder).not.toContain('Appends:');
  });

  it('previews the appended instruction after the question and hides it when empty', async () => {
    settingsState.selectedPromptMode = 'concise';
    const { controls } = await setupWithModes();
    const input = document.getElementById('unified-input');
    const ghost = document.getElementById('prompt-ghost');

    expect(ghost.hidden).toBe(true);
    input.value = 'Explain closures';
    controls.refreshPromptGhost();
    expect(ghost.hidden).toBe(false);
    expect(ghost.textContent).toBe('Explain closures\u200bBe brief.');
    expect(ghost.querySelector('.prompt-ghost-suffix').textContent).toBe('Be brief.');

    input.value = '';
    controls.refreshPromptGhost();
    expect(ghost.hidden).toBe(true);
    expect(ghost.textContent).toBe('');
  });

  it('starts on Default when nothing or a missing mode is saved', async () => {
    settingsState.selectedPromptMode = 'verbose';
    const { controls } = await setupWithModes();

    expect(promptSelect().dataset.mode).toBe('');
    expect(controls.getPromptMode()).toBeNull();
    expect(promptSelect().closest('.prompt-mode-control').dataset.active).toBe('false');
    expect(promptSelect().title).toBe('Prompt mode\nNothing is added; each AI answers in its own way');
  });

  it('saves the chosen mode and reports its instruction', async () => {
    const { controls } = await setupWithModes();
    await chooseMode('compete');

    expect(mocks.saveSetting).toHaveBeenCalledWith('selectedPromptMode', 'compete');
    expect(controls.getPromptMode()).toBe('Win the comparison.');
    expect(promptSelect().closest('.prompt-mode-control').dataset.active).toBe('true');
    expect(promptSelect().title).toContain('Prompt mode: Challenge');
  });

  it('clears the mode when Default is picked again', async () => {
    settingsState.selectedPromptMode = 'learning';
    const { controls } = await setupWithModes();

    await chooseMode('');

    expect(mocks.saveSetting).toHaveBeenCalledWith('selectedPromptMode', null);
    expect(controls.getPromptMode()).toBeNull();
    expect(promptSelect().closest('.prompt-mode-control').dataset.active).toBe('false');
  });

  it('follows library edits and falls back to Default when the mode is gone', async () => {
    settingsState.selectedPromptMode = 'concise';
    const prompts = modePrompts();
    const { controls } = await setupWithModes(prompts);

    prompts[1].content = 'Shorter, please.';
    prompts[1].title = 'Short';
    await controls.refreshPromptModes();
    expect(controls.getPromptMode()).toBe('Shorter, please.');
    expect(optionLabels()).toContain('Short');

    prompts[1].isMode = false;
    await controls.refreshPromptModes();
    expect(optionLabels()).not.toContain('Short');
    expect(promptSelect().dataset.mode).toBe('');
    expect(controls.getPromptMode()).toBeNull();
    expect(mocks.saveSetting).not.toHaveBeenCalledWith('selectedPromptMode', null);
  });

  it('re-reads the library when the page regains focus', async () => {
    const { loadModePrompts } = await setupWithModes();
    loadModePrompts.mockClear();

    window.dispatchEvent(new Event('focus'));
    await flushMicrotasks();

    expect(loadModePrompts).toHaveBeenCalledOnce();
  });

  it('keeps Default only when the library cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controls = await setupControls([], { loadModePrompts: vi.fn().mockRejectedValue(new Error('idb')) });

    expect(optionLabels()).toHaveLength(2);
    expect(controls.getPromptMode()).toBeNull();
  });

  describe('Auto mode', () => {
    const triggerPrompts = () => modePrompts().map(prompt => ({
      ...prompt,
      triggers: { learning: ['/study'], concise: ['/brief'], compete: [] }[prompt.modeKey]
    }));

    it('adds nothing until a trigger word is typed, then applies that mode to the send', async () => {
      settingsState.selectedPromptMode = 'auto';
      const { controls } = await setupWithModes(triggerPrompts());

      expect(promptSelect().dataset.mode).toBe('auto');
      expect(controls.getPromptMode()).toBeNull();
      expect(controls.resolvePromptMode('Explain closures')).toEqual({ text: 'Explain closures', instruction: null, prompts: [] });
      const resolved = controls.resolvePromptMode('/study Explain closures');
      expect(resolved.text).toBe('Explain closures');
      expect(resolved.instruction).toBe('Teach me.');
      expect(controls.resolvePromptMode('/BRIEF why /study').instruction).toBe('Be brief.\n\nTeach me.');
    });

    it('marks the select active and lists the trigger words', async () => {
      settingsState.selectedPromptMode = 'auto';
      await setupWithModes(triggerPrompts());

      expect(promptSelect().closest('.prompt-mode-control').dataset.active).toBe('true');
      expect(promptSelect().title).toContain('Prompt mode: Auto');
      expect(promptSelect().title).toContain('/brief Concise · /study Learning');
      expect(document.getElementById('unified-input').placeholder).toContain('Auto: /brief Concise · /study Learning');
    });

    it('previews the removed trigger words struck through and the instruction appended', async () => {
      settingsState.selectedPromptMode = 'auto';
      const { controls } = await setupWithModes(triggerPrompts());
      const input = document.getElementById('unified-input');
      const ghost = document.getElementById('prompt-ghost');

      input.value = 'Explain closures /study';
      controls.refreshPromptGhost();
      expect(ghost.querySelector('.prompt-ghost-removed').textContent).toBe('/study');
      expect(ghost.querySelector('.prompt-ghost-suffix').textContent).toBe('Teach me.');

      input.value = 'Explain closures';
      controls.refreshPromptGhost();
      expect(ghost.hidden).toBe(true);
    });

    it('shows the trigger completion at the caret and completes it with Tab', async () => {
      settingsState.selectedPromptMode = 'auto';
      const { controls } = await setupWithModes(triggerPrompts());
      const input = document.getElementById('unified-input');
      const ghost = document.getElementById('prompt-ghost');
      input.focus();
      input.value = 'Explain /st';
      input.setSelectionRange(input.value.length, input.value.length);
      controls.refreshPromptGhost();

      expect(ghost.hidden).toBe(false);
      expect(ghost.querySelector('.prompt-ghost-completion').textContent).toBe('udy');
      expect(ghost.querySelector('.prompt-ghost-completion-hint').textContent).toBe('Tab · Learning');

      const onInput = vi.fn();
      input.addEventListener('input', onInput);
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      input.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(true);
      expect(input.value).toBe('Explain /study ');
      expect(input.selectionStart).toBe(input.value.length);
      expect(onInput).toHaveBeenCalled();
      expect(ghost.querySelector('.prompt-ghost-completion')).toBeNull();
      expect(ghost.querySelector('.prompt-ghost-removed').textContent).toBe('/study');
    });

    it('leaves Tab alone without a completion, with Shift, or outside Auto mode', async () => {
      settingsState.selectedPromptMode = 'auto';
      const { controls } = await setupWithModes(triggerPrompts());
      const input = document.getElementById('unified-input');
      const pressTab = (options = {}) => {
        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...options });
        input.dispatchEvent(event);
        return event.defaultPrevented;
      };
      input.focus();
      input.value = 'Explain';
      expect(pressTab()).toBe(false);
      input.value = '/st';
      input.setSelectionRange(3, 3);
      expect(pressTab({ shiftKey: true })).toBe(false);
      expect(input.value).toBe('/st');

      settingsState.selectedPromptMode = 'concise';
      await chooseMode('concise');
      input.focus();
      input.setSelectionRange(3, 3);
      controls.refreshPromptGhost();
      expect(document.querySelector('.prompt-ghost-completion')).toBeNull();
      expect(pressTab()).toBe(false);
      expect(input.value).toBe('/st');
    });

    it('keeps trigger words as typed outside Auto mode', async () => {
      settingsState.selectedPromptMode = 'concise';
      const { controls } = await setupWithModes(triggerPrompts());

      expect(controls.resolvePromptMode('/study Explain')).toEqual({ text: '/study Explain', instruction: 'Be brief.', prompts: [] });
    });
  });

  describe('per-send prompt mode override', () => {
    it('uses the requested built-in mode instead of the saved one', async () => {
      settingsState.selectedPromptMode = 'learning';
      const { controls } = await setupWithModes();

      expect(controls.resolvePromptMode('Explain closures', { promptMode: 'concise' }))
        .toEqual({ text: 'Explain closures', instruction: 'Be brief.', prompts: [] });
      expect(controls.getPromptMode()).toBe('Teach me.');
      expect(mocks.saveSetting).not.toHaveBeenCalled();
    });

    it('applies Default as no instruction even when a mode is saved', async () => {
      settingsState.selectedPromptMode = 'auto';
      const { controls } = await setupWithModes(modePrompts().map(prompt => ({
        ...prompt,
        triggers: prompt.modeKey === 'learning' ? ['/study'] : []
      })));

      expect(controls.resolvePromptMode('/study Explain', { promptMode: 'default' }))
        .toEqual({ text: '/study Explain', instruction: null, prompts: [] });
    });

    it('runs Auto trigger words for the requested send only', async () => {
      settingsState.selectedPromptMode = 'concise';
      const { controls } = await setupWithModes(modePrompts().map(prompt => ({
        ...prompt,
        triggers: prompt.modeKey === 'learning' ? ['/study'] : []
      })));

      const resolved = controls.resolvePromptMode('/study Explain', { promptMode: 'auto' });
      expect(resolved.text).toBe('Explain');
      expect(resolved.instruction).toBe('Teach me.');
      expect(controls.getPromptMode()).toBe('Be brief.');
      expect(promptSelect().dataset.mode).toBe('concise');
    });

    it('appends nothing for a built-in the library no longer has', async () => {
      const prompts = modePrompts().filter(prompt => prompt.modeKey !== 'learning');
      const { controls } = await setupWithModes(prompts);

      expect(controls.resolvePromptMode('Explain', { promptMode: 'learning' }))
        .toEqual({ text: 'Explain', instruction: null, prompts: [] });
      expect(controls.resolvePromptMode('Explain', { promptMode: 'custom-x' }))
        .toEqual({ text: 'Explain', instruction: null, prompts: [] });
    });

    it('keeps the saved mode when no override is passed', async () => {
      settingsState.selectedPromptMode = 'concise';
      const { controls } = await setupWithModes();

      expect(controls.resolvePromptMode('Explain'))
        .toEqual({ text: 'Explain', instruction: 'Be brief.', prompts: [] });
    });
  });

  it('follows a mode saved in another window', async () => {
    const { controls } = await setupWithModes();

    getStorageChangeListener()({ selectedPromptMode: { newValue: 'compete' } }, 'sync');

    expect(controls.getPromptMode()).toBe('Win the comparison.');
    expect(promptSelect().dataset.mode).toBe('compete');

    getStorageChangeListener()({ selectedPromptMode: { newValue: null } }, 'local');
    expect(controls.getPromptMode()).toBeNull();
    expect(promptSelect().dataset.mode).toBe('');
  });
});
