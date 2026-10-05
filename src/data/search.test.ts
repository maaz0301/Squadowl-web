import { describe, expect, it } from 'vitest';
import { buildSearchIndex, EMPTY_SEARCH, runSearch, type SearchPlayer } from './search';

const player = (id: string, first: string, last: string, extra: Partial<SearchPlayer> = {}): SearchPlayer => ({
  id,
  first,
  last,
  tryoutId: 't1',
  tryoutName: 'Fall Tryout',
  ...extra,
});

const index = buildSearchIndex({
  evaluations: [
    { id: 'e1', name: 'Fall Tryout', sport: 'Hockey' },
    { id: 'e2', name: 'Old Camp', sport: 'Hockey', archived: true },
  ],
  players: [
    player('p1', 'Jane', 'Doe', { jersey: '7' }),
    player('p2', 'John', 'Doe', { jersey: '17' }),
    player('p3', 'Ann', 'Lee', { jersey: '70' }),
  ],
  seasons: [{ id: 's1', name: '2026 Season', teamName: 'Wildcats' }],
});

describe('runSearch', () => {
  it('returns nothing for a blank query', () => {
    expect(runSearch(index, '   ')).toBe(EMPTY_SEARCH);
  });

  it('matches case-insensitively across evaluations, players and seasons', () => {
    const r = runSearch(index, 'FALL');
    expect(r.evaluations.items.map((e) => e.id)).toEqual(['e1']);
    expect(runSearch(index, 'doe').players.items.map((p) => p.evaluations[0].id)).toEqual(['p1', 'p2']);
    expect(runSearch(index, 'wildcats').seasons.items.map((s) => s.id)).toEqual(['s1']);
  });

  it('skips archived evaluations', () => {
    expect(runSearch(index, 'camp').evaluations.total).toBe(0);
  });

  it('matches names in either order and multi-word queries', () => {
    expect(runSearch(index, 'jane doe').players.items.map((p) => p.evaluations[0].id)).toEqual(['p1']);
    expect(runSearch(index, 'doe jane').players.items.map((p) => p.evaluations[0].id)).toEqual(['p1']);
    expect(runSearch(index, 'jane lee').players.total).toBe(0);
  });

  it('finds a jersey number exactly, not as a substring of others', () => {
    expect(runSearch(index, '7').players.items.map((p) => p.evaluations[0].id)).toEqual(['p1']);
    expect(runSearch(index, '#17').players.items.map((p) => p.evaluations[0].id)).toEqual(['p2']);
  });

  it('caps each group but reports the true total', () => {
    const many = buildSearchIndex({
      players: Array.from({ length: 60 }, (_, i) => player(`p${i}`, 'Sam', `Smith${i}`)),
    });
    const r = runSearch(many, 'sam', 25);
    expect(r.players.items).toHaveLength(25);
    expect(r.players.total).toBe(60);
  });

  describe('one person on several evaluations', () => {
    it('shows an athlete once, listing every evaluation', () => {
      const idx = buildSearchIndex({
        players: [
          player('r1', 'Jane', 'Doe', { athleteId: 'a1', tryoutId: 't1', tryoutName: 'Fall Tryout' }),
          player('r2', 'Jane', 'Doe', { athleteId: 'a1', tryoutId: 't2', tryoutName: 'Spring Camp' }),
          player('r3', 'Jane', 'Doe', { athleteId: 'a1', tryoutId: 't3', tryoutName: 'Winter Combine' }),
        ],
      });
      const r = runSearch(idx, 'jane');
      expect(r.players.total).toBe(1);
      expect(r.players.items[0].evaluations.map((e) => e.tryoutName)).toEqual([
        'Fall Tryout',
        'Spring Camp',
        'Winter Combine',
      ]);
    });

    it('merges separately imported records with the same name and year of birth', () => {
      const idx = buildSearchIndex({
        players: [
          player('r1', 'Jane', 'Doe', { athleteId: 'a1', yob: 2012, tryoutId: 't1' }),
          player('r2', 'jane ', ' DOE', { athleteId: 'a2', yob: 2012, tryoutId: 't2' }),
        ],
      });
      expect(runSearch(idx, 'doe').players.total).toBe(1);
    });

    it('keeps same-named players apart without a matching year of birth', () => {
      const idx = buildSearchIndex({
        players: [
          player('r1', 'Sam', 'Lee', { athleteId: 'a1', yob: 2011 }),
          player('r2', 'Sam', 'Lee', { athleteId: 'a2', yob: 2013 }),
          player('r3', 'Sam', 'Lee', { athleteId: 'a3' }),
        ],
      });
      expect(runSearch(idx, 'sam lee').players.total).toBe(3);
    });

    it('still finds a person by the jersey they wore on any evaluation', () => {
      const idx = buildSearchIndex({
        players: [
          player('r1', 'Jane', 'Doe', { athleteId: 'a1', jersey: '7', tryoutId: 't1' }),
          player('r2', 'Jane', 'Doe', { athleteId: 'a1', jersey: '12', tryoutId: 't2' }),
        ],
      });
      expect(runSearch(idx, '12').players.total).toBe(1);
    });
  });
});
