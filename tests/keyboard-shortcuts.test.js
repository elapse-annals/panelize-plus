import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEYBOARD_SHORTCUT_BINDINGS,
  KEYBOARD_SHORTCUT_ACTIONS,
  formatShortcutForTooltip,
  getShortcutBindingFromEvent,
  matchesShortcut,
  normalizeShortcutBinding,
  setupKeyboardShortcuts,
  validateShortcutBinding
} from '../modules/keyboard-shortcuts.js';

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

afterEach(() => {
  document.body.innerHTML = '';
});

describe('keyboard shortcut bindings', () => {
  it('defines the requested default actions without taking prompt, layout or sort keys', () => {
    expect(DEFAULT_KEYBOARD_SHORTCUT_BINDINGS).toEqual({
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
    });
    expect(KEYBOARD_SHORTCUT_ACTIONS.SEND).toBe('send');
  });

  it('normalizes aliases and rejects malformed or browser-reserved combinations', () => {
    expect(normalizeShortcutBinding('cmd + shift + return')).toBe('Mod+Shift+Enter');
    expect(normalizeShortcutBinding('option + ctrl + k')).toBe('Ctrl+Alt+K');
    expect(normalizeShortcutBinding('Mod+Alt+1')).toBe('Mod+Alt+1');
    expect(normalizeShortcutBinding('Enter')).toBeNull();
    expect(normalizeShortcutBinding('Mod+Bogus')).toBeNull();
    expect(validateShortcutBinding(null)).toBe(true);
    expect(validateShortcutBinding('Ctrl+W')).toBe(false);
    expect(validateShortcutBinding('Cmd+T')).toBe(false);
    expect(validateShortcutBinding('Mod+Shift+N')).toBe(false);
    expect(validateShortcutBinding('Ctrl+Shift+O')).toBe(false);
    expect(validateShortcutBinding('Cmd+Option+I')).toBe(false);
    expect(validateShortcutBinding('Ctrl+Shift+J')).toBe(false);
    expect(validateShortcutBinding('Mod+Shift+I')).toBe(false);
    expect(validateShortcutBinding('Mod+Alt+K')).toBe(true);
  });

  it('formats bindings with macOS symbols and Windows labels', () => {
    expect(formatShortcutForTooltip('Mod+Shift+Enter', { platform: 'mac' })).toBe('⌘⇧↵');
    expect(formatShortcutForTooltip('Mod+Alt+K', { platform: 'win32' })).toBe('Ctrl+Alt+K');
    expect(formatShortcutForTooltip('Ctrl+Shift+ArrowDown', { platform: 'linux' })).toBe('Ctrl+Shift+Down');
    expect(formatShortcutForTooltip(null, { platform: 'mac' })).toBe('');
  });

  it('matches exact modifier sets and resolves Mod for the active platform', () => {
    expect(matchesShortcut(keydown('Enter', { metaKey: true }), 'Mod+Enter', { platform: 'mac' })).toBe(true);
    expect(matchesShortcut(keydown('Enter', { ctrlKey: true }), 'Mod+Enter', { platform: 'win32' })).toBe(true);
    expect(matchesShortcut(keydown('Enter', { ctrlKey: true, shiftKey: true }), 'Mod+Enter', { platform: 'win32' })).toBe(false);
    expect(matchesShortcut(keydown('Enter', { metaKey: true, shiftKey: true }), 'Mod+Shift+Enter', { platform: 'mac' })).toBe(true);
    const composing = keydown('Enter', { ctrlKey: true });
    Object.defineProperty(composing, 'isComposing', { value: true });
    expect(matchesShortcut(composing, 'Mod+Enter', { platform: 'win32' })).toBe(false);
    expect(matchesShortcut(
      keydown('1', { ctrlKey: true, altKey: true, altGraph: true }),
      'Mod+Alt+1',
      { platform: 'win32' }
    )).toBe(false);
  });

  it('captures a pressed combination in portable storage format', () => {
    expect(getShortcutBindingFromEvent(keydown('k', { metaKey: true, altKey: true }), { platform: 'mac' }))
      .toBe('Mod+Alt+K');
    expect(getShortcutBindingFromEvent(keydown('Enter', { ctrlKey: true, shiftKey: true }), { platform: 'win32' }))
      .toBe('Mod+Shift+Enter');
    const reserved = getShortcutBindingFromEvent(keydown('w', { ctrlKey: true }), { platform: 'win32' });
    expect(reserved).toBe('Mod+W');
    expect(validateShortcutBinding(reserved)).toBe(false);
    expect(getShortcutBindingFromEvent(keydown('k'), { platform: 'win32' })).toBeNull();
  });
});

