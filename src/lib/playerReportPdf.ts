import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

import type { PlayerFullResults } from '@/data/resultsExport';
import type { BenchmarkLine } from '@/data/benchmarks';
import { LOGO_BAND, drawLogoStrip, embedLogos, pdfSafe } from '@/lib/reportPdf';

/**
 * The printable player report card: the scores from the evaluations the coach
 * chose, their comments, the optional AI comments (labelled as such), and the
 * names and addresses of any files, videos or links attached. Meant to be put
 * in front of a family. Kept identical in both repos (src/lib/playerReportPdf.ts).
 */

export interface PlayerReportPdfInput {
  title: string;
  /** Team or assessment line under the title. */
  subtitle: string;
  card: PlayerFullResults;
  coachComments: string;
  aiComments: string;
  attachments: { kind: 'file' | 'video' | 'link'; name: string; url?: string }[];
  /** The coach's rubric benchmarks beside this player's own results; the section is left out when empty. */
  benchmarks?: BenchmarkLine[];
  logoUrls?: string[];
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const GRAY = rgb(0.45, 0.45, 0.45);
const BLACK = rgb(0, 0, 0);
const RULE = rgb(0.8, 0.8, 0.8);
const BLUE = rgb(0.1, 0.32, 0.6);

function wrap(text: string, f: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfSafe(text).split(/\r?\n/)) {
    let current = '';
    for (const word of paragraph.split(' ')) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && f.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

export async function renderPlayerReportPdf(input: PlayerReportPdfInput): Promise<string> {
  const { card } = input;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logos = await embedLogos(pdfDoc, input.logoUrls);
  const top = PAGE_HEIGHT - MARGIN - (logos.length ? LOGO_BAND : 0);

  const newPage = () => {
    const p = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    p.drawRectangle({ x: 24, y: 24, width: PAGE_WIDTH - 48, height: PAGE_HEIGHT - 48, borderColor: BLACK, borderWidth: 1 });
    if (logos.length) drawLogoStrip(p, logos, MARGIN);
    return p;
  };
  let page = newPage();
  let y = top;

  const ensure = (needed: number) => {
    if (y - needed < MARGIN) {
      page = newPage();
      y = top;
    }
  };
  const text = (
    value: string,
    o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; gap?: number } = {},
  ) => {
    const size = o.size ?? 10;
    ensure(size + 4);
    page.drawText(pdfSafe(value), { x: o.x ?? MARGIN, y, size, font: o.f ?? font, color: o.color ?? BLACK });
    y -= o.gap ?? size + 4;
  };
  const paragraph = (value: string, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = o.size ?? 10;
    for (const line of wrap(value, o.f ?? font, size, PAGE_WIDTH - MARGIN * 2)) {
      text(line, { size, f: o.f, color: o.color, gap: o.gap ?? size + 4 });
    }
  };
  const heading = (value: string) => {
    y -= 6;
    ensure(30);
    text(value, { size: 12, f: bold, gap: 8 });
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: RULE });
    y -= 12;
  };

  text(input.title, { size: 18, f: bold, gap: 22 });
  if (input.subtitle) paragraph(input.subtitle, { size: 9, color: GRAY, gap: 12 });
  y -= 8;

  const meta = pdfSafe(`#${card.jersey || '-'} | ${card.pos || '-'} | Evaluations ${card.evalCount}`);
  ensure(26);
  page.drawText(pdfSafe(card.name), { x: MARGIN, y, size: 16, font: bold, color: BLACK });
  page.drawText(meta, {
    x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(meta, 9),
    y: y + 3,
    size: 9,
    font,
    color: GRAY,
  });
  y -= 24;

  // ── Scores ────────────────────────────────────────────────────────────────
  heading('Scoring and Ranking');
  const scoreX = MARGIN + 270;
  const rankX = MARGIN + 390;
  ensure(16);
  page.drawText('METRIC', { x: MARGIN, y, size: 8, font: bold, color: GRAY });
  page.drawText('SCORE', { x: scoreX, y, size: 8, font: bold, color: GRAY });
  page.drawText('RANK', { x: rankX, y, size: 8, font: bold, color: GRAY });
  y -= 14;
  const rows = [{ label: 'Overall', score: card.overallScore, rank: card.overallRank }, ...card.metrics];
  rows.forEach((m, i) => {
    ensure(15);
    const isOverall = i === 0;
    page.drawText(pdfSafe(m.label), { x: MARGIN, y, size: 10, font: isOverall ? bold : font, color: isOverall ? BLUE : BLACK });
    page.drawText(pdfSafe(m.score || '-'), { x: scoreX, y, size: 10, font: isOverall ? bold : font, color: isOverall ? BLUE : BLACK });
    page.drawText(pdfSafe(m.rank || '-'), { x: rankX, y, size: 10, font: isOverall ? bold : font, color: isOverall ? BLUE : BLACK });
    y -= 15;
  });

  if (input.benchmarks?.length) {
    heading('Benchmarks');
    paragraph('What we are aiming for on each measure, beside the player\'s own result.', { size: 8, color: GRAY, gap: 12 });
    for (const b of input.benchmarks) {
      const standing = b.met == null ? '' : b.met ? '  (reached)' : '  (working towards)';
      paragraph(`${b.label}:  ${b.result ? `player ${b.result}` : 'not yet scored'},  benchmark ${b.target}${standing}`, { size: 10, f: bold, gap: 13 });
      if (b.note) paragraph(b.note, { size: 8.5, color: GRAY, gap: 11 });
      y -= 5;
    }
  }

  if (card.recommendation) {
    y -= 4;
    paragraph(`Recommendation: ${card.recommendation}`, { size: 10, color: BLUE });
  }

  // ── Evaluations ───────────────────────────────────────────────────────────
  if (card.evals.length) {
    heading('Evaluations included');
    for (const ev of card.evals) {
      ensure(40);
      paragraph(`Evaluation ${ev.index}: ${ev.date} | ${ev.evaluator} | ${ev.session}`, { size: 9.5, f: bold, gap: 12 });
      paragraph(ev.values.map((v) => `${v.abbr}: ${v.text || '-'}`).join('   '), { size: 8.5, color: GRAY, gap: 11 });
      const notes = [
        ev.strengths ? `Strengths: ${ev.strengths}` : '',
        ev.improve ? `To work on: ${ev.improve}` : '',
      ].filter(Boolean);
      for (const n of notes) paragraph(n, { size: 8.5, gap: 11 });
      y -= 5;
    }
  }

  // ── Comments ──────────────────────────────────────────────────────────────
  if (input.coachComments.trim()) {
    heading('Coach comments');
    paragraph(input.coachComments.trim(), { size: 10, gap: 14 });
  }
  if (input.aiComments.trim()) {
    heading('AI-assisted comments');
    paragraph('Drafted by an AI assistant from the evaluations above and reviewed by the coach.', {
      size: 8,
      color: GRAY,
      gap: 12,
    });
    paragraph(input.aiComments.trim(), { size: 10, gap: 14 });
  }

  // ── Attachments ───────────────────────────────────────────────────────────
  if (input.attachments.length) {
    heading('Videos, files and links');
    for (const a of input.attachments) {
      const kind = a.kind === 'video' ? 'Video' : a.kind === 'link' ? 'Link' : 'File';
      paragraph(`${kind}: ${a.name}`, { size: 10, f: bold, gap: 12 });
      // Only addresses that stay valid are printed; an uploaded file's signed
      // address expires, so it is listed by name and shared another way.
      if (a.url) paragraph(a.url, { size: 8.5, color: BLUE, gap: 12 });
    }
  }

  return pdfDoc.saveAsBase64();
}
