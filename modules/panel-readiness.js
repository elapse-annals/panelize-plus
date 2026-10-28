export const PANELIZE_COMPOSER_READY = 'PANELIZE_COMPOSER_READY';
// Long enough for a slow provider page; a page that never shows a question
// box (e.g. signed out) stops holding Send after this.
export const PANEL_READY_TIMEOUT_MS = 20000;

export const PANEL_READY_STATE = Object.freeze({
  PENDING: 'pending',
  READY: 'ready',
  TIMEOUT: 'timeout'
});

/**
 * Groups panels by whether their provider page can take a question yet.
 *
 * @param {Array<{readyState?: string}>} panels - Current panels.
 * @returns {{total: number, ready: Array, pending: Array, notReady: Array}}
 *   Panels without a readyState count as ready.
 */
export function summarizePanelReadiness(panels) {
  const summary = { total: panels.length, ready: [], pending: [], notReady: [] };
  panels.forEach(panel => {
    if (panel.readyState === PANEL_READY_STATE.PENDING) summary.pending.push(panel);
    else if (panel.readyState === PANEL_READY_STATE.TIMEOUT) summary.notReady.push(panel);
    else summary.ready.push(panel);
  });
  return summary;
}

// Once this share of the AIs is ready, the rest stop holding Send: one stuck
// provider should not block the round.
export const PANEL_READY_SEND_RATIO = 0.8;

/**
 * Whether loading panels still hold Send: some are pending and fewer than
 * PANEL_READY_SEND_RATIO of all panels are ready (rounded up).
 *
 * @param {{total: number, ready: Array, pending: Array}} summary - From summarizePanelReadiness.
 * @returns {boolean}
 */
export function isSendHeldByReadiness(summary) {
  if (!summary?.pending?.length) return false;
  return summary.ready.length < Math.ceil(summary.total * PANEL_READY_SEND_RATIO);
}
