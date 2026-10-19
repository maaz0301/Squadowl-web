import { describe, expect, it } from 'vitest';
import { filterIdsByBirthYear, isBirthYearRangeActive } from './ageFilter';

const players = new Map<string, { yearOfBirth?: string; dateOfBirth?: string }>([
  ['a', { yearOfBirth: '2010' }],
  ['b', { yearOfBirth: '2012' }],
  ['c', { yearOfBirth: '2014', dateOfBirth: '2014-05-01' }],
  ['d', {}],
]);
const ids = ['a', 'b', 'c', 'd'];

describe('filterIdsByBirthYear', () => {
  it('keeps everyone, unknown ages included, when no limit is set', () => {
    expect(isBirthYearRangeActive({ from: '', to: ' ' })).toBe(false);
    expect(filterIdsByBirthYear(ids, players, { from: '', to: '' })).toEqual(ids);
  });
  it('limits to a window, ends included, and drops unknown ages', () => {
    expect(filterIdsByBirthYear(ids, players, { from: '2012', to: '2014' })).toEqual(['b', 'c']);
  });
  it('works with only one end', () => {
    expect(filterIdsByBirthYear(ids, players, { from: '2012', to: '' })).toEqual(['b', 'c']);
    expect(filterIdsByBirthYear(ids, players, { from: '', to: '2010' })).toEqual(['a']);
  });
});
