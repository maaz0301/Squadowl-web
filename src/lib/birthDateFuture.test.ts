import { describe, expect, it } from 'vitest';

import { isFutureBirth } from '@/lib/birthDate';

const now = new Date(2026, 9, 9);

describe('isFutureBirth', () => {
  it('flags a later year and a later full date', () => {
    expect(isFutureBirth('2027', undefined, now)).toBe(true);
    expect(isFutureBirth('2026', '2026-12-30', now)).toBe(true);
    expect(isFutureBirth('2026', '2026-10-10', now)).toBe(true);
  });

  it('allows today, the past, and nothing at all', () => {
    expect(isFutureBirth('2026', '2026-10-09', now)).toBe(false);
    expect(isFutureBirth('2012', '2012-03-04', now)).toBe(false);
    expect(isFutureBirth('2026', undefined, now)).toBe(false);
    expect(isFutureBirth('', '', now)).toBe(false);
    expect(isFutureBirth(undefined, undefined, now)).toBe(false);
  });
});
