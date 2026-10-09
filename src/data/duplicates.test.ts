import { describe, expect, it } from 'vitest';
import { duplicatePrompt, findPossibleDuplicates } from './duplicates';

const roster = [
  { first: 'Jane', last: 'Doe', yearOfBirth: '2012', playerEmail: 'jane@x.com', guardianEmail: 'mum@x.com', jersey: '12' },
  { first: 'Sam', last: 'Lee', yearOfBirth: '2013', playerEmail: '', guardianEmail: 'lee@x.com' },
  { first: 'Katherine', last: 'Brown', yearOfBirth: '2012' },
];

describe('findPossibleDuplicates', () => {
  it('matches the same player email whatever the name', () => {
    const m = findPossibleDuplicates({ first: 'J', last: 'D', playerEmail: ' JANE@x.com ' }, roster);
    expect(m.map((x) => x.reason)).toEqual(['same-email']);
  });

  it('matches the same name in either order and ignores case and accents', () => {
    expect(findPossibleDuplicates({ first: 'jane', last: 'DOE' }, roster)[0].reason).toBe('same-name');
    expect(findPossibleDuplicates({ first: 'Doe', last: 'Jane' }, roster)[0].reason).toBe('same-name');
    expect(findPossibleDuplicates({ first: 'Jané', last: 'Doe' }, roster)[0].reason).toBe('same-name');
  });

  it('does not match when the birth years differ', () => {
    expect(findPossibleDuplicates({ first: 'Jane', last: 'Doe', yearOfBirth: '2010' }, roster)).toEqual([]);
  });

  it('matches a name a typo away', () => {
    expect(findPossibleDuplicates({ first: 'Jayne', last: 'Doe' }, roster)[0].reason).toBe('similar-name');
    expect(findPossibleDuplicates({ first: 'Katharine', last: 'Brown' }, roster)[0].reason).toBe('similar-name');
  });

  it('leaves different people and shared guardian emails alone', () => {
    expect(findPossibleDuplicates({ first: 'Sue', last: 'Lee', guardianEmail: 'lee@x.com' }, roster)).toEqual([]);
    expect(findPossibleDuplicates({ first: 'Tom', last: 'Reed' }, roster)).toEqual([]);
  });

  it('puts the strongest reason first and words the prompt', () => {
    const m = findPossibleDuplicates({ first: 'Jane', last: 'Doe', playerEmail: 'jane@x.com' }, roster);
    expect(m[0].reason).toBe('same-email');
    expect(duplicatePrompt(m, 'Jane Doe')).toContain('Jane Doe (#12) uses the same email address.');
    expect(duplicatePrompt([], 'x')).toBe('');
  });
});

import { flagRegistrationDuplicates } from './duplicates';

describe('flagRegistrationDuplicates', () => {
  const reg = (id: string, firstName: string, lastName: string, extra = {}) => ({
    id, firstName, lastName, status: 'pending', guardianEmail: 'g@x.com', ...extra,
  });

  it('flags a registration matching the roster and a second copy in the queue, not the first', () => {
    const flags = flagRegistrationDuplicates(
      [reg('a', 'Jane', 'Doe'), reg('b', 'Tom', 'Reed'), reg('c', 'Tom', 'Reed'), reg('d', 'Gone', 'Away', { status: 'dismissed' })],
      roster,
    );
    expect(flags.get('a')).toContain('Already on the roster?');
    expect(flags.has('b')).toBe(false);
    expect(flags.get('c')).toContain('Registered twice?');
    expect(flags.has('d')).toBe(false);
  });

  it('leaves added registrations unflagged', () => {
    expect(flagRegistrationDuplicates([reg('a', 'Jane', 'Doe', { status: 'added' })], roster).size).toBe(0);
  });
});
