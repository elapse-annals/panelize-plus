import { readContentScriptSource } from '../../helpers/content-scripts.js';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const contentScriptSource = readContentScriptSource(
  resolve(process.cwd(), 'content-scripts/text-injection-all-providers.js'),
  'utf8'
);

function markVisible(element) {
  Object.defineProperty(element, 'offsetParent', {
    configurable: true,
    get: () => document.body,
  });
}

function createWenxinDom({ sendEnabled = true } = {}) {
  document.body.innerHTML = `
    <div id="ci-main">
      <div class="ci-wrapper"><div class="ci-container">
        <textarea id="chat-textarea" class="ci-textarea" placeholder="询问AI任何问题"></textarea>
        <span class="ci-submit-button"><img id="ci-submit-button-ai" class="${sendEnabled ? 'ci-submit-button-ai-active' : ''}"></span>
      </div></div>
    </div>
  `;
  const editor = document.querySelector('textarea#chat-textarea.ci-textarea');
  const sendButton = document.querySelector('img#ci-submit-button-ai');
  [editor, sendButton].forEach(markVisible);
  return { editor, sendButton };
}

function dispatchMultiPanelMessage(payload) {
  window.dispatchEvent(new MessageEvent('message', { data: { context: 'multi-panel', ...payload } }));
}

describe('Wenxin content script integration', () => {
  beforeAll(() => {
    window.eval(contentScriptSource);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.happyDOM.setURL('https://wenxin.baidu.com/');
  });

  it('fills the observed textarea and clicks the active send control', () => {
    const { editor, sendButton } = createWenxinDom();
    const click = vi.fn();
    sendButton.addEventListener('click', click);

    dispatchMultiPanelMessage({ type: 'INJECT_TEXT', text: '你好，文心', autoSubmit: false });
    dispatchMultiPanelMessage({ type: 'TRIGGER_SEND' });

    expect(editor.value).toBe('你好，文心');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('does not click the inactive send control when the composer is empty', () => {
    const { sendButton } = createWenxinDom({ sendEnabled: false });
    const click = vi.fn();
    sendButton.addEventListener('click', click);

    dispatchMultiPanelMessage({ type: 'TRIGGER_SEND' });

    expect(click).not.toHaveBeenCalled();
  });

  it('keeps image uploads disabled and reports them as unsupported', async () => {
    const { editor } = createWenxinDom();
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', { configurable: true, value: parent });
    dispatchMultiPanelMessage({
      type: 'INJECT_TEXT_WITH_IMAGES',
      requestId: 'wenxin-image-request',
      text: '',
      images: [{ id: 'image-1', name: 'sample.png', type: 'image/png', dataUrl: 'data:image/png;base64,AA==' }],
      autoSubmit: false,
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PANELIZE_ACTION_RESULT',
      requestId: 'wenxin-image-request',
      provider: 'wenxin',
      status: 'failed',
      reason: 'unsupported',
    }), '*');
    Object.defineProperty(window, 'parent', { configurable: true, value: window });
  });

  it.each([
    {
      url: 'https://www.perplexity.ai/',
      markup: '<div class="bg-composer _editor_22sit_47"><div id="ask-input" contenteditable="true" role="textbox" data-lexical-editor="true"></div><button type="button" aria-label="提交">提交</button></div>',
      input: '#ask-input',
      button: '.bg-composer button',
      contentEditable: true
    },
    {
      url: 'https://www.perplexity.ai/',
      markup: '<div class="bg-composer"><textarea id="ask-input"></textarea><button type="button" aria-label="Submit">Submit</button></div>',
      input: '#ask-input',
      button: '.bg-composer button',
      contentEditable: false
    },
    {
      url: 'https://copilot.com/chat',
      markup: '<div id="m365-chat-input-shared-container" data-test-id="chat-input-wrapper"><div class="fai-BebopLiteChatInput"><span id="m365-chat-editor-target-element" role="textbox" contenteditable="true" data-lexical-editor="true" aria-label="Message Copilot"></span><button type="submit" aria-label="Send" class="fui-Button fai-SendButton">Send</button></div></div>',
      input: '#m365-chat-editor-target-element',
      button: '#m365-chat-input-shared-container button.fai-SendButton',
      contentEditable: true
    }
  ])('supports the scoped signed-in composer on $url', ({ url, markup, input, button, contentEditable }) => {
    window.happyDOM.setURL(url);
    document.body.innerHTML = markup;
    const editor = document.querySelector(input);
    const sendButton = document.querySelector(button);
    [editor, sendButton].forEach(markVisible);
    const click = vi.fn();
    sendButton.addEventListener('click', click);

    dispatchMultiPanelMessage({ type: 'INJECT_TEXT', text: 'safe scoped test', autoSubmit: false });
    dispatchMultiPanelMessage({ type: 'TRIGGER_SEND' });

    expect(contentEditable ? editor.textContent : editor.value).toBe('safe scoped test');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['https://www.perplexity.ai/', '<form><textarea name="email"></textarea><button type="submit">Sign in</button></form>'],
    ['https://copilot.com/chat', '<form><textarea name="email"></textarea><button type="submit">Sign in</button></form>']
  ])('does not use a generic login field on %s', (url, markup) => {
    window.happyDOM.setURL(url);
    document.body.innerHTML = markup;
    const editor = document.querySelector('textarea');
    const button = document.querySelector('button');
    [editor, button].forEach(markVisible);
    const click = vi.fn();
    button.addEventListener('click', click);

    dispatchMultiPanelMessage({ type: 'INJECT_TEXT', text: 'must not go in login', autoSubmit: false });
    dispatchMultiPanelMessage({ type: 'TRIGGER_SEND' });

    expect(editor.value).toBe('');
    expect(click).not.toHaveBeenCalled();
  });
});
