export const KEYBOARD_SHORTCUT_ACTIONS = Object.freeze({
  SEND: 'send',
  FILL: 'fill',
  NEW_CONVERSATION: 'newConversation',
  FOCUS_INPUT: 'focusInput',
  TIER_FAST: 'tierFast',
  TIER_BALANCED: 'tierBalanced',
  TIER_DEEP: 'tierDeep',
  TOGGLE_PROMPT_LIBRARY: 'togglePromptLibrary',
  TOGGLE_LAYOUT: 'toggleLayout',
  TOGGLE_POPULAR_SORT: 'togglePopularSort'
});

export const DEFAULT_KEYBOARD_SHORTCUT_BINDINGS = Object.freeze({
  [KEYBOARD_SHORTCUT_ACTIONS.SEND]: 'Mod+Enter',
  [KEYBOARD_SHORTCUT_ACTIONS.FILL]: 'Mod+Shift+Enter',
  [KEYBOARD_SHORTCUT_ACTIONS.NEW_CONVERSATION]: 'Mod+Alt+N',
  // Mod+Alt+I opens browser developer tools on macOS. K is free on the
  // supported browsers and keeps this shortcut portable.
  [KEYBOARD_SHORTCUT_ACTIONS.FOCUS_INPUT]: 'Mod+Alt+K',
  [KEYBOARD_SHORTCUT_ACTIONS.TIER_FAST]: 'Mod+Alt+1',
  [KEYBOARD_SHORTCUT_ACTIONS.TIER_BALANCED]: 'Mod+Alt+2',
  [KEYBOARD_SHORTCUT_ACTIONS.TIER_DEEP]: 'Mod+Alt+3',
  [KEYBOARD_SHORTCUT_ACTIONS.TOGGLE_PROMPT_LIBRARY]: null,
  [KEYBOARD_SHORTCUT_ACTIONS.TOGGLE_LAYOUT]: null,
  [KEYBOARD_SHORTCUT_ACTIONS.TOGGLE_POPULAR_SORT]: null
});

const ACTION_IDS = Object.freeze(Object.values(KEYBOARD_SHORTCUT_ACTIONS));
// Canonical order matches platform display order: primary modifier, then Alt,
// Shift and the explicit platform-specific modifier.
const MODIFIER_ORDER = Object.freeze(['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta']);
const KEY_ALIASES = new Map([
  ['esc', 'Escape'],
  ['escape', 'Escape'],
  ['return', 'Enter'],
  ['enter', 'Enter'],
  ['space', 'Space'],
  ['spacebar', 'Space'],
  ['del', 'Delete'],
  ['delete', 'Delete'],
  ['backspace', 'Backspace'],
  ['tab', 'Tab'],
  ['home', 'Home'],
  ['end', 'End'],
  ['pageup', 'PageUp'],
  ['pagedown', 'PageDown'],
  ['left', 'ArrowLeft'],
  ['arrowleft', 'ArrowLeft'],
  ['right', 'ArrowRight'],
  ['arrowright', 'ArrowRight'],
  ['up', 'ArrowUp'],
  ['arrowup', 'ArrowUp'],
  ['down', 'ArrowDown'],
  ['arrowdown', 'ArrowDown'],
  ['comma', 'Comma'],
  ['period', 'Period'],
  ['slash', 'Slash'],
  ['backquote', 'Backquote'],
  ['minus', 'Minus'],
  ['equal', 'Equal'],
  ['bracketleft', 'BracketLeft'],
  ['bracketright', 'BracketRight'],
  ['backslash', 'Backslash'],
  ['semicolon', 'Semicolon'],
  ['quote', 'Quote']
]);
const MODIFIER_ALIASES = new Map([
  ['ctrl', 'Ctrl'],
  ['control', 'Ctrl'],
  ['alt', 'Alt'],
  ['option', 'Alt'],
  ['shift', 'Shift'],
  ['meta', 'Meta'],
  ['cmd', 'Mod'],
  ['command', 'Mod'],
  ['mod', 'Mod']
]);
const KEY_CODE_ALIASES = new Map([
  [',', 'Comma'],
  ['.', 'Period'],
  ['/', 'Slash'],
  ['`', 'Backquote'],
  ['-', 'Minus'],
  ['=', 'Equal'],
  ['[', 'BracketLeft'],
  [']', 'BracketRight'],
  ['\\', 'Backslash'],
  [';', 'Semicolon'],
  ["'", 'Quote'],
  [' ', 'Space']
]);

function canonicalKey(key) {
  if (typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  const alias = KEY_ALIASES.get(trimmed.toLowerCase());
  if (alias) return alias;
  if (/^[a-z]$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9]$/.test(trimmed)) return trimmed;
  if (/^f(?:[1-9]|1[0-2])$/i.test(trimmed)) return trimmed.toUpperCase();
  return null;
}

