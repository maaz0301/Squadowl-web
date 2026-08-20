import { describe, expect, it } from 'vitest';
import {
  buildDefaultWeights,
  categoryAverage,
  categoryAverageAcrossEvals,
  categoryAveragesAcrossEvals,
  compareSubskillScores,
  generateAthleteId,
  generateCloudCode,
  generateId,
  getDefaultRubrics,
  getDefaultWeights,
  getPlayerCategories,
  getPlayerSubskills,
  getScoreHeatLevel,
  isGoaliePosition,
  mapLegacyScores,
  normalizeScore,
  playerDisplayName,
  playerInitials,
  weightedOverall,
  weightedOverallAcrossEvals,
  type RubricCategory,
} from './rubrics';
import type { Evaluation } from './types';

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

describe('isGoaliePosition', () => {
  it('matches GTL and any label containing "goal"', () => {
    expect(isGoaliePosition('GTL')).toBe(true);
    expect(isGoaliePosition('Goalie')).toBe(true);
    expect(isGoaliePosition('goaltender')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isGoaliePosition('gtl')).toBe(true);
  });

  it('returns false for skater positions and empty input', () => {
    expect(isGoaliePosition('FWD')).toBe(false);
    expect(isGoaliePosition('DEF')).toBe(false);
    expect(isGoaliePosition(undefined)).toBe(false);
    expect(isGoaliePosition('')).toBe(false);
  });
});

describe('compareSubskillScores', () => {
  it('ranks higher value first by default (higher_is_better)', () => {
    expect(compareSubskillScores(5, 3)).toBeLessThan(0);
    expect(compareSubskillScores(3, 5)).toBeGreaterThan(0);
    expect(compareSubskillScores(4, 4)).toBe(0);
  });

  it('ranks lower value first when direction is lower_is_better', () => {
    expect(compareSubskillScores(3, 5, 'lower_is_better')).toBeLessThan(0);
    expect(compareSubskillScores(5, 3, 'lower_is_better')).toBeGreaterThan(0);
  });

  it('sorts undefined scores to the bottom regardless of direction', () => {
    expect(compareSubskillScores(undefined, 3)).toBeGreaterThan(0);
    expect(compareSubskillScores(3, undefined)).toBeLessThan(0);
    expect(compareSubskillScores(undefined, 3, 'lower_is_better')).toBeGreaterThan(0);
    expect(compareSubskillScores(undefined, undefined)).toBe(0);
  });
});

describe('normalizeScore', () => {
  it('returns null for missing or NaN input', () => {
    expect(normalizeScore(undefined)).toBeNull();
    expect(normalizeScore(NaN)).toBeNull();
  });

  it('halves a 1-10 skill score onto the 1-5 scale and clamps out-of-range values', () => {
    expect(normalizeScore(10, '1-10')).toBe(5);
    expect(normalizeScore(2, '1-10')).toBe(1);
    expect(normalizeScore(15, '1-10')).toBe(5); // clamped to max
    expect(normalizeScore(0, '1-10')).toBe(0.5); // clamped to min (1) then halved
  });

  it('passes a 1-5 skill score through unchanged, clamped to range', () => {
    expect(normalizeScore(3, '1-5')).toBe(3);
    expect(normalizeScore(10, '1-5')).toBe(5);
    expect(normalizeScore(0, '1-5')).toBe(1);
  });

  it('normalizes a "time" metric so lower raw values score higher', () => {
    // minVal=10 (best->5), maxVal=20 (worst->1)
    expect(normalizeScore(10, '1-5', 'time', 10, 20)).toBe(5);
    expect(normalizeScore(20, '1-5', 'time', 10, 20)).toBe(1);
    expect(normalizeScore(15, '1-5', 'time', 10, 20)).toBe(3);
    // out of bounds clamps to the nearest endpoint
    expect(normalizeScore(5, '1-5', 'time', 10, 20)).toBe(5);
    expect(normalizeScore(25, '1-5', 'time', 10, 20)).toBe(1);
  });

  it('normalizes a "distance"/"speed" metric so higher raw values score higher', () => {
    // minVal=0 (worst->1), maxVal=100 (best->5)
    expect(normalizeScore(0, '1-5', 'distance', 0, 100)).toBe(1);
    expect(normalizeScore(100, '1-5', 'distance', 0, 100)).toBe(5);
    expect(normalizeScore(50, '1-5', 'distance', 0, 100)).toBe(3);
  });

  it('returns the raw metric value when no min/max benchmark is defined', () => {
    expect(normalizeScore(42, '1-5', 'time')).toBe(42);
  });
});

describe('getScoreHeatLevel', () => {
  it('buckets scores against the default max of 5', () => {
    expect(getScoreHeatLevel(5)).toBe('great'); // 100%
    expect(getScoreHeatLevel(4)).toBe('good'); // 80%
    expect(getScoreHeatLevel(3)).toBe('avg'); // 60%
    expect(getScoreHeatLevel(2.5)).toBe('low'); // 50%
    expect(getScoreHeatLevel(1)).toBe('poor'); // 20%
  });

  it('respects a custom max', () => {
    expect(getScoreHeatLevel(9, 10)).toBe('great');
    expect(getScoreHeatLevel(1, 10)).toBe('poor');
  });
});

