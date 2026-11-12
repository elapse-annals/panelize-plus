import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPOSER_STATUS_PRIORITY,
  createComposerStatusController
} from '../../../multi-panel/controllers/composer-status.js';

function mountStatusBar() {
  document.body.innerHTML = `
    <div id="composer-status-row" hidden>
      <span id="composer-status-text"></span>
      <button id="retry-new-chat-btn" hidden></button>
      <button id="dismiss-composer-status-btn"></button>
    </div>
  `;
}

const row = () => document.getElementById('composer-status-row');
const text = () => document.getElementById('composer-status-text');
const retry = () => document.getElementById('retry-new-chat-btn');

describe('composer status controller', () => {
  let controller;

  beforeEach(() => {
    vi.useFakeTimers();
    mountStatusBar();
    controller = createComposerStatusController();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows only the highest-priority status and falls back when it clears', () => {
    controller.setStatus('readiness', {
      key: 'readiness-progress',
      priority: COMPOSER_STATUS_PRIORITY.READINESS_INFO,
      text: '1/2 AIs ready'
    });
    expect(row().hidden).toBe(false);
    expect(text().textContent).toBe('1/2 AIs ready');

    controller.setStatus('new-chat', {
      key: 'new-chat-hold',
      priority: COMPOSER_STATUS_PRIORITY.NEW_CHAT_HOLD,
      text: 'Starting new conversations'
    });
    expect(text().textContent).toBe('Starting new conversations');

    controller.clearStatus('new-chat');
    expect(text().textContent).toBe('1/2 AIs ready');
    expect(row().hidden).toBe(false);
  });

  it('breaks equal priorities by the latest update', () => {
    controller.setStatus('new-chat', {
      key: 'new-chat-done',
      priority: COMPOSER_STATUS_PRIORITY.DONE,
      text: 'New conversations ready'
    });
    controller.setStatus('readiness', {
      key: 'readiness-done',
      priority: COMPOSER_STATUS_PRIORITY.DONE,
      text: 'All AIs ready'
    });

    expect(text().textContent).toBe('All AIs ready');
  });

  it('keeps actionable failures visible with the retry button', () => {
    controller.setStatus('new-chat', {
      key: 'new-chat-failure',
      priority: COMPOSER_STATUS_PRIORITY.NEW_CHAT_FAILURE,
      text: '2 confirmed; not confirmed: Grok',
      showRetry: true
    });

    expect(row().hidden).toBe(false);
    expect(retry().hidden).toBe(false);
    expect(row().title).toBe('2 confirmed; not confirmed: Grok');

    vi.advanceTimersByTime(30000);
    expect(row().hidden).toBe(false);
    expect(retry().hidden).toBe(false);
  });

  it('auto-hides partial-not-ready feedback after its delay and dismisses that key', () => {
    controller.setStatus('readiness', {
      key: 'readiness-not-ready',
      priority: COMPOSER_STATUS_PRIORITY.READINESS_INFO,
      text: '1/2 AIs ready. Not ready: Gemini',
      autoHideMs: 7000
    });
    expect(row().hidden).toBe(false);

    vi.advanceTimersByTime(6999);
    expect(row().hidden).toBe(false);

    vi.advanceTimersByTime(1);
    expect(row().hidden).toBe(true);
    expect(text().textContent).toBe('');
    expect(row().title).toBe('');

    // The same cycle stays hidden on an incidental re-render...
    controller.setStatus('readiness', {
      key: 'readiness-not-ready',
      priority: COMPOSER_STATUS_PRIORITY.READINESS_INFO,
      text: '1/2 AIs ready. Not ready: Gemini',
      autoHideMs: 7000
    });
    expect(row().hidden).toBe(true);

    // ...and a new cycle (which passes through the hold key) can show it again.
    controller.setStatus('readiness', {
      key: 'readiness-hold',
      priority: COMPOSER_STATUS_PRIORITY.READINESS_HOLD,
      text: 'Preparing AIs'
    });
    expect(row().hidden).toBe(false);

    controller.setStatus('readiness', {
      key: 'readiness-not-ready',
      priority: COMPOSER_STATUS_PRIORITY.READINESS_INFO,
      text: 'Still not ready: Gemini'
    });
    expect(row().hidden).toBe(false);
    expect(text().textContent).toBe('Still not ready: Gemini');
  });

  it('cancels the previous auto-hide timer when a higher-priority status arrives', () => {
    controller.setStatus('new-chat', {
      key: 'new-chat-done',
      priority: COMPOSER_STATUS_PRIORITY.DONE,
      text: 'New conversations ready',
      autoHideMs: 4000
    });

    vi.advanceTimersByTime(2000);
    controller.setStatus('readiness', {
      key: 'readiness-hold',
      priority: COMPOSER_STATUS_PRIORITY.READINESS_HOLD,
      text: 'Preparing AIs'
    });

    vi.advanceTimersByTime(10000);
    expect(row().hidden).toBe(false);
    expect(text().textContent).toBe('Preparing AIs');
  });

  it('lets a lower-priority status through once expired feedback auto-hides', () => {
    controller.setStatus('new-chat', {
      key: 'new-chat-done',
      priority: COMPOSER_STATUS_PRIORITY.DONE,
      text: 'New conversations ready',
      autoHideMs: 4000
    });
    vi.advanceTimersByTime(4000);
    expect(row().hidden).toBe(true);

    controller.setStatus('readiness', {
      key: 'readiness-not-ready',
      priority: COMPOSER_STATUS_PRIORITY.READINESS_INFO,
      text: '1/2 AIs ready. Not ready: Gemini',
      autoHideMs: 7000
    });
    expect(row().hidden).toBe(false);
    expect(text().textContent).toContain('Not ready');
  });

  it('keeps a manually dismissed status hidden until its source starts a new key', () => {
    controller.setStatus('readiness', {
      key: 'readiness-not-ready',
      priority: COMPOSER_STATUS_PRIORITY.READINESS_INFO,
      text: 'Not ready: Gemini',
      autoHideMs: 7000
    });
    controller.dismiss();

    expect(row().hidden).toBe(true);
    expect(text().textContent).toBe('');
    expect(row().title).toBe('');

    controller.setStatus('readiness', {
      key: 'readiness-not-ready',
      priority: COMPOSER_STATUS_PRIORITY.READINESS_INFO,
      text: 'Not ready: Gemini (updated)'
    });
    expect(row().hidden).toBe(true);

    controller.setStatus('readiness', {
      key: 'readiness-hold',
      priority: COMPOSER_STATUS_PRIORITY.READINESS_HOLD,
      text: 'Preparing AIs'
    });
    expect(row().hidden).toBe(false);
    expect(text().textContent).toBe('Preparing AIs');
  });

  it('clears the row when the last status source clears', () => {
    controller.setStatus('readiness', {
      key: 'readiness-hold',
      priority: COMPOSER_STATUS_PRIORITY.READINESS_HOLD,
      text: 'Preparing AIs'
    });
    controller.clearStatus('readiness');

    expect(row().hidden).toBe(true);
    expect(text().textContent).toBe('');
    expect(row().title).toBe('');
    expect(retry().hidden).toBe(true);
    expect(controller.getCurrentStatus()).toBeNull();
  });
});
