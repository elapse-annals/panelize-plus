import { describe, expect, it } from 'vitest';
import {
  RECENT_SCORE_WINDOW_MS,
  applyTimingEvent,
  createRound,
  toggleRoundAdoption,
  toggleRoundRejection
} from '../modules/answer-stats.js';
import {
  ANSWER_LOG_FEEDBACK,
  filterAnswerLogRounds,
  getAnswerLogProviderIds,
  renderAnswerLog
} from '../modules/answer-log.js';
import { toLanguageTag } from '../modules/share-snapshot.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 27, 12);
const NAMES = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude', kimi: 'Kimi' };
const OPTIONS = {
  locale: 'en-US',
  getText: (key, fallback) => fallback,
  getProviderName: providerId => NAMES[providerId] || providerId
};

function round(id, createdAt, text, providerIds = ['chatgpt', 'gemini']) {
  return createRound({
    id,
    createdAt,
    text,
    panels: providerIds.map((providerId, index) => ({ id: `p${index + 1}`, providerId }))
  });
}

// Newest first, as getAllAnswerRounds returns them.
function sampleRounds() {
  const adopted = toggleRoundAdoption(round('adopted', NOW - 1000, 'Write a  HAIKU about rain'), 'p2');
  const rejected = toggleRoundRejection(round('rejected', NOW - DAY_MS, 'Explain closures', ['chatgpt', 'claude']), 'p1');
  const plain = round('plain', NOW - 2 * DAY_MS, 'Plan a trip');
  const old = round('old', NOW - RECENT_SCORE_WINDOW_MS - 1, 'Old question', ['kimi']);
  return [adopted, rejected, plain, old];
}

const ids = rounds => rounds.map(entry => entry.id);

describe('filterAnswerLogRounds', () => {
  it('keeps the last 30 days without filters', () => {
    expect(ids(filterAnswerLogRounds(sampleRounds(), { now: NOW }))).toEqual(['adopted', 'rejected', 'plain']);
  });

  it('searches question text without regard to case or extra spaces', () => {
    expect(ids(filterAnswerLogRounds(sampleRounds(), { now: NOW, query: '  haiku   about ' }))).toEqual(['adopted']);
    expect(ids(filterAnswerLogRounds(sampleRounds(), { now: NOW, query: 'old' }))).toEqual([]);
  });

  it('filters by provider and by feedback on that provider', () => {
    expect(ids(filterAnswerLogRounds(sampleRounds(), { now: NOW, providerId: 'claude' }))).toEqual(['rejected']);
    expect(ids(filterAnswerLogRounds(sampleRounds(), { now: NOW, providerId: 'kimi' }))).toEqual([]);
    expect(ids(filterAnswerLogRounds(sampleRounds(), {
      now: NOW, providerId: 'gemini', feedback: ANSWER_LOG_FEEDBACK.ADOPTED
    }))).toEqual(['adopted']);
    expect(ids(filterAnswerLogRounds(sampleRounds(), {
      now: NOW, providerId: 'chatgpt', feedback: ANSWER_LOG_FEEDBACK.NONE
    }))).toEqual(['adopted', 'plain']);
  });

  it('filters by feedback across all providers', () => {
    const rounds = sampleRounds();
    expect(ids(filterAnswerLogRounds(rounds, { now: NOW, feedback: ANSWER_LOG_FEEDBACK.ADOPTED }))).toEqual(['adopted']);
    expect(ids(filterAnswerLogRounds(rounds, { now: NOW, feedback: ANSWER_LOG_FEEDBACK.REJECTED }))).toEqual(['rejected']);
    expect(ids(filterAnswerLogRounds(rounds, { now: NOW, feedback: ANSWER_LOG_FEEDBACK.NONE }))).toEqual(['plain']);
  });
});

describe('getAnswerLogProviderIds', () => {
  it('lists each provider once in order of first appearance', () => {
    expect(getAnswerLogProviderIds(sampleRounds())).toEqual(['chatgpt', 'gemini', 'claude', 'kimi']);
  });
});

describe('renderAnswerLog', () => {
  it('groups questions by day, marks feedback on chips and stops at the limit', () => {
    const rounds = filterAnswerLogRounds(sampleRounds(), { now: NOW });
    rounds[0] = applyTimingEvent(rounds[0], 'p1', 'complete', rounds[0].createdAt + 2500);

    const list = document.createElement('ul');
    const result = renderAnswerLog(list, rounds, { ...OPTIONS, limit: 2 });

    expect(result).toEqual({ total: 3, shown: 2 });
    expect(list.querySelectorAll('.answer-log-day')).toHaveLength(2);
    const items = list.querySelectorAll('.answer-log-item');
    expect([...items].map(item => item.querySelector('.answer-log-prompt').textContent))
      .toEqual(['Write a HAIKU about rain', 'Explain closures']);

    const firstChips = [...items[0].querySelectorAll('.answer-log-chip')];
    expect(firstChips.map(chip => chip.textContent)).toEqual(['ChatGPT · 2.5 s', 'Gemini · pending']);
    expect(firstChips[1].classList.contains('adopted')).toBe(true);
    expect(firstChips[1].title).toBe('Adopted');

    const rejectedChip = items[1].querySelector('.answer-log-chip.rejected');
    expect(rejectedChip.textContent).toBe('ChatGPT · pending');
    expect(rejectedChip.title).toBe('5 points deducted');
    expect(items[1].querySelectorAll('.answer-log-chip')[1].textContent).toBe('Claude');
  });

  it('shows a placeholder for questions without text', () => {
    const list = document.createElement('ul');
    renderAnswerLog(list, [round('empty', NOW, '')], { ...OPTIONS, limit: 20 });
    expect(list.querySelector('.answer-log-prompt').textContent).toBe('(no text)');
  });

  it('renders with an extension locale converted to a language tag', () => {
    const list = document.createElement('ul');
    const result = renderAnswerLog(list, [round('zh', NOW, '你好')], { ...OPTIONS, locale: toLanguageTag('zh_CN'), limit: 20 });
    expect(result).toEqual({ total: 1, shown: 1 });
    expect(list.querySelector('.answer-log-day').textContent).toBe(new Date(NOW).toLocaleDateString('zh-CN'));
  });
});
