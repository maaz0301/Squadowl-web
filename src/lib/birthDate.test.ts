import { describe, expect, it } from 'vitest';

import { buildDateOfBirth, daysInMonth, formatBirth, parseBirth, splitDateOfBirth, withYear } from '@/lib/birthDate';

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

describe('parseBirth', () => {
  const full = (y: string, dob: string) => ({ yearOfBirth: y, dateOfBirth: dob });

  it('reads a whole date however a sheet writes it', () => {
    expect(parseBirth('2011-04-02')).toEqual(full('2011', '2011-04-02'));
    expect(parseBirth('2011/4/2')).toEqual(full('2011', '2011-04-02'));
    expect(parseBirth('04/02/2011')).toEqual(full('2011', '2011-04-02'));
    expect(parseBirth('2-Apr-11')).toEqual(full('2011', '2011-04-02'));
    expect(parseBirth('April 2, 2011')).toEqual(full('2011', '2011-04-02'));
    expect(parseBirth('2 April 2011')).toEqual(full('2011', '2011-04-02'));
  });

  it('reads the two-digit year Excel shows for a date cell', () => {
    expect(parseBirth('4/2/11')).toEqual(full('2011', '2011-04-02'));
    expect(parseBirth('12/31/98')).toEqual(full('1998', '1998-12-31'));
  });

  it('lets a part above 12 settle which is the day', () => {
    expect(parseBirth('25/12/2010')).toEqual(full('2010', '2010-12-25'));
    expect(parseBirth('12/25/2010')).toEqual(full('2010', '2010-12-25'));
  });

  it('reads an Excel serial number', () => {
    expect(parseBirth('40635')).toEqual(full('2011', '2011-04-02'));
  });

  it('gives only the year when that is all there is', () => {
    expect(parseBirth('2011')).toEqual({ yearOfBirth: '2011', dateOfBirth: '' });
    expect(parseBirth('Born 2011?')).toEqual({ yearOfBirth: '2011', dateOfBirth: '' });
  });

  it('does not invent a date that does not exist', () => {
    expect(parseBirth('2011-02-30')).toEqual({ yearOfBirth: '2011', dateOfBirth: '' });
    expect(parseBirth('')).toEqual({ yearOfBirth: '', dateOfBirth: '' });
  });
});
