import { describe, expect, it } from 'vitest';

import { buildFullResultsCsvRows, buildPlayerFullResults, isReportFilterActive, reportFilterChoices, reportSortOptions } from '@/data/resultsExport';
import type { Evaluation, Player, Tryout } from '@/data/types';

// id, first, last, jersey, position, birth (date or year), overall score (null = unscored)
const people: [string, string, string, string, string, string, number | null][] = [
  ['p1', 'Mia', 'Zane', '9', 'FWD', '2012-03-04', 2],
  ['p2', 'Bob', 'Young', '10', 'DEF', '2011-11-20', 5],
  ['p3', 'Zed', 'Adams', '2', 'FWD', '2012', 4],
  ['p4', 'Cara', 'Xu', '', 'GTL', '', null],
];

function tryout(): Tryout {
  const roster = people.map(([id, first, last, jersey, pos, birth]) => {
    const dob = /^\d{4}-/.test(birth) ? birth : undefined;
    return { id, first, last, jersey, pos, dateOfBirth: dob, yearOfBirth: birth.slice(0, 4) || undefined } as Player;
  });
  const evals = people
    .filter((p) => p[6] != null)
    .map(
      (p) =>
        ({ id: 'e' + p[0], playerId: p[0], evaluator: 'Coach', session: 'Session 1', date: '2026-09-10', scores: { skating: p[6] }, createdAt: 1 }) as unknown as Evaluation,
    );
  return {
    id: 't1', name: 'Fall', createdAt: 0, updatedAt: 0, eventType: 'Tryout', sport: 'Hockey', assessors: [], roster, evals,
    settings: {
      skaterWeights: { skating: 1 }, goalieWeights: { skating: 1 },
      customRubrics: [{ key: 'skating', label: 'Skating', scoringType: 'skill', scale: '1-5', rankingDirection: 'higher_is_better', role: 'all' }],
    },
    archived: false, viewerIsOwner: true,
  } as unknown as Tryout;
}

const lasts = (sort?: Parameters<typeof buildPlayerFullResults>[1], filter?: Parameters<typeof buildPlayerFullResults>[2]) =>
  buildPlayerFullResults(tryout(), sort, filter).map((c) => c.name.split(' ').pop());

describe('report sort orders', () => {
  it('first name A-Z', () => expect(lasts('firstName')).toEqual(['Young', 'Xu', 'Zane', 'Adams']));
  it('age youngest first, unknown last', () => expect(lasts('ageYoungest')).toEqual(['Zane', 'Adams', 'Young', 'Xu']));
  it('age oldest first, unknown last', () => expect(lasts('ageOldest')).toEqual(['Young', 'Adams', 'Zane', 'Xu']));
  it('results best first with unscored last', () => expect(lasts('results')).toEqual(['Young', 'Adams', 'Zane', 'Xu']));
  it('results worst first with unscored still last', () => expect(lasts('resultsWorst')).toEqual(['Zane', 'Adams', 'Young', 'Xu']));
  it('position A-Z', () => expect(lasts('position')).toEqual(['Young', 'Adams', 'Zane', 'Xu']));
  it('numbers sort 2, 9, 10 and blank last', () => expect(lasts('jersey')).toEqual(['Adams', 'Zane', 'Young', 'Xu']));
});

describe('report filters', () => {
  it('no filter keeps everyone', () => {
    expect(isReportFilterActive({})).toBe(false);
    expect(lasts('name', {})).toHaveLength(4);
  });
  it('scored only drops players with no evaluations', () => expect(lasts('name', { scoredOnly: true })).toEqual(['Adams', 'Young', 'Zane']));
  it('top X takes the best X scored players', () => expect(lasts('results', { topX: 2 })).toEqual(['Young', 'Adams']));
  it('score above a threshold', () => expect(lasts('results', { minScore: 4 })).toEqual(['Young', 'Adams']));
  it('by position, several allowed', () => expect(lasts('name', { positions: ['FWD', 'GTL'] })).toEqual(['Adams', 'Xu', 'Zane']));
  it('by birth year uses the full date when there is one', () => expect(lasts('name', { birthYears: ['2012'] })).toEqual(['Adams', 'Zane']));
  it('filters combine', () => expect(lasts('name', { positions: ['FWD'], minScore: 3 })).toEqual(['Adams']));
  it('keeps ranks against the whole roster', () => {
    const [only] = buildPlayerFullResults(tryout(), 'name', { positions: ['FWD'], birthYears: ['2012'], topX: 1 });
    expect(only.name).toContain('Adams');
    expect(only.overallRank).toBe('2/3');
  });
});

describe('report choices', () => {
  it('lists the roster positions and birth years', () => {
    expect(reportFilterChoices(tryout())).toEqual({ positions: ['DEF', 'FWD', 'GTL'], birthYears: ['2011', '2012'] });
  });
  it('labels the number option from the evaluation terms', () => {
    expect(reportSortOptions(tryout())[0]).toEqual({ key: 'jersey', label: 'Jersey #' });
  });
});

describe('CSV and XLSX rows follow the same order and filter', () => {
  const firstCells = (sort?: Parameters<typeof buildFullResultsCsvRows>[1], filter?: Parameters<typeof buildFullResultsCsvRows>[2]) =>
    buildFullResultsCsvRows(tryout(), sort, filter).playerBlocks.map((b) => String(b[0][1]).split(' ').pop());

  it('defaults to jersey order with everyone', () => expect(firstCells()).toEqual(['Adams', 'Zane', 'Young', 'Xu']));
  it('sorts', () => expect(firstCells('results')).toEqual(['Young', 'Adams', 'Zane', 'Xu']));
  it('filters', () => expect(firstCells('name', { scoredOnly: true, positions: ['FWD'] })).toEqual(['Adams', 'Zane']));
});

describe('report card rows in the rubric own units', () => {
  const jumpTryout = (): Tryout => {
    const base = tryout();
    return {
      ...base,
      evals: [
        { id: 'a', playerId: 'p1', evaluator: 'C', session: 'S1', date: '2026-10-01', scores: { jump: 30 }, createdAt: 1 },
        { id: 'b', playerId: 'p1', evaluator: 'C', session: 'S2', date: '2026-10-02', scores: { jump: 34 }, createdAt: 2 },
      ] as unknown as Evaluation[],
      settings: {
        ...base.settings,
        customRubrics: [
          { key: 'jump', label: 'Vertical Jump', scoringType: 'distance', unit: 'inches', minVal: 10, maxVal: 40, rankingDirection: 'higher_is_better', role: 'all', benchmark: 36 },
        ],
      },
    } as unknown as Tryout;
  };

  it('shows the average jump in inches beside its benchmark and rank', () => {
    const card = buildPlayerFullResults(jumpTryout()).find((c) => c.playerId === 'p1')!;
    const jump = card.metrics.find((m) => m.label === 'Vertical Jump')!;
    expect(jump.actual).toBe('32 inches');
    expect(jump.benchmark).toBe('36 inches');
    expect(jump.met).toBe(false);
    expect(jump.rank).toBe('1/1');
  });
});
