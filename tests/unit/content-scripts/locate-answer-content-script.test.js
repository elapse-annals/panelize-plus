import { readContentScriptSource } from '../../helpers/content-scripts.js';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const contentScriptSource = readContentScriptSource(
  resolve(process.cwd(), 'content-scripts/text-injection-all-providers.js'),
  'utf8'
);

const EXTENSION_ORIGIN = 'chrome-extension://panelize-test';

function dispatchLocate(data, { origin = EXTENSION_ORIGIN, source = window.parent } = {}) {
  const event = new window.Event('message');
  Object.assign(event, { data: { context: 'multi-panel', ...data }, origin, source });
  window.dispatchEvent(event);
}

function getLocateResults() {
  return window.parent.postMessage.mock.calls
    .filter(([message]) => message?.type === 'PANELIZE_LOCATE_ANSWER_RESULT');
}

describe('locating quoted answer text for the AI summary', () => {
  beforeAll(() => {
    window.chrome = { runtime: { getURL: () => `${EXTENSION_ORIGIN}/` } };
    window.eval(contentScriptSource);
  });

  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 28, 8) });
    window.happyDOM.setURL('https://chat.deepseek.com/a/chat/s/test');
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <div class="ds-markdown"><p>Older answer quote should stay untouched.</p></div>
      <div class="ds-markdown">
        <p id="first-paragraph">An introduction.</p>
        <p id="quoted-paragraph">This sentence has a <strong>quote spanning</strong>\n inline text nodes.</p>
      </div>`;
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: vi.fn() }
    });
  });

  afterEach(() => {
    dispatchLocate({ type: 'NEW_CHAT' });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('finds a whitespace-normalized quote across inline text nodes in the last answer', () => {
    const paragraph = document.getElementById('quoted-paragraph');
    paragraph.scrollIntoView = vi.fn();

    dispatchLocate({
      type: 'PANELIZE_LOCATE_ANSWER_TEXT',
      requestId: 'locate-1',
      anchor: 'sentence has a quote spanning inline text'
    });

    expect(paragraph.classList.contains('panelize-quote-highlight')).toBe(true);
    expect(paragraph.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(document.querySelector('style#panelize-quote-highlight-style')).not.toBeNull();
    expect(getLocateResults()).toEqual([[
      expect.objectContaining({
        type: 'PANELIZE_LOCATE_ANSWER_RESULT',
        requestId: 'locate-1',
        provider: 'deepseek',
        found: true,
        context: 'multi-panel-provider-status'
      }),
      EXTENSION_ORIGIN
    ]]);

    vi.advanceTimersByTime(2500);
    expect(paragraph.classList.contains('panelize-quote-highlight')).toBe(false);
    expect(document.querySelector('style#panelize-quote-highlight-style')).not.toBeNull();
  });

  it('returns found false when the quote is absent from the last answer', () => {
    dispatchLocate({ type: 'PANELIZE_LOCATE_ANSWER_TEXT', requestId: 'locate-2', anchor: 'older answer quote' });

    expect(document.querySelector('.panelize-quote-highlight')).toBeNull();
    expect(getLocateResults()).toEqual([[
      expect.objectContaining({ requestId: 'locate-2', provider: 'deepseek', found: false }),
      EXTENSION_ORIGIN
    ]]);
  });

  it('matches implied block and br spaces while keeping adjacent inline CJK text together', () => {
    document.body.innerHTML = `
      <div class="ds-markdown">
        <p id="block-start">Intro</p>
        <p id="block-next">Target</p>
        <p id="line-break">Before<br>After</p>
        <p id="cjk"><span>中</span><span>文</span></p>
      </div>`;

    dispatchLocate({ type: 'PANELIZE_LOCATE_ANSWER_TEXT', requestId: 'block-boundary', anchor: 'Intro Target' });
    dispatchLocate({ type: 'PANELIZE_LOCATE_ANSWER_TEXT', requestId: 'br-boundary', anchor: 'Before After' });
    dispatchLocate({ type: 'PANELIZE_LOCATE_ANSWER_TEXT', requestId: 'inline-cjk', anchor: '中文' });

    expect(document.getElementById('block-start').classList.contains('panelize-quote-highlight')).toBe(true);
    expect(document.getElementById('line-break').classList.contains('panelize-quote-highlight')).toBe(true);
    expect(document.getElementById('cjk').classList.contains('panelize-quote-highlight')).toBe(true);
    expect(getLocateResults().map(([message]) => message.found)).toEqual([true, true, true]);
  });

  it('highlights and scrolls the answer root when its text has no listed block ancestor', () => {
    document.body.innerHTML = '<div class="ds-markdown" id="plain-answer">Plain response text</div>';
    const answer = document.getElementById('plain-answer');
    answer.scrollIntoView = vi.fn();

    dispatchLocate({ type: 'PANELIZE_LOCATE_ANSWER_TEXT', requestId: 'root-target', anchor: 'response text' });

    expect(answer.classList.contains('panelize-quote-highlight')).toBe(true);
    expect(answer.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(getLocateResults()[0][0]).toEqual(expect.objectContaining({ requestId: 'root-target', found: true }));
  });

  it('restarts highlight cleanup timing after a repeated locate request', () => {
    const paragraph = document.getElementById('quoted-paragraph');
    dispatchLocate({ type: 'PANELIZE_LOCATE_ANSWER_TEXT', requestId: 'repeat-1', anchor: 'quote spanning' });
    vi.advanceTimersByTime(2000);
    dispatchLocate({ type: 'PANELIZE_LOCATE_ANSWER_TEXT', requestId: 'repeat-2', anchor: 'quote spanning' });

    vi.advanceTimersByTime(500);
    expect(paragraph.classList.contains('panelize-quote-highlight')).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(paragraph.classList.contains('panelize-quote-highlight')).toBe(false);
  });

  it('returns found false for invalid anchors and when no answer exists', () => {
    dispatchLocate({ type: 'PANELIZE_LOCATE_ANSWER_TEXT', requestId: 'empty-anchor', anchor: '   ' });
    dispatchLocate({ type: 'PANELIZE_LOCATE_ANSWER_TEXT', requestId: 'non-string-anchor', anchor: 42 });
    dispatchLocate({ type: 'PANELIZE_LOCATE_ANSWER_TEXT', requestId: 'long-anchor', anchor: 'x'.repeat(2001) });
    document.body.replaceChildren();
    dispatchLocate({ type: 'PANELIZE_LOCATE_ANSWER_TEXT', requestId: 'missing-answer', anchor: 'answer' });

    expect(getLocateResults().map(([message]) => message.found)).toEqual([false, false, false, false]);
  });

  it.each([
    ['wrong message source', { source: {} }],
    ['wrong extension origin', { origin: 'https://provider-page.example' }]
  ])('ignores locate requests with the %s', (label, overrides) => {
    dispatchLocate({ type: 'PANELIZE_LOCATE_ANSWER_TEXT', requestId: 'locate-3', anchor: 'introduction' }, overrides);
    expect(getLocateResults()).toEqual([]);
    expect(document.querySelector('.panelize-quote-highlight')).toBeNull();
  });
});
