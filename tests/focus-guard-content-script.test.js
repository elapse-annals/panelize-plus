import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const contentScriptSource = readFileSync(
  resolve(process.cwd(), 'content-scripts/text-injection-all-providers.js'),
  'utf8'
);

function dispatchGuard(data, source = window.parent) {
  const event = new window.Event('message');
  Object.assign(event, {
    data: { context: 'multi-panel', type: 'PANELIZE_FOCUS_GUARD', ...data },
    origin: 'chrome-extension://panelize-test',
    source
  });
  window.dispatchEvent(event);
}

function trusted(event) {
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

function typeKey(target, key, init = {}) {
  const event = trusted(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  target.dispatchEvent(event);
  return event;
}

function sentMessages(type) {
  return window.parent.postMessage.mock.calls.map(([message]) => message).filter(message => message?.type === type);
}

describe('host focus guard in provider frames', () => {
  beforeAll(() => {
    window.chrome = { runtime: { getURL: () => 'chrome-extension://panelize-test/' } };
    window.eval(contentScriptSource);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    window.happyDOM.setURL('https://chatgpt.com/');
    document.body.innerHTML = '<textarea id="prompt-textarea"></textarea>';
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: vi.fn() }
    });
  });

  afterEach(() => {
    dispatchGuard({ active: false });
    vi.useRealTimers();
  });

  it('sends stolen keys back to the host instead of typing them, and drops Enter', () => {
    dispatchGuard({ active: true, requestId: 'guard-1', durationMs: 8000 });
    const input = document.getElementById('prompt-textarea');
    const typed = ['h', 'i', 'Backspace', 'Enter'].map(key => typeKey(input, key));
    expect(typed.every(event => event.defaultPrevented)).toBe(true);
    // Shortcuts and IME stay with the page's own handlers.
    expect(typeKey(input, 'k', { metaKey: true }).defaultPrevented).toBe(false);
    expect(typeKey(input, 'a', { isComposing: true }).defaultPrevented).toBe(false);

    vi.advanceTimersByTime(0);
    expect(sentMessages('PANELIZE_FORWARD_KEYS')).toEqual([expect.objectContaining({
      requestId: 'guard-1', provider: 'chatgpt', keys: 'hi\b', context: 'multi-panel-provider-status'
    })]);
  });

  it('ends on a click in the frame and reports it so the host keeps focus here', () => {
    dispatchGuard({ active: true, requestId: 'guard-2', durationMs: 8000 });
    document.body.dispatchEvent(trusted(new PointerEvent('pointerdown', { bubbles: true })));
    expect(sentMessages('PANELIZE_PROVIDER_USER_INTERACTION')).toEqual([
      expect.objectContaining({ requestId: 'guard-2', provider: 'chatgpt' })
    ]);
    expect(typeKey(document.getElementById('prompt-textarea'), 'x').defaultPrevented).toBe(false);
  });

  it('expires on its own and ignores guards not sent by the host', () => {
    dispatchGuard({ active: true, requestId: 'guard-3', durationMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(typeKey(document.body, 'x').defaultPrevented).toBe(false);

    dispatchGuard({ active: true, requestId: 'guard-4', durationMs: 8000 }, window);
    expect(typeKey(document.body, 'x').defaultPrevented).toBe(false);
  });
});
