import { describe, expect, it } from 'vitest';

import { buildDateOfBirth, daysInMonth, formatBirth, splitDateOfBirth, withYear } from '@/lib/birthDate';

describe('birth dates', () => {
  it('knows month lengths, leap years included', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2023, 4)).toBe(30);
    expect(daysInMonth(2023, 12)).toBe(31);
  });

  it('builds a date only when all three parts make a real date', () => {
    expect(buildDateOfBirth('2012', '3', '4')).toBe('2012-03-04');
    expect(buildDateOfBirth('2012', '', '4')).toBe('');
    expect(buildDateOfBirth('', '3', '4')).toBe('');
    expect(buildDateOfBirth('2023', '2', '29')).toBe('');
    expect(buildDateOfBirth('2024', '2', '29')).toBe('2024-02-29');
    expect(buildDateOfBirth('2012', '13', '1')).toBe('');
  });

  it('splits a stored date back into parts, and tolerates junk', () => {
    expect(splitDateOfBirth('2012-03-04')).toEqual({ year: '2012', month: '3', day: '4' });
    expect(splitDateOfBirth('')).toEqual({ year: '', month: '', day: '' });
    expect(splitDateOfBirth(undefined)).toEqual({ year: '', month: '', day: '' });
    expect(splitDateOfBirth('March 4')).toEqual({ year: '', month: '', day: '' });
  });

  it('formats a full date, falling back to the year', () => {
    expect(formatBirth('2012-03-04', '2012')).toBe('Mar 4, 2012');
    expect(formatBirth(undefined, '2012')).toBe('2012');
    expect(formatBirth(undefined, undefined)).toBe('');
  });

  it('clears a day that no longer exists when the year changes', () => {
    expect(withYear({ year: '2024', month: '2', day: '29' }, '2023')).toEqual({ year: '2023', month: '2', day: '' });
    expect(withYear({ year: '2024', month: '3', day: '31' }, '2023')).toEqual({ year: '2023', month: '3', day: '31' });
  });
});
