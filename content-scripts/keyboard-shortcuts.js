// Forward shortcuts pressed inside provider frames to the trusted extension
// host. This script is self-contained because manifest content scripts run in
// an isolated classic-script world.
(() => {
  const ACTION_IDS = [
    'send',
    'fill',
    'newConversation',
    'focusInput',
    'tierFast',
    'tierBalanced',
    'tierDeep',
    'togglePromptLibrary',
    'toggleLayout',
    'togglePopularSort',
    'toggleWideContent'
  ];
  const DEFAULT_BINDINGS = {
    send: 'Mod+Enter',
    fill: 'Mod+Shift+Enter',
    newConversation: 'Mod+Alt+N',
    focusInput: 'Mod+Alt+K',
    tierFast: 'Mod+Alt+1',
    tierBalanced: 'Mod+Alt+2',
    tierDeep: 'Mod+Alt+3',
    togglePromptLibrary: null,
    toggleLayout: null,
    togglePopularSort: null,
    toggleWideContent: 'Mod+Alt+W'
  };
  const MODIFIERS = new Map([
    ['ctrl', 'Ctrl'], ['control', 'Ctrl'],
    ['alt', 'Alt'], ['option', 'Alt'],
    ['shift', 'Shift'], ['meta', 'Meta'], ['cmd', 'Mod'], ['command', 'Mod'], ['mod', 'Mod']
  ]);
  const KEY_ALIASES = new Map([
    ['enter', 'Enter'], ['return', 'Enter'], ['escape', 'Escape'], ['esc', 'Escape'],
    ['space', 'Space'], ['spacebar', 'Space'], ['delete', 'Delete'], ['del', 'Delete'],
    ['backspace', 'Backspace'], ['tab', 'Tab'], ['home', 'Home'], ['end', 'End'],
    ['pageup', 'PageUp'], ['pagedown', 'PageDown'], ['arrowleft', 'ArrowLeft'], ['left', 'ArrowLeft'],
    ['arrowright', 'ArrowRight'], ['right', 'ArrowRight'], ['arrowup', 'ArrowUp'], ['up', 'ArrowUp'],
    ['arrowdown', 'ArrowDown'], ['down', 'ArrowDown'], ['comma', 'Comma'], ['period', 'Period'],
    ['slash', 'Slash'], ['backquote', 'Backquote'], ['minus', 'Minus'], ['equal', 'Equal'],
    ['bracketleft', 'BracketLeft'], ['bracketright', 'BracketRight'], ['backslash', 'Backslash'],
    ['semicolon', 'Semicolon'], ['quote', 'Quote']
  ]);
  const KEY_SYMBOLS = new Map([
    [',', 'Comma'], ['.', 'Period'], ['/', 'Slash'], ['`', 'Backquote'], ['-', 'Minus'], ['=', 'Equal'],
    ['[', 'BracketLeft'], [']', 'BracketRight'], ['\\', 'Backslash'], [';', 'Semicolon'], ["'", 'Quote'], [' ', 'Space']
  ]);
  const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'];

  function providerForHostname(hostname) {
    const host = String(hostname || '').toLowerCase();
    const matches = domain => host === domain || host.endsWith(`.${domain}`);
    if (matches('chatgpt.com') || host === 'chat.openai.com') return 'chatgpt';
    if (matches('claude.ai')) return 'claude';
    if (host === 'gemini.google.com') return 'gemini';
    if (matches('grok.com')) return 'grok';
    if (host === 'chat.deepseek.com') return 'deepseek';
    if (matches('kimi.com')) return 'kimi';
    if (host === 'google.com' || host === 'www.google.com') return 'google';
    if (matches('doubao.com')) return 'doubao';
    if (host === 'qianwen.com' || host === 'www.qianwen.com') return 'qwen-cn';
    if (host === 'chat.qwen.ai') return 'qwen-global';
    if (host === 'chatglm.cn') return 'chatglm';
    if (host === 'chat.z.ai') return 'zai-global';
    if (host === 'yuanbao.tencent.com') return 'yuanbao';
    if (host === 'aistudio.xiaomimimo.com') return 'mimo';
    if (host === 'meta.ai' || host === 'www.meta.ai') return 'meta-ai';
    return null;
  }

  function readStorageArea(area, defaults) {
    if (typeof area?.get !== 'function') {
      return Promise.reject(new Error('Storage area is unavailable.'));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value || {});
      };

      const callback = value => {
        // chrome.* callbacks report failures through lastError, which is only
        // available while the callback is running.
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          finish(new Error(lastError.message || String(lastError)));
        } else {
          finish(null, value);
        }
      };

      try {
        const result = area.get(defaults, callback);
        if (result && typeof result.then === 'function') {
          result.then(value => finish(null, value), error => finish(error));
        }
      } catch (error) {
        finish(error);
      }
    });
  }

  function canonicalKey(value) {
    if (typeof value !== 'string') return null;
    const key = value.trim();
    if (!key) return null;
    if (KEY_SYMBOLS.has(key)) return KEY_SYMBOLS.get(key);
    const alias = KEY_ALIASES.get(key.toLowerCase());
    if (alias) return alias;
    if (/^[a-z]$/i.test(key)) return key.toUpperCase();
    if (/^[0-9]$/.test(key)) return key;
    if (/^f(?:[1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
    return null;
  }

  function parseBinding(value) {
    if (value === null || value === undefined || value === '') return { valid: true, binding: null };
    if (typeof value !== 'string') return { valid: false, binding: null };
    const parts = value.split('+').map(part => part.trim()).filter(Boolean);
    if (parts.length < 2) return { valid: false, binding: null };
    const modifiers = [];
    const keys = [];
    for (const part of parts) {
      const modifier = MODIFIERS.get(part.toLowerCase());
      if (modifier) modifiers.push(modifier);
      else keys.push(canonicalKey(part));
    }
    if (!modifiers.length || keys.length !== 1 || !keys[0] || new Set(modifiers).size !== modifiers.length) {
      return { valid: false, binding: null };
    }
    if (modifiers.includes('Mod') && (modifiers.includes('Ctrl') || modifiers.includes('Meta'))) {
      return { valid: false, binding: null };
    }
    const ordered = MODIFIER_ORDER.filter(modifier => modifiers.includes(modifier));
    return { valid: true, binding: [...ordered, keys[0]].join('+') };
  }

  function isReservedBinding(binding) {
    const parsed = parseBinding(binding);
    if (!parsed.valid || !parsed.binding) return false;
    const parts = parsed.binding.split('+');
    const key = parts.pop();
    const modifiers = new Set(parts);
    const primary = modifiers.has('Mod') || modifiers.has('Ctrl') || modifiers.has('Meta');
    const shift = modifiers.has('Shift');
    const alt = modifiers.has('Alt');
    if (primary && !alt && !shift && ['W', 'T', 'N', 'L', 'R', 'F', 'P'].includes(key)) return true;
    if (primary && shift && !alt && ['N', 'T', 'O', 'I', 'J'].includes(key)) return true;
    if (primary && alt && ['I', 'J'].includes(key)) return true;
    if (modifiers.has('Ctrl') && shift && ['I', 'J'].includes(key)) return true;
    if (key === 'F12') return true;
    return false;
  }

  function resolveBindings(overrides) {
    const supplied = overrides && typeof overrides === 'object' ? overrides : {};
    const resolved = {};
    const occupied = new Set();
    for (const actionId of ACTION_IDS) {
      let binding = DEFAULT_BINDINGS[actionId];
      if (Object.prototype.hasOwnProperty.call(supplied, actionId)) {
        const value = supplied[actionId];
        if (value === null || value === '') {
          binding = null;
        } else {
          const parsed = parseBinding(value);
          binding = parsed.valid && parsed.binding && !isReservedBinding(parsed.binding) ? parsed.binding : null;
        }
      }
      if (binding && occupied.has(binding)) binding = null;
      if (binding) occupied.add(binding);
      resolved[actionId] = binding;
    }
    return resolved;
  }

  function eventKey(event) {
    if (KEY_SYMBOLS.has(event?.key)) return KEY_SYMBOLS.get(event.key);
    const key = canonicalKey(event?.key);
    if (key) return key;
    const code = String(event?.code || '');
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
    return null;
  }

  function isMac() {
    return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');
  }

  function matches(event, binding) {
    if (!binding || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229
      || event.which === 229 || event.getModifierState?.('AltGraph')) return false;
    const parsed = parseBinding(binding);
    if (!parsed.valid || !parsed.binding) return false;
    const parts = parsed.binding.split('+');
    const key = parts.pop();
    const modifiers = new Set(parts);
    const wantsCtrl = modifiers.has('Ctrl') || (modifiers.has('Mod') && !isMac());
    const wantsMeta = modifiers.has('Meta') || (modifiers.has('Mod') && isMac());
    return eventKey(event) === key
      && Boolean(event.ctrlKey) === wantsCtrl
      && Boolean(event.metaKey) === wantsMeta
      && Boolean(event.altKey) === modifiers.has('Alt')
      && Boolean(event.shiftKey) === modifiers.has('Shift');
  }

  function isDialog(target) {
    return Boolean(target?.closest?.('dialog, [role="dialog"], [aria-modal="true"]'));
  }

  const provider = providerForHostname(window.location?.hostname);
  let extensionOrigin = '';
  try {
    const extensionUrl = new URL(chrome.runtime.getURL('/'));
    extensionOrigin = extensionUrl.origin === 'null'
      ? `${extensionUrl.protocol}//${extensionUrl.host}`
      : extensionUrl.origin;
  } catch {
    extensionOrigin = '';
  }
  if (!provider || !extensionOrigin || window.parent === window) return;

  const previous = window.__panelizeKeyboardShortcutForwarding;
  previous?.destroy?.();

  let bindings = resolveBindings();
  let enabled = true;
  let destroyed = false;
  const storageRevisions = { keyboardShortcutBindings: 0, pageShortcutsEnabled: 0 };

  const handleKeydown = event => {
    if (destroyed || !enabled) return;
    let actionId = null;
    for (const candidate of ACTION_IDS) {
      if (matches(event, bindings[candidate])) {
        actionId = candidate;
        break;
      }
    }
    if (!actionId) return;

    const isFocusAction = actionId === 'focusInput';
    if (isDialog(event.target) && !isFocusAction) return;

    event.preventDefault();
    event.stopImmediatePropagation?.();
    if (!event.stopImmediatePropagation) event.stopPropagation?.();
    try {
      window.parent.postMessage({
        type: 'PANELIZE_SHORTCUT',
        context: 'multi-panel',
        actionId,
        provider
      }, extensionOrigin);
    } catch {
      // The host may have navigated away; a shortcut should not break the page.
    }
  };

  const handleStorageChanged = (changes, areaName) => {
    if (areaName !== 'sync' && areaName !== 'local') return;
    if (Object.prototype.hasOwnProperty.call(changes || {}, 'keyboardShortcutBindings')) {
      storageRevisions.keyboardShortcutBindings += 1;
      bindings = resolveBindings(changes.keyboardShortcutBindings.newValue);
    }
    if (Object.prototype.hasOwnProperty.call(changes || {}, 'pageShortcutsEnabled')) {
      storageRevisions.pageShortcutsEnabled += 1;
      enabled = changes.pageShortcutsEnabled.newValue !== false;
    }
  };

  document.addEventListener('keydown', handleKeydown, true);
  chrome.storage?.onChanged?.addListener?.(handleStorageChanged);
  const initialStorageRevisions = { ...storageRevisions };
  const readInitialSettings = async () => {
    const defaults = {
      keyboardShortcutBindings: {},
      pageShortcutsEnabled: true
    };
    let settings;
    try {
      settings = await readStorageArea(chrome.storage?.sync, defaults);
    } catch {
      try {
        settings = await readStorageArea(chrome.storage?.local, defaults);
      } catch {
        // Defaults remain available when both storage areas are unavailable.
        return;
      }
    }

    if (destroyed || !settings) return;
    if (storageRevisions.keyboardShortcutBindings === initialStorageRevisions.keyboardShortcutBindings) {
      bindings = resolveBindings(settings.keyboardShortcutBindings);
    }
    if (storageRevisions.pageShortcutsEnabled === initialStorageRevisions.pageShortcutsEnabled) {
      enabled = settings.pageShortcutsEnabled !== false;
    }
  };
  void readInitialSettings();

  window.__panelizeKeyboardShortcutForwarding = {
    destroy() {
      destroyed = true;
      document.removeEventListener('keydown', handleKeydown, true);
      chrome.storage?.onChanged?.removeListener?.(handleStorageChanged);
    },
    getBindings() {
      return { ...bindings };
    },
    getEnabled() {
      return enabled;
    }
  };
})();