function parseShortcutBinding(value) {
  if (value === null || value === undefined || value === '') {
    return { valid: true, binding: null, reason: null };
  }
  if (typeof value !== 'string') {
    return { valid: false, binding: null, reason: 'Shortcut must be a string or null.' };
  }

  const parts = value.split('+').map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { valid: false, binding: null, reason: 'A shortcut needs a modifier and a key.' };
  }

  const modifiers = [];
  const keys = [];
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES.get(part.toLowerCase());
    if (modifier) modifiers.push(modifier);
    else keys.push(canonicalKey(part));
  }

  if (modifiers.length === 0 || keys.length !== 1 || !keys[0]) {
    return { valid: false, binding: null, reason: 'Shortcut must contain one supported key and at least one modifier.' };
  }
  if (new Set(modifiers).size !== modifiers.length) {
    return { valid: false, binding: null, reason: 'Shortcut contains a duplicate modifier.' };
  }
  if (modifiers.includes('Mod') && (modifiers.includes('Ctrl') || modifiers.includes('Meta'))) {
    return { valid: false, binding: null, reason: 'Mod cannot be combined with Ctrl or Meta.' };
  }

  const orderedModifiers = MODIFIER_ORDER.filter(modifier => modifiers.includes(modifier));
  return {
    valid: true,
    binding: [...orderedModifiers, keys[0]].join('+'),
    reason: null
  };
}

function modifierSetFor(binding) {
  if (!binding) return null;
  const parsed = parseShortcutBinding(binding);
  if (!parsed.valid || !parsed.binding) return null;
  const parts = parsed.binding.split('+');
  return { modifiers: new Set(parts.slice(0, -1)), key: parts.at(-1) };
}

function hasPrimaryModifier(modifiers) {
  return modifiers.has('Mod') || modifiers.has('Ctrl') || modifiers.has('Meta');
}

/**
 * Normalizes a custom binding to a stable string such as `Mod+Shift+Enter`.
 * Returns null for an empty, unassigned or syntactically invalid binding.
 */
export function normalizeShortcutBinding(value) {
  return parseShortcutBinding(value).binding;
}

function isReservedBrowserShortcut(binding) {
  const parsed = modifierSetFor(binding);
  if (!parsed) return false;
  const { modifiers, key } = parsed;
  const primary = hasPrimaryModifier(modifiers);
  const shift = modifiers.has('Shift');
  const alt = modifiers.has('Alt');

  if (primary && !alt && !shift && ['W', 'T', 'N', 'L', 'R', 'F', 'P'].includes(key)) return true;
  if (primary && shift && !alt && ['N', 'T', 'O', 'I', 'J'].includes(key)) return true;
  // Chromium developer tools use Cmd+Option+I/J on macOS and
  // Ctrl+Shift+I/J on Windows and Linux.
  if (primary && alt && ['I', 'J'].includes(key)) return true;
  if (modifiers.has('Ctrl') && shift && ['I', 'J'].includes(key)) return true;
  if (key === 'F12') return true;
  return false;
}

/** Returns whether a binding is syntactically valid and avoids known browser shortcuts. */
export function validateShortcutBinding(value) {
  const parsed = parseShortcutBinding(value);
  return parsed.valid && (!parsed.binding || !isReservedBrowserShortcut(parsed.binding));
}

function resolvePlatform(platform) {
  const value = String(platform || globalThis.navigator?.platform || '').toLowerCase();
  if (value.includes('mac') || value.includes('iphone') || value.includes('ipad')) return 'mac';
  if (value.includes('win')) return 'windows';
  return 'linux';
}

function getPlatformModifier(modifier, platform) {
  if (modifier !== 'Mod') return modifier;
  return resolvePlatform(platform) === 'mac' ? 'Meta' : 'Ctrl';
}

function getEventKey(event) {
  const eventKey = KEY_CODE_ALIASES.get(event?.key) || canonicalKey(event?.key);
  if (eventKey) return eventKey;
  const code = String(event?.code || '');
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  return null;
}

/** Captures a pressed shortcut as a portable stored binding. */
export function getShortcutBindingFromEvent(event, { platform } = {}) {
  if (isIneligibleKeyboardEvent(event)) return null;
  const key = getEventKey(event);
  if (!key) return null;

  const resolvedPlatform = resolvePlatform(platform);
  const modifiers = [];
  if (event.ctrlKey) modifiers.push(resolvedPlatform === 'mac' ? 'Ctrl' : 'Mod');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push(resolvedPlatform === 'mac' ? 'Mod' : 'Meta');
  if (!modifiers.length) return null;

  return normalizeShortcutBinding([...modifiers, key].join('+'));
}

function isIneligibleKeyboardEvent(event) {
  return Boolean(
    !event || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229
      || event.which === 229 || event.getModifierState?.('AltGraph')
  );
}

