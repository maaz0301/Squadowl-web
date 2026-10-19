import { describe, expect, it } from 'vitest';
import { compareByAge } from './ageSort';

const p = (first: string, yearOfBirth?: string, dateOfBirth?: string) => ({ first, last: 'X', yearOfBirth, dateOfBirth });

describe('compareByAge', () => {
  const list = [p('old', '2010'), p('none'), p('young', '2016'), p('mid', '2013', '2013-02-03')];
  it('youngest first, unknown last', () => {
    expect([...list].sort(compareByAge('youngest')).map((x) => x.first)).toEqual(['young', 'mid', 'old', 'none']);
  });
  it('oldest first, unknown still last', () => {
    expect([...list].sort(compareByAge('oldest')).map((x) => x.first)).toEqual(['old', 'mid', 'young', 'none']);
  });
  it('uses the full date within a year', () => {
    const a = p('a', '2012', '2012-11-01');
    const b = p('b', '2012', '2012-03-01');
    expect([b, a].sort(compareByAge('youngest')).map((x) => x.first)).toEqual(['a', 'b']);
  });
});
