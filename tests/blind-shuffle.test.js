import { describe, expect, it } from 'vitest';
import { shuffleOrder, syncDisplayOrder } from '../modules/blind-shuffle.js';

const sequence = (...values) => {
  let index = 0;
  return () => values[index++ % values.length];
};

describe('blind shuffle', () => {
  it('returns a different permutation of the panels', () => {
    const ids = ['a', 'b', 'c', 'd'];
    for (const random of [() => 0, () => 0.999, sequence(0.3, 0.7, 0.1)]) {
      const next = shuffleOrder(ids, random);
      expect([...next].sort()).toEqual(ids);
      expect(next).not.toEqual(ids);
    }
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('rotates when the random draw keeps every panel in place', () => {
    // Each draw picks the last free index, so Fisher-Yates swaps nothing.
    expect(shuffleOrder(['a', 'b', 'c'], () => 0.999)).toEqual(['b', 'c', 'a']);
    expect(shuffleOrder(['a'], () => 0)).toEqual(['a']);
    expect(shuffleOrder([], () => 0)).toEqual([]);
  });

  it('keeps shown panels, drops removed ones and inserts new ones at a random place', () => {
    expect(syncDisplayOrder(['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    expect(syncDisplayOrder(['c', 'a', 'b'], ['a', 'c'])).toEqual(['c', 'a']);
    expect(syncDisplayOrder(['c', 'a'], ['a', 'c', 'd'], () => 0)).toEqual(['d', 'c', 'a']);
    expect(syncDisplayOrder(['c', 'a'], ['a', 'c', 'd'], () => 0.5)).toEqual(['c', 'd', 'a']);
    expect(syncDisplayOrder(['c', 'a'], ['a', 'c', 'd'], () => 1)).toEqual(['c', 'a', 'd']);
    expect([...syncDisplayOrder(null, ['a', 'b', 'c'])].sort()).toEqual(['a', 'b', 'c']);
  });
});
