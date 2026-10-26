import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const contentScriptSource = readFileSync(
  resolve(process.cwd(), 'content-scripts/text-injection-all-providers.js'),
  'utf8'
);

function markVisible(element) {
  Object.defineProperty(element, 'offsetParent', {
    configurable: true,
    get: () => document.body,
  });
}

function dispatchMultiPanelMessage(payload) {
  window.dispatchEvent(new MessageEvent('message', { data: payload }));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createDoubaoComposerDom() {
  document.body.innerHTML = `
    <div id="flow_chat_sidebar">
      <div>Header</div>
      <div class="cursor-pointer" id="doubao-new-chat">新对话</div>
    </div>
    <div id="input-engine-container">
      <div class="semi-input-textarea-wrapper">
        <textarea
          id="doubao-editor"
          class="semi-input-textarea semi-input-textarea-autosize"
          placeholder="发消息..."
        ></textarea>
      </div>
      <input id="doubao-file-input" type="file" accept=".png,.jpg,image/*" />
      <button id="flow-end-msg-send" aria-label="">Send</button>
    </div>
  `;

  const editor = document.getElementById('doubao-editor');
  const fileInput = document.getElementById('doubao-file-input');
  const sendButton = document.getElementById('flow-end-msg-send');
  const newChatButton = document.getElementById('doubao-new-chat');

  [editor, fileInput, sendButton, newChatButton].forEach(markVisible);

  return {
    editor,
    fileInput,
    sendButton,
    newChatButton,
  };
}

function createCurrentDoubaoComposerDom() {
  document.body.innerHTML = `
    <div contenteditable="true" class="ProseMirror" id="unrelated-editor"></div>
    <div id="input-engine-container">
      <div class="guidance-input-editor-wrapper">
        <div class="w-full text-16">
          <div
            id="doubao-prosemirror-editor"
            contenteditable="true"
            translate="no"
            class="tiptap ProseMirror"
            tabindex="0"
          >
            <p data-placeholder="发消息或按住空格说话..." class="is-empty is-editor-empty"><br></p>
          </div>
        </div>
      </div>
      <button id="flow-end-msg-send">Send</button>
    </div>
  `;

  const unrelatedEditor = document.getElementById('unrelated-editor');
  const editor = document.getElementById('doubao-prosemirror-editor');
  const sendButton = document.getElementById('flow-end-msg-send');

  [unrelatedEditor, editor, sendButton].forEach(markVisible);

  return {
    unrelatedEditor,
    editor,
    sendButton,
  };
}

function setRect(element, rect) {
  markVisible(element);
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
  });
}

function dispatchHostNewChat(requestId) {
  const event = new window.Event('message');
  Object.assign(event, {
    data: { context: 'multi-panel', type: 'NEW_CHAT', requestId, panelId: 'panel-doubao', provider: 'doubao' },
    origin: 'chrome-extension://panelize-test',
    source: window.parent,
  });
  window.dispatchEvent(event);
}

function getNewChatResults() {
  return window.parent.postMessage.mock.calls
    .map(([message]) => message)
    .filter(message => message?.type === 'PANELIZE_NEW_CHAT_RESULT');
}

// Narrow-panel layout captured live on 2026-10-26: the sidebar nav becomes a
// drawer over the chat, with a fixed mask covering the composer. Hit tests come from the stubbed
// elementFromPoint: the drawer owns the top of the viewport, the mask (when
// present) the rest.
function createNarrowDoubaoDom({ drawerOpen = true, dialog = '' } = {}) {
  document.body.innerHTML = `
    <nav data-testid="chat_route_layout_leftside_nav" id="drawer">
      <div id="flow_chat_sidebar" data-testid="flow_chat_sidebar">
        <div data-testid="create_conversation_button" id="doubao-new-chat"><span>新对话</span></div>
      </div>
    </nav>
    ${dialog}
    <div class="z-[39] fixed inset-0 bg-[var(--s-color-bg-mask)] cursor-pointer" id="mask"></div>
    <div id="input-engine-container">
      <div class="semi-input-textarea-wrapper">
        <textarea id="doubao-editor" class="semi-input-textarea" placeholder="发消息..."></textarea>
      </div>
    </div>
  `;
  const drawer = document.getElementById('drawer');
  const mask = document.getElementById('mask');
  const editor = document.getElementById('doubao-editor');
  const newChatButton = document.getElementById('doubao-new-chat');
  setRect(drawer, { top: 0, left: 0, width: 300, height: 800 });
  setRect(newChatButton, { top: 10, left: 10, width: 200, height: 30 });
  setRect(mask, { top: 0, left: 0, width: 400, height: 800 });
  setRect(editor, { top: 700, left: 20, width: 360, height: 40 });
  const dialogElement = document.querySelector('#login-dialog');
  if (dialogElement) setRect(dialogElement, { top: 300, left: 40, width: 320, height: 200 });

  vi.spyOn(document, 'elementFromPoint').mockImplementation((x, y) => {
    if (dialogElement?.isConnected) return mask.isConnected ? mask : editor;
    if (drawerOpen && y < 100 && drawer.isConnected) return newChatButton;
    return mask.isConnected ? mask : editor;
  });
  return { drawer, mask, editor, newChatButton };
}

