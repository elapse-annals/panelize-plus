import { ANSWER_STATUS } from '../answers/answer-stats.js';

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
// provider should not block the round. The macOS client uses the same ratio,
// so sending from either surface waits for the same number of AIs.
export const PANEL_READY_SEND_RATIO = 0.7;

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

// What a panel's tab chip shows: loading, answering, finished, or a problem.
export const PANEL_ACTIVITY = Object.freeze({
  IDLE: 'idle',
  PREPARING: 'preparing',
  NOT_READY: 'not-ready',
  RUNNING: 'running',
  DONE: 'done',
  STALLED: 'stalled'
});

const ANSWER_ACTIVITY = {
  [ANSWER_STATUS.PENDING]: PANEL_ACTIVITY.RUNNING,
  [ANSWER_STATUS.COMPLETE]: PANEL_ACTIVITY.DONE,
  [ANSWER_STATUS.TIMEOUT]: PANEL_ACTIVITY.STALLED
};

/**
 * The activity a panel's tab chip shows. A loading page wins; then the
 * panel's answer in the latest round, when its provider reports timing
 * (untimed answers show nothing); then a page that never got ready.
 *
 * @param {{readyState?: string}} panel - The panel.
 * @param {{timed?: boolean, status?: string}|null} answer - The panel's answer
 *   in the latest round, or null when the panel is not in it.
 * @returns {string} A PANEL_ACTIVITY value.
 */
export function getPanelActivity(panel, answer) {
  if (panel?.readyState === PANEL_READY_STATE.PENDING) return PANEL_ACTIVITY.PREPARING;
  const answerActivity = answer?.timed ? ANSWER_ACTIVITY[answer.status] : null;
  if (answerActivity) return answerActivity;
  if (panel?.readyState === PANEL_READY_STATE.TIMEOUT) return PANEL_ACTIVITY.NOT_READY;
  return PANEL_ACTIVITY.IDLE;
}
