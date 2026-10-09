import { describe, expect, it } from 'vitest';

import { benchmarkLines, canHaveBenchmark, formatBenchmarkValue } from '@/data/benchmarks';
import type { Evaluation, Player, Tryout } from '@/data/types';

function tryout(rubrics: object[]): Tryout {
  const roster = [{ id: 'p1', first: 'Amy', last: 'Zane', pos: 'FWD' }] as Player[];
  const evals = [
    { id: 'e1', playerId: 'p1', evaluator: 'C', session: 'S1', date: '2026-09-10', scores: { vj: 25, sk: 3, dash: 6.5 }, createdAt: 1 },
    { id: 'e2', playerId: 'p1', evaluator: 'C', session: 'S2', date: '2026-09-11', scores: { vj: 29, sk: 4, dash: 6.1 }, createdAt: 2 },
  ] as unknown as Evaluation[];
  return {
    id: 't', name: 'T', createdAt: 0, updatedAt: 0, eventType: 'Tryout', sport: 'Hockey', assessors: [], roster, evals,
    settings: { skaterWeights: {}, goalieWeights: {}, customRubrics: rubrics },
    archived: false, viewerIsOwner: true,
  } as unknown as Tryout;
}

const vj = { key: 'vj', label: 'Vertical Jump', scoringType: 'distance', unit: 'in', minVal: 10, maxVal: 40, rankingDirection: 'higher_is_better', role: 'all' };
const sk = { key: 'sk', label: 'Skating', scoringType: 'skill', scale: '1-5', rankingDirection: 'higher_is_better', role: 'all' };
const dash = { key: 'dash', label: '30m Dash', scoringType: 'time', unit: 'sec', minVal: 4, maxVal: 8, rankingDirection: 'lower_is_better', role: 'all' };

describe('benchmarkLines', () => {
  it('is empty when no rubric sets a benchmark', () => {
    expect(benchmarkLines(tryout([vj, sk]), { id: 'p1', pos: 'FWD' })).toEqual([]);
  });

  it('shows the target, the note and the player average', () => {
    const lines = benchmarkLines(
      tryout([{ ...vj, benchmark: 30, benchmarkNote: 'Elite for this age' }, { ...sk, benchmark: 4 }]),
      { id: 'p1', pos: 'FWD' },
    );
    expect(lines).toEqual([
      { key: 'vj', label: 'Vertical Jump', target: '30 in', note: 'Elite for this age', result: '27 in', met: false },
      { key: 'sk', label: 'Skating', target: '4/5', note: '', result: '3.5/5', met: false },
    ]);
  });

  it('reads a lower-is-better rubric the right way round', () => {
    const [line] = benchmarkLines(tryout([{ ...dash, benchmark: 6.5 }]), { id: 'p1', pos: 'FWD' });
    expect(line).toMatchObject({ target: '6.5 sec', result: '6.3 sec', met: true });
  });

  it('stays unscored for a player with no results', () => {
    const [line] = benchmarkLines(tryout([{ ...vj, benchmark: 30 }]), { id: 'nobody', pos: 'FWD' });
    expect(line).toMatchObject({ result: '', met: null });
  });

  it('formats by rubric type and skips two-state rubrics', () => {
    expect(formatBenchmarkValue({ scoringType: 'observation' }, 70)).toBe('70/100');
    expect(formatBenchmarkValue({ scoringType: 'skill', scale: '1-10' }, 7.5)).toBe('7.5/10');
    expect(canHaveBenchmark('yes_no')).toBe(false);
    expect(canHaveBenchmark('skill')).toBe(true);
  });
});
