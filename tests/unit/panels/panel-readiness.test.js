import { describe, expect, it } from 'vitest';
import { PANEL_ACTIVITY, PANEL_READY_STATE, getPanelActivity, isSendHeldByReadiness, summarizePanelReadiness } from '../../../modules/panels/panel-readiness.js';

describe('summarizePanelReadiness', () => {
  it('groups panels by ready state', () => {
    const panels = [
      { id: 'a', readyState: PANEL_READY_STATE.READY },
      { id: 'b', readyState: PANEL_READY_STATE.PENDING },
      { id: 'c', readyState: PANEL_READY_STATE.TIMEOUT },
      { id: 'd', readyState: PANEL_READY_STATE.PENDING }
    ];

    const summary = summarizePanelReadiness(panels);

    expect(summary.total).toBe(4);
    expect(summary.ready.map(panel => panel.id)).toEqual(['a']);
    expect(summary.pending.map(panel => panel.id)).toEqual(['b', 'd']);
    expect(summary.notReady.map(panel => panel.id)).toEqual(['c']);
  });

  it('counts panels without a state as ready', () => {
    const summary = summarizePanelReadiness([{ id: 'a' }]);

    expect(summary.ready).toHaveLength(1);
    expect(summary.pending).toHaveLength(0);
  });

  it('handles no panels', () => {
    expect(summarizePanelReadiness([])).toEqual({ total: 0, ready: [], pending: [], notReady: [] });
  });
});

describe('isSendHeldByReadiness', () => {
  const panelsWith = (ready, pending, timeout = 0) => [
    ...Array.from({ length: ready }, () => ({ readyState: PANEL_READY_STATE.READY })),
    ...Array.from({ length: pending }, () => ({ readyState: PANEL_READY_STATE.PENDING })),
    ...Array.from({ length: timeout }, () => ({ readyState: PANEL_READY_STATE.TIMEOUT }))
  ];
  const held = (...counts) => isSendHeldByReadiness(summarizePanelReadiness(panelsWith(...counts)));

  it('releases Send once 70% of the AIs are ready, rounded up', () => {
    const heldFor = (total, ready) => held(ready, total - ready);
    // ceil(total × 0.7): 4 needs 3, 5 needs 4, 7 needs 5, 10 needs 7.
    [[4, 3], [5, 4], [7, 5], [10, 7]].forEach(([total, needed]) => {
      expect(heldFor(total, needed)).toBe(false);
      expect(heldFor(total, needed - 1)).toBe(true);
    });
  });

  it('needs every AI when 70% rounds up to all of them', () => {
    expect(held(2, 1)).toBe(true);
    expect(held(1, 1)).toBe(true);
  });

  it('does not hold without pending AIs, even when some timed out', () => {
    expect(held(1, 0, 3)).toBe(false);
    expect(held(0, 0)).toBe(false);
  });
});

describe('getPanelActivity', () => {
  const ready = { readyState: PANEL_READY_STATE.READY };
  const answer = status => ({ timed: true, status });

  it('shows a loading page as preparing, even with an answer', () => {
    expect(getPanelActivity({ readyState: PANEL_READY_STATE.PENDING }, answer('complete'))).toBe(PANEL_ACTIVITY.PREPARING);
  });

  it('follows a timed answer in the latest round', () => {
    expect(getPanelActivity(ready, answer('pending'))).toBe(PANEL_ACTIVITY.RUNNING);
    expect(getPanelActivity(ready, answer('complete'))).toBe(PANEL_ACTIVITY.DONE);
    expect(getPanelActivity(ready, answer('timeout'))).toBe(PANEL_ACTIVITY.STALLED);
  });

  it('shows nothing for untimed or cancelled answers', () => {
    expect(getPanelActivity(ready, { timed: false, status: 'pending' })).toBe(PANEL_ACTIVITY.IDLE);
    expect(getPanelActivity(ready, answer('cancelled'))).toBe(PANEL_ACTIVITY.IDLE);
    expect(getPanelActivity(ready, null)).toBe(PANEL_ACTIVITY.IDLE);
    expect(getPanelActivity({}, null)).toBe(PANEL_ACTIVITY.IDLE);
  });

  it('marks a page that never got ready unless it answered', () => {
    const timedOut = { readyState: PANEL_READY_STATE.TIMEOUT };
    expect(getPanelActivity(timedOut, null)).toBe(PANEL_ACTIVITY.NOT_READY);
    expect(getPanelActivity(timedOut, answer('complete'))).toBe(PANEL_ACTIVITY.DONE);
  });
});
