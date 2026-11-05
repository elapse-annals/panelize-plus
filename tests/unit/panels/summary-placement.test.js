import { describe, it, expect } from 'vitest';
import { getSummaryColumnStart } from '../../../modules/panels/summary-placement.js';

describe('getSummaryColumnStart', () => {
  it('puts the card right after the first row when no panel is rendered', () => {
    expect(getSummaryColumnStart([])).toBeNull();
    expect(getSummaryColumnStart(null)).toBeNull();
  });

  it('follows the number of panels in the first row', () => {
    expect(getSummaryColumnStart([0])).toBe(2);
    expect(getSummaryColumnStart([0, 0, 0])).toBe(4);
  });

  it('counts only panels sharing the first row top', () => {
    expect(getSummaryColumnStart([0, 0, 300, 300])).toBe(3);
    expect(getSummaryColumnStart([300, 0, 0, 300])).toBe(3);
  });
});
