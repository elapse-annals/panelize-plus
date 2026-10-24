import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const contentScriptSource = readFileSync(
  resolve(process.cwd(), 'content-scripts/text-injection-all-providers.js'),
  'utf8'
);
const STORAGE_PREFIX = 'panelize.pending-new-chat.v1:';

function markVisible(element) {
  Object.defineProperty(element, 'offsetParent', {
    configurable: true,
    get: () => document.body
  });
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top: 1, left: 1, right: 100, bottom: 30, width: 99, height: 29 })
  });
}

function createChatgptDom({ draft = 'draft', hasConversation = true, resetOnClick = true } = {}) {
  document.body.innerHTML = `
    <div id="prompt-textarea" contenteditable="true">${draft}</div>
    ${hasConversation
      ? '<div data-message-author-role="user">previous user message</div><div data-message-author-role="assistant">previous answer</div>'
      : ''}
    <button type="button" data-testid="new-chat-button">New chat</button>
  `;
  const composer = document.getElementById('prompt-textarea');
  const userMessage = document.querySelector('[data-message-author-role="user"]');
  const assistantMessage = document.querySelector('[data-message-author-role="assistant"]');
  const button = document.querySelector('[data-testid="new-chat-button"]');
  [composer, userMessage, assistantMessage, button].filter(Boolean).forEach(markVisible);
  const clicks = vi.fn();
  button.addEventListener('click', () => {
    clicks();
    if (!resetOnClick) return;
    composer.textContent = '';
    userMessage?.remove();
    assistantMessage?.remove();
  });

  window.PanelizeChatgptComposer = {
    EDITOR_SELECTORS: ['#prompt-textarea'],
    findEditor: () => document.querySelector('#prompt-textarea')
  };
  return { button, composer, clicks };
}

function dispatchMultiPanelMessage(data) {
  const event = new window.Event('message');
  Object.assign(event, {
    data: { context: 'multi-panel', ...data },
    origin: 'chrome-extension://panelize-test',
    source: window.parent
  });
  window.dispatchEvent(event);
}

function dispatchUntrustedMessage(data, { origin = 'chrome-extension://panelize-test', source = window.parent } = {}) {
  const event = new window.Event('message');
  Object.assign(event, { data: { context: 'multi-panel', ...data }, origin, source });
  window.dispatchEvent(event);
}

function createGeminiDom() {
  window.happyDOM.setURL('https://gemini.google.com/app');
  document.body.innerHTML = `
    <div class="ql-editor" contenteditable="true"></div>
    <button type="button" aria-label="New chat">New chat</button>
  `;
  const composer = document.querySelector('.ql-editor');
  const button = document.querySelector('button[aria-label="New chat"]');
  [composer, button].forEach(markVisible);
  const clicks = vi.fn();
  button.addEventListener('click', clicks);
  return { button, composer, clicks };
}

function getNewChatResults() {
  return window.parent.postMessage.mock.calls
    .map(([message]) => message)
    .filter(message => message?.type === 'PANELIZE_NEW_CHAT_RESULT');
}

function createPendingMarker(requestId, panelId) {
  return {
    requestId,
    provider: 'chatgpt',
    providerMode: null,
    panelId,
    createdAt: Date.now()
  };
}

describe('new chat content script result protocol', () => {
  beforeAll(() => {
    window.chrome = { runtime: { getURL: () => 'chrome-extension://panelize-test/' } };
    window.eval(contentScriptSource);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    window.happyDOM.setURL('https://chatgpt.com/c/old-conversation');
    document.body.innerHTML = '';
    window.PanelizeChatgptComposer = undefined;
    window.sessionStorage.clear();
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: vi.fn() }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports verified only after the composer and existing user turns clear', async () => {
    vi.useFakeTimers();
    const { button, clicks } = createChatgptDom();

    dispatchMultiPanelMessage({
      type: 'NEW_CHAT',
      requestId: 'req-clear',
      panelId: 'panel-chatgpt',
      provider: 'chatgpt'
    });
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(getNewChatResults()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);

    expect(getNewChatResults()).toEqual([expect.objectContaining({
      type: 'PANELIZE_NEW_CHAT_RESULT',
      context: 'multi-panel-new-chat-result',
      requestId: 'req-clear',
      panelId: 'panel-chatgpt',
      provider: 'chatgpt',
      status: 'verified'
    })]);
    expect(button).toBeTruthy();
  });

  it('does not treat a successful click as proof when the page stays unchanged', async () => {
    vi.useFakeTimers();
    const { clicks } = createChatgptDom({ draft: '', hasConversation: false, resetOnClick: false });

    dispatchMultiPanelMessage({
      type: 'NEW_CHAT',
      requestId: 'req-no-change',
      panelId: 'panel-chatgpt',
      provider: 'chatgpt'
    });
    await vi.advanceTimersByTimeAsync(12500);

    expect(clicks).toHaveBeenCalledTimes(1);
    expect(getNewChatResults()).toEqual([expect.objectContaining({
      requestId: 'req-no-change',
      status: 'unconfirmed',
      reason: 'confirmation-timeout'
    })]);
  });

  it('does not verify a blank composer while an assistant turn remains', async () => {
    vi.useFakeTimers();
    const { clicks } = createChatgptDom({ draft: '', hasConversation: false, resetOnClick: false });
    const assistant = document.createElement('div');
    assistant.setAttribute('data-message-author-role', 'assistant');
    assistant.textContent = 'previous answer';
    markVisible(assistant);
    document.body.append(assistant);

    dispatchMultiPanelMessage({
      type: 'NEW_CHAT',
      requestId: 'req-assistant-remains',
      panelId: 'panel-chatgpt',
      provider: 'chatgpt'
    });
    await vi.advanceTimersByTimeAsync(12500);

    expect(clicks).toHaveBeenCalledTimes(1);
    expect(getNewChatResults()).toEqual([expect.objectContaining({
      requestId: 'req-assistant-remains',
      status: 'unconfirmed',
      reason: 'confirmation-timeout'
    })]);
  });

  it('treats repeated Gemini requests on the canonical blank state as ready', async () => {
    vi.useFakeTimers();
    const { clicks } = createGeminiDom();

    for (const requestId of ['req-gemini-first', 'req-gemini-repeat']) {
      dispatchMultiPanelMessage({
        type: 'NEW_CHAT',
        requestId,
        panelId: 'panel-gemini',
        provider: 'gemini'
      });
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(clicks).toHaveBeenCalledTimes(2);
    expect(getNewChatResults().map(result => [result.requestId, result.status])).toEqual([
      ['req-gemini-first', 'verified'],
      ['req-gemini-repeat', 'verified']
    ]);
  });

  it.each([
    ['wrong message source', { source: {} }],
    ['wrong extension origin', { origin: 'https://provider-page.example' }]
  ])('ignores a request from %s', (_label, trustOverrides) => {
    const { clicks } = createChatgptDom();

    dispatchUntrustedMessage({
      type: 'NEW_CHAT',
      requestId: 'req-untrusted',
      panelId: 'panel-chatgpt',
      provider: 'chatgpt'
    }, trustOverrides);

    expect(clicks).not.toHaveBeenCalled();
    expect(getNewChatResults()).toHaveLength(0);
  });

  it('verifies a host-driven reload without clicking a new-chat control', async () => {
    vi.useFakeTimers();
    const { clicks } = createChatgptDom({ draft: '', hasConversation: false });

    dispatchMultiPanelMessage({
      type: 'VERIFY_NEW_CHAT',
      requestId: 'req-host-reload',
      panelId: 'panel-chatgpt',
      provider: 'chatgpt'
    });
    await vi.advanceTimersByTimeAsync(2000);

    expect(clicks).not.toHaveBeenCalled();
    expect(getNewChatResults()).toEqual([expect.objectContaining({
      requestId: 'req-host-reload',
      panelId: 'panel-chatgpt',
      status: 'verified'
    })]);
  });

  it.each([
    ['wrong message source', { source: {} }],
    ['wrong extension origin', { origin: 'https://provider-page.example' }]
  ])('ignores VERIFY_NEW_CHAT from %s', (_label, trustOverrides) => {
    createChatgptDom({ draft: '', hasConversation: false });

    dispatchUntrustedMessage({
      type: 'VERIFY_NEW_CHAT',
      requestId: 'req-untrusted-verify',
      panelId: 'panel-chatgpt',
      provider: 'chatgpt'
    }, trustOverrides);

    expect(getNewChatResults()).toHaveLength(0);
  });

  it('recovers the pending request on a fresh document after navigation', async () => {
    vi.useFakeTimers();
    createChatgptDom({ draft: '', hasConversation: false });
    const marker = createPendingMarker('req-navigation', 'panel-chatgpt');
    const key = `${STORAGE_PREFIX}${encodeURIComponent(marker.requestId)}:${encodeURIComponent(marker.panelId)}`;
    window.sessionStorage.setItem(key, JSON.stringify(marker));

    // A new content-script instance models the document loaded after fallback navigation.
    window.eval(contentScriptSource);
    await vi.advanceTimersByTimeAsync(2000);

    expect(getNewChatResults()).toEqual([expect.objectContaining({
      requestId: 'req-navigation',
      panelId: 'panel-chatgpt',
      provider: 'chatgpt',
      status: 'verified'
    })]);
  });
});
