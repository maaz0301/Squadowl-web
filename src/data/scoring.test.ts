import { describe, expect, it } from 'vitest';

import { buildPlayerFullResults } from '@/data/resultsExport';
import { compareResultsBestFirst, computePlayerResults, metricSummaries } from '@/data/scoring';
import type { Evaluation, Player, Tryout } from '@/data/types';

// Everyone jumps past the Max of 20, so every score is held at 5.0. The raw
// jump is all that tells them apart: Zane 27, Young 25, Adams 22.
const jumps: [string, string, string, number][] = [
  ['p1', 'Amy', 'Zane', 27],
  ['p2', 'Bob', 'Young', 25],
  ['p3', 'Zed', 'Adams', 22],
];

function tryout(): Tryout {
  const roster = jumps.map(([id, first, last]) => ({ id, first, last, pos: 'FWD' }) as Player);
  const evals = jumps.map(
    ([id, , , jump]) =>
      ({ id: 'e' + id, playerId: id, evaluator: 'Coach', session: 'Session 1', date: '2026-09-10', scores: { vj: jump }, createdAt: 1 }) as unknown as Evaluation,
  );
  return {
    id: 't1', name: 'Fitness', createdAt: 0, updatedAt: 0, eventType: 'Tryout', sport: 'Hockey', assessors: [], roster, evals,
    settings: {
      skaterWeights: { vj: 1 }, goalieWeights: { vj: 1 },
      customRubrics: [
        { key: 'vj', label: 'Vertical Jump', scoringType: 'distance', unit: 'in', minVal: 10, maxVal: 20, rankingDirection: 'higher_is_better', role: 'all' },
      ],
    },
    archived: false, viewerIsOwner: true,
  } as unknown as Tryout;
}

describe('measured tests held at the best benchmark', () => {
  it('flags the cap and keeps the raw figure', () => {
    const [m] = metricSummaries(tryout(), tryout().roster[0]);
    expect(m).toMatchObject({ raw: 27, score: 5, capped: true });
  });

  it('does not flag a figure inside the range', () => {
    const t = tryout();
    t.evals[0].scores = { vj: 15 };
    const [m] = metricSummaries(t, t.roster[0]);
    expect(m.capped).toBe(false);
  });

  it('splits a tie on overall by raw figure instead of falling to alphabetical', () => {
    const t = tryout();
    const results = computePlayerResults(t);
    expect(results.every((r) => r.overall === 5)).toBe(true);
    const order = results.slice().sort(compareResultsBestFirst(t)).map((r) => r.player.last);
    expect(order).toEqual(['Zane', 'Young', 'Adams']);
  });

  it('applies the same split to the "results" export order', () => {
    const names = buildPlayerFullResults(tryout(), 'results').map((c) => c.name.split(' ').pop());
    expect(names).toEqual(['Zane', 'Young', 'Adams']);
  });

  it('respects lower-is-better for the split', () => {
    const t = tryout();
    t.settings.customRubrics![0] = { ...t.settings.customRubrics![0], scoringType: 'time', rankingDirection: 'lower_is_better', minVal: 30, maxVal: 60 } as never;
    const order = computePlayerResults(t).sort(compareResultsBestFirst(t)).map((r) => r.player.last);
    expect(order).toEqual(['Adams', 'Young', 'Zane']);
  });
});
