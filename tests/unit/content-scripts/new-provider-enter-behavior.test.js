import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const utilsSource = readFileSync(resolve(process.cwd(), 'content-scripts/runtime/enter-behavior-utils.js'), 'utf8');

function createHarness(provider, inputOverrides = {}) {
  const sendButton = { disabled: false, getAttribute: vi.fn(() => null), click: vi.fn() };
  const inputAttributes = provider === 'copilot'
    ? { role: 'textbox', 'data-lexical-editor': 'true' }
    : {};
  const editor = {
    tagName: provider === 'copilot' ? 'SPAN' : provider === 'perplexity' ? 'DIV' : 'TEXTAREA',
    id: provider === 'perplexity' ? 'ask-input' : provider === 'copilot' ? 'm365-chat-editor-target-element' : 'userInput',
    offsetParent: {},
    selectionStart: 2,
    selectionEnd: 2,
    getAttribute: vi.fn(name => inputAttributes[name] || null),
    isContentEditable: provider === 'perplexity' || provider === 'copilot',
    focus: vi.fn(),
    setRangeText: vi.fn(),
    dispatchEvent: vi.fn(),
    ...inputOverrides,
  };
  const context = {
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: { get: vi.fn() },
        sync: { get: vi.fn((_defaults, callback) => callback({ enterKeyBehavior: {
          enabled: true,
          newlineModifiers: { shift: true, ctrl: false, alt: false, meta: false },
          sendModifiers: { shift: false, ctrl: false, alt: false, meta: false },
        } })) },
        onChanged: { addListener: vi.fn() },
      },
    },
    document: { activeElement: editor, execCommand: vi.fn(() => true) },
    window: {
      ButtonFinderUtils: { findButton: vi.fn(() => sendButton) },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    Event: class Event { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  };
  vm.createContext(context);
  vm.runInContext(utilsSource, context);
  vm.runInContext(readFileSync(resolve(process.cwd(), `content-scripts/providers/${provider}/enter-behavior.js`), 'utf8'), context);
  return { context, editor, sendButton };
}

function enter(overrides = {}) {
  return {
    isTrusted: true,
    code: 'Enter',
    isComposing: false,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  };
}

describe.each(['perplexity', 'copilot'])('%s Enter behavior', provider => {
  it('uses the scoped send control for Enter and inserts a newline for Shift+Enter', () => {
    const { context, editor, sendButton } = createHarness(provider);
    context.handleEnterSwap(enter());
    expect(sendButton.click).toHaveBeenCalledTimes(1);
    const selectors = context.window.ButtonFinderUtils.findButton.mock.calls[0][0];
    if (provider === 'perplexity') {
      expect(selectors.every(selector => selector.startsWith('.bg-composer:has('))).toBe(true);
    } else if (provider === 'copilot') {
      expect(selectors).toEqual([
        '#m365-chat-input-shared-container button.fai-SendButton',
        '#m365-chat-input-shared-container button[aria-label="Send"]',
        '#m365-chat-input-shared-container button[aria-label="发送"]'
      ]);
    } else {
      expect(selectors.every(selector => selector.includes('form:has('))).toBe(true);
    }

    context.handleEnterSwap(enter({ shiftKey: true }));
    if (provider === 'perplexity' || provider === 'copilot') {
      expect(context.document.execCommand).toHaveBeenCalledWith('insertLineBreak', false);
    } else {
      expect(editor.setRangeText).toHaveBeenCalledWith('\n', 2, 2, 'end');
    }
    expect(sendButton.click).toHaveBeenCalledTimes(1);
  });

  it('leaves IME and unrelated login fields alone', () => {
    const { context, sendButton } = createHarness(provider);
    const composing = enter({ isComposing: true });
    context.handleEnterSwap(composing);
    expect(composing.preventDefault).not.toHaveBeenCalled();

    const login = enter();
    context.document.activeElement = {
      tagName: 'TEXTAREA',
      id: 'login-email',
      offsetParent: {},
      isContentEditable: false,
      getAttribute: () => null,
    };
    context.handleEnterSwap(login);
    expect(login.preventDefault).not.toHaveBeenCalled();
    expect(sendButton.click).not.toHaveBeenCalled();
  });
});

describe('Copilot embedded sign-in', () => {
  function createEmbeddedHarness() {
    class Element {
      constructor(matches = {}) { this.matches = matches; }
      closest(selector) { return this.matches[selector] || null; }
    }
    const listeners = {};
    const self = {};
    const context = {
      chrome: {
        runtime: { lastError: null },
        storage: {
          sync: { get: vi.fn((_defaults, callback) => callback({})) },
          onChanged: { addListener: vi.fn() },
        },
      },
      Element,
      URL,
      location: { href: 'https://copilot.com/', hostname: 'copilot.com' },
      document: { addEventListener: vi.fn((type, listener) => { listeners[type] = listener; }) },
      window: { top: {}, self, open: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    };
    vm.createContext(context);
    vm.runInContext(utilsSource, context);
    vm.runInContext(readFileSync(resolve(process.cwd(), 'content-scripts/providers/copilot/enter-behavior.js'), 'utf8'), context);
    const click = target => {
      const event = { target, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
      listeners.click(event);
      return event;
    };
    return { context, Element, click };
  }

  it('opens sign-in links and the header sign-in button in a top-level tab', () => {
    const { context, Element, click } = createEmbeddedHarness();

    const linkClick = click(new Element({
      'a[href]': { href: 'https://copilot.com/login?es=Click&ru=%2F' },
    }));
    expect(linkClick.preventDefault).toHaveBeenCalled();
    expect(context.window.open).toHaveBeenCalledWith('https://copilot.com/login?es=Click&ru=%2F', '_blank', 'noopener');

    click(new Element({ '.uhf-mecontrol-signin-label': {} }));
    expect(context.window.open).toHaveBeenLastCalledWith('https://copilot.com/login?ru=%2F', '_blank', 'noopener');
  });

  it('leaves other links alone', () => {
    const { context, Element, click } = createEmbeddedHarness();
    const event = click(new Element({ 'a[href]': { href: 'https://copilot.com/chats/abc' } }));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(context.window.open).not.toHaveBeenCalled();
  });
});
