import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const utilsSource = readFileSync(
  resolve(process.cwd(), 'content-scripts/enter-behavior-utils.js'),
  'utf8'
);
const buttonFinderSource = readFileSync(
  resolve(process.cwd(), 'content-scripts/button-finder-utils.js'),
  'utf8'
);

function createContext({ scriptName, editor, sendButton, findButtonImplementation = null }) {
  const context = {
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: { get: vi.fn() },
        sync: {
          get: vi.fn((_defaults, callback) => callback({
            enterKeyBehavior: {
              enabled: true,
              newlineModifiers: { shift: true, ctrl: false, alt: false, meta: false },
              sendModifiers: { shift: false, ctrl: false, alt: false, meta: false },
            },
          })),
        },
        onChanged: { addListener: vi.fn() },
      },
    },
    document: {
      activeElement: editor,
      querySelector: vi.fn(() => sendButton),
      execCommand: vi.fn(() => true),
    },
    window: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    Event: class Event {
      constructor(type, options) {
        this.type = type;
        Object.assign(this, options);
      }
    },
  };

  vm.createContext(context);
  vm.runInContext(buttonFinderSource, context);
  context.window.ButtonFinderUtils.findButton = vi.fn(
    findButtonImplementation || (() => sendButton)
  );
  vm.runInContext(utilsSource, context);
  vm.runInContext(
    readFileSync(resolve(process.cwd(), `content-scripts/${scriptName}`), 'utf8'),
    context
  );
  return context;
}

function createSendButton({ viewBox = null } = {}) {
  return {
    disabled: false,
    getAttribute: vi.fn(() => null),
    querySelector: vi.fn(() => ({
      getAttribute: vi.fn((name) => (name === 'viewBox' ? viewBox : null)),
    })),
    click: vi.fn(),
  };
}

function createEnterEvent(overrides = {}) {
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

function createMimoHarness({ viewBox = '0 0 19 16' } = {}) {
  const sendButton = createSendButton({ viewBox });
  const editor = {
    tagName: 'TEXTAREA',
    offsetParent: {},
    selectionStart: 3,
    selectionEnd: 3,
    setRangeText: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  const context = createContext({ scriptName: 'enter-behavior-mimo.js', editor, sendButton });
  context.window.ButtonFinderUtils.findMimoInput = vi.fn(() => editor);
  return { context, editor, sendButton };
}

function createMetaAiHarness() {
  const sendButton = createSendButton();
  const editor = {
    tagName: 'DIV',
    offsetParent: {},
    getAttribute: vi.fn((name) => (name === 'data-testid' ? 'composer-input' : null)),
    focus: vi.fn(),
  };
  const context = createContext({ scriptName: 'enter-behavior-meta-ai.js', editor, sendButton });
  return { context, editor, sendButton };
}

function createMetaAiLoggedOutHarness() {
  const sendButton = createSendButton();
  const composerInput = {};
  const editor = {
    tagName: 'INPUT',
    type: 'text',
    offsetParent: {},
    getAttribute: vi.fn((name) => (name === 'aria-label' ? '问问 Meta AI' : null)),
    closest: vi.fn((selector) => (
      selector === '[data-slot="logged-out-composer-input"]' ? composerInput : null
    )),
    selectionStart: 0,
    selectionEnd: 0,
    setRangeText: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  const scopedSendSelector =
    '[data-slot="logged-out-composer-controls"] button[data-slot="button"][aria-label="发送"]';
  const context = createContext({
    scriptName: 'enter-behavior-meta-ai.js',
    editor,
    sendButton,
    findButtonImplementation: (selectors) => selectors.some(
      (selector) => selector.type === 'css' && selector.value === scopedSendSelector
    ) ? sendButton : null,
  });
  return { context, editor, sendButton, scopedSendSelector };
}

describe('MiMo Enter behavior', () => {
  it('sends through the control while it shows the send icon', () => {
    const { context, sendButton } = createMimoHarness();

    context.handleEnterSwap(createEnterEvent());

    expect(sendButton.click).toHaveBeenCalledTimes(1);
  });

  it('does not click the shared control while it shows the stop icon', () => {
    const { context, sendButton } = createMimoHarness({ viewBox: '0 0 16 16' });

    context.handleEnterSwap(createEnterEvent());

    expect(sendButton.click).not.toHaveBeenCalled();
  });

  it('inserts a newline at the caret for Shift+Enter', () => {
    const { context, editor, sendButton } = createMimoHarness();

    context.handleEnterSwap(createEnterEvent({ shiftKey: true }));

    expect(editor.setRangeText).toHaveBeenCalledWith('\n', 3, 3, 'end');
    expect(sendButton.click).not.toHaveBeenCalled();
  });

  it('ignores IME composition Enter', () => {
    const { context, sendButton } = createMimoHarness();

    context.handleEnterSwap(createEnterEvent({ isComposing: true }));

    expect(sendButton.click).not.toHaveBeenCalled();
  });
});

describe('Meta AI Enter behavior', () => {
  it('sends through the composer send button', () => {
    const { context, sendButton } = createMetaAiHarness();

    context.handleEnterSwap(createEnterEvent());

    expect(sendButton.click).toHaveBeenCalledTimes(1);
  });

  it('sends from the logged-out input through its scoped localized control', () => {
    const { context, editor, sendButton, scopedSendSelector } = createMetaAiLoggedOutHarness();

    context.handleEnterSwap(createEnterEvent());

    expect(editor.closest).toHaveBeenCalledWith('[data-slot="logged-out-composer-input"]');
    expect(context.window.ButtonFinderUtils.findButton).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: 'css', value: scopedSendSelector })])
    );
    expect(sendButton.click).toHaveBeenCalledTimes(1);
  });

  it('does not send while the send button is disabled', () => {
    const { context, sendButton } = createMetaAiHarness();
    sendButton.disabled = true;

    context.handleEnterSwap(createEnterEvent());

    expect(sendButton.click).not.toHaveBeenCalled();
  });

  it('inserts a line break in the Lexical editor for Shift+Enter', () => {
    const { context, sendButton } = createMetaAiHarness();

    context.handleEnterSwap(createEnterEvent({ shiftKey: true }));

    expect(context.document.execCommand).toHaveBeenCalledWith('insertLineBreak', false);
    expect(sendButton.click).not.toHaveBeenCalled();
  });

  it('ignores Enter outside the composer', () => {
    const { context, editor, sendButton } = createMetaAiHarness();
    editor.getAttribute.mockReturnValue(null);

    context.handleEnterSwap(createEnterEvent());

    expect(sendButton.click).not.toHaveBeenCalled();
  });
});
