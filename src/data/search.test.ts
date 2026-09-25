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
    expect(runSearch(index, 'doe').players.items.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(runSearch(index, 'wildcats').seasons.items.map((s) => s.id)).toEqual(['s1']);
  });

  it('skips archived evaluations', () => {
    expect(runSearch(index, 'camp').evaluations.total).toBe(0);
  });

  it('matches names in either order and multi-word queries', () => {
    expect(runSearch(index, 'jane doe').players.items.map((p) => p.id)).toEqual(['p1']);
    expect(runSearch(index, 'doe jane').players.items.map((p) => p.id)).toEqual(['p1']);
    expect(runSearch(index, 'jane lee').players.total).toBe(0);
  });

  it('finds a jersey number exactly, not as a substring of others', () => {
    expect(runSearch(index, '7').players.items.map((p) => p.id)).toEqual(['p1']);
    expect(runSearch(index, '#17').players.items.map((p) => p.id)).toEqual(['p2']);
  });

  it('caps each group but reports the true total', () => {
    const many = buildSearchIndex({
      players: Array.from({ length: 60 }, (_, i) => player(`p${i}`, 'Sam', `Smith${i}`)),
    });
    const r = runSearch(many, 'sam', 25);
    expect(r.players.items).toHaveLength(25);
    expect(r.players.total).toBe(60);
  });
});
