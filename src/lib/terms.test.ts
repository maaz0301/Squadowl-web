import { describe, expect, it } from 'vitest';

import { DEFAULT_TERMS, makeT, pluralize, resolveTerms, sportLabel } from '@/lib/terms';

describe('terms', () => {
  it('defaults when nothing is set', () => {
    expect(resolveTerms(undefined)).toEqual(DEFAULT_TERMS);
    expect(resolveTerms({ player: '  ', jersey: '' })).toEqual(DEFAULT_TERMS);
  });
  it('applies renames and derives the plural', () => {
    const t = resolveTerms({ player: 'Skater', jersey: 'Skate Ontario #', sport: 'Skating' });
    expect(t).toEqual({ player: 'Skater', players: 'Skaters', jersey: 'Skate Ontario #', sport: 'Skating' });
  });
  it('pluralizes common endings', () => {
    expect(pluralize('Goalie')).toBe('Goalies');
    expect(pluralize('Family')).toBe('Families');
    expect(pluralize('Coach')).toBe('Coaches');
  });
  it('only renames the default sport', () => {
    const t = resolveTerms({ sport: 'Skating' });
    expect(sportLabel('Hockey', t)).toBe('Skating');
    expect(sportLabel('Soccer', t)).toBe('Soccer');
  });
  it('rewrites wording only when renamed', () => {
    expect(makeT(DEFAULT_TERMS)('Score Players')).toBe('Score Players');
    const t = makeT(resolveTerms({ player: 'Skater', jersey: 'Skate Ontario #' }));
    expect(t('Score Players')).toBe('Score Skaters');
    expect(t("the player's card")).toBe("the skater's card");
    expect(t('Search by name or jersey #')).toBe('Search by name or skate Ontario #');
    expect(t('Jersey')).toBe('Skate Ontario');
    expect(t('Player Selection Letters')).toBe('Skater Selection Letters');
  });
});
