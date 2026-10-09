import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { Evaluation, Player, Tryout } from '@/data/types';
import { renderFullResultsPdf } from './exportData';
import { DEFAULT_REPORT_CONTENT } from './reportPdf';

function tryout(count = 30): Tryout {
  const roster = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`, first: `First${i}`, last: `Last${i}`, jersey: String(i + 1), pos: i % 2 ? 'DEF' : 'FWD', yearOfBirth: i % 3 ? '2012' : '2011',
  }) as Player);
  const evals = roster.map(
    (p, i) =>
      ({ id: `e${i}`, playerId: p.id, evaluator: 'Coach', session: 'Session 1', date: '2026-09-10', scores: { a: (i % 5) + 1, b: ((i + 2) % 5) + 1, c: 3, d: 4, e: 2, f: 5, g: 1 }, strengths: 'quick', improve: 'shoot', recommendation: 'Keep', createdAt: 1 }) as unknown as Evaluation,
  );
  const rubric = (key: string) => ({ key, label: `Skill ${key}`, scoringType: 'skill', scale: '1-5', rankingDirection: 'higher_is_better', role: 'all' });
  return {
    id: 't1', name: 'Fall', createdAt: 0, updatedAt: 0, eventType: 'Tryout', sport: 'Hockey', assessors: [], roster, evals,
    settings: {
      skaterWeights: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 }, goalieWeights: {},
      customRubrics: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(rubric),
    },
    archived: false, viewerIsOwner: true,
  } as unknown as Tryout;
}

const pages = async (b64: string) => (await PDFDocument.load(b64)).getPageCount();

describe('report PDF options', () => {
  it('one player per page: a page per player', async () => {
    expect(await pages(await renderFullResultsPdf(tryout(5), { playersPerPage: 1 }))).toBe(5);
  });

  it('filters shrink the report', async () => {
    const all = await pages(await renderFullResultsPdf(tryout(12), { playersPerPage: 1 }));
    const top3 = await pages(await renderFullResultsPdf(tryout(12), { playersPerPage: 1, filter: { topX: 3 } }));
    expect(all).toBe(12);
    expect(top3).toBe(3);
  });

  it('compact list fits many players on few pages and wraps extra rubrics into more tables', async () => {
    const n = await pages(await renderFullResultsPdf(tryout(30), { layout: 'list' }));
    expect(n).toBeGreaterThanOrEqual(2); // 7 rubrics do not fit across one table
    expect(n).toBeLessThan(10);
  });

  it('compact list without rubric scores fits 30 players on one page', async () => {
    const n = await pages(
      await renderFullResultsPdf(tryout(30), { layout: 'list', content: { ...DEFAULT_REPORT_CONTENT, rubricScores: false, ranking: false } }),
    );
    expect(n).toBe(1);
  });

  it('every content toggle off still renders in each layout', async () => {
    const off = { rubricScores: false, ranking: false, comments: false, assessor: false, date: false };
    for (const opts of [{ playersPerPage: 1 as const }, { playersPerPage: 4 as const }, { layout: 'list' as const }, { continuous: true }]) {
      expect(await pages(await renderFullResultsPdf(tryout(6), { ...opts, content: off }))).toBeGreaterThan(0);
    }
  });

  it('every sort order renders', async () => {
    for (const sortBy of ['jersey', 'name', 'firstName', 'ageYoungest', 'ageOldest', 'results', 'resultsWorst', 'position'] as const) {
      expect(await pages(await renderFullResultsPdf(tryout(6), { sortBy, layout: 'list' }))).toBeGreaterThan(0);
    }
  });
});
