import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const utilsSource = readFileSync(resolve(process.cwd(), 'content-scripts/runtime/enter-behavior-utils.js'), 'utf8');

function createClassList(classes = []) {
  return { contains: name => classes.includes(name) };
}

function createHarness({ contentEditable = false, disabledSend = false, placeholder = '问一问灵光' } = {}) {
  const container = { name: 'composer' };
  const sendButton = {
    disabled: false,
    classList: createClassList(disabledSend ? ['anticon', 'disabled'] : ['anticon']),
    getAttribute: vi.fn(() => null),
    click: vi.fn(),
  };
  const editor = contentEditable
    ? {
      tagName: 'DIV',
      offsetParent: {},
      isContentEditable: true,
      getAttribute: vi.fn(name => (name === 'aria-hidden' ? null : name === 'role' ? 'textbox' : null)),
      closest: vi.fn(() => container),
      focus: vi.fn(),
      dispatchEvent: vi.fn(),
    }
    : {
      tagName: 'TEXTAREA',
      name: '',
      offsetParent: {},
      isContentEditable: false,
      placeholder,
      selectionStart: 2,
      selectionEnd: 2,
      getAttribute: vi.fn(name => (name === 'aria-hidden' ? null : name === 'placeholder' ? placeholder : null)),
      closest: vi.fn(() => container),
      focus: vi.fn(),
      setRangeText: vi.fn(),
      dispatchEvent: vi.fn(),
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
  vm.runInContext(readFileSync(resolve(process.cwd(), 'content-scripts/providers/lingguang/enter-behavior.js'), 'utf8'), context);
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

describe('Lingguang Enter behavior', () => {
  it('sends with Enter and inserts a newline with Shift+Enter in the textarea composer', () => {
    const { context, editor, sendButton } = createHarness();

    context.handleEnterSwap(enter());
    expect(sendButton.click).toHaveBeenCalledTimes(1);
    expect(context.window.ButtonFinderUtils.findButton.mock.calls[0][0]).toEqual([
      expect.objectContaining({ type: 'css', value: expect.stringContaining('.anticon') }),
      expect.objectContaining({ type: 'css', value: expect.stringContaining('.anticon') }),
      expect.objectContaining({ type: 'css', value: expect.stringContaining('.anticon') }),
      expect.objectContaining({ type: 'css', value: expect.stringContaining('.anticon') }),
      expect.objectContaining({ type: 'css', value: 'button[aria-label="发送"]' }),
      expect.objectContaining({ type: 'css', value: 'button[title="发送"]' }),
      expect.objectContaining({ type: 'css', value: 'button[aria-label="Send"]' }),
      expect.objectContaining({ type: 'css', value: 'button[title="Send"]' }),
    ]);

    context.handleEnterSwap(enter({ shiftKey: true }));
    expect(editor.setRangeText).toHaveBeenCalledWith('\n', 2, 2, 'end');
    expect(editor.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(sendButton.click).toHaveBeenCalledTimes(1);
  });

  it('inserts a native line break in a contenteditable composer', () => {
    const { context, editor, sendButton } = createHarness({ contentEditable: true });

    context.handleEnterSwap(enter({ shiftKey: true }));
    expect(context.document.execCommand).toHaveBeenCalledWith('insertLineBreak', false);
    expect(sendButton.click).not.toHaveBeenCalled();

    context.handleEnterSwap(enter());
    expect(sendButton.click).toHaveBeenCalledTimes(1);
  });

  it('leaves the disabled send control, IME composition, hidden mirror, and login fields alone', () => {
    const disabled = createHarness({ disabledSend: true });
    const sendEvent = enter();
    disabled.context.handleEnterSwap(sendEvent);
    expect(sendEvent.preventDefault).toHaveBeenCalled();
    expect(disabled.sendButton.click).not.toHaveBeenCalled();

    const { context, editor } = createHarness();
    const composing = enter({ isComposing: true });
    context.handleEnterSwap(composing);
    expect(composing.preventDefault).not.toHaveBeenCalled();

    context.document.activeElement = {
      tagName: 'TEXTAREA',
      name: 'hiddenTextarea',
      offsetParent: {},
      getAttribute: vi.fn(name => (name === 'aria-hidden' ? 'true' : null)),
      closest: vi.fn(() => ({ name: 'composer' })),
    };
    const hidden = enter();
    context.handleEnterSwap(hidden);
    expect(hidden.preventDefault).not.toHaveBeenCalled();

    context.document.activeElement = {
      tagName: 'TEXTAREA',
      name: '',
      offsetParent: {},
      placeholder: '请输入手机号',
      getAttribute: vi.fn(name => (name === 'aria-hidden' ? null : name === 'placeholder' ? '请输入手机号' : null)),
      closest: vi.fn(() => null),
    };
    const login = enter();
    context.handleEnterSwap(login);
    expect(login.preventDefault).not.toHaveBeenCalled();

    expect(editor.setRangeText).not.toHaveBeenCalled();
  });
});