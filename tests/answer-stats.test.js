import { describe, expect, it } from 'vitest';
import {
  ANSWER_STATUS,
  aggregateAnswerStats,
  applyTimingEvent,
  createRound,
  summarizePromptText,
  toggleRoundAdoption
} from '../modules/answer-stats.js';

const PANELS = [
  { id: 'p1', providerId: 'chatgpt' },
  { id: 'p2', providerId: 'gemini' },
  { id: 'p3', providerId: 'kimi' }
];

function newRound(id = 'r1', createdAt = 1000) {
  return createRound({ id, createdAt, text: 'Question', panels: PANELS });
}

function finish(round, panelId, firstOutputMs, completeMs) {
  const withFirst = applyTimingEvent(round, panelId, 'first-output', round.createdAt + firstOutputMs);
  return applyTimingEvent(withFirst, panelId, 'complete', round.createdAt + completeMs);
}

describe('summarizePromptText', () => {
  it('collapses whitespace and truncates long questions', () => {
    expect(summarizePromptText('  a\n\n b  ')).toBe('a b');
    const summary = summarizePromptText('x'.repeat(150));
    expect(summary).toHaveLength(100);
    expect(summary.endsWith('…')).toBe(true);
    expect(summarizePromptText(null)).toBe('');
  });
});

describe('createRound', () => {
  it('only times providers with timing support', () => {
    const round = newRound();
    expect(round.promptSummary).toBe('Question');
    expect(round.answers.p1).toMatchObject({ providerId: 'chatgpt', timed: true, status: ANSWER_STATUS.PENDING });
    expect(round.answers.p3).toMatchObject({ providerId: 'kimi', timed: false, status: null });
  });
});

describe('applyTimingEvent', () => {
  it('records times relative to the send', () => {
    const round = finish(newRound(), 'p1', 800, 4200);
    expect(round.answers.p1).toMatchObject({
      status: ANSWER_STATUS.COMPLETE,
      firstOutputMs: 800,
      completeMs: 4200
    });
  });

  it('ignores reports for finished answers, untimed providers and unknown panels', () => {
    const done = finish(newRound(), 'p1', 800, 4200);
    expect(applyTimingEvent(done, 'p1', 'timeout', 9000)).toBeNull();
    expect(applyTimingEvent(done, 'p3', 'first-output', 2000)).toBeNull();
    expect(applyTimingEvent(done, 'missing', 'first-output', 2000)).toBeNull();
    expect(applyTimingEvent(done, 'p2', 'unknown-phase', 2000)).toBeNull();
    expect(applyTimingEvent(done, 'p2', 'first-output', Number.NaN)).toBeNull();
  });

  it('keeps the first first-output report', () => {
    const round = applyTimingEvent(newRound(), 'p2', 'first-output', 1500);
    expect(applyTimingEvent(round, 'p2', 'first-output', 2500)).toBeNull();
  });

  it('marks timeouts and cancellations without times', () => {
    const round = applyTimingEvent(newRound(), 'p1', 'timeout', 99000);
    expect(round.answers.p1).toMatchObject({ status: ANSWER_STATUS.TIMEOUT, completeMs: null });
    const cancelled = applyTimingEvent(newRound(), 'p2', 'cancelled', 2000);
    expect(cancelled.answers.p2.status).toBe(ANSWER_STATUS.CANCELLED);
  });
});

describe('toggleRoundAdoption', () => {
  it('adopts one answer and clears it on a second click', () => {
    const adopted = toggleRoundAdoption(newRound(), 'p3');
    expect(adopted).toMatchObject({ adoptedPanelId: 'p3', adoptedProviderId: 'kimi' });

    const switched = toggleRoundAdoption(adopted, 'p1');
    expect(switched).toMatchObject({ adoptedPanelId: 'p1', adoptedProviderId: 'chatgpt' });

    expect(toggleRoundAdoption(switched, 'p1')).toMatchObject({ adoptedPanelId: null, adoptedProviderId: null });
  });
});

describe('aggregateAnswerStats', () => {
  it('summarizes speed, timeouts and adoption per provider', () => {
    let first = finish(newRound('r1', 1000), 'p1', 1000, 5000);
    first = finish(first, 'p2', 2000, 3000);
    first = toggleRoundAdoption(first, 'p2');

    let second = finish(newRound('r2', 50000), 'p1', 3000, 9000);
    second = applyTimingEvent(second, 'p2', 'timeout', 400000);
    second = toggleRoundAdoption(second, 'p1');

    // No answer adopted: counts as a question, not for the adoption rate.
    const third = finish(newRound('r3', 90000), 'p1', 2000, 6000);

    const stats = aggregateAnswerStats([first, second, third]);
    const byProvider = Object.fromEntries(stats.map(entry => [entry.providerId, entry]));

    expect(byProvider.chatgpt).toMatchObject({
      rounds: 3,
      decidedRounds: 2,
      adoptedCount: 1,
      adoptionRate: 0.5,
      completeCount: 3,
      timeoutCount: 0,
      medianFirstOutputMs: 2000,
      avgFirstOutputMs: 2000,
      medianCompleteMs: 6000,
      avgCompleteMs: 6667
    });
    expect(byProvider.gemini).toMatchObject({
      rounds: 3,
      adoptedCount: 1,
      completeCount: 1,
      timeoutCount: 1,
      medianCompleteMs: 3000
    });
    expect(byProvider.kimi).toMatchObject({
      timed: false,
      rounds: 3,
      adoptedCount: 0,
      adoptionRate: 0,
      medianCompleteMs: null
    });
  });

  it('counts a provider shown in two panels once per question, using its fastest answer', () => {
    let round = createRound({
      id: 'r1',
      createdAt: 0,
      text: 'Q',
      panels: [{ id: 'a', providerId: 'chatgpt' }, { id: 'b', providerId: 'chatgpt' }]
    });
    round = finish(round, 'a', 900, 8000);
    round = finish(round, 'b', 1200, 4000);

    const [entry] = aggregateAnswerStats([round]);
    expect(entry).toMatchObject({ rounds: 1, medianFirstOutputMs: 900, medianCompleteMs: 4000 });
  });

  it('returns nothing without rounds', () => {
    expect(aggregateAnswerStats([])).toEqual([]);
  });
});