/** Matches a KeyboardEvent against one binding with platform-aware `Mod`. */
export function matchesShortcut(event, binding, { platform } = {}) {
  if (isIneligibleKeyboardEvent(event)) return false;
  const parsed = modifierSetFor(binding);
  if (!parsed || getEventKey(event) !== parsed.key) return false;

  const expected = new Set([...parsed.modifiers].map(modifier => getPlatformModifier(modifier, platform)));
  return Boolean(event.ctrlKey) === expected.has('Ctrl')
    && Boolean(event.altKey) === expected.has('Alt')
    && Boolean(event.shiftKey) === expected.has('Shift')
    && Boolean(event.metaKey) === expected.has('Meta');
}

const MAC_KEY_LABELS = Object.freeze({
  Enter: '↵',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: '⌦',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageUp: '⇞',
  PageDown: '⇟',
  Space: 'Space'
});
const OTHER_KEY_LABELS = Object.freeze({
  Escape: 'Esc',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Minus: '-',
  Equal: '='
});

/** Formats a binding for a platform-appropriate tooltip. */
export function formatShortcutForTooltip(value, options = {}) {
  const binding = normalizeShortcutBinding(value);
  if (!binding) return '';
  const platform = resolvePlatform(typeof options === 'string' ? options : options.platform);
  const parts = binding.split('+');
  const key = parts.pop();
  if (platform === 'mac') {
    const symbols = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘', Mod: '⌘' };
    const modifiers = parts.map(modifier => symbols[modifier]).join('');
    return `${modifiers}${MAC_KEY_LABELS[key] || key}`;
  }

  const labels = parts.map(modifier => {
    if (modifier === 'Mod') return platform === 'windows' || platform === 'linux' ? 'Ctrl' : modifier;
    return modifier;
  });
  return [...labels, OTHER_KEY_LABELS[key] || key].join('+');
}

function isEditableTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
}

function isDialogTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('dialog, [role="dialog"], [aria-modal="true"]'));
}

function normalizeBindings(bindings) {
  const overrides = bindings && typeof bindings === 'object' ? bindings : {};
  const resolved = {};
  const occupied = new Set();

  for (const actionId of ACTION_IDS) {
    let binding = DEFAULT_KEYBOARD_SHORTCUT_BINDINGS[actionId];
    if (Object.prototype.hasOwnProperty.call(overrides, actionId)) {
      const supplied = overrides[actionId];
      if (supplied === null || supplied === '') {
        binding = null;
      } else {
        const normalized = normalizeShortcutBinding(supplied);
        binding = normalized && validateShortcutBinding(normalized) ? normalized : null;
      }
    }

    if (binding && occupied.has(binding)) binding = null;
    if (binding) occupied.add(binding);
    resolved[actionId] = binding;
  }
  return resolved;
}

/**
 * Registers one capture-phase keydown listener and routes at most one action.
 * The returned controller supports live updates when settings change.
 */
export function setupKeyboardShortcuts({
  target = globalThis.window,
  bindings = DEFAULT_KEYBOARD_SHORTCUT_BINDINGS,
  enabled = true,
  onAction = () => {},
  platform,
  editableActionIds = ACTION_IDS
} = {}) {
  if (!target?.addEventListener) {
    throw new TypeError('A keyboard event target is required.');
  }

  let currentBindings = normalizeBindings(bindings);
  let currentEnabled = enabled !== false;
  const editableActions = new Set(editableActionIds);

  const handleKeydown = event => {
    if (!currentEnabled || isIneligibleKeyboardEvent(event)) return;

    let matchedAction = null;
    for (const actionId of ACTION_IDS) {
      const binding = currentBindings[actionId];
      if (binding && matchesShortcut(event, binding, { platform })) {
        matchedAction = actionId;
        break;
      }
    }
    if (!matchedAction) return;

    const isFocusAction = matchedAction === KEYBOARD_SHORTCUT_ACTIONS.FOCUS_INPUT;
    if ((isDialogTarget(event.target) && !isFocusAction)
      || (isEditableTarget(event.target) && !editableActions.has(matchedAction))) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation?.();
    if (!event.stopImmediatePropagation) event.stopPropagation?.();
    onAction(matchedAction, event);
  };

  target.addEventListener('keydown', handleKeydown, true);

  const controller = {
    update({ bindings: nextBindings, enabled: nextEnabled } = {}) {
      if (nextBindings !== undefined) currentBindings = normalizeBindings(nextBindings);
      if (nextEnabled !== undefined) currentEnabled = nextEnabled !== false;
      return controller;
    },
    updateBindings(nextBindings) {
      currentBindings = normalizeBindings(nextBindings);
      return controller;
    },
    setEnabled(nextEnabled) {
      currentEnabled = nextEnabled !== false;
      return controller;
    },
    getBindings() {
      return { ...currentBindings };
    },
    getEnabled() {
      return currentEnabled;
    },
    destroy() {
      target.removeEventListener('keydown', handleKeydown, true);
    }
  };

  return controller;
}
