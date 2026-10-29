import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'content-scripts/focus-toggle.js'), 'utf8');
let messageListener;

function markVisible(element) {
  Object.defineProperty(element, 'offsetParent', { configurable: true, get: () => document.body });
}

function takeFocus() {
  let response;
  messageListener({ action: 'takeFocus' }, {}, result => { response = result; });
  return response;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.chrome = { runtime: { onMessage: { addListener: vi.fn(listener => { messageListener = listener; }) } } };
});

describe('provider focus toggle for new providers', () => {
  it('targets the verified Perplexity Lexical composer without falling back to login textareas', () => {
    window.happyDOM.setURL('https://www.perplexity.ai/');
    document.body.innerHTML = '<textarea id="login-email"></textarea><div id="ask-input" contenteditable="true" role="textbox" data-lexical-editor="true"></div>';
    const composer = document.getElementById('ask-input');
    markVisible(composer);
    const focus = vi.spyOn(composer, 'focus');
    window.eval(source);

    expect(takeFocus()).toEqual({ success: true });
    expect(focus).toHaveBeenCalledOnce();
  });

  it('does not focus a generic Copilot login field when the composer is absent', () => {
    window.happyDOM.setURL('https://copilot.microsoft.com/');
    document.body.innerHTML = '<textarea id="login-email"></textarea>';
    markVisible(document.getElementById('login-email'));
    window.eval(source);

    expect(takeFocus()).toEqual({ success: false });
  });

  it('targets the verified Copilot Lexical composer', () => {
    window.happyDOM.setURL('https://copilot.com/chat');
    document.body.innerHTML = '<textarea name="email"></textarea><div id="m365-chat-input-shared-container"><span id="m365-chat-editor-target-element" role="textbox" contenteditable="true" data-lexical-editor="true"></span></div>';
    const composer = document.getElementById('m365-chat-editor-target-element');
    markVisible(composer);
    const focus = vi.spyOn(composer, 'focus');
    window.eval(source);

    expect(takeFocus()).toEqual({ success: true });
    expect(focus).toHaveBeenCalledOnce();
  });

  it('targets the measured Wenxin textarea', () => {
    window.happyDOM.setURL('https://wenxin.baidu.com/');
    document.body.innerHTML = '<div id="ci-main"><textarea id="chat-textarea" class="ci-textarea"></textarea></div>';
    const composer = document.getElementById('chat-textarea');
    const focus = vi.spyOn(composer, 'focus');
    window.eval(source);

    expect(takeFocus()).toEqual({ success: true });
    expect(focus).toHaveBeenCalledOnce();
  });
});
