import { describe, expect, it } from 'vitest';
import { computeAssessorProgress, computePlayerResults } from './scoring';
import type { Evaluation, Player, Tryout } from './types';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    first: 'Jane',
    last: 'Doe',
    createdAt: 0,
    ...overrides,
  };
}

function makeEval(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: 'e1',
    playerId: 'p1',
    date: '2026-01-01',
    evaluator: 'Coach',
    session: 'Session 1',
    recommendation: '',
    scores: {},
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

describe('computePlayerResults', () => {
  it('returns a zeroed, unrecommended result for a player with no evaluations', () => {
    const tryout = makeTryout({ roster: [makePlayer()] });
    const [result] = computePlayerResults(tryout);
    expect(result.overall).toBe(0);
    expect(result.evalCount).toBe(0);
    expect(result.latestRecommendation).toBe('');
    expect(result.categoryScores).toEqual({});
  });

  it('pools scores across every evaluation for the player and ignores other players', () => {
    const tryout = makeTryout({
      roster: [makePlayer({ id: 'p1' }), makePlayer({ id: 'p2', first: 'Other' })],
      evals: [
        makeEval({ id: 'e1', playerId: 'p1', scores: { skating: 2 } }),
        makeEval({ id: 'e2', playerId: 'p1', scores: { skating: 4 } }),
        makeEval({ id: 'e3', playerId: 'p2', scores: { skating: 5 } }),
      ],
    });
    const [p1Result, p2Result] = computePlayerResults(tryout);
    expect(p1Result.evalCount).toBe(2);
    expect(p1Result.overall).toBe(3);
    expect(p2Result.evalCount).toBe(1);
    expect(p2Result.overall).toBe(5);
  });

  it('routes goalies to the goalie weight map based on position', () => {
    const tryout = makeTryout({
      roster: [makePlayer({ pos: 'GTL' })],
      evals: [makeEval({ scores: { positioning: 4 } })],
      settings: {
        skaterWeights: { skating: 1 },
        goalieWeights: { positioning: 1 },
        customRubrics: [
          { key: 'skating', label: 'Skating', scoringType: 'skill', scale: '1-5', rankingDirection: 'higher_is_better', role: 'skater' },
          { key: 'positioning', label: 'Positioning', scoringType: 'skill', scale: '1-5', rankingDirection: 'higher_is_better', role: 'goalie' },
        ],
      },
    });
    const [result] = computePlayerResults(tryout);
    expect(result.overall).toBe(4);
    expect(result.categoryScores).toEqual({ positioning: 4 });
  });

  it('takes the latest evaluation (by createdAt) as the recommendation of record', () => {
    const tryout = makeTryout({
      roster: [makePlayer()],
      evals: [
        makeEval({ id: 'e1', createdAt: 1, recommendation: 'Bubble' }),
        makeEval({ id: 'e2', createdAt: 2, recommendation: 'Make' }),
      ],
    });
    const [result] = computePlayerResults(tryout);
    expect(result.latestRecommendation).toBe('Make');
  });

  it('preserves roster order and returns one result per player', () => {
    const tryout = makeTryout({
      roster: [makePlayer({ id: 'p1' }), makePlayer({ id: 'p2' }), makePlayer({ id: 'p3' })],
    });
    const results = computePlayerResults(tryout);
    expect(results.map((r) => r.player.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('computeAssessorProgress', () => {
  it('counts distinct scored players per named assessor', () => {
    const tryout = makeTryout({
      assessors: [
        { name: 'Alice', role: 'lead', status: 'accepted' },
        { name: 'Bob', role: 'assessor', status: 'accepted' },
      ],
      roster: [makePlayer({ id: 'p1' }), makePlayer({ id: 'p2' }), makePlayer({ id: 'p3' })],
      evals: [
        makeEval({ id: 'e1', playerId: 'p1', evaluator: 'Alice' }),
        makeEval({ id: 'e2', playerId: 'p2', evaluator: 'Alice' }),
        // A second session for the same player shouldn't double-count.
        makeEval({ id: 'e3', playerId: 'p2', evaluator: 'Alice', session: 'Session 2' }),
        makeEval({ id: 'e4', playerId: 'p1', evaluator: 'Bob' }),
      ],
    });
    const progress = computeAssessorProgress(tryout);
    expect(progress).toEqual([
      { name: 'Alice', scored: 2, total: 3 },
      { name: 'Bob', scored: 1, total: 3 },
    ]);
  });

  it('falls back to a single "headAssessor" (or "Coach") entry when no assessors are listed', () => {
    const withHead = makeTryout({ headAssessor: 'Sam', roster: [makePlayer()] });
    expect(computeAssessorProgress(withHead)).toEqual([{ name: 'Sam', scored: 0, total: 1 }]);

    const withoutHead = makeTryout({ roster: [makePlayer()] });
    expect(computeAssessorProgress(withoutHead)).toEqual([{ name: 'Coach', scored: 0, total: 1 }]);
  });
});
