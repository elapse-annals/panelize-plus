import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const buttonFinderSource = readFileSync(
  resolve(process.cwd(), 'content-scripts/button-finder-utils.js'),
  'utf8'
);
const contentScriptSource = readFileSync(
  resolve(process.cwd(), 'content-scripts/text-injection-all-providers.js'),
  'utf8'
);

const MIMO_SEND_ICON = '0 0 19 16';

function markVisible(element) {
  Object.defineProperty(element, 'offsetParent', {
    configurable: true,
    get: () => document.body,
  });
}

function createMimoDom({ sendIcon = MIMO_SEND_ICON, withFileInput = true } = {}) {
  document.body.innerHTML = `
    <button type="button" aria-label="新对话" data-track-id="navbar_new_chat_btn"></button>
    <div class="composer">
      ${withFileInput ? '<input type="file" multiple accept="image/jpeg,image/png,application/pdf" />' : ''}
      <div class="previews"></div>
      <div>
        <textarea placeholder="有问题，尽管问"></textarea>
        <div>
          <button type="button" data-track-id="home_send_btn">
            <svg viewBox="${sendIcon}"></svg>
          </button>
        </div>
      </div>
    </div>
  `;

  const editor = document.querySelector('textarea');
  const sendButton = document.querySelector('[data-track-id="home_send_btn"]');
  const newChatButton = document.querySelector('[data-track-id="navbar_new_chat_btn"]');
  const fileInput = document.querySelector('input[type="file"]');
  const previews = document.querySelector('.previews');
  [editor, sendButton, newChatButton].forEach(markVisible);

  fileInput?.addEventListener('change', () => {
    const preview = document.createElement('img');
    preview.alt = fileInput.files[0].name;
    previews.append(preview);
  });

  return { editor, sendButton, newChatButton, fileInput, previews };
}

function createMetaAiDom() {
  document.body.innerHTML = `
    <a data-testid="new-chat-button" href="/">New chat</a>
    <div class="rounded-3xl">
      <textarea data-testid="composer-input" hidden></textarea>
      <div data-testid="composer-input" contenteditable="true" role="textbox"></div>
      <input type="file" multiple accept="image/png,image/jpeg" hidden />
      <button type="button" data-testid="composer-send-button" aria-label="Send">Send</button>
    </div>
  `;

  const mirror = document.querySelector('textarea[data-testid="composer-input"]');
  const editor = document.querySelector('[data-testid="composer-input"][contenteditable="true"]');
  const sendButton = document.querySelector('[data-testid="composer-send-button"]');
  const newChatButton = document.querySelector('[data-testid="new-chat-button"]');
  [editor, sendButton, newChatButton].forEach(markVisible);

  return { mirror, editor, sendButton, newChatButton };
}

function createMetaAiLoggedOutDom() {
  document.body.innerHTML = `
    <div data-slot="logged-out-composer">
      <div data-slot="logged-out-composer-input">
        <input type="text" aria-label="问问 Meta AI" />
      </div>
      <div data-slot="logged-out-composer-controls">
        <button type="button" data-slot="button" aria-label="发送">Send</button>
      </div>
    </div>
  `;

  const editor = document.querySelector('[data-slot="logged-out-composer-input"] input[type="text"]');
  const sendButton = document.querySelector(
    '[data-slot="logged-out-composer-controls"] button[data-slot="button"][aria-label="发送"]'
  );
  [editor, sendButton].forEach(markVisible);

  return { editor, sendButton };
}

function dispatchMultiPanelMessage(payload) {
  window.dispatchEvent(new MessageEvent('message', { data: payload }));
}

