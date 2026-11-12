import { describe, expect, it } from 'vitest';
import {
  clearFreshChat,
  createFreshChatState,
  isFreshChatUsable,
  markFreshChatCompleted,
  markSendCompleted,
  panelSignature
} from '../../../modules/panels/new-chat-freshness.js';

const PANELS = [
  { id: 'p1', providerId: 'chatgpt' },
  { id: 'p2', providerId: 'deepseek' }
];

describe('new chat freshness', () => {
  it('builds a stable signature for the current panel arrangement', () => {
    expect(panelSignature(PANELS)).toBe('p1:chatgpt|p2:deepseek');
    expect(panelSignature([])).toBe('');
  });

  it('is usable only after every targeted panel confirmed the reset', () => {
    const state = createFreshChatState();
    expect(markFreshChatCompleted(state, {
      panels: PANELS,
      results: [{ ok: true }, { ok: false }]
    })).toBe(false);
    expect(isFreshChatUsable(state, PANELS)).toBe(false);

    markFreshChatCompleted(state, {
      panels: PANELS,
      results: [{ ok: true }, { ok: true }]
    });
    expect(isFreshChatUsable(state, PANELS)).toBe(true);
  });

  it('is invalidated by a changed panel setup or an empty result list', () => {
    const state = createFreshChatState();
    markFreshChatCompleted(state, { panels: PANELS, results: [{ ok: true }, { ok: true }] });
    expect(isFreshChatUsable(state, [PANELS[0]])).toBe(false);
    expect(isFreshChatUsable(state, [...PANELS, { id: 'p3', providerId: 'gemini' }])).toBe(false);

    markFreshChatCompleted(state, { panels: [], results: [] });
    expect(isFreshChatUsable(state, [])).toBe(false);
  });

  it('is consumed by a send and can be cleared on failure', () => {
    const state = createFreshChatState();
    markFreshChatCompleted(state, { panels: PANELS, results: [{ ok: true }, { ok: true }] });
    markSendCompleted(state);
    expect(isFreshChatUsable(state, PANELS)).toBe(false);

    markFreshChatCompleted(state, { panels: PANELS, results: [{ ok: true }, { ok: true }] });
    clearFreshChat(state);
    expect(isFreshChatUsable(state, PANELS)).toBe(false);
    expect(state.signature).toBe('');
  });
});