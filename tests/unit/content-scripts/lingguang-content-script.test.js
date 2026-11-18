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

function createLingguangDom({ sendEnabled = true, contentEditable = false } = {}) {
  const editor = contentEditable
    ? '<div id="lingguang-editor" contenteditable="true" role="textbox"></div>'
    : '<textarea id="lingguang-editor" class="ant-input input-textarea-f0YiLm4o" placeholder="问一问灵光"></textarea>';
  document.body.innerHTML = `
    <div class="input-container-Cz5jN3Ed">
      <div class="input-textarea-container-9QLdbTK5">
        ${editor}
        <textarea name="hiddenTextarea" aria-hidden="true"></textarea>
      </div>
      <div class="input-footer-fm9AgwoI">
        <div class="input-button-SEl1BODX">
          <div class="button-container-W3aBX_JK">
            <span data-aspm="c414395.d568860">
              <span id="lingguang-send" role="img" class="anticon${sendEnabled ? '' : ' disabled'}">send</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  `;
  const input = document.querySelector('#lingguang-editor');
  const hidden = document.querySelector('textarea[name="hiddenTextarea"]');
  const send = document.querySelector('#lingguang-send');
  [input, hidden, send].forEach(markVisible);
  return { input, hidden, send };
}

function dispatchMultiPanelMessage(payload) {
  window.dispatchEvent(new MessageEvent('message', { data: { context: 'multi-panel', ...payload } }));
}

describe('Lingguang content script integration', () => {
  beforeAll(() => {
    window.eval(contentScriptSource);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.happyDOM.setURL('https://www.lingguang.com/chat');
  });

  it('fills the visible antd textarea instead of the hidden autosize mirror', () => {
    const { input, hidden, send } = createLingguangDom();
    const click = vi.fn();
    send.addEventListener('click', click);

    dispatchMultiPanelMessage({ type: 'INJECT_TEXT', text: '你好，灵光', autoSubmit: false });
    dispatchMultiPanelMessage({ type: 'TRIGGER_SEND' });

    expect(input.value).toBe('你好，灵光');
    expect(hidden.value).toBe('');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('does not click the send icon while it is disabled', () => {
    const { send } = createLingguangDom({ sendEnabled: false });
    const click = vi.fn();
    send.addEventListener('click', click);

    dispatchMultiPanelMessage({ type: 'TRIGGER_SEND' });

    expect(click).not.toHaveBeenCalled();
  });

  it('supports a contenteditable composer and sends through the scoped icon', () => {
    const { input, send } = createLingguangDom({ contentEditable: true });
    const click = vi.fn();
    send.addEventListener('click', click);

    dispatchMultiPanelMessage({ type: 'INJECT_TEXT', text: '灵光编辑器测试', autoSubmit: false });
    dispatchMultiPanelMessage({ type: 'TRIGGER_SEND' });

    expect(input.textContent).toBe('灵光编辑器测试');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('does not use a login field when the composer is absent', () => {
    document.body.innerHTML = '<form><textarea name="phone" placeholder="请输入手机号"></textarea><button type="submit">下一步</button></form>';
    const loginField = document.querySelector('textarea');
    markVisible(loginField);
    const click = vi.fn();
    document.querySelector('button').addEventListener('click', click);

    dispatchMultiPanelMessage({ type: 'INJECT_TEXT', text: '必须留在登录页', autoSubmit: false });
    dispatchMultiPanelMessage({ type: 'TRIGGER_SEND' });

    expect(loginField.value).toBe('');
    expect(click).not.toHaveBeenCalled();
  });
});