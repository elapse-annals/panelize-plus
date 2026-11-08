// Shared lookup for ChatGPT's main composer, used by every ChatGPT content script.
// Loaded before the other ChatGPT scripts (see manifest.json), so they can read
// window.PanelizeChatgptComposer when they need the composer.

(function() {
  'use strict';

  // Current composer first; `#prompt-textarea` is the legacy layout, still
  // served to some accounts.
  const EDITOR_SELECTORS = Object.freeze([
    'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"]',
    '#prompt-textarea'
  ]);

  function isRendered(element) {
    return element.offsetParent !== null && element.getAttribute('aria-hidden') !== 'true';
  }

  function isEditor(element) {
    return Boolean(element?.matches) && EDITOR_SELECTORS.some(selector => element.matches(selector));
  }

  // A send must never target an editor the user cannot see: ChatGPT keeps
  // previous composers in the DOM after moving from home to a thread, and some
  // of them are only hidden with visibility/opacity rather than display.
  function isVisibleEditor(element) {
    if (!element?.isConnected || isEditor(element) === false) {
      return false;
    }
    if (element.getAttribute('aria-hidden') === 'true' || element.closest('[aria-hidden="true"]')) {
      return false;
    }

    try {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
    } catch {
      // Some test DOMs do not implement computed styles for detached nodes.
    }

    // happy-dom has no layout; there offsetParent is undefined and every rect
    // is empty, so tests control visibility through offsetParent instead.
    const hasLayout = element.offsetParent !== undefined;
    if (hasLayout) {
      try {
        if (typeof element.checkVisibility === 'function'
          && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
          return false;
        }
      } catch {
        // Older environments may not accept the options object.
      }
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }
    } else if (element.offsetParent === null) {
      return false;
    }
    return true;
  }

  // ChatGPT can keep more than one composer in the DOM (for example per
  // placement), so prefer a rendered one over whichever comes first.
  function findEditor() {
    let firstMatch = null;
    for (const selector of EDITOR_SELECTORS) {
      for (const element of document.querySelectorAll(selector)) {
        if (isRendered(element)) {
          return element;
        }
        firstMatch = firstMatch || element;
      }
    }
    return firstMatch;
  }

  // Send paths need a composer the user can actually see. Prefer the thread
  // placement when both are visible, otherwise take the lowest one: ChatGPT's
  // active composer sits at the bottom of the conversation.
  function findVisibleEditor() {
    const seen = new Set();
    const candidates = [];
    for (const selector of EDITOR_SELECTORS) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
        if (isVisibleEditor(element)) {
          candidates.push(element);
        }
      }
    }
    if (candidates.length <= 1) {
      return candidates[0] || null;
    }

    const thread = candidates.find(element => element.closest('form[data-composer-placement="thread"]'));
    if (thread) {
      return thread;
    }
    return candidates.reduce((lowest, element) => {
      const lowestRect = lowest.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return rect.top > lowestRect.top ? element : lowest;
    }, candidates[0]);
  }

  // The form holding `editor`, where its own send button lives.
  function findForm(editor = findEditor()) {
    return editor?.closest('form') || null;
  }

  window.PanelizeChatgptComposer = Object.freeze({
    EDITOR_SELECTORS,
    isEditor,
    isRendered,
    isVisibleEditor,
    findEditor,
    findVisibleEditor,
    findForm
  });
})();
