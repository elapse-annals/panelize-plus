import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const contentScriptSource = readFileSync(
  resolve(process.cwd(), 'content-scripts/keyboard-shortcuts.js'),
  'utf8'
);

let parent;
let storageListener;
let storedSettings;
let originalLocation;
let runtimeLastError;

function keydown(key, modifiers = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key === 'Enter' ? 'Enter' : undefined,
    bubbles: true,
    cancelable: true,
    ctrlKey: modifiers.ctrlKey || false,
    altKey: modifiers.altKey || false,
    shiftKey: modifiers.shiftKey || false,
    metaKey: modifiers.metaKey || false,
    repeat: modifiers.repeat || false
  });
  Object.defineProperty(event, 'getModifierState', {
    value: modifier => modifier === 'AltGraph' && modifiers.altGraph === true
  });
  return event;
}

function modModifiers(extra = {}) {
  const primary = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')
    ? { metaKey: true }
    : { ctrlKey: true };
  return { ...primary, ...extra };
}

function setProviderHost(hostname) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname }
  });
}

function evaluateContentScript() {
  window.eval(contentScriptSource);
  return window.__panelizeKeyboardShortcutForwarding;
}

function dispatchKey(target, event) {
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
  setProviderHost('chatgpt.com');
  parent = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { configurable: true, value: parent });
  storedSettings = { keyboardShortcutEnabled: false };
  runtimeLastError = null;
  storageListener = null;

  const chromeMock = {
    runtime: {
      getURL: vi.fn(() => 'chrome-extension://panelize-test/'),
      get lastError() { return runtimeLastError; }
    },
    storage: {
      sync: {
        get: vi.fn((defaults, callback) => callback({ ...defaults, ...storedSettings }))
      },
      local: {
        get: vi.fn((defaults, callback) => callback({ ...defaults, ...storedSettings }))
      },
      onChanged: {
        addListener: vi.fn(listener => { storageListener = listener; }),
        removeListener: vi.fn()
      }
    }
  };
  window.chrome = chromeMock;
  vi.stubGlobal('chrome', chromeMock);
  document.body.innerHTML = '<textarea id="composer"></textarea><div id="page"></div>';
});

afterEach(() => {
  window.__panelizeKeyboardShortcutForwarding?.destroy?.();
  delete window.__panelizeKeyboardShortcutForwarding;
  if (originalLocation) {
    Object.defineProperty(window, 'location', originalLocation);
  }
  delete window.parent;
  delete window.chrome;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('provider keyboard shortcut forwarding content script', () => {
  it('forwards one matching action to the extension origin with the detected provider', () => {
    const controller = evaluateContentScript();
    const event = dispatchKey(document.getElementById('composer'), keydown('Enter', modModifiers()));

    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).toHaveBeenCalledWith({
      type: 'PANELIZE_SHORTCUT',
      context: 'multi-panel',
      actionId: 'send',
      provider: 'chatgpt'
    }, 'chrome-extension://panelize-test');
    expect(event.defaultPrevented).toBe(true);
    expect(controller.getEnabled()).toBe(true);
    expect(window.chrome.storage.sync.get).toHaveBeenCalledWith({
      keyboardShortcutBindings: {},
      pageShortcutsEnabled: true
    }, expect.any(Function));
  });

  it('keeps tier shortcuts available while typing in an AI composer', () => {
    evaluateContentScript();
    const event = dispatchKey(
      document.getElementById('composer'),
      keydown('1', modModifiers({ altKey: true }))
    );

    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'tierFast' }), expect.any(String));
    expect(event.defaultPrevented).toBe(true);
  });

  it('updates custom bindings and the page-only enabled setting from sync storage', () => {
    const controller = evaluateContentScript();
    storageListener({ pageShortcutsEnabled: { newValue: false } }, 'sync');
    dispatchKey(document.body, keydown('Enter', modModifiers()));
    expect(parent.postMessage).not.toHaveBeenCalled();

    storageListener({ pageShortcutsEnabled: { newValue: true } }, 'sync');
    storageListener({
      keyboardShortcutBindings: {
        newValue: { send: null, toggleLayout: 'Alt+L', tierFast: 'Ctrl+W' }
      }
    }, 'sync');
    dispatchKey(document.getElementById('composer'), keydown('Enter', modModifiers()));
    expect(parent.postMessage).not.toHaveBeenCalled();

    dispatchKey(document.body, keydown('l', { altKey: true }));
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage.mock.calls[0][0]).toMatchObject({ actionId: 'toggleLayout' });
    expect(controller.getBindings()).toMatchObject({ send: null, toggleLayout: 'Alt+L', tierFast: null });
  });

  it('falls back to local storage on sync lastError and applies local changes', async () => {
    const chromeMock = window.chrome;
    const localSettings = {
      keyboardShortcutBindings: { send: null, toggleLayout: 'Alt+L' },
      pageShortcutsEnabled: false
    };
    chromeMock.storage.sync.get = vi.fn((defaults, callback) => {
      runtimeLastError = { message: 'sync unavailable' };
      callback();
      runtimeLastError = null;
    });
    chromeMock.storage.local.get = vi.fn((defaults, callback) => callback({ ...defaults, ...localSettings }));

    const controller = evaluateContentScript();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(chromeMock.storage.local.get).toHaveBeenCalledTimes(1);
    expect(controller.getEnabled()).toBe(false);
    expect(controller.getBindings()).toMatchObject({ send: null, toggleLayout: 'Alt+L' });
    dispatchKey(document.body, keydown('l', { altKey: true }));
    expect(parent.postMessage).not.toHaveBeenCalled();

    storageListener({ pageShortcutsEnabled: { newValue: true } }, 'local');
    dispatchKey(document.body, keydown('l', { altKey: true }));
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage.mock.calls[0][0]).toMatchObject({ actionId: 'toggleLayout' });
  });

  it('ignores IME, repeats, browser-owned shortcuts and actions typed in dialogs', () => {
    const controller = evaluateContentScript();
    const repeated = keydown('Enter', modModifiers({ repeat: true }));
    dispatchKey(document.body, repeated);
    const composing = keydown('Enter', modModifiers());
    Object.defineProperty(composing, 'isComposing', { value: true });
    dispatchKey(document.body, composing);
    dispatchKey(document.body, keydown('1', modModifiers({ altKey: true, altGraph: true })));
    dispatchKey(document.body, keydown('w', { ctrlKey: true }));

    document.body.innerHTML = '<div role="dialog"><input id="modal-input"></div>';
    dispatchKey(document.getElementById('modal-input'), keydown('1', modModifiers({ altKey: true })));
    expect(parent.postMessage).not.toHaveBeenCalled();

    // The focus action remains usable from an editable dialog field.
    dispatchKey(document.getElementById('modal-input'), keydown('k', modModifiers({ altKey: true })));
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage.mock.calls[0][0]).toMatchObject({ actionId: 'focusInput' });
    controller.destroy();
  });

  it('does not install on an unknown provider or in the top-level browsing context', () => {
    setProviderHost('example.com');
    expect(evaluateContentScript()).toBeUndefined();
    dispatchKey(document.body, keydown('Enter', modModifiers()));
    expect(parent.postMessage).not.toHaveBeenCalled();

    setProviderHost('chatgpt.com');
    Object.defineProperty(window, 'parent', { configurable: true, value: window });
    expect(evaluateContentScript()).toBeUndefined();
    dispatchKey(document.body, keydown('Enter', modModifiers()));
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('uses the provider IDs defined by the extension for Zhipu sites', () => {
    for (const [hostname, expectedProvider] of [
      ['chatglm.cn', 'chatglm'],
      ['chat.z.ai', 'zai-global']
    ]) {
      setProviderHost(hostname);
      const controller = evaluateContentScript();
      dispatchKey(document.body, keydown('Enter', modModifiers()));
      expect(parent.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({ provider: expectedProvider });
      controller.destroy();
      parent.postMessage.mockClear();
    }
  });

  it('responds to setting changes from both sync and local storage areas', () => {
    evaluateContentScript();
    storageListener({ pageShortcutsEnabled: { newValue: false } }, 'local');
    dispatchKey(document.body, keydown('Enter', modModifiers()));
    expect(parent.postMessage).not.toHaveBeenCalled();

    storageListener({ pageShortcutsEnabled: { newValue: true } }, 'sync');
    dispatchKey(document.body, keydown('Enter', modModifiers()));
    expect(parent.postMessage).toHaveBeenCalledTimes(1);

    storageListener({ pageShortcutsEnabled: { newValue: false } }, 'local');
    dispatchKey(document.body, keydown('Enter', modModifiers()));
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
  });
});
