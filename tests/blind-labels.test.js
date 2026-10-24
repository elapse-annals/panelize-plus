import { describe, expect, it } from 'vitest';
import { assignBlindLabels, blindLetter } from '../modules/blind-labels.js';

describe('blind labels', () => {
  it('counts like spreadsheet columns', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(blindLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });

  it('keeps letters of open panels and gives new panels the first free letter', () => {
    const first = assignBlindLabels(['p1', 'p2', 'p3']);
    expect([...first]).toEqual([['p1', 'A'], ['p2', 'B'], ['p3', 'C']]);

    const afterRemoval = assignBlindLabels(['p1', 'p3'], first);
    expect([...afterRemoval]).toEqual([['p1', 'A'], ['p3', 'C']]);

    const afterAdd = assignBlindLabels(['p1', 'p3', 'p4', 'p5'], afterRemoval);
    expect(Object.fromEntries(afterAdd)).toEqual({ p1: 'A', p3: 'C', p4: 'B', p5: 'D' });
  });
});
