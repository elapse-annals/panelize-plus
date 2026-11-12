/**
 * Owns the single composer status line shared by new-chat and readiness
 * updates: one highest-priority message, one auto-hide timer, one dismissal.
 */

export const COMPOSER_STATUS_PRIORITY = Object.freeze({
  NEW_CHAT_HOLD: 1,
  READINESS_HOLD: 2,
  NEW_CHAT_FAILURE: 3,
  READINESS_INFO: 4,
  DONE: 5
});

export function createComposerStatusController() {
  // Each source keeps its latest candidate; only the highest-priority one renders.
  const statusesBySource = new Map();

  // A dismissed or auto-hidden key stays hidden until its source reports a new key.
  const dismissedKeyBySource = new Map();

  let hideTimerId = null;

  let current = null;

  let updateSequence = 0;

  function clearHideTimer() {
    if (hideTimerId !== null) {
      clearTimeout(hideTimerId);
      hideTimerId = null;
    }
  }

  function pickWinner() {
    let winner = null;
    for (const [source, status] of statusesBySource) {
      if (!winner
        || status.priority < winner.status.priority
        || (status.priority === winner.status.priority && status.sequence > winner.status.sequence)) {
        winner = { source, status };
      }
    }
    return winner;
  }

  function hideRow(row, text, retry) {
    current = null;
    row.hidden = true;
    row.title = '';
    text.textContent = '';
    if (retry) retry.hidden = true;
  }

  function render() {
    const row = document.getElementById('composer-status-row');
    const text = document.getElementById('composer-status-text');
    const retry = document.getElementById('retry-new-chat-btn');
    if (!row || !text) return;

    const winner = pickWinner();
    if (!winner) {
      clearHideTimer();
      hideRow(row, text, retry);
      return;
    }

    const { source, status } = winner;
    const changed = !current || current.source !== source || current.key !== status.key;
    if (changed) {
      clearHideTimer();
      current = { source, key: status.key };
    }

    if (dismissedKeyBySource.get(source) === status.key) {
      hideRow(row, text, retry);
      return;
    }

    row.hidden = false;
    row.title = status.text;
    text.textContent = status.text;
    if (retry) retry.hidden = status.showRetry !== true;

    if (changed && status.autoHideMs > 0) {
      hideTimerId = setTimeout(() => {
        hideTimerId = null;
        if (!current || current.source !== source || current.key !== status.key) return;
        // Auto-hidden feedback expires; the next source can take over. The key
        // stays dismissed so an unchanged re-render does not bring it back.
        dismissedKeyBySource.set(source, status.key);
        statusesBySource.delete(source);
        current = null;
        render();
      }, status.autoHideMs);
    }
  }

  /**
   * Publishes a source's candidate status, or clears it when status is null.
   * status: { key, priority, text, showRetry?, autoHideMs? }
   */
  function setStatus(source, status) {
    if (!status) {
      clearStatus(source);
      return;
    }

    updateSequence += 1;
    const next = { ...status, sequence: updateSequence };
    const previous = statusesBySource.get(source);
    // A new key starts a new status cycle and lifts an earlier dismissal.
    if (previous && previous.key !== next.key) dismissedKeyBySource.delete(source);
    statusesBySource.set(source, next);
    render();
  }

  function clearStatus(source) {
    const previous = statusesBySource.get(source);
    if (!previous) return;
    statusesBySource.delete(source);
    if (current?.source === source) current = null;
    render();
  }

  function dismiss() {
    if (!current) return;
    dismissedKeyBySource.set(current.source, current.key);
    clearHideTimer();
    render();
  }

  return {
    clearStatus,
    dismiss,
    getCurrentStatus: () => (current ? { ...current } : null),
    setStatus
  };
}
