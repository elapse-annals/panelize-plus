import { describe, expect, it } from 'vitest';
import {
  ANSWER_STATUS,
  RECENT_SCORE_WINDOW_MS,
  aggregateAnswerStats,
  applyEngagementEvent,
  applyTimingEvent,
  getEngagementPoints,
  getNoOutputPenalty,
  createRound,
  isFirstRoundCompletion,
  summarizePromptText,
  toggleRoundAdoption,
  toggleRoundRejection
} from '../modules/answer-stats.js';

const PANELS = [
  { id: 'p1', providerId: 'chatgpt' },
  { id: 'p2', providerId: 'gemini' },
  { id: 'p3', providerId: 'claude' }
];

// Every test round counts as recent unless a test says otherwise.
const NOW = 1000000;

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
    expect(round.answers.p3).toMatchObject({ providerId: 'claude', timed: false, status: null });
  });

  it('marks rounds sent in blind mode and leaves other rounds unchanged', () => {
    expect(newRound()).not.toHaveProperty('blind');
    expect(createRound({ id: 'r-blind', createdAt: 1, text: 'Q', panels: PANELS, blind: true }).blind).toBe(true);
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

describe('isFirstRoundCompletion', () => {
  it('is true only for the first answer in a round to complete', () => {
    const round = applyTimingEvent(newRound(), 'p1', 'first-output', 1800);
    const first = applyTimingEvent(round, 'p1', 'complete', 4000);
    expect(isFirstRoundCompletion(round, first, 'p1')).toBe(true);
    const second = applyTimingEvent(first, 'p2', 'complete', 5000);
    expect(isFirstRoundCompletion(first, second, 'p2')).toBe(false);
  });

  it('ignores first output, timeouts and cancellations', () => {
    const round = newRound();
    expect(isFirstRoundCompletion(round, applyTimingEvent(round, 'p1', 'first-output', 1800), 'p1')).toBe(false);
    expect(isFirstRoundCompletion(round, applyTimingEvent(round, 'p1', 'timeout', 99000), 'p1')).toBe(false);
    expect(isFirstRoundCompletion(round, applyTimingEvent(round, 'p2', 'cancelled', 2000), 'p2')).toBe(false);
    expect(isFirstRoundCompletion(round, null, 'p1')).toBe(false);
  });
});

describe('toggleRoundAdoption', () => {
  it('adopts one answer and clears it on a second click', () => {
    const adopted = toggleRoundAdoption(newRound(), 'p3');
    expect(adopted).toMatchObject({ adoptedPanelId: 'p3', adoptedProviderId: 'claude' });

    const switched = toggleRoundAdoption(adopted, 'p1');
    expect(switched).toMatchObject({ adoptedPanelId: 'p1', adoptedProviderId: 'chatgpt' });

    expect(toggleRoundAdoption(switched, 'p1')).toMatchObject({ adoptedPanelId: null, adoptedProviderId: null });
  });
});

describe('toggleRoundRejection', () => {
  it('rejects an answer, clears it on a second click and ignores unknown panels', () => {
    const round = newRound();
    const rejected = toggleRoundRejection(round, 'p1');
    expect(rejected.answers.p1.rejected).toBe(true);
    expect(rejected.answers.p2.rejected).toBeUndefined();

    const cleared = toggleRoundRejection(rejected, 'p1');
    expect(cleared.answers.p1.rejected).not.toBe(true);
    expect(toggleRoundRejection(cleared, 'missing')).toBe(cleared);
  });

  it('clears the same answer rejection or adoption when switching feedback', () => {
    const adopted = toggleRoundAdoption(newRound(), 'p1');
    const rejected = toggleRoundRejection(adopted, 'p1');
    expect(rejected).toMatchObject({ adoptedPanelId: null, adoptedProviderId: null });
    expect(rejected.answers.p1.rejected).toBe(true);

    const readopted = toggleRoundAdoption(rejected, 'p1');
    expect(readopted).toMatchObject({ adoptedPanelId: 'p1', adoptedProviderId: 'chatgpt' });
    expect(readopted.answers.p1.rejected).not.toBe(true);
  });

  it('keeps another panel adopted when a different answer is rejected', () => {
    const adopted = toggleRoundAdoption(newRound(), 'p1');
    const rejected = toggleRoundRejection(adopted, 'p2');

    expect(rejected).toMatchObject({ adoptedPanelId: 'p1', adoptedProviderId: 'chatgpt' });
    expect(rejected.answers.p2.rejected).toBe(true);
  });
});

function engage(round, panelId, events) {
  return events.reduce(
    (current, [kind, offsetMs]) => applyEngagementEvent(current, panelId, kind, current.createdAt + offsetMs),
    round
  );
}

describe('applyEngagementEvent', () => {
  it('counts clicks and scrolls and the gaps between them up to 15 s apart', () => {
    const round = engage(newRound(), 'p3', [
      ['click', 10000],
      ['scroll', 14000],
      ['scroll', 29000],
      // Away for longer than 15 s: the gap does not count.
      ['click', 60000],
      ['scroll', 61000]
    ]);
    expect(round.answers.p3.engagement).toMatchObject({ clicks: 2, scrolls: 3, zooms: 0, activeMs: 20000 });
  });

  it('counts the time a panel stays enlarged, up to 5 minutes between events', () => {
    const round = engage(newRound(), 'p1', [
      ['zoom-in', 5000],
      ['scroll', 45000],
      ['zoom-out', 105000],
      ['zoom-in', 200000],
      ['zoom-out', 900000]
    ]);
    expect(round.answers.p1.engagement).toMatchObject({
      zooms: 2,
      scrolls: 1,
      activeMs: 100000 + 5 * 60 * 1000,
      zoomedSince: null
    });
  });

  it('ignores unknown panels and kinds and zoom changes that change nothing', () => {
    const round = newRound();
    expect(applyEngagementEvent(round, 'missing', 'click', 2000)).toBeNull();
    expect(applyEngagementEvent(round, 'p1', 'hover', 2000)).toBeNull();
    expect(applyEngagementEvent(round, 'p1', 'click', Number.NaN)).toBeNull();
    expect(applyEngagementEvent(round, 'p1', 'zoom-out', 2000)).toBeNull();
    const zoomed = applyEngagementEvent(round, 'p1', 'zoom-in', 2000);
    expect(applyEngagementEvent(zoomed, 'p1', 'zoom-in', 3000)).toBeNull();
  });

  it('keeps timing while recording engagement', () => {
    const round = engage(finish(newRound(), 'p1', 800, 4200), 'p1', [['click', 5000]]);
    expect(round.answers.p1).toMatchObject({ status: ANSWER_STATUS.COMPLETE, completeMs: 4200 });
    expect(applyTimingEvent(engage(newRound(), 'p2', [['click', 500]]), 'p2', 'first-output', 1800)
      .answers.p2).toMatchObject({ firstOutputMs: 800, engagement: { clicks: 1 } });
  });
});

describe('getEngagementPoints', () => {
  it('gives a point each for interacting, enlarging and 30 s of engaged time, up to 3', () => {
    expect(getEngagementPoints(undefined)).toBe(0);
    expect(getEngagementPoints({ clicks: 0, scrolls: 0, zooms: 0, activeMs: 0 })).toBe(0);
    expect(getEngagementPoints({ clicks: 1, scrolls: 0, zooms: 0, activeMs: 29000 })).toBe(1);
    expect(getEngagementPoints({ clicks: 0, scrolls: 2, zooms: 1, activeMs: 30000 })).toBe(3);
    expect(getEngagementPoints({ clicks: 4, scrolls: 9, zooms: 1, activeMs: 600000 })).toBe(3);
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

    const stats = aggregateAnswerStats([first, second, third], NOW);
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
    expect(byProvider.claude).toMatchObject({
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

    const [entry] = aggregateAnswerStats([round], NOW);
    expect(entry).toMatchObject({ rounds: 1, medianFirstOutputMs: 900, medianCompleteMs: 4000 });
  });

  it('subtracts at most five points per provider per round and accepts older rounds without rejection data', () => {
    let duplicateProviderRound = createRound({
      id: 'duplicate-provider',
      createdAt: 0,
      text: 'Q',
      panels: [
        { id: 'a', providerId: 'chatgpt' },
        { id: 'b', providerId: 'chatgpt' },
        { id: 'c', providerId: 'gemini' }
      ]
    });
    duplicateProviderRound = toggleRoundRejection(duplicateProviderRound, 'a');
    duplicateProviderRound = toggleRoundRejection(duplicateProviderRound, 'b');

    const oldRound = {
      id: 'old',
      createdAt: 0,
      adoptedPanelId: null,
      adoptedProviderId: null,
      answers: {
        p1: { providerId: 'chatgpt' },
        p2: { providerId: 'gemini' }
      }
    };
    const stats = aggregateAnswerStats([duplicateProviderRound, oldRound], NOW);
    const byProvider = Object.fromEntries(stats.map(entry => [entry.providerId, entry]));

    expect(byProvider.chatgpt.score).toBe(-5);
    expect(byProvider.gemini.score).toBe(0);
  });

  it('scores adoption and engagement and sorts by score, then adoptions', () => {
    // Claude is used but not adopted; ChatGPT is adopted without being used.
    let first = engage(newRound('r1', 0), 'p3', [['click', 1000], ['scroll', 11000], ['scroll', 21000], ['scroll', 31000]]);
    first = toggleRoundAdoption(first, 'p1');
    let second = engage(newRound('r2', 100000), 'p3', [['zoom-in', 1000], ['zoom-out', 61000]]);
    second = engage(second, 'p2', [['scroll', 2000]]);

    const stats = aggregateAnswerStats([first, second], NOW);
    // Claude and ChatGPT tie on score; adoptions decide.
    expect(stats.map(entry => entry.providerId)).toEqual(['chatgpt', 'claude', 'gemini']);
    const byProvider = Object.fromEntries(stats.map(entry => [entry.providerId, entry]));
    expect(byProvider.claude).toMatchObject({ score: 2 + 3, engagedRounds: 2, activeMs: 90000, adoptedCount: 0 });
    expect(byProvider.chatgpt).toMatchObject({ score: 5, engagedRounds: 0, activeMs: 0 });
    expect(byProvider.gemini).toMatchObject({ score: 1, engagedRounds: 1, activeMs: 0 });
  });

  it('scores a provider shown in two panels by its most used answer', () => {
    let round = createRound({
      id: 'r1',
      createdAt: 0,
      text: 'Q',
      panels: [{ id: 'a', providerId: 'chatgpt' }, { id: 'b', providerId: 'chatgpt' }]
    });
    round = engage(round, 'a', [['click', 1000]]);
    round = engage(round, 'b', [['zoom-in', 1000], ['click', 2000]]);

    const [entry] = aggregateAnswerStats([round], NOW);
    expect(entry).toMatchObject({ score: 2, engagedRounds: 1, activeMs: 1000 });
  });

  it('only counts a timed answer that times out without output and ignores its engagement', () => {
    let round = engage(newRound(), 'p1', [['zoom-in', 2000], ['zoom-out', 62000]]);
    round = applyTimingEvent(round, 'p1', 'timeout', 301000);
    // Output before the timeout is not a failure.
    round = applyTimingEvent(round, 'p2', 'first-output', 3000);
    round = engage(round, 'p2', [['click', 4000]]);
    round = applyTimingEvent(round, 'p2', 'timeout', 901000);

    const byProvider = Object.fromEntries(aggregateAnswerStats([round], NOW).map(entry => [entry.providerId, entry]));
    expect(byProvider.chatgpt).toMatchObject({ score: 0, timeoutCount: 1, noOutputCount: 1, confirmedNoOutputCount: 0, engagedRounds: 1 });
    expect(byProvider.gemini).toMatchObject({ score: 1, timeoutCount: 1, noOutputCount: 0 });
  });

  it('does not deduct for a timeout when the answer was adopted or clicked or scrolled in', () => {
    let clicked = engage(newRound('r1'), 'p1', [['click', 1000], ['zoom-in', 2000], ['zoom-out', 62000]]);
    clicked = applyTimingEvent(clicked, 'p1', 'timeout', 301000);
    let scrolled = engage(newRound('r2'), 'p1', [['scroll', 1000]]);
    scrolled = applyTimingEvent(scrolled, 'p1', 'timeout', 301000);
    let adopted = applyTimingEvent(newRound('r3'), 'p1', 'timeout', 301000);
    adopted = toggleRoundAdoption(adopted, 'p1');
    const untouched = applyTimingEvent(newRound('r4'), 'p1', 'timeout', 301000);

    const [chatgpt] = aggregateAnswerStats([clicked, scrolled, adopted, untouched], NOW)
      .filter(entry => entry.providerId === 'chatgpt');
    // 3 + 1 engagement points and 5 for the adoption; the untouched timeout
    // is only counted because timing never saw this provider's output.
    expect(chatgpt).toMatchObject({ score: 9, timeoutCount: 4, adoptedCount: 1, noOutputCount: 1 });
  });

  it('deducts logarithmically for timeouts confirmed by output in the neighbouring rounds', () => {
    const output = (id, createdAt) => finish(newRound(id, createdAt), 'p1', 1000, 2000);
    const missed = (id, createdAt) => applyTimingEvent(newRound(id, createdAt), 'p1', 'timeout', createdAt + 300000);
    const rounds = [
      output('o1', 1000), missed('m1', 2000), output('o2', 3000),
      missed('m2', 4000), output('o3', 5000), missed('m3', 6000), output('o4', 7000),
      // Two timeouts in a row may mean timing broke, so neither is confirmed.
      missed('m4', 8000), missed('m5', 9000), output('o5', 10000),
      // The latest timeout waits for a later answer to confirm it.
      missed('m6', 11000)
    ];

    const [chatgpt] = aggregateAnswerStats(rounds, NOW).filter(entry => entry.providerId === 'chatgpt');
    // Three confirmed failures lose 5 * log2(4) = 10 points instead of 15.
    expect(chatgpt).toMatchObject({ score: -10, timeoutCount: 6, noOutputCount: 6, confirmedNoOutputCount: 3 });
    expect(getNoOutputPenalty(1)).toBe(5);
    expect(getNoOutputPenalty(0)).toBe(0);
  });

  it('does not deduct twice for a rejected answer whose timeout is confirmed', () => {
    const output = (id, createdAt) => finish(newRound(id, createdAt), 'p1', 1000, 2000);
    const missed = toggleRoundRejection(applyTimingEvent(newRound('m', 2000), 'p1', 'timeout', 302000), 'p1');

    const [chatgpt] = aggregateAnswerStats([output('a', 1000), missed, output('b', 3000)], NOW)
      .filter(entry => entry.providerId === 'chatgpt');
    expect(chatgpt).toMatchObject({ score: -5, confirmedNoOutputCount: 1 });
  });

  it('deducts once for a rejected answer without output and not for pending or cancelled answers', () => {
    let failed = applyTimingEvent(newRound('r1', 0), 'p1', 'timeout', 300000);
    failed = toggleRoundRejection(failed, 'p1');
    failed = applyTimingEvent(failed, 'p2', 'cancelled', 2000);
    const pending = engage(newRound('r2', 0), 'p1', [['click', 1000]]);

    const byProvider = Object.fromEntries(aggregateAnswerStats([failed, pending], NOW).map(entry => [entry.providerId, entry]));
    expect(byProvider.chatgpt.score).toBe(-5 + 1);
    expect(byProvider.gemini.score).toBe(0);
  });

  it('weighs points from the last 30 days in full and older points at 30%', () => {
    const now = RECENT_SCORE_WINDOW_MS + 100000;
    const old = toggleRoundAdoption(newRound('old', 99999), 'p1');
    const oldRejected = toggleRoundRejection(newRound('old-rejected', 0), 'p2');
    let recent = toggleRoundAdoption(newRound('recent', 100000), 'p1');
    recent = engage(recent, 'p2', [['click', 1000]]);

    const byProvider = Object.fromEntries(
      aggregateAnswerStats([old, oldRejected, recent], now).map(entry => [entry.providerId, entry])
    );
    expect(byProvider.chatgpt).toMatchObject({ recentScore: 5, olderScore: 5, score: 6.5, adoptedCount: 2 });
    expect(byProvider.gemini).toMatchObject({ recentScore: 1, olderScore: -5, score: -0.5 });
  });

  it('returns nothing without rounds', () => {
    expect(aggregateAnswerStats([], NOW)).toEqual([]);
  });
});
