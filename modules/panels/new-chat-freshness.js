// Tracks whether the current panels are already sitting in freshly-created
// conversations. A fresh set is reusable for exactly one send; changing the
// panel setup invalidates it. The desktop client never decides this alone —
// it always asks for a new chat and this state prevents a double reset.

/** Identifies the current panel arrangement. */
export function panelSignature(panels) {
  return (Array.isArray(panels) ? panels : [])
    .filter(Boolean)
    .map(panel => `${panel.id || ''}:${panel.providerId || ''}`)
    .join('|');
}

export function createFreshChatState() {
  return { signature: '', fresh: false };
}

/**
 * Marks the panels fresh only when every targeted panel confirmed the reset.
 * `results` are the provider acknowledgements from runNewChatBatch.
 */
export function markFreshChatCompleted(state, { panels, results } = {}) {
  const list = Array.isArray(results) ? results : [];
  const allVerified = list.length > 0 && list.every(result => result?.ok === true);
  state.signature = panelSignature(panels);
  state.fresh = allVerified;
  return state.fresh;
}

export function isFreshChatUsable(state, panels) {
  return Boolean(state?.fresh) && state.signature === panelSignature(panels);
}

export function markSendCompleted(state) {
  state.fresh = false;
  return state;
}

export function clearFreshChat(state) {
  state.fresh = false;
  state.signature = '';
  return state;
}