import { describe, expect, it } from 'vitest';
import { planCompareBands, wrapHeader } from './comparePdfLayout';

describe('planCompareBands', () => {
  const base = { available: 770, firstFixed: 540, repeatFixed: 330, scoreWidth: 62 };

  it('keeps everything on one band when it fits', () => {
    expect(planCompareBands({ ...base, scoreCount: 3 }).bands).toEqual([3]);
  });

  it('puts what fits on the first band and splits the rest, repeating the identity columns', () => {
    // 770 - 540 = 230 -> 3 on the first band; 770 - 330 = 440 -> 7 on each later band.
    expect(planCompareBands({ ...base, scoreCount: 20 }).bands).toEqual([3, 7, 7, 3]);
  });

  it('always accounts for every score column', () => {
    for (const n of [0, 1, 2, 9, 31, 60]) {
      const { bands } = planCompareBands({ ...base, scoreCount: n });
      expect(bands.reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

  it('puts nothing but identity columns on the first band when no score column fits beside them', () => {
    expect(planCompareBands({ ...base, firstFixed: 760, scoreCount: 4 }).bands).toEqual([0, 4]);
  });

  it('never makes an empty later band, even on a very narrow page', () => {
    const { bands } = planCompareBands({ available: 300, firstFixed: 280, repeatFixed: 290, scoreWidth: 62, scoreCount: 3 });
    expect(bands.slice(1).every((n) => n >= 1)).toBe(true);
    expect(bands.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('has a single empty band when there are no score columns', () => {
    expect(planCompareBands({ ...base, scoreCount: 0 }).bands).toEqual([0]);
  });
});

describe('wrapHeader', () => {
  const measure = (t: string) => t.length * 4;

  it('keeps a short header on one line', () => {
    expect(wrapHeader('Skating', 60, 4, measure)).toEqual(['Skating']);
  });

  it('breaks a long header at spaces onto several lines instead of cutting it', () => {
    const lines = wrapHeader('# OF BWD SKIPS IN 30 SECONDS', 60, 4, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('# OF BWD SKIPS IN 30 SECONDS');
    expect(lines.every((l) => measure(l) <= 60)).toBe(true);
  });

  it('marks text that does not fit in the allowed lines', () => {
    const lines = wrapHeader('one two three four five six seven eight nine ten eleven twelve', 40, 2, measure);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('...')).toBe(true);
  });

  it('cuts a single word that is wider than the line', () => {
    const lines = wrapHeader('Supercalifragilisticexpialidocious', 40, 4, measure);
    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith('...')).toBe(true);
    expect(measure(lines[0])).toBeLessThanOrEqual(40);
  });
});