describe('getDefaultRubrics / getDefaultWeights', () => {
  it('return empty skater/goalie buckets (7.1 removed sport-specific template rubrics)', () => {
    expect(getDefaultRubrics('Hockey')).toEqual({ skater: [], goalie: [] });
    expect(getDefaultWeights('Soccer')).toEqual({ skater: {}, goalie: {} });
  });
});

describe('getPlayerCategories / getPlayerSubskills', () => {
  const customRubrics = [
    { key: 'SK1', label: 'Skating', role: 'skater' as const },
    { key: 'GK1', label: 'Positioning', role: 'goalie' as const },
    { key: 'ALL1', label: 'Hockey IQ', role: 'all' as const },
    { key: 'ROLELESS', label: 'Compete Level' },
  ];

  it('includes only rubrics matching the resolved role, plus role-agnostic ones', () => {
    const skaterCats = getPlayerCategories('Hockey', 'FWD', customRubrics);
    expect(skaterCats.map((c) => c.key).sort()).toEqual(['ALL1', 'ROLELESS', 'SK1'].sort());

    const goalieCats = getPlayerCategories('Hockey', 'GTL', customRubrics);
    expect(goalieCats.map((c) => c.key).sort()).toEqual(['ALL1', 'GK1', 'ROLELESS'].sort());
  });

  it('defaults to skater categories when no position is given', () => {
    const cats = getPlayerCategories('Hockey', undefined, customRubrics);
    expect(cats.map((c) => c.key).sort()).toEqual(['ALL1', 'ROLELESS', 'SK1'].sort());
  });

  it('flattens categories into their single subskill (one custom rubric = one subskill)', () => {
    const subskills = getPlayerSubskills('Hockey', 'FWD', customRubrics);
    expect(subskills).toHaveLength(3);
    expect(subskills.every((s) => s.key)).toBe(true);
  });

  it('defaults scale to 1-5 and rankingDirection based on scoringType', () => {
    const [cat] = getPlayerCategories('Hockey', 'FWD', [
      { key: 'TIME1', label: 'Sprint', scoringType: 'time', role: 'skater' },
    ]);
    expect(cat.subskills[0].scale).toBe('1-5');
    expect(cat.subskills[0].rankingDirection).toBe('lower_is_better');
  });
});

describe('buildDefaultWeights', () => {
  it('splits weight equally across categories', () => {
    const categories: RubricCategory[] = [
      { key: 'a', label: 'A', role: 'skater', subskills: [] },
      { key: 'b', label: 'B', role: 'skater', subskills: [] },
      { key: 'c', label: 'C', role: 'skater', subskills: [] },
      { key: 'd', label: 'D', role: 'skater', subskills: [] },
    ];
    const weights = buildDefaultWeights(categories);
    expect(weights).toEqual({ a: 0.25, b: 0.25, c: 0.25, d: 0.25 });
  });

  it('falls back to a single full-weight bucket for an empty category list', () => {
    expect(buildDefaultWeights([])).toEqual({});
  });
});

describe('mapLegacyScores', () => {
  const categories: RubricCategory[] = [
    {
      key: 'skating',
      label: 'Skating',
      role: 'skater',
      subskills: [{ key: 'SK1 Accel', label: 'Acceleration' }],
    },
  ];

  it('copies a legacy short-key score onto the current long key when the long key is unset', () => {
    const mapped = mapLegacyScores({ SK1: 4 }, categories);
    expect(mapped['SK1 Accel']).toBe(4);
    expect(mapped.SK1).toBe(4); // legacy key preserved, not removed
  });

  it('does not overwrite a score already present under the current key', () => {
    const mapped = mapLegacyScores({ SK1: 4, 'SK1 Accel': 2 }, categories);
    expect(mapped['SK1 Accel']).toBe(2);
  });

  it('returns an empty object for falsy input', () => {
    expect(mapLegacyScores(undefined as unknown as Record<string, number>, categories)).toEqual({});
  });
});

describe('categoryAverage', () => {
  const subskills = [
    { key: 'a', label: 'A', scale: '1-5' as const },
    { key: 'b', label: 'B', scale: '1-5' as const },
  ];

  it('averages the normalized scores present in the map', () => {
    expect(categoryAverage({ a: 4, b: 2 }, subskills)).toBe(3);
  });

  it('ignores subskills missing from the score map', () => {
    expect(categoryAverage({ a: 5 }, subskills)).toBe(5);
  });

  it('returns null when no subskill has been scored', () => {
    expect(categoryAverage({}, subskills)).toBeNull();
  });
});

