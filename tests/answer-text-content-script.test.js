import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const contentScriptSource = readFileSync(
  resolve(process.cwd(), 'content-scripts/text-injection-all-providers.js'),
  'utf8'
);

const EXTENSION_ORIGIN = 'chrome-extension://panelize-test';

function dispatchMultiPanelMessage(data, { origin = EXTENSION_ORIGIN, source = window.parent } = {}) {
  const event = new window.Event('message');
  Object.assign(event, { data: { context: 'multi-panel', ...data }, origin, source });
  window.dispatchEvent(event);
}

function getMessages(type) {
  return window.parent.postMessage.mock.calls.filter(([message]) => message?.type === type);
}

describe('answer text for the AI summary', () => {
  beforeAll(() => {
    window.chrome = { runtime: { getURL: () => `${EXTENSION_ORIGIN}/` } };
    window.eval(contentScriptSource);
  });

  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 28, 8) });
    window.happyDOM.setURL('https://chat.deepseek.com/a/chat/s/test');
    document.body.innerHTML = '<div id="thread"><div class="ds-markdown">Old answer</div></div>';
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: vi.fn() }
    });
  });

  afterEach(() => {
    dispatchMultiPanelMessage({ type: 'NEW_CHAT' });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sends the finished answer text to the extension page only', async () => {
    dispatchMultiPanelMessage({ type: 'TRIGGER_SEND', requestId: 'req-text' });
    document.getElementById('thread').insertAdjacentHTML('beforeend', '<div class="ds-markdown">New answer</div>');
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(5500);

    const timing = getMessages('PANELIZE_RESPONSE_TIMING').filter(([message]) => message.requestId === 'req-text');
    expect(timing[0][0]).not.toHaveProperty('text');
    expect(timing[0][1]).toBe('*');
    const complete = timing.find(([message]) => message.phase === 'complete');
    expect(complete[0].text).toBe('New answer');
    expect(complete[1]).toBe(EXTENSION_ORIGIN);
  });

  it('replies with the last answer when asked by the extension page', () => {
    dispatchMultiPanelMessage({ type: 'PANELIZE_GET_ANSWER_TEXT', requestId: 'ask-1' });
    expect(getMessages('PANELIZE_ANSWER_TEXT')).toEqual([[
      expect.objectContaining({ requestId: 'ask-1', provider: 'deepseek', text: 'Old answer' }),
      EXTENSION_ORIGIN
    ]]);
  });

  it.each([
    ['wrong message source', { source: {} }],
    ['wrong extension origin', { origin: 'https://provider-page.example' }]
  ])('ignores answer text requests with the %s', (label, overrides) => {
    dispatchMultiPanelMessage({ type: 'PANELIZE_GET_ANSWER_TEXT', requestId: 'ask-2' }, overrides);
    expect(getMessages('PANELIZE_ANSWER_TEXT')).toEqual([]);
  });
});
