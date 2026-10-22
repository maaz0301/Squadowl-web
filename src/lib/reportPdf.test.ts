import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { PlayerFullResults } from '@/data/resultsExport';
import { compactMetricCapacity, embedLogos, pdfSafe, renderCompactResults, type PlayersPerPage } from './reportPdf';
import { readPdfPages } from './pdfTable';

const card = (i: number, metrics = 8): PlayerFullResults => ({
  playerId: `p${i}`,
  name: `Player ${i} Łukasz`,
  jersey: String(i),
  birthDate: '2014-03-02', team: 'Spring', pos: 'F',
  shoots: 'L',
  overallScore: '3.25',
  overallRank: `${i}/20`,
  evalCount: 2,
  metrics: Array.from({ length: metrics }, (_, m) => ({
    label: `Skating category number ${m}`,
    abbr: `S${m}`,
    score: '3.50',
    rank: `${m + 1}/20`,
  })),
  recommendation: 'Make the team',
  strengths: 'Fast, good vision, strong on the puck and tireless on the back check every shift',
  improve: 'Shot accuracy',
  evals: [],
});

const info = { title: 'Fall Tryout, Full Results', subtitle: 'Assessment: Fall Tryout • Sport: Hockey' };

async function render(count: number, perPage: Exclude<PlayersPerPage, 1>, metrics?: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cards = Array.from({ length: count }, (_, i) => card(i + 1, metrics));
  renderCompactResults(doc, { font, bold }, info, cards, perPage, []);
  return doc;
}

describe('renderCompactResults', () => {
  it.each([
    [2, 5, 3],
    [4, 9, 3],
    [6, 13, 3],
  ] as const)('puts %i players on a page', async (perPage, players, pages) => {
    const doc = await render(players, perPage);
    expect(doc.getPageCount()).toBe(pages);
  });

  it('does not throw on characters the PDF font cannot encode, or very long metric lists', async () => {
    const doc = await render(6, 6, 40);
    expect(doc.getPageCount()).toBe(1);
    await expect(doc.save()).resolves.toBeInstanceOf(Uint8Array);
  });

  it('still produces a page when there are no players', async () => {
    const doc = await render(0, 4);
    expect(doc.getPageCount()).toBe(1);
  });
});

describe('pdfSafe', () => {
  it('folds accents and replaces what cannot be drawn', () => {
    expect(pdfSafe('Łukasz Žižek')).toBe('Lukasz Žižek');
    expect(pdfSafe('日本')).toBe('??');
  });
});

describe('embedLogos', () => {
  it('skips a logo that cannot be fetched instead of failing the export', async () => {
    const doc = await PDFDocument.create();
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    try {
      await expect(embedLogos(doc, ['https://example.com/logo.png'])).resolves.toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('skips formats it cannot embed', async () => {
    const doc = await PDFDocument.create();
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]))) as typeof fetch;
    try {
      await expect(embedLogos(doc, ['https://example.com/logo.webp'])).resolves.toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('compactMetricCapacity', () => {
  const cut = async (perPage: Exclude<PlayersPerPage, 1>, metrics: number) => {
    const doc = await render(1, perPage, metrics);
    const pages = await readPdfPages(Uint8Array.from(await doc.save()).buffer);
    return pages.flat().some((i) => /\+\d+ more/.test(i.str));
  };

  it.each([2, 4, 6] as const)('matches where a %i-per-page card starts printing "+N more"', async (perPage) => {
    const cap = compactMetricCapacity(perPage, false);
    expect(cap).toBeGreaterThan(5);
    expect(await cut(perPage, cap)).toBe(false);
    expect(await cut(perPage, cap + 1)).toBe(true);
  });

  it('holds fewer rows when a logo strip or the notes take room', () => {
    expect(compactMetricCapacity(4, true)).toBeLessThan(compactMetricCapacity(4, false));
    const noNotes = { ...{ position: true, ranking: true, rubricScores: true, comments: false, assessor: true, date: true } };
    expect(compactMetricCapacity(4, false, noNotes)).toBeGreaterThan(compactMetricCapacity(4, false));
  });
});
