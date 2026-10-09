import { describe, expect, it } from 'vitest';

import { sportProfile } from './sportProfile';
import { DEFAULT_TERMS, makeT, resolveTerms, termsFor } from '@/lib/terms';

describe('sportProfile', () => {
  it('keeps the standard card for every other sport and for none', () => {
    for (const s of ['Hockey', 'Soccer', 'Other', '', undefined, null]) {
      expect(sportProfile(s).positions).toBe(true);
      expect(sportProfile(s).player).toBe('Player');
    }
  });

  it('gives skating Skaters with no positions or handedness', () => {
    expect(sportProfile('Skating')).toMatchObject({ player: 'Skater', positions: false, shoots: false });
  });
});

describe('terms for a sport', () => {
  it('leaves terms untouched without a sport or for hockey', () => {
    expect(resolveTerms(undefined, undefined)).toEqual(DEFAULT_TERMS);
    expect(resolveTerms(undefined, 'Hockey')).toEqual(DEFAULT_TERMS);
  });

  it('calls skating participants Skaters', () => {
    const t = resolveTerms(undefined, 'Skating');
    expect(t.player).toBe('Skater');
    expect(t.players).toBe('Skaters');
    expect(makeT(t)('Add Player')).toBe('Add Skater');
  });

  it('lets an account or evaluation rename win over the sport', () => {
    expect(resolveTerms({ player: 'Athlete' }, 'Skating').players).toBe('Athletes');
    expect(resolveTerms({ jersey: 'Skate Ontario #' }, 'Skating').jersey).toBe('Skate Ontario #');
  });

  it('applies to an evaluation export through its sport', () => {
    expect(termsFor({ sport: 'Skating' })('Players')).toBe('Skaters');
    expect(termsFor({ sport: 'Hockey' })('Players')).toBe('Players');
  });
});
