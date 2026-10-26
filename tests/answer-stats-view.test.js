import { describe, expect, it } from 'vitest';
import {
  aggregateAnswerStats,
  applyTimingEvent,
  createRound,
  toggleRoundAdoption
} from '../modules/answer-stats.js';
import {
  formatAnswerDuration,
  formatAnswerScore,
  formatAnswerTiming,
  formatEngagedDuration,
  renderAnswerStatsTable
} from '../modules/answer-stats-view.js';

const NAMES = { chatgpt: 'ChatGPT', claude: 'Claude' };
const OPTIONS = {
  getText: (key, fallback) => fallback,
  getProviderName: providerId => NAMES[providerId] || providerId
};

describe('answer stats formatting', () => {
  it('formats answer times in ms below one second and in seconds above', () => {
    expect(formatAnswerDuration(null)).toBe('—');
    expect(formatAnswerDuration(850)).toBe('850 ms');
    expect(formatAnswerDuration(2345)).toBe('2.3 s');
    expect(formatAnswerTiming(2000, 3000)).toBe('2.0 s (3.0 s)');
    expect(formatAnswerTiming(null, null)).toBe('—');
  });

  it('formats engaged time and scores', () => {
    expect(formatEngagedDuration(0)).toBe('—');
    expect(formatEngagedDuration(500)).toBe('<1 s');
    expect(formatEngagedDuration(42000)).toBe('42 s');
    expect(formatEngagedDuration(90000)).toBe('1.5 min');
    expect(formatAnswerScore(5)).toBe('5');
    expect(formatAnswerScore(1.5)).toBe('1.5');
  });
});

describe('renderAnswerStatsTable', () => {
  it('renders one row per provider and marks untimed providers as not measured', () => {
    let round = createRound({
      id: 'r1',
      createdAt: 1000,
      text: 'Question',
      panels: [{ id: 'p1', providerId: 'chatgpt' }, { id: 'p2', providerId: 'claude' }]
    });
    round = applyTimingEvent(round, 'p1', 'first-output', 2000);
    round = applyTimingEvent(round, 'p1', 'complete', 4000);
    round = toggleRoundAdoption(round, 'p2');

    const tbody = document.createElement('tbody');
    tbody.appendChild(document.createElement('tr'));
    renderAnswerStatsTable(tbody, aggregateAnswerStats([round], 2000), OPTIONS);

    const rows = [...tbody.querySelectorAll('tr')];
    expect(rows).toHaveLength(2);
    const cells = rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent));
    expect(cells[0]).toEqual(['Claude', '1', '—', '—', '—', '1', '100%', '—', '5', '0', '5']);
    expect(cells[1]).toEqual(['ChatGPT', '1', '1.0 s (1.0 s)', '3.0 s (3.0 s)', '0', '0', '0%', '—', '0', '0', '0']);
    expect(rows[0].querySelectorAll('td')[2].title).toBe('Not measured');
    expect(rows[1].querySelectorAll('td')[2].title).toBe('');
    expect(rows[0].querySelector('td').className).toBe('answer-stats-provider');
  });
});
