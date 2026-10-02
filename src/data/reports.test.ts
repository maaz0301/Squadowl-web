import { describe, expect, it } from 'vitest';
import { buildReportSummary, listReportRubrics, topPerformersByRubric } from './reports';
import type { Evaluation, Player, Tryout } from './types';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return { id: 'p1', first: 'Jane', last: 'Doe', createdAt: 0, ...overrides };
}

function makeEval(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: 'e1',
    playerId: 'p1',
    date: '2026-01-01',
    evaluator: 'Coach',
    session: 'Session 1',
    recommendation: '',
    scores: { skating: 3 },
    createdAt: 0,
    ...overrides,
  };
}

function makeTryout(overrides: Partial<Tryout> = {}): Tryout {
  return {
    id: 't1',
    name: 'Fall Tryout',
    createdAt: 0,
    updatedAt: 0,
    eventType: 'Tryout',
    sport: 'Hockey',
    assessors: [],
    roster: [],
    evals: [],
    settings: {
      skaterWeights: { skating: 1 },
      goalieWeights: { positioning: 1 },
      customRubrics: [{ key: 'skating', label: 'Skating', scoringType: 'skill', scale: '1-5', rankingDirection: 'higher_is_better', role: 'skater' }],
    },
    archived: false,
    viewerIsOwner: true,
    ...overrides,
  };
}

describe('buildReportSummary', () => {
  it('is all zeros and nulls with no evaluations', () => {
    const s = buildReportSummary([]);
    expect(s.evaluationCount).toBe(0);
    expect(s.avgOverall).toBeNull();
    expect(s.completion).toBe(0);
    expect(s.rows).toEqual([]);
    expect(s.topPerformers).toEqual([]);
    expect(s.recommendations).toEqual({ Make: 0, Keep: 0, Bubble: 0, Release: 0, Undecided: 0 });
  });

  it('reports progress, average and leader per evaluation', () => {
    const t = makeTryout({
      roster: [
        makePlayer({ id: 'p1', first: 'Ann', last: 'A' }),
        makePlayer({ id: 'p2', first: 'Bo', last: 'B' }),
        makePlayer({ id: 'p3', first: 'Cy', last: 'C' }),
      ],
      evals: [
        makeEval({ id: 'e1', playerId: 'p1', scores: { skating: 2 } }),
        makeEval({ id: 'e2', playerId: 'p2', scores: { skating: 5 } }),
        // A second session for p2 still counts as one scored player.
        makeEval({ id: 'e3', playerId: 'p2', scores: { skating: 5 } }),
      ],
    });
    const [row] = buildReportSummary([t]).rows;
    expect(row.players).toBe(3);
    expect(row.scoredPlayers).toBe(2);
    expect(row.unscored).toBe(1);
    expect(row.completion).toBeCloseTo(2 / 3);
    expect(row.scoresRecorded).toBe(3);
    expect(row.avgOverall).toBe(3.5);
    expect(row.top).toEqual({ name: 'Bo B', overall: 5 });
  });

  it('leaves the average and leader empty until someone is scored', () => {
    const [row] = buildReportSummary([makeTryout({ roster: [makePlayer()] })]).rows;
    expect(row.avgOverall).toBeNull();
    expect(row.top).toBeNull();
    expect(row.completion).toBe(0);
  });

  it('rolls totals up across evaluations and orders rows newest first', () => {
    const older = makeTryout({
      id: 'old',
      name: 'Old',
      createdAt: 1,
      roster: [makePlayer({ id: 'p1' })],
      evals: [makeEval({ playerId: 'p1', scores: { skating: 2 } })],
    });
    const newer = makeTryout({
      id: 'new',
      name: 'New',
      createdAt: 2,
      roster: [makePlayer({ id: 'p1' }), makePlayer({ id: 'p2' })],
      evals: [makeEval({ id: 'e9', playerId: 'p1', scores: { skating: 4 } })],
    });
    const s = buildReportSummary([older, newer]);
    expect(s.rows.map((r) => r.id)).toEqual(['new', 'old']);
    expect(s.evaluationCount).toBe(2);
    expect(s.playerCount).toBe(3);
    expect(s.scoredPlayerCount).toBe(2);
    expect(s.completion).toBeCloseTo(2 / 3);
    expect(s.avgOverall).toBe(3);
  });

  it('splits recommendations by each scored player’s latest call', () => {
    const t = makeTryout({
      roster: [makePlayer({ id: 'p1' }), makePlayer({ id: 'p2' }), makePlayer({ id: 'p3' }), makePlayer({ id: 'p4' })],
      evals: [
        makeEval({ id: 'a', playerId: 'p1', createdAt: 1, recommendation: 'Bubble' }),
        makeEval({ id: 'b', playerId: 'p1', createdAt: 2, recommendation: 'Make' }),
        makeEval({ id: 'c', playerId: 'p2', recommendation: 'Release' }),
        makeEval({ id: 'd', playerId: 'p3', recommendation: '' }),
        // p4 was never scored, so it is not in any bucket.
      ],
    });
    expect(buildReportSummary([t]).recommendations).toEqual({
      Make: 1,
      Keep: 0,
      Bubble: 0,
      Release: 1,
      Undecided: 1,
    });
  });

  it('lists the highest overall first and caps the list', () => {
    const t = makeTryout({
      roster: [1, 2, 3, 4].map((n) => makePlayer({ id: `p${n}`, first: `P${n}`, last: 'X' })),
      evals: [1, 2, 3, 4].map((n) => makeEval({ id: `e${n}`, playerId: `p${n}`, scores: { skating: n } })),
    });
    const top = buildReportSummary([t], 2).topPerformers;
    expect(top.map((p) => p.name)).toEqual(['P4 X', 'P3 X']);
    expect(top[0]).toMatchObject({ playerId: 'p4', evaluationId: 't1', evaluationName: 'Fall Tryout', overall: 4 });
  });
});

