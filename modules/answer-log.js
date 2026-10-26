// Answer log: the questions of the last RECENT_SCORE_WINDOW_MS with each
// panel's answer, newest first and grouped by day. Text and provider names
// come from the caller so this module has no page globals.

import { ANSWER_STATUS, RECENT_SCORE_WINDOW_MS } from './answer-stats.js';
import { createCell, formatAnswerDuration } from './answer-stats-view.js';

export const ANSWER_LOG_FEEDBACK = Object.freeze({
  ALL: 'all',
  ADOPTED: 'adopted',
  REJECTED: 'rejected',
  NONE: 'none'
});

function normalizeQuery(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().toLowerCase() : '';
}

/**
 * Rounds from the last RECENT_SCORE_WINDOW_MS that match the filters, in the
 * given order. With a provider selected, the feedback filter looks at that
 * provider's answers only.
 *
 * @param {Array<object>} rounds Rounds sorted newest first.
 * @param {{ now?: number, query?: string, providerId?: string, feedback?: string }} filters
 */
export function filterAnswerLogRounds(rounds, {
  now = Date.now(),
  query = '',
  providerId = '',
  feedback = ANSWER_LOG_FEEDBACK.ALL
} = {}) {
  const since = now - RECENT_SCORE_WINDOW_MS;
  const normalizedQuery = normalizeQuery(query);

  return rounds.filter(round => {
    if (round.createdAt < since) {
      return false;
    }
    if (normalizedQuery && !normalizeQuery(round.promptSummary).includes(normalizedQuery)) {
      return false;
    }

    const answers = Object.entries(round.answers || {})
      .filter(([, answer]) => !providerId || answer?.providerId === providerId);
    if (providerId && answers.length === 0) {
      return false;
    }
    if (feedback === ANSWER_LOG_FEEDBACK.ALL) {
      return true;
    }

    const adopted = answers.some(([panelId]) => round.adoptedPanelId === panelId);
    const rejected = answers.some(([, answer]) => answer.rejected);
    if (feedback === ANSWER_LOG_FEEDBACK.ADOPTED) return adopted;
    if (feedback === ANSWER_LOG_FEEDBACK.REJECTED) return rejected;
    if (feedback === ANSWER_LOG_FEEDBACK.NONE) return !adopted && !rejected;
    return true;
  });
}

// Providers that answered any of the rounds, in order of first appearance.
export function getAnswerLogProviderIds(rounds) {
  const providerIds = new Set();
  rounds.forEach(round => {
    Object.values(round.answers || {}).forEach(answer => {
      if (answer?.providerId) {
        providerIds.add(answer.providerId);
      }
    });
  });
  return [...providerIds];
}

function createAnswerChip(round, panelId, answer, { getText, getProviderName }) {
  const isAdopted = round.adoptedPanelId === panelId;
  let timing = '';
  if (answer.timed) {
    timing = answer.status === ANSWER_STATUS.COMPLETE
      ? formatAnswerDuration(answer.completeMs)
      : getText(`answerStatsStatus_${answer.status}`, answer.status);
  }
  const providerName = getProviderName(answer.providerId);
  const chip = createCell(
    'span',
    timing ? `${providerName} · ${timing}` : providerName,
    `answer-log-chip${isAdopted ? ' adopted' : ''}${answer.rejected ? ' rejected' : ''}`
  );
  if (isAdopted) {
    chip.title = getText('answerStatsAdopted', 'Adopted');
  } else if (answer.rejected) {
    chip.title = getText('answerStatsRejected', '5 points deducted');
  }
  return chip;
}

/**
 * Replaces the items of `list` with the first `limit` rounds, grouped by day.
 *
 * @param {HTMLUListElement} list
 * @param {Array<object>} rounds Filtered rounds, newest first.
 * @param {{ limit: number, locale?: string, getText: Function, getProviderName: Function }} options
 * @returns {{ total: number, shown: number }}
 */
export function renderAnswerLog(list, rounds, { limit, locale, getText, getProviderName }) {
  const shownRounds = rounds.slice(0, limit);
  const items = [];
  let lastDay = null;

  shownRounds.forEach(round => {
    const day = new Date(round.createdAt).toLocaleDateString(locale);
    if (day !== lastDay) {
      lastDay = day;
      items.push(createCell('li', day, 'answer-log-day'));
    }

    const item = document.createElement('li');
    item.className = 'answer-log-item';
    const header = document.createElement('div');
    header.className = 'answer-log-header';
    header.append(
      createCell('span', round.promptSummary || getText('answerStatsNoPrompt', '(no text)'), 'answer-log-prompt'),
      createCell('span', new Date(round.createdAt).toLocaleTimeString(locale), 'answer-log-time')
    );
    if (round.promptSummary) {
      header.firstChild.title = round.promptSummary;
    }

    const answers = document.createElement('div');
    answers.className = 'answer-log-answers';
    Object.entries(round.answers || {}).forEach(([panelId, answer]) => {
      answers.appendChild(createAnswerChip(round, panelId, answer, { getText, getProviderName }));
    });

    item.append(header, answers);
    items.push(item);
  });

  list.replaceChildren(...items);
  return { total: rounds.length, shown: shownRounds.length };
}