describe('doubao content script integration', () => {
  beforeAll(() => {
    window.chrome = { runtime: { getURL: () => 'chrome-extension://panelize-test/' } };
    window.eval(contentScriptSource);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    window.happyDOM.setURL('https://www.doubao.com/chat/');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    });
    createDoubaoComposerDom();
  });

  it('injects text into the Doubao textarea composer', () => {
    const { editor } = createDoubaoComposerDom();

    dispatchMultiPanelMessage({
      type: 'INJECT_TEXT',
      text: 'hello doubao',
      autoSubmit: false,
      context: 'multi-panel',
    });

    expect(editor.value).toContain('hello doubao');
  });

  it('injects text into the current Doubao ProseMirror composer', () => {
    const { unrelatedEditor, editor } = createCurrentDoubaoComposerDom();
    const execCommandSpy = vi.fn((command, _showUi, value) => {
      if (command !== 'insertText') {
        return false;
      }

      document.activeElement.appendChild(document.createTextNode(value));
      return true;
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommandSpy,
    });

    dispatchMultiPanelMessage({
      type: 'INJECT_TEXT',
      text: 'hello current doubao',
      autoSubmit: false,
      context: 'multi-panel',
    });

    expect(editor.textContent).toContain('hello current doubao');
    expect(unrelatedEditor.textContent).toBe('');
    expect(execCommandSpy).toHaveBeenCalledWith(
      'insertText',
      false,
      'hello current doubao'
    );
  });

  it('uses the send button for Doubao when triggering send', () => {
    const { sendButton } = createDoubaoComposerDom();
    const clickSpy = vi.fn();
    sendButton.addEventListener('click', clickSpy);

    dispatchMultiPanelMessage({
      type: 'TRIGGER_SEND',
      context: 'multi-panel',
    });

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the Doubao textarea composer through form control updates', async () => {
    const { editor } = createDoubaoComposerDom();
    editor.value = 'hello doubao';
    const inputSpy = vi.fn();
    const changeSpy = vi.fn();
    editor.addEventListener('input', inputSpy);
    editor.addEventListener('change', changeSpy);

    dispatchMultiPanelMessage({
      type: 'CLEAR_INPUT',
      context: 'multi-panel',
    });

    await wait(10);

    expect(editor.value).toBe('');
    expect(inputSpy).toHaveBeenCalled();
    expect(changeSpy).toHaveBeenCalled();
  });

  it('uploads images through the Doubao file input and keeps text injection working', async () => {
    const { editor, fileInput } = createDoubaoComposerDom();
    const changeSpy = vi.fn();
    fileInput.addEventListener('change', () => {
      const preview = document.createElement('img');
      preview.src = 'blob:https://www.doubao.com/test-preview';
      document.getElementById('input-engine-container').appendChild(preview);
    });
    fileInput.addEventListener('change', changeSpy);

    dispatchMultiPanelMessage({
      type: 'INJECT_TEXT_WITH_IMAGES',
      text: 'text only',
      images: [{
        name: 'sample.png',
        type: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z2ioAAAAASUVORK5CYII='
      }],
      autoSubmit: false,
      context: 'multi-panel',
    });

    await wait(2800);

    expect(editor.value).toContain('text only');
    expect(changeSpy).toHaveBeenCalled();
    expect(fileInput.files).toHaveLength(1);
    expect(fileInput.files[0].name).toBe('sample.png');
  });

  it('does not auto-submit Doubao images when upload preview never appears', async () => {
    const { fileInput, sendButton } = createDoubaoComposerDom();
    const clickSpy = vi.fn();
    const changeSpy = vi.fn();
    fileInput.addEventListener('change', changeSpy);
    sendButton.addEventListener('click', clickSpy);

    dispatchMultiPanelMessage({
      type: 'INJECT_TEXT_WITH_IMAGES',
      text: 'text with missing preview',
      images: [{
        name: 'sample.png',
        type: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z2ioAAAAASUVORK5CYII='
      }],
      autoSubmit: true,
      context: 'multi-panel',
    });

    await wait(3500);

    expect(changeSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).not.toHaveBeenCalled();
  }, 6000);

  it('uses the visible new chat control for Doubao', () => {
    const { newChatButton } = createDoubaoComposerDom();
    const clickSpy = vi.fn();
    newChatButton.addEventListener('click', clickSpy);

    dispatchMultiPanelMessage({
      type: 'NEW_CHAT',
      context: 'multi-panel',
    });

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the current create conversation control for Doubao', () => {
    // Markup captured from the live site on 2026-09-23: the control sits in a
    // `contents` wrapper, so it is no longer a direct sidebar child.
    document.body.innerHTML = `
      <div id="flow_chat_sidebar" data-testid="flow_chat_sidebar">
        <div class="select-none contents">
          <div data-testid="create_conversation_button">
            <div><span>新对话</span></div>
          </div>
        </div>
      </div>
    `;
    const newChatControl = document.querySelector('[data-testid="create_conversation_button"]');
    const clickSpy = vi.fn();
    newChatControl.addEventListener('click', clickSpy);

    dispatchMultiPanelMessage({
      type: 'NEW_CHAT',
      context: 'multi-panel',
    });

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  describe('narrow panel overlays', () => {
    beforeEach(() => {
      window.sessionStorage.clear();
      Object.defineProperty(window, 'parent', {
        configurable: true,
        value: { postMessage: vi.fn() },
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      delete window.parent;
    });

    it('loads the new-chat URL instead of clicking a control under the drawer mask', () => {
      window.happyDOM.setURL('https://www.doubao.com/chat/123456');
      const { newChatButton } = createNarrowDoubaoDom({ drawerOpen: false });
      const clickSpy = vi.fn();
      newChatButton.addEventListener('click', clickSpy);

      dispatchMultiPanelMessage({ type: 'NEW_CHAT', context: 'multi-panel' });

      expect(clickSpy).not.toHaveBeenCalled();
      expect(window.location.href).toBe('https://www.doubao.com/chat/');
    });

    it('loads the new-chat URL when the sidebar drawer is collapsed off-screen', () => {
      window.happyDOM.setURL('https://www.doubao.com/chat/123456');
      const { mask, newChatButton } = createNarrowDoubaoDom({ drawerOpen: false });
      mask.remove();
      // Live geometry at a 400px panel: the collapsed drawer sits at x=-308.
      setRect(newChatButton, { top: 81, left: -295, width: 255, height: 34 });
      const clickSpy = vi.fn();
      newChatButton.addEventListener('click', clickSpy);

      dispatchMultiPanelMessage({ type: 'NEW_CHAT', context: 'multi-panel' });

      expect(clickSpy).not.toHaveBeenCalled();
      expect(window.location.href).toBe('https://www.doubao.com/chat/');
    });

    it('closes the drawer mask that stays open after New Chat and then verifies', async () => {
      vi.useFakeTimers();
      window.happyDOM.setURL('https://www.doubao.com/chat/123456');
      const { mask, drawer, editor, newChatButton } = createNarrowDoubaoDom();
      editor.value = 'draft';
      newChatButton.addEventListener('click', () => {
        window.happyDOM.setURL('https://www.doubao.com/chat/');
        editor.value = '';
      });
      const maskClicks = vi.fn(() => {
        mask.remove();
        drawer.remove();
      });
      mask.addEventListener('click', maskClicks);

      dispatchHostNewChat('req-doubao-drawer');
      await vi.advanceTimersByTimeAsync(3000);

      expect(maskClicks).toHaveBeenCalled();
      expect(document.getElementById('mask')).toBeNull();
      expect(getNewChatResults()).toEqual([expect.objectContaining({
        requestId: 'req-doubao-drawer',
        provider: 'doubao',
        status: 'verified',
      })]);
    });

    it('does not verify while a drawer mask it cannot close covers the composer', async () => {
      vi.useFakeTimers();
      window.happyDOM.setURL('https://www.doubao.com/chat/123456');
      const { editor, newChatButton } = createNarrowDoubaoDom();
      editor.value = 'draft';
      newChatButton.addEventListener('click', () => {
        window.happyDOM.setURL('https://www.doubao.com/chat/');
        editor.value = '';
      });

      dispatchHostNewChat('req-doubao-stuck');
      await vi.advanceTimersByTimeAsync(12500);

      expect(getNewChatResults()).toEqual([expect.objectContaining({
        requestId: 'req-doubao-stuck',
        status: 'unconfirmed',
        reason: 'confirmation-timeout',
      })]);
    });

    it('stops retrying dismissal after a few attempts on a mask it cannot close', async () => {
      vi.useFakeTimers();
      window.happyDOM.setURL('https://www.doubao.com/chat/123456');
      const { mask, editor, newChatButton } = createNarrowDoubaoDom();
      editor.value = 'draft';
      newChatButton.addEventListener('click', () => {
        window.happyDOM.setURL('https://www.doubao.com/chat/');
        editor.value = '';
      });
      const maskClicks = vi.fn();
      const escapes = vi.fn();
      mask.addEventListener('click', maskClicks);
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') escapes();
      });

      dispatchHostNewChat('req-doubao-capped');
      await vi.advanceTimersByTimeAsync(12500);

      // Post-click cleanup and verification each make at most three attempts
      // (mask, then close or Escape), instead of one every 200 ms poll.
      expect(maskClicks.mock.calls.length).toBeLessThanOrEqual(2);
      expect(escapes.mock.calls.length).toBeLessThanOrEqual(4);
    });

    it('verifies when a floating element that is not an overlay sits over the composer', async () => {
      vi.useFakeTimers();
      window.happyDOM.setURL('https://www.doubao.com/chat/123456');
      const { mask, drawer, editor, newChatButton } = createNarrowDoubaoDom();
      editor.value = 'draft';
      const hint = document.createElement('div');
      hint.id = 'floating-hint';
      document.body.append(hint);
      newChatButton.addEventListener('click', () => {
        window.happyDOM.setURL('https://www.doubao.com/chat/');
        editor.value = '';
        mask.remove();
        drawer.remove();
      });
      document.elementFromPoint.mockImplementation((x, y) => (y < 100 && newChatButton.isConnected ? newChatButton : hint));

      dispatchHostNewChat('req-doubao-hint');
      await vi.advanceTimersByTimeAsync(3000);

      expect(getNewChatResults()).toEqual([expect.objectContaining({
        requestId: 'req-doubao-hint',
        status: 'verified',
      })]);
    });

    it('reports a login dialog as failed without dismissing it', async () => {
      vi.useFakeTimers();
      window.happyDOM.setURL('https://www.doubao.com/chat/');
      const { mask } = createNarrowDoubaoDom({
        drawerOpen: false,
        dialog: '<div role="dialog" id="login-dialog"><p>登录后继续使用豆包</p><button class="semi-modal-close" id="login-close">x</button></div>',
      });
      const maskClicks = vi.fn();
      const closeClicks = vi.fn();
      const escapes = vi.fn();
      mask.addEventListener('click', maskClicks);
      document.getElementById('login-close').addEventListener('click', closeClicks);
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') escapes();
      });

      dispatchHostNewChat('req-doubao-login');
      await vi.advanceTimersByTimeAsync(3000);

      expect(maskClicks).not.toHaveBeenCalled();
      expect(closeClicks).not.toHaveBeenCalled();
      expect(escapes).not.toHaveBeenCalled();
      expect(document.getElementById('login-dialog')).not.toBeNull();
      expect(getNewChatResults()).toEqual([expect.objectContaining({
        requestId: 'req-doubao-login',
        status: 'failed',
        reason: 'provider-dialog-open',
      })]);
    });

    it('falls back to an exact 新对话 control but not a chat titled 新对话', () => {
      document.body.innerHTML = `
        <a href="/chat/987654" id="history-link">新对话</a>
        <button type="button" id="text-new-chat">新对话</button>
      `;
      const historyLink = document.getElementById('history-link');
      const textButton = document.getElementById('text-new-chat');
      [historyLink, textButton].forEach(markVisible);
      const historyClicks = vi.fn(event => event.preventDefault());
      const buttonClicks = vi.fn();
      historyLink.addEventListener('click', historyClicks);
      textButton.addEventListener('click', buttonClicks);

      dispatchMultiPanelMessage({ type: 'NEW_CHAT', context: 'multi-panel' });

      expect(historyClicks).not.toHaveBeenCalled();
      expect(buttonClicks).toHaveBeenCalledTimes(1);
    });
  });
});
