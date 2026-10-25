import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('content-scripts/text-injection-all-providers.js'), 'utf8');

describe('page width reporting during streaming', () => {
  let frame;
  let observers;
  let resizes;
  let styles;

  beforeEach(() => {
    vi.useFakeTimers();
    frame = new Window({ url: 'https://chatgpt.com/c/test', width: 500, height: 800 });
    const parent = { postMessage: vi.fn() };
    Object.defineProperty(frame, 'parent', { configurable: true, value: parent });
    Object.defineProperty(frame, 'top', { configurable: true, value: parent });
    frame.setTimeout = setTimeout;
    frame.clearTimeout = clearTimeout;
    observers = [];
    resizes = [];
    frame.MutationObserver = class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe = vi.fn();
      disconnect = vi.fn();
    };
    frame.ResizeObserver = class {
      constructor(callback) { this.callback = callback; resizes.push(this); }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
    styles = vi.fn(element => ({
      display: element.style.display || 'block',
      position: 'static',
      minWidth: element.style.minWidth || '0px',
      visibility: 'visible',
      overflowX: element.style.overflowX || 'visible',
      overflowY: element.style.overflowY || 'visible'
    }));
    frame.getComputedStyle = styles;
    frame.document.body.innerHTML = `
      <main style="min-width: 600px">
        <div data-message-author-role="assistant">Earlier text</div>
        <div id="transcript" style="overflow-y: auto"><p>Scrollable content</p></div>
      </main>`;
    frame.document.querySelector('main').getBoundingClientRect = () => ({
      left: 0, right: 600, width: 600, height: 800
    });
    frame.document.querySelector('[data-message-author-role]').getBoundingClientRect = () => ({
      left: 0, right: 500, width: 500, height: 200
    });
    frame.document.getElementById('transcript').getBoundingClientRect = () => ({
      left: 0, right: 500, width: 500, height: 200
    });
  });

  afterEach(() => {
    frame.dispatchEvent(new frame.Event('pagehide'));
    frame.happyDOM.abort();
    vi.useRealTimers();
  });

  function notify(record) {
    observers[0].callback([record]);
  }

  function reports() {
    return frame.parent.postMessage.mock.calls.map(([payload]) => payload)
      .filter(payload => payload.type === 'PANELIZE_PAGE_WIDTH');
  }

  it('avoids full layout scans for streamed text and excluded scrolling content, but follows shell changes', () => {
    frame.eval(source);
    vi.advanceTimersByTime(500);
    expect(reports()).toEqual([expect.objectContaining({ neededWidth: 600 })]);
    const initialReads = styles.mock.calls.length;
    const answer = frame.document.querySelector('[data-message-author-role]');
    for (let token = 0; token < 20; token += 1) {
      const oldText = answer.firstChild;
      answer.textContent = `Answer ${token}`;
      notify({ type: 'childList', target: answer, addedNodes: [answer.firstChild], removedNodes: [oldText] });
      notify({ type: 'attributes', target: frame.document.querySelector('#transcript p') });
      vi.advanceTimersByTime(500);
    }
    expect(styles).toHaveBeenCalledTimes(initialReads);

    const shell = frame.document.querySelector('main');
    shell.style.minWidth = '700px';
    notify({ type: 'attributes', target: shell });
    vi.advanceTimersByTime(500);
    expect(reports().at(-1)).toMatchObject({ neededWidth: 700 });
    expect(resizes[0].observe).toHaveBeenCalledWith(shell);
  });

  it('ignores height-only growth while detecting changes in observed widths', () => {
    frame.eval(source);
    vi.advanceTimersByTime(500);
    const shell = frame.document.querySelector('main');
    resizes[0].callback([{ target: shell, contentRect: { width: 600, height: 800 } }]);
    vi.advanceTimersByTime(500);
    const previousReads = styles.mock.calls.length;
    resizes[0].callback([{ target: shell, contentRect: { width: 600, height: 1000 } }]);
    vi.advanceTimersByTime(500);
    expect(styles).toHaveBeenCalledTimes(previousReads);
    resizes[0].callback([{ target: shell, contentRect: { width: 700, height: 1000 } }]);
    vi.advanceTimersByTime(500);
    expect(styles.mock.calls.length).toBeGreaterThan(previousReads);
  });

  it('coalesces separate removal and addition records for a streamed text replacement', () => {
    frame.eval(source);
    vi.advanceTimersByTime(500);
    const initialReads = styles.mock.calls.length;
    const answer = frame.document.querySelector('[data-message-author-role]');
    const oldText = answer.firstChild;
    answer.textContent = 'Streamed replacement';
    observers[0].callback([
      { type: 'childList', target: answer, addedNodes: [], removedNodes: [oldText] },
      { type: 'childList', target: answer, addedNodes: [answer.firstChild], removedNodes: [] }
    ]);
    vi.advanceTimersByTime(500);
    expect(styles).toHaveBeenCalledTimes(initialReads);
  });

  it('remeasures a batch of replacements whose final answer is empty', () => {
    frame.eval(source);
    vi.advanceTimersByTime(500);
    const initialReads = styles.mock.calls.length;
    const answer = frame.document.querySelector('[data-message-author-role]');
    const oldText = answer.firstChild;
    const temporaryText = frame.document.createTextNode('Intermediate output');
    answer.textContent = '';
    observers[0].callback([
      { type: 'childList', target: answer, addedNodes: [temporaryText], removedNodes: [oldText] },
      { type: 'childList', target: answer, addedNodes: [], removedNodes: [temporaryText] }
    ]);
    vi.advanceTimersByTime(500);
    expect(styles.mock.calls.length).toBeGreaterThan(initialReads);
  });

  it('measures the first text in an empty min-width answer and handles resize without ResizeObserver', () => {
    frame.ResizeObserver = undefined;
    const answer = frame.document.querySelector('[data-message-author-role]');
    answer.textContent = '';
    answer.style.minWidth = '800px';
    answer.getBoundingClientRect = () => ({
      left: 0, right: 800, width: 800, height: answer.textContent ? 200 : 0
    });
    frame.eval(source);
    vi.advanceTimersByTime(500);
    expect(reports().at(-1)).toMatchObject({ neededWidth: 600 });
    answer.textContent = 'First output';
    notify({ type: 'childList', target: answer, addedNodes: [answer.firstChild], removedNodes: [] });
    vi.advanceTimersByTime(500);
    expect(reports().at(-1)).toMatchObject({ neededWidth: 800 });
    const previousReads = styles.mock.calls.length;
    frame.dispatchEvent(new frame.Event('resize'));
    vi.advanceTimersByTime(500);
    expect(styles.mock.calls.length).toBeGreaterThan(previousReads);
  });

  it('detects text moving a min-width box without changing its size', () => {
    const shell = frame.document.querySelector('main');
    let left = 0;
    shell.getBoundingClientRect = () => ({ left, right: left + 600, width: 600, height: 800 });
    frame.eval(source);
    vi.advanceTimersByTime(500);
    expect(reports().at(-1)).toMatchObject({ neededWidth: 600 });

    const answer = frame.document.querySelector('[data-message-author-role]');
    const oldText = answer.firstChild;
    answer.textContent = 'Longer streamed answer shifts a sibling';
    left = 80;
    notify({ type: 'childList', target: answer, addedNodes: [answer.firstChild], removedNodes: [oldText] });
    vi.advanceTimersByTime(500);
    expect(reports().at(-1)).toMatchObject({ neededWidth: 680 });
  });

  it('disconnects pending work on pagehide and resumes reporting after pageshow', () => {
    frame.eval(source);
    frame.dispatchEvent(new frame.Event('pagehide'));
    vi.advanceTimersByTime(1000);
    expect(styles).not.toHaveBeenCalled();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(resizes[0].disconnect).toHaveBeenCalledOnce();
    frame.dispatchEvent(new frame.Event('pageshow'));
    vi.advanceTimersByTime(500);
    expect(reports().at(-1)).toMatchObject({ neededWidth: 600 });
  });
});
