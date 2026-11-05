/**
 * Owns rating behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import {
  RATING_PROMPT_ACTIONS,
  RATING_PROMPT_REVIEW_URL,
  countSuccessfulSend,
  loadRatingPromptState,
  saveRatingPromptAction,
  shouldShowRatingPrompt
} from '../../modules/platform/rating-prompt.js';

export function createRatingController() {
  // ===== Store Rating Prompt =====

  function setRatingBannerVisible(visible) {
    const banner = document.getElementById('rating-banner');
    if (banner) {
      banner.hidden = !visible;
    }
  }

  async function refreshRatingBanner(state) {
    try {
      setRatingBannerVisible(shouldShowRatingPrompt(state || await loadRatingPromptState()));
    } catch (error) {
      console.warn('[Multi-Panel] Failed to load rating prompt state:', error);
    }
  }

  // Counting is best effort: a storage failure must never affect sending.
  function recordSendForRatingPrompt() {
    countSuccessfulSend()
      .then(refreshRatingBanner)
      .catch(error => console.warn('[Multi-Panel] Failed to count send for rating prompt:', error));
  }

  async function answerRatingPrompt(action) {
    setRatingBannerVisible(false);
    try {
      if (action === RATING_PROMPT_ACTIONS.RATE) {
        await chrome.tabs.create({ url: RATING_PROMPT_REVIEW_URL });
      }
      await saveRatingPromptAction(action);
    } catch (error) {
      console.warn('[Multi-Panel] Failed to save rating prompt answer:', error);
    }
  }

  function setupRatingPrompt() {
    const buttons = {
      'rating-rate-btn': RATING_PROMPT_ACTIONS.RATE,
      'rating-later-btn': RATING_PROMPT_ACTIONS.LATER,
      'rating-never-btn': RATING_PROMPT_ACTIONS.NEVER
    };
    Object.entries(buttons).forEach(([id, action]) => {
      document.getElementById(id)?.addEventListener('click', () => answerRatingPrompt(action));
    });
    refreshRatingBanner();
  }

  return {
    recordSendForRatingPrompt,
    setupRatingPrompt,
  };
}
