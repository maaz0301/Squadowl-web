import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import type { PlayerFullResults } from '@/data/resultsExport';
import { renderPlayerReportPdf } from './playerReportPdf';

const card: PlayerFullResults = {
  playerId: 'p1',
  name: 'Zoë Łukasz',
  jersey: '12',
  pos: 'F',
  shoots: 'L',
  overallScore: '3.80',
  overallRank: '2/20',
  evalCount: 2,
  metrics: Array.from({ length: 9 }, (_, i) => ({ label: `Category ${i}`, abbr: `C${i}`, score: '3.5', rank: `${i + 1}/20` })),
  recommendation: 'Make the team',
  strengths: '',
  improve: '',
  evals: [1, 2].map((n) => ({
    index: n,
    date: '2026-09-1' + n,
    evaluator: 'Coach Sam',
    session: `Session ${n}`,
    recommendation: 'Make the team',
    strengths: 'Quick feet and sees the ice well',
    improve: 'Shoot more',
    values: Array.from({ length: 9 }, (_, i) => ({ abbr: `C${i}`, text: '4' })),
  })),
};

const input = {
  title: 'Player Report Card',
  subtitle: 'Assessment: Fall Tryout',
  card,
  coachComments: 'Zoë has had a great fall.\n'.repeat(60),
  aiComments: 'Summary of the player. '.repeat(80),
  attachments: [
    { kind: 'video' as const, name: 'Game clip', url: 'https://youtu.be/abc123' },
    { kind: 'file' as const, name: 'Skills sheet.pdf' },
  ],
};

describe('renderPlayerReportPdf', () => {
  it('renders a multi-page card without throwing on accents or long comments', async () => {
    const base64 = await renderPlayerReportPdf(input);
    const doc = await PDFDocument.load(Buffer.from(base64, 'base64'));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('renders a card with no comments, evaluations or attachments', async () => {
    const base64 = await renderPlayerReportPdf({
      ...input,
      card: { ...card, evals: [], metrics: [] },
      coachComments: '',
      aiComments: '',
      attachments: [],
    });
    const doc = await PDFDocument.load(Buffer.from(base64, 'base64'));
    expect(doc.getPageCount()).toBe(1);
  });

  it('prints the benchmarks with their notes, and adds nothing when there are none', async () => {
    const lines = [
      { key: 'vj', label: 'Vertical Jump', target: '30 in', note: 'What a top-team player reaches. '.repeat(6), result: '27 in', met: false },
      { key: 'sk', label: 'Skating', target: '4/5', note: '', result: '', met: null },
    ];
    const bare = { ...input, card: { ...card, evals: [] }, coachComments: '', aiComments: '', attachments: [] };
    const withLines = await PDFDocument.load(Buffer.from(await renderPlayerReportPdf({ ...bare, benchmarks: lines }), 'base64'));
    const without = await PDFDocument.load(Buffer.from(await renderPlayerReportPdf({ ...bare, benchmarks: [] }), 'base64'));
    expect(withLines.getPageCount()).toBe(1);
    expect(without.getPageCount()).toBe(1);
    expect(Buffer.from(await withLines.save()).length).toBeGreaterThan(Buffer.from(await without.save()).length);
  });
});