function dispatchImageInjection(autoSubmit = false) {
  dispatchMultiPanelMessage({
    type: 'INJECT_TEXT_WITH_IMAGES',
    text: '',
    images: [{
      name: 'sample.png',
      type: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z2ioAAAAASUVORK5CYII=',
    }],
    autoSubmit,
    context: 'multi-panel',
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(() => {
  window.eval(buttonFinderSource);
  window.eval(contentScriptSource);
});

describe('MiMo content script integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.happyDOM.setURL('https://aistudio.xiaomimimo.com/#/c');
  });

  it('injects text into the composer textarea and clicks the send control', () => {
    const { editor, sendButton } = createMimoDom();
    const clickSpy = vi.fn();
    sendButton.addEventListener('click', clickSpy);

    dispatchMultiPanelMessage({
      type: 'INJECT_TEXT',
      text: 'hello mimo',
      autoSubmit: false,
      context: 'multi-panel',
    });
    dispatchMultiPanelMessage({ type: 'TRIGGER_SEND', context: 'multi-panel' });

    expect(editor.value).toContain('hello mimo');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('does not click the shared control while it shows the stop icon', () => {
    const { sendButton } = createMimoDom({ sendIcon: '0 0 16 16' });
    const clickSpy = vi.fn();
    sendButton.addEventListener('click', clickSpy);

    dispatchMultiPanelMessage({ type: 'TRIGGER_SEND', context: 'multi-panel' });

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('clicks the navbar control for a new chat', () => {
    const { newChatButton } = createMimoDom();
    const clickSpy = vi.fn();
    newChatButton.addEventListener('click', clickSpy);

    dispatchMultiPanelMessage({ type: 'NEW_CHAT', context: 'multi-panel' });

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('uploads an image through the composer file input and waits for its preview', async () => {
    const { fileInput, previews } = createMimoDom();

    dispatchImageInjection();
    await wait(1000);

    expect(fileInput.files).toHaveLength(1);
    expect(fileInput.files[0].name).toBe('sample.png');
    expect(previews.querySelectorAll('img')).toHaveLength(1);
  });

  it('does not auto-submit when the image cannot be attached', async () => {
    const { sendButton } = createMimoDom({ withFileInput: false });
    const clickSpy = vi.fn();
    sendButton.addEventListener('click', clickSpy);

    dispatchImageInjection(true);
    await wait(1000);

    expect(clickSpy).not.toHaveBeenCalled();
  });
});

describe('Meta AI content script integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.happyDOM.setURL('https://www.meta.ai/');
  });

  it('writes into the visible Lexical editor and clicks the send button', () => {
    const { mirror, editor, sendButton } = createMetaAiDom();
    const clickSpy = vi.fn();
    sendButton.addEventListener('click', clickSpy);

    dispatchMultiPanelMessage({
      type: 'INJECT_TEXT',
      text: 'hello meta',
      autoSubmit: false,
      context: 'multi-panel',
    });
    dispatchMultiPanelMessage({ type: 'TRIGGER_SEND', context: 'multi-panel' });

    expect(editor.textContent).toContain('hello meta');
    expect(mirror.value).toBe('');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('submits from Meta AI’s logged-out composer using its scoped Chinese send control', async () => {
    const { editor, sendButton } = createMetaAiLoggedOutDom();
    const clickSpy = vi.fn();
    sendButton.addEventListener('click', clickSpy);

    dispatchMultiPanelMessage({
      type: 'INJECT_TEXT',
      text: 'hello meta',
      autoSubmit: true,
      context: 'multi-panel',
    });
    await wait(900);

    expect(editor.value).toBe('hello meta');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('does not click anything while the stop button replaces send', () => {
    createMetaAiDom();
    const sendButton = document.querySelector('[data-testid="composer-send-button"]');
    sendButton.setAttribute('data-testid', 'composer-stop-button');
    const clickSpy = vi.fn();
    sendButton.addEventListener('click', clickSpy);

    dispatchMultiPanelMessage({ type: 'TRIGGER_SEND', context: 'multi-panel' });

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('clicks the new chat button', () => {
    const { newChatButton } = createMetaAiDom();
    const clickSpy = vi.fn((event) => event.preventDefault());
    newChatButton.addEventListener('click', clickSpy);

    dispatchMultiPanelMessage({ type: 'NEW_CHAT', context: 'multi-panel' });

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
