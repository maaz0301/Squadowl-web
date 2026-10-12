import { describe, expect, it } from 'vitest';

import { formatClock, parseTimeField, parseTimeText, partsToValue, unitSeconds, valueToParts } from './timeEntry';

describe('timeEntry', () => {
  it('turns 23 seconds into 23 in a seconds rubric, not 0', () => {
    expect(partsToValue({ h: 0, m: 0, s: 23, t: 0 }, 'sec')).toBe(23);
    expect(partsToValue({ h: 0, m: 0, s: 23, t: 4 }, 's')).toBe(23.4);
  });
  it('carries minutes and hours into the rubric unit', () => {
    expect(partsToValue({ h: 0, m: 1, s: 5, t: 0 }, 'sec')).toBe(65);
    expect(partsToValue({ h: 0, m: 1, s: 30, t: 0 }, 'min')).toBe(1.5);
    expect(partsToValue({ h: 1, m: 30, s: 0, t: 0 }, 'hours')).toBe(1.5);
    expect(unitSeconds(undefined)).toBe(1);
  });
  it('splits a stored value back into the same parts', () => {
    expect(valueToParts(83.4, 'sec')).toEqual({ h: 0, m: 1, s: 23, t: 4 });
    expect(valueToParts(1.5, 'min')).toEqual({ h: 0, m: 1, s: 30, t: 0 });
    expect(valueToParts(undefined)).toEqual({ h: 0, m: 0, s: 0, t: 0 });
  });
  it('reads a time like a stopwatch', () => {
    expect(formatClock(23, 'sec')).toBe('0:23.0');
    expect(formatClock(3723.4, 'sec')).toBe('1:02:03.4');
  });
  it('keeps each field in range', () => {
    expect(parseTimeField('99', 's')).toBe(59);
    expect(parseTimeField('7x', 't')).toBe(7);
    expect(parseTimeField('', 'm')).toBe(0);
  });

  it('records a result under a minute, such as 15 seconds of skipping', () => {
    expect(partsToValue({ h: 0, m: 0, s: 15, t: 0 }, 'sec')).toBe(15);
    expect(partsToValue({ h: 0, m: 0, s: 15, t: 0 }, 'min')).toBe(0.25);
    expect(formatClock(0.25, 'min')).toBe('0:15.0');
  });

  it('reads a typed range or benchmark either as a plain number or as a clock', () => {
    expect(parseTimeText('45', 'sec')).toBe(45);
    expect(parseTimeText('1:30', 'sec')).toBe(90);
    expect(parseTimeText('1:30', 'min')).toBe(1.5);
    expect(parseTimeText('0:15.5', 'sec')).toBe(15.5);
    expect(parseTimeText('1:xx', 'sec')).toBeNaN();
  });
});