describe('top performers by measure', () => {
  const rubrics = [
    { key: 'skating', label: 'Skating', scoringType: 'skill' as const, scale: '1-5' as const, rankingDirection: 'higher_is_better' as const, role: 'skater' as const },
    { key: 'sprint', label: 'Sprint', unit: 's', scoringType: 'time' as const, scale: '1-5' as const, rankingDirection: 'lower_is_better' as const, role: 'skater' as const },
  ];
  const tryout = makeTryout({
    roster: [makePlayer({ id: 'a', first: 'Ana' }), makePlayer({ id: 'b', first: 'Bo' }), makePlayer({ id: 'c', first: 'Cy' })],
    evals: [
      makeEval({ id: '1', playerId: 'a', scores: { skating: 5, sprint: 6.4 } }),
      makeEval({ id: '2', playerId: 'a', scores: { skating: 3, sprint: 6.6 } }),
      makeEval({ id: '3', playerId: 'b', scores: { skating: 4, sprint: 5.9 } }),
      makeEval({ id: '4', playerId: 'c', scores: { skating: 2 } }),
    ],
    settings: { skaterWeights: { skating: 1 }, goalieWeights: { positioning: 1 }, customRubrics: rubrics },
  });

  it('lists the measures that have scores, alphabetically', () => {
    expect(listReportRubrics([tryout]).map((r) => r.label)).toEqual(['Skating', 'Sprint']);
    expect(listReportRubrics([makeTryout()])).toEqual([]);
  });

  it('ranks a skill highest first, by each player\'s average across sessions', () => {
    const top = topPerformersByRubric([tryout], 'skating');
    expect(top.map((p) => [p.name, p.overall])).toEqual([['Ana Doe', 4], ['Bo Doe', 4], ['Cy Doe', 2]]);
  });

  it('ranks a time fastest first and skips players with no score on it', () => {
    const top = topPerformersByRubric([tryout], 'sprint');
    expect(top.map((p) => p.name)).toEqual(['Bo Doe', 'Ana Doe']);
    expect(top[0].unit).toBe('s');
  });

  it('matches a measure by name across evaluations and caps the list', () => {
    const other = makeTryout({
      id: 't2',
      name: 'Spring',
      roster: [makePlayer({ id: 'x', first: 'Xi' })],
      evals: [makeEval({ id: '9', playerId: 'x', scores: { skating: 5 } })],
    });
    const top = topPerformersByRubric([tryout, other], 'skating', 2);
    expect(top).toHaveLength(2);
    expect(top.some((p) => p.name === 'Xi Doe')).toBe(true);
  });
});