describe('categoryAverageAcrossEvals / categoryAveragesAcrossEvals', () => {
  const subskills = [{ key: 'a', label: 'A', scale: '1-5' as const }];
  const categories: RubricCategory[] = [{ key: 'cat', label: 'Cat', role: 'skater', subskills }];

  it('pools scores for one category across multiple evaluations', () => {
    const evals = [makeEval({ scores: { a: 2 } }), makeEval({ scores: { a: 4 } })];
    expect(categoryAverageAcrossEvals(evals, subskills)).toBe(3);
  });

  it('returns null when no evaluation has a score for the subskill', () => {
    expect(categoryAverageAcrossEvals([makeEval({ scores: {} })], subskills)).toBeNull();
  });

  it('keys per-category averages and omits categories with no score at all', () => {
    const evals = [makeEval({ scores: { a: 4 } })];
    const otherCategories: RubricCategory[] = [
      ...categories,
      { key: 'empty', label: 'Empty', role: 'skater', subskills: [{ key: 'z', label: 'Z' }] },
    ];
    expect(categoryAveragesAcrossEvals(evals, otherCategories)).toEqual({ cat: 4 });
  });
});

describe('weightedOverall / weightedOverallAcrossEvals', () => {
  const categories: RubricCategory[] = [
    { key: 'skating', label: 'Skating', role: 'skater', subskills: [{ key: 'sk', label: 'SK' }] },
    { key: 'shooting', label: 'Shooting', role: 'skater', subskills: [{ key: 'sh', label: 'SH' }] },
  ];

  it('weights each category average by its configured weight', () => {
    const weights = { skating: 0.75, shooting: 0.25 };
    // skating=4, shooting=2 -> (4*0.75 + 2*0.25) / 1 = 3.5
    expect(weightedOverall({ sk: 4, sh: 2 }, categories, weights)).toBe(3.5);
  });

  it('falls back to an equal share for a category missing from the weights map', () => {
    const weights = {};
    // both categories default to weight 1/2 each -> plain average
    expect(weightedOverall({ sk: 4, sh: 2 }, categories, weights)).toBe(3);
  });

  it('skips unscored categories rather than treating them as zero', () => {
    const weights = { skating: 0.5, shooting: 0.5 };
    expect(weightedOverall({ sk: 4 }, categories, weights)).toBe(4);
  });

  it('returns 0 when nothing has been scored', () => {
    expect(weightedOverall({}, categories, {})).toBe(0);
  });

  it('restricts to skill-typed categories when at least one exists, ignoring pure time/metric categories', () => {
    const mixed: RubricCategory[] = [
      { key: 'skill', label: 'Skill', role: 'skater', subskills: [{ key: 's', label: 'S', scoringType: 'skill' }] },
      { key: 'sprint', label: 'Sprint', role: 'skater', subskills: [{ key: 't', label: 'T', scoringType: 'time' }] },
    ];
    // Only the skill category should count toward the overall.
    expect(weightedOverall({ s: 5, t: 1 }, mixed, { skill: 1, sprint: 1 })).toBe(5);
  });

  it('pools scores across evaluations for weightedOverallAcrossEvals', () => {
    const weights = { skating: 0.5, shooting: 0.5 };
    const evals = [makeEval({ scores: { sk: 2, sh: 2 } }), makeEval({ scores: { sk: 4, sh: 4 } })];
    expect(weightedOverallAcrossEvals(evals, categories, weights)).toBe(3);
  });
});

describe('generateId / generateAthleteId / generateCloudCode', () => {
  it('generates a prefixed random id when a prefix is given', () => {
    const id = generateId('tryout');
    expect(id.startsWith('tryout_')).toBe(true);
    expect(id.length).toBeGreaterThan('tryout_'.length);
  });

  it('omits the separator when no prefix is given', () => {
    expect(generateId()).not.toContain('_');
  });

  it('generates an 8-digit numeric athlete id', () => {
    const id = generateAthleteId();
    expect(id).toMatch(/^\d{8}$/);
  });

  it('generates a 6-character cloud code from the restricted alphabet (no ambiguous chars)', () => {
    const code = generateCloudCode();
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });
});

describe('playerDisplayName / playerInitials', () => {
  it('joins first and last name', () => {
    expect(playerDisplayName({ first: 'Jane', last: 'Doe' })).toBe('Jane Doe');
  });

  it('falls back to firstName/lastName aliases', () => {
    expect(playerDisplayName({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe');
  });

  it('returns "Anonymous" for anonymous players regardless of name', () => {
    expect(playerDisplayName({ first: 'Jane', last: 'Doe', anonymous: true })).toBe('Anonymous');
  });

  it('returns "Unknown Player" when no name is present', () => {
    expect(playerDisplayName({})).toBe('Unknown Player');
  });

  it('builds uppercase initials from first and last name', () => {
    expect(playerInitials({ first: 'jane', last: 'doe' })).toBe('JD');
  });

  it('tolerates a missing name half', () => {
    expect(playerInitials({ first: 'Jane' })).toBe('J');
    expect(playerInitials({})).toBe('');
  });
});
