import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NEW_CHAT_RESULT_TIMEOUT_MS,
  PANELIZE_NEW_CHAT_RESULT,
  PANEL_NEW_CHAT_RESULT_CONTEXT,
  createNewChatResultWaiter,
  isMatchingNewChatResult,
  runNewChatBatch,
  summarizeNewChatResults
} from '../modules/new-chat-actions.js';

function createPanel(id = 'panel-1', providerId = 'grok') {
  const contentWindow = { postMessage: vi.fn() };
  return {
    panel: { id, providerId, iframe: { contentWindow } },
    contentWindow
  };
}

function createResultMessage(source, overrides = {}, origin = '') {
  return new MessageEvent('message', {
    source,
    origin,
    data: {
      type: PANELIZE_NEW_CHAT_RESULT,
      context: PANEL_NEW_CHAT_RESULT_CONTEXT,
      requestId: 'request-current',
      panelId: 'panel-1',
      provider: 'grok',
      status: 'verified',
      ...overrides
    }
  });
}

describe('new chat result protocol', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts only a verified result from the expected iframe, panel and request', () => {
    const { panel, contentWindow } = createPanel();
    expect(isMatchingNewChatResult(createResultMessage(contentWindow), panel, 'request-current')).toBe(true);
    expect(isMatchingNewChatResult(createResultMessage({}), panel, 'request-current')).toBe(false);
    expect(isMatchingNewChatResult(
      createResultMessage(contentWindow, { requestId: 'stale' }), panel, 'request-current'
    )).toBe(false);
    expect(isMatchingNewChatResult(
      createResultMessage(contentWindow, { panelId: 'another-panel' }), panel, 'request-current'
    )).toBe(false);
    expect(isMatchingNewChatResult(
      createResultMessage(contentWindow, { status: 'started' }), panel, 'request-current'
    )).toBe(false);
  });

  it('checks the iframe URL origin when available and keeps originless mocks compatible', async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const { panel, contentWindow } = createPanel('panel-origin', 'grok');
    panel.iframe.src = 'https://grok.com/';
    const waiter = createNewChatResultWaiter({ target, panel, requestId: 'request-current', timeoutMs: 1000 });

    target.dispatchEvent(createResultMessage(contentWindow, { panelId: panel.id }, 'https://evil.test'));
    await vi.advanceTimersByTimeAsync(50);
    target.dispatchEvent(createResultMessage(contentWindow, { panelId: panel.id }, 'https://grok.com'));

    await expect(waiter.promise).resolves.toMatchObject({ status: 'verified', panelId: 'panel-origin' });

    const { panel: mockPanel, contentWindow: mockWindow } = createPanel('panel-mock', 'grok');
    expect(isMatchingNewChatResult(
      createResultMessage(mockWindow, { panelId: mockPanel.id }),
      mockPanel,
      'request-current'
    )).toBe(true);
  });

  it('ignores stale ACKs and resolves only after the matching result arrives', async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const { panel, contentWindow } = createPanel();
    const waiter = createNewChatResultWaiter({ target, panel, requestId: 'request-current', timeoutMs: 1000 });

    target.dispatchEvent(createResultMessage(contentWindow, { requestId: 'request-stale' }));
    await vi.advanceTimersByTimeAsync(100);
    target.dispatchEvent(createResultMessage(contentWindow));

    await expect(waiter.promise).resolves.toEqual({
      ok: true,
      panelId: 'panel-1',
      provider: 'grok',
      status: 'verified'
    });
  });

  it('returns unconfirmed after the result timeout', async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const { panel } = createPanel();
    const waiter = createNewChatResultWaiter({ target, panel, requestId: 'request-current', timeoutMs: 500 });

    await vi.advanceTimersByTimeAsync(500);

    await expect(waiter.promise).resolves.toMatchObject({
      ok: false,
      status: 'unconfirmed',
      reason: 'confirmation-timeout'
    });
  });

  it('installs all waiters before dispatch and summarizes verified results', async () => {
    const target = new EventTarget();
    const { panel, contentWindow } = createPanel('panel-grok', 'grok');
    const { panel: deepseekPanel, contentWindow: deepseekWindow } = createPanel('panel-deepseek', 'deepseek');
    const dispatch = vi.fn((currentPanel, message) => {
      expect(message).toMatchObject({
        type: 'NEW_CHAT',
        context: 'multi-panel',
        requestId: 'batch-1',
        panelId: currentPanel.id,
        provider: currentPanel.providerId
      });
      expect(message.providerMode).toBe(currentPanel.providerId === 'grok' ? 'private' : undefined);
      expect(currentPanel.iframe.contentWindow.postMessage).not.toHaveBeenCalled();
      target.dispatchEvent(createResultMessage(
        currentPanel.iframe.contentWindow,
        { requestId: 'batch-1', panelId: currentPanel.id, provider: currentPanel.providerId }
      ));
    });

    const batch = await runNewChatBatch({
      target,
      panels: [panel, deepseekPanel],
      requestId: 'batch-1',
      providerModes: { grok: 'private' },
      dispatch
    });

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(batch.results.map(result => result.status)).toEqual(['verified', 'verified']);
    expect(batch.summary).toEqual({ verifiedCount: 2, failedCount: 0, unconfirmedCount: 0, total: 2 });
    expect(contentWindow.postMessage).not.toHaveBeenCalled();
    expect(deepseekWindow.postMessage).not.toHaveBeenCalled();
  });

  it('short-circuits missing iframes and reports dispatch failures', async () => {
    const target = new EventTarget();
    const { panel } = createPanel('panel-ok', 'grok');
    const missingFrame = { id: 'panel-missing', providerId: 'claude', iframe: null };
    const batch = await runNewChatBatch({
      target,
      panels: [missingFrame, panel],
      requestId: 'batch-errors',
      timeoutMs: 1000,
      dispatch: () => { throw new Error('frame disappeared'); }
    });

    expect(batch.results).toEqual([
      {
        ok: false,
        panelId: 'panel-missing',
        provider: 'claude',
        status: 'unconfirmed',
        reason: 'missing-iframe'
      },
      {
        ok: false,
        panelId: 'panel-ok',
        provider: 'grok',
        status: 'failed',
        reason: 'dispatch-error'
      }
    ]);
    expect(batch.summary).toEqual({ verifiedCount: 0, failedCount: 1, unconfirmedCount: 1, total: 2 });
  });

  it('classifies unknown and missing results as unconfirmed in summaries', () => {
    expect(summarizeNewChatResults([
      { status: 'verified' },
      { status: 'failed' },
      { status: 'unconfirmed' },
      {}
    ])).toEqual({ verifiedCount: 1, failedCount: 1, unconfirmedCount: 2, total: 4 });
    expect(NEW_CHAT_RESULT_TIMEOUT_MS).toBeGreaterThan(10000);
  });
});
