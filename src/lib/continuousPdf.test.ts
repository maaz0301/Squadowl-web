import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { Evaluation, Player, Tryout } from '@/data/types';
import { renderFullResultsPdf } from './exportData';

function tryout(count: number): Tryout {
  const roster: Player[] = [];
  const evals: Evaluation[] = [];
  for (let i = 0; i < count; i++) {
    roster.push({ id: 'p' + i, first: 'First' + i, last: 'Last' + i, pos: 'FWD', jersey: String(i + 1) } as Player);
    for (let s = 0; s < 2; s++) {
      evals.push({
        id: 'e' + i + '-' + s,
        playerId: 'p' + i,
        evaluator: 'Coach',
        session: 'Session ' + (s + 1),
        date: '2026-09-1' + s,
        scores: { skating: 3 + ((i + s) % 3) },
        recommendation: 'Make the team',
        strengths: 'Quick feet',
        improve: 'Shoot more',
        createdAt: s,
      } as unknown as Evaluation);
    }
  }
  return {
    id: 't1', name: 'Fall Tryout', createdAt: 0, updatedAt: 0, eventType: 'Tryout', sport: 'Hockey', assessors: [], roster, evals,
    settings: {
      skaterWeights: { skating: 1 }, goalieWeights: { skating: 1 },
      customRubrics: [{ key: 'skating', label: 'Skating', scoringType: 'skill', scale: '1-5', rankingDirection: 'higher_is_better', role: 'all' }],
    },
    archived: false, viewerIsOwner: true,
  } as unknown as Tryout;
}

const pages = async (b64: string) => (await PDFDocument.load(Buffer.from(b64, 'base64'))).getPageCount();

describe('continuous layout', () => {
  it('runs players on with no page break between them', async () => {
    const t = tryout(8);
    const perPlayer = await renderFullResultsPdf(t, {});
    const flowing = await renderFullResultsPdf(t, { continuous: true });
    expect(await pages(perPlayer)).toBe(8);
    expect(await pages(flowing)).toBeLessThan(8);
  });
});