describe('setupKeyboardShortcuts', () => {
  it('routes only one action, prevents browser behavior and exposes live controller updates', () => {
    const onAction = vi.fn();
    const controller = setupKeyboardShortcuts({ target: document, onAction, platform: 'win32' });
    const laterListener = vi.fn();
    document.addEventListener('keydown', laterListener);

    const event = keydown('Enter', { ctrlKey: true });
    document.dispatchEvent(event);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('send', event);
    expect(event.defaultPrevented).toBe(true);
    expect(laterListener).not.toHaveBeenCalled();

    controller.update({ bindings: { send: null, toggleLayout: 'Alt+L' }, enabled: false });
    document.dispatchEvent(keydown('l', { altKey: true }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(controller.getBindings()).toMatchObject({ send: null, toggleLayout: 'Alt+L' });
    expect(controller.getEnabled()).toBe(false);

    controller.setEnabled(true);
    document.dispatchEvent(keydown('l', { altKey: true }));
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls[1][0]).toBe('toggleLayout');

    document.removeEventListener('keydown', laterListener);
    controller.destroy();
    document.dispatchEvent(keydown('l', { altKey: true }));
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('normalizes assignments before detecting duplicate shortcuts', () => {
    const onAction = vi.fn();
    const controller = setupKeyboardShortcuts({ target: document, onAction, platform: 'win32' });
    controller.updateBindings({
      send: 'Shift+Mod+Enter',
      fill: 'Mod+Shift+Return'
    });

    expect(controller.getBindings()).toMatchObject({
      send: 'Mod+Shift+Enter',
      fill: null
    });
    document.dispatchEvent(keydown('Enter', { ctrlKey: true, shiftKey: true }));
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(['send']);
    controller.destroy();
  });

  it('allows all configured shortcuts in the main input while suppressing dialog actions except focus', () => {
    document.body.innerHTML = `
      <textarea id="main-prompt"></textarea>
      <div role="dialog"><textarea id="dialog-input"></textarea></div>
    `;
    const onAction = vi.fn();
    const controller = setupKeyboardShortcuts({ target: document, onAction, platform: 'win32' });
    const mainInput = document.getElementById('main-prompt');
    const dialogInput = document.getElementById('dialog-input');

    mainInput.dispatchEvent(keydown('Enter', { ctrlKey: true }));
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(['send']);

    mainInput.dispatchEvent(keydown('Enter', { ctrlKey: true, shiftKey: true }));
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(['send', 'fill']);

    mainInput.dispatchEvent(keydown('n', { ctrlKey: true, altKey: true }));
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(['send', 'fill', 'newConversation']);

    mainInput.dispatchEvent(keydown('k', { ctrlKey: true, altKey: true }));
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(['send', 'fill', 'newConversation', 'focusInput']);

    mainInput.dispatchEvent(keydown('1', { ctrlKey: true, altKey: true }));
    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      'send', 'fill', 'newConversation', 'focusInput', 'tierFast'
    ]);

    mainInput.dispatchEvent(keydown('2', { ctrlKey: true, altKey: true }));
    mainInput.dispatchEvent(keydown('3', { ctrlKey: true, altKey: true }));
    expect(onAction.mock.calls.slice(-2).map(([action]) => action)).toEqual(['tierBalanced', 'tierDeep']);

    dialogInput.dispatchEvent(keydown('Enter', { ctrlKey: true }));
    expect(onAction).toHaveBeenCalledTimes(7);
    dialogInput.dispatchEvent(keydown('k', { ctrlKey: true, altKey: true }));
    expect(onAction.mock.calls.map(([action]) => action).at(-1)).toBe('focusInput');
    controller.destroy();
  });

  it('ignores repeats, IME confirmation and already handled events', () => {
    const onAction = vi.fn();
    const controller = setupKeyboardShortcuts({ target: document, onAction, platform: 'win32' });
    document.dispatchEvent(keydown('Enter', { ctrlKey: true, repeat: true }));
    const composing = keydown('Enter', { ctrlKey: true });
    Object.defineProperty(composing, 'isComposing', { value: true });
    document.dispatchEvent(composing);
    const handled = keydown('Enter', { ctrlKey: true });
    handled.preventDefault();
    document.dispatchEvent(handled);
    document.dispatchEvent(keydown('1', { ctrlKey: true, altKey: true, altGraph: true }));
    expect(onAction).not.toHaveBeenCalled();
    controller.destroy();
  });
});
