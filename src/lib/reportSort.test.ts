import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { buildPlayerFullResults, REPORT_SORT_OPTIONS } from '@/data/resultsExport';
import type { Evaluation, Player, Tryout } from '@/data/types';
import { renderFullResultsPdf } from './exportData';

// Jersey order: Zane(1) Young(2) Adams(3) Xu(4). Last-name order: Adams Xu Young Zane.
// Result order: Adams (best) Young Zane, then Xu, who has no evaluations yet.
const people: [string, string, string, string, number | null][] = [
  ['p1', 'Amy', 'Zane', '1', 2],
  ['p2', 'Bob', 'Young', '2', 3],
  ['p3', 'Zed', 'Adams', '3', 5],
  ['p4', 'Cara', 'Xu', '4', null],
];

function tryout(): Tryout {
  const roster = people.map(([id, first, last, jersey]) => ({ id, first, last, jersey, pos: 'FWD' }) as Player);
  const evals = people
    .filter(([, , , , score]) => score != null)
    .map(
      ([id, , , , score]) =>
        ({ id: 'e' + id, playerId: id, evaluator: 'Coach', session: 'Session 1', date: '2026-09-10', scores: { skating: score }, createdAt: 1 }) as unknown as Evaluation,
    );
  return {
    id: 't1', name: 'Fall Tryout', createdAt: 0, updatedAt: 0, eventType: 'Tryout', sport: 'Hockey', assessors: [], roster, evals,
    settings: {
      skaterWeights: { skating: 1 }, goalieWeights: { skating: 1 },
      customRubrics: [{ key: 'skating', label: 'Skating', scoringType: 'skill', scale: '1-5', rankingDirection: 'higher_is_better', role: 'all' }],
    },
    archived: false, viewerIsOwner: true,
  } as unknown as Tryout;
}

const lastNames = (sort?: Parameters<typeof buildPlayerFullResults>[1]) =>
  buildPlayerFullResults(tryout(), sort).map((c) => c.name.split(' ').pop());

describe('report player order', () => {
  it('keeps jersey order as the default', () => {
    expect(lastNames()).toEqual(['Zane', 'Young', 'Adams', 'Xu']);
    expect(lastNames('jersey')).toEqual(['Zane', 'Young', 'Adams', 'Xu']);
  });

  it('sorts A-Z by last name', () => {
    expect(lastNames('name')).toEqual(['Adams', 'Xu', 'Young', 'Zane']);
  });

  it('sorts by results, best first, with unscored players last', () => {
    expect(lastNames('results')).toEqual(['Adams', 'Young', 'Zane', 'Xu']);
  });

  it('does not change the ranks printed on each card', () => {
    const rankOf = (sort: 'jersey' | 'results') =>
      Object.fromEntries(buildPlayerFullResults(tryout(), sort).map((c) => [c.name, c.overallRank]));
    expect(rankOf('results')).toEqual(rankOf('jersey'));
  });

  it('offers every sort choice to the export screens', () => {
    expect(REPORT_SORT_OPTIONS.map((o) => o.key)).toEqual([
      'jersey', 'name', 'firstName', 'ageYoungest', 'ageOldest', 'results', 'resultsWorst', 'position',
    ]);
  });

  it('builds a valid PDF for every order and layout', async () => {
    for (const sortBy of ['jersey', 'name', 'results'] as const) {
      for (const playersPerPage of [1, 4] as const) {
        const b64 = await renderFullResultsPdf(tryout(), { sortBy, playersPerPage });
        expect((await PDFDocument.load(Buffer.from(b64, 'base64'))).getPageCount()).toBeGreaterThan(0);
      }
    }
  });
});
