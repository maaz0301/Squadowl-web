import { describe, expect, it } from 'vitest';
import {
  MAX_COMPARE_PLAYERS,
  addToSelection,
  availableBirthYears,
  buildComparison,
  columnId,
  filterCandidates,
  isTopPerformer,
  nextSort,
  teamsOf,
  type CompareAssessment,
  type CompareCandidate,
} from './compare';

const cand = (id: string, first: string, last: string, extra: Partial<CompareCandidate> = {}): CompareCandidate => ({
  id,
  first,
  last,
  teams: [],
  ...extra,
});

const assess = (
  tryoutId: string,
  overall: number,
  scores: Record<string, number>,
  extra: Partial<CompareAssessment> = {},
): CompareAssessment => ({
  tryoutId,
  tryoutName: tryoutId,
  overall,
  evalCount: overall > 0 ? 1 : 0,
  scores,
  columns: Object.fromEntries(Object.keys(scores).map((k) => [k, { label: k }])),
  ...extra,
});

describe('filterCandidates', () => {
  const list = [
    cand('1', 'Mia', 'Chen', { dateOfBirth: '2014-03-02', yearOfBirth: '2014', teams: [{ teamId: 'a', teamName: 'A' }] }),
    cand('2', 'Noah', 'Chen-Smith', { dateOfBirth: '2015-11-20', teams: [{ teamId: 'b', teamName: 'B' }] }),
    cand('3', 'Ava', 'Lopez', { yearOfBirth: '2013', teams: [{ teamId: 'a', teamName: 'A' }] }),
    cand('4', 'Zed', 'Nobirth'),
  ];

  it('matches partial names in any order', () => {
    expect(filterCandidates(list, { query: 'chen mia' }).map((c) => c.id)).toEqual(['1']);
    expect(filterCandidates(list, { query: 'chen' }).map((c) => c.id)).toEqual(['1', '2']);
  });
  it('filters by team and by single year', () => {
    expect(filterCandidates(list, { teamIds: ['a'] }).map((c) => c.id)).toEqual(['1', '3']);
    expect(filterCandidates(list, { year: '2014' }).map((c) => c.id)).toEqual(['1']);
    expect(filterCandidates(list, { year: '2013' }).map((c) => c.id)).toEqual(['3']);
  });
  it('filters by an inclusive date range, falling back to the year when only a year is known', () => {
    expect(filterCandidates(list, { from: '2014-01-01', to: '2015-12-31' }).map((c) => c.id)).toEqual(['1', '2']);
    expect(filterCandidates(list, { from: '2014-03-03', to: '2015-11-19' }).map((c) => c.id)).toEqual([]);
    expect(filterCandidates(list, { from: '2013-01-01', to: '2013-12-31' }).map((c) => c.id)).toEqual(['3']);
  });
  it('lists birth years newest first and the distinct teams', () => {
    expect(availableBirthYears(list)).toEqual(['2015', '2014', '2013']);
    expect(teamsOf(list).map((t) => t.teamName)).toEqual(['A', 'B']);
  });
});

describe('selection', () => {
  it('stops at the limit and never duplicates', () => {
    const ids = Array.from({ length: 150 }, (_, i) => `p${i}`);
    const out = addToSelection(['p0'], ids);
    expect(out).toHaveLength(MAX_COMPARE_PLAYERS);
    expect(new Set(out).size).toBe(MAX_COMPARE_PLAYERS);
  });
});

describe('buildComparison', () => {
  const skating = columnId('Skating');
  const shooting = columnId('Shooting');
  const candidates = [cand('a', 'Ann', 'A'), cand('b', 'Bo', 'B'), cand('c', 'Cy', 'C'), cand('d', 'Di', 'D')];
  const assessments = {
    a: [assess('t2', 4, { [skating]: 4, [shooting]: 3 })],
    b: [assess('t2', 4, { [skating]: 5, [shooting]: 2 })],
    c: [assess('t2', 3, { [skating]: 3 })],
    d: [assess('t2', 0, {})],
  };

  it('ranks by overall with ties sharing a place and unscored players last', () => {
    const t = buildComparison({ candidates, assessments, selectedIds: ['d', 'c', 'b', 'a'] });
    const byId = Object.fromEntries(t.rows.map((r) => [r.athleteId, r.rank]));
    expect(byId).toEqual({ a: 1, b: 1, c: 3, d: null });
    expect(t.rows[t.rows.length - 1].athleteId).toBe('d');
  });
  it('marks the top performer per column', () => {
    const t = buildComparison({ candidates, assessments, selectedIds: ['a', 'b', 'c'] });
    expect(isTopPerformer(t, skating, 5)).toBe(true);
    expect(isTopPerformer(t, skating, 4)).toBe(false);
    expect(isTopPerformer(t, shooting, 3)).toBe(true);
  });
  it('sorts by a column and keeps unscored last either way', () => {
    const asc = buildComparison({ candidates, assessments, selectedIds: ['a', 'b', 'c', 'd'], sort: { key: skating, dir: 'asc' } });
    expect(asc.rows.map((r) => r.athleteId)).toEqual(['c', 'a', 'b', 'd']);
    const desc = buildComparison({ candidates, assessments, selectedIds: ['a', 'b', 'c', 'd'], sort: { key: skating, dir: 'desc' } });
    expect(desc.rows.map((r) => r.athleteId)).toEqual(['b', 'a', 'c', 'd']);
  });
  it('shows the most recent evaluation by default and honours a switch', () => {
    const multi = {
      a: [
        assess('new', 4, { [skating]: 4 }, { date: '2026-10-01' }),
        assess('old', 2, { [skating]: 2 }, { date: '2025-10-01' }),
      ],
    };
    const base = { candidates, assessments: multi, selectedIds: ['a'] };
    expect(buildComparison(base).rows[0].assessment?.tryoutId).toBe('new');
    expect(buildComparison({ ...base, choices: { a: 'old' } }).rows[0].overall).toBe(2);
  });
  it('flips direction on the same header and starts names ascending', () => {
    expect(nextSort({ key: 'rank', dir: 'asc' }, 'rank')).toEqual({ key: 'rank', dir: 'desc' });
    expect(nextSort({ key: 'rank', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort({ key: 'rank', dir: 'asc' }, skating)).toEqual({ key: skating, dir: 'desc' });
  });
  it('stays fast at 100 players across 30 columns', () => {
    const cols = Array.from({ length: 30 }, (_, i) => columnId(`Rubric ${i}`));
    const many = Array.from({ length: 100 }, (_, i) => cand(`p${i}`, `P${i}`, 'X'));
    const ass: Record<string, CompareAssessment[]> = {};
    many.forEach((c, i) => {
      ass[c.id] = [assess('t', 1 + (i % 5), Object.fromEntries(cols.map((k, j) => [k, 1 + ((i + j) % 5)])))];
    });
    const start = performance.now();
    const t = buildComparison({ candidates: many, assessments: ass, selectedIds: many.map((c) => c.id), sort: { key: cols[3], dir: 'desc' } });
    expect(t.rows).toHaveLength(100);
    expect(t.columns).toHaveLength(30);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
