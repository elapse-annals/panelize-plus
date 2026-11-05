/**
 * Owns question history behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { findQuestionHistoryMatches, loadQuestionHistory, recordQuestion } from '../../modules/prompts/question-history.js';
import { isAnyModalOpen } from './ui.js';

export function createQuestionHistoryController({
  getAttachmentsController,
  getPromptsController
}) {
  // Recently sent questions, newest first; offered above the input when the
  // draft is a prefix of one. Stored locally, never synced.
  let questionHistoryEntries = [];

  let questionHistoryMatches = [];

  let questionHistoryIndex = -1;

  let questionHistorySuppressed = false;

  // ===== Recent question suggestions =====
  function questionHistoryElement() {
    return document.getElementById('question-history');
  }

  function canShowQuestionHistory(input) {
    return Boolean(
      input
      && document.activeElement === input
      && input.selectionStart === input.selectionEnd
      && getAttachmentsController().uploadedImages.length === 0
      && !isAnyModalOpen()
      // The inline trigger-word completion owns the caret while it shows.
      && !document.querySelector('#prompt-ghost .prompt-ghost-completion')
    );
  }

  function renderQuestionHistory() {
    const list = questionHistoryElement();
    const input = document.getElementById('unified-input');
    if (!list) return;
    if (!questionHistoryMatches.length) {
      list.hidden = true;
      list.replaceChildren();
      input?.removeAttribute('aria-activedescendant');
      return;
    }

    list.hidden = false;
    list.replaceChildren(...questionHistoryMatches.map((text, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.id = `question-history-option-${index}`;
      item.className = 'question-history-item';
      item.dataset.index = String(index);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === questionHistoryIndex));
      item.classList.toggle('is-active', index === questionHistoryIndex);
      item.textContent = text.replace(/\s+/g, ' ').trim();
      item.title = text;
      return item;
    }));

    if (input && questionHistoryIndex >= 0) {
      input.setAttribute('aria-activedescendant', `question-history-option-${questionHistoryIndex}`);
    } else {
      input?.removeAttribute('aria-activedescendant');
    }
  }

  function refreshQuestionHistoryMatches() {
    const input = document.getElementById('unified-input');
    questionHistoryMatches = !questionHistorySuppressed && canShowQuestionHistory(input)
      ? findQuestionHistoryMatches(questionHistoryEntries, input.value)
      : [];
    if (questionHistoryIndex >= questionHistoryMatches.length) questionHistoryIndex = -1;
    renderQuestionHistory();
  }

  function dismissQuestionHistory({ suppress = false } = {}) {
    if (suppress) questionHistorySuppressed = true;
    questionHistoryMatches = [];
    questionHistoryIndex = -1;
    renderQuestionHistory();
  }

  // Fills the composer with a past question; the user still chooses to send it.
  function fillQuestionHistory(index) {
    const text = questionHistoryMatches[index];
    if (!text) return;
    questionHistorySuppressed = true;
    questionHistoryMatches = [];
    questionHistoryIndex = -1;
    renderQuestionHistory();
    getPromptsController().applyPromptToInput(text);
    const input = document.getElementById('unified-input');
    if (input) {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function handleQuestionHistoryKeydown(event, isComposing) {
    if (event.defaultPrevented || isComposing || event.isComposing || event.keyCode === 229) return false;
    if (!questionHistoryMatches.length) return false;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      questionHistoryIndex = questionHistoryIndex < 0
        ? (delta > 0 ? 0 : questionHistoryMatches.length - 1)
        : (questionHistoryIndex + delta + questionHistoryMatches.length) % questionHistoryMatches.length;
      renderQuestionHistory();
      return true;
    }

    // Enter fills only a highlighted suggestion; otherwise it sends as usual.
    if (event.key === 'Enter') {
      if (questionHistoryIndex < 0) return false;
      event.preventDefault();
      fillQuestionHistory(questionHistoryIndex);
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      dismissQuestionHistory({ suppress: true });
      return true;
    }

    return false;
  }

  async function setupQuestionHistory() {
    questionHistoryEntries = await loadQuestionHistory();
    refreshQuestionHistoryMatches();
    const list = questionHistoryElement();
    // Keep the textarea focused while a suggestion is clicked.
    list?.addEventListener('pointerdown', event => event.preventDefault());
    list?.addEventListener('click', event => {
      const item = event.target instanceof Element ? event.target.closest('.question-history-item') : null;
      if (item) fillQuestionHistory(Number(item.dataset.index));
    });
  }

  async function rememberQuestionForHistory(text) {
    questionHistoryEntries = await recordQuestion(text);
    refreshQuestionHistoryMatches();
  }

  return {
    dismissQuestionHistory,
    handleQuestionHistoryKeydown,
    get questionHistoryEntries() { return questionHistoryEntries; },
    set questionHistoryEntries(value) { questionHistoryEntries = value; },
    get questionHistoryIndex() { return questionHistoryIndex; },
    set questionHistoryIndex(value) { questionHistoryIndex = value; },
    get questionHistorySuppressed() { return questionHistorySuppressed; },
    set questionHistorySuppressed(value) { questionHistorySuppressed = value; },
    refreshQuestionHistoryMatches,
    rememberQuestionForHistory,
    setupQuestionHistory,
  };
}
