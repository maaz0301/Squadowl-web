import { PDFArray, PDFDocument, PDFFont, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';

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
const GREEN = rgb(0.1, 0.5, 0.25);

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

/** Only web addresses become tappable links; anything else is left as plain text. */
const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

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
  /** Makes the rectangle a tappable link in any PDF viewer. */
  const addLink = (url: string, x: number, baseline: number, width: number, size: number) => {
    const link = pdfDoc.context.register(
      pdfDoc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [x, baseline - 2, x + width, baseline + size],
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
      }),
    );
    const existing = page.node.lookup(PDFName.of('Annots'));
    if (existing instanceof PDFArray) existing.push(link);
    else page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([link]));
  };
  /** Wrapped text in link colour; every line of it opens `url`. */
  const linkParagraph = (value: string, url: string, o: { size?: number; f?: PDFFont; gap?: number } = {}) => {
    const size = o.size ?? 10;
    const f = o.f ?? font;
    for (const line of wrap(value, f, size, PAGE_WIDTH - MARGIN * 2)) {
      ensure(size + 4);
      const shown = pdfSafe(line);
      const width = f.widthOfTextAtSize(shown, size);
      page.drawText(shown, { x: MARGIN, y, size, font: f, color: BLUE });
      page.drawLine({ start: { x: MARGIN, y: y - 1.5 }, end: { x: MARGIN + width, y: y - 1.5 }, thickness: 0.5, color: BLUE });
      addLink(url, MARGIN, y, width, size);
      y -= o.gap ?? size + 4;
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
  // The player's place among everyone scored, then each rubric's raw result, its
  // benchmark and the rank on that rubric alone. No blended overall score.
  heading('Scoring and Ranking');
  if (card.overallRank) {
    const [place, outOf] = card.overallRank.split('/');
    ensure(24);
    page.drawText('Overall rank (all rubrics)', { x: MARGIN, y, size: 10, font: bold, color: GRAY });
    page.drawText(pdfSafe(outOf ? `${place} of ${outOf}` : card.overallRank), { x: MARGIN + 200, y: y - 1, size: 13, font: bold, color: BLUE });
    y -= 22;
  }
  const resultX = MARGIN + 200;
  const benchX = MARGIN + 290;
  const rankX = MARGIN + 400;
  const header = (t: string, x: number) => page.drawText(t, { x, y, size: 8, font: bold, color: GRAY });
  ensure(16);
  header('RUBRIC', MARGIN);
  header('RAW SCORE', resultX);
  header('BENCHMARK', benchX);
  header('RANK', rankX);
  y -= 14;
  // A category of several rubrics prints its pooled score, then each drill beneath it with its own result.
  const rows = card.metrics.flatMap((m) => [
    { label: m.label, actual: m.actual || m.score, benchmark: m.benchmark ?? '', met: m.met, rank: m.rank, indent: false },
    ...(m.children ?? []).map((c) => ({ label: c.label, actual: c.actual || c.score, benchmark: c.benchmark ?? '', met: c.met, rank: c.rank, indent: true })),
  ]);
  rows.forEach((m) => {
    ensure(15);
    const maxLabel = m.indent ? 30 : 34;
    page.drawText(pdfSafe(m.label.length > maxLabel ? `${m.label.slice(0, maxLabel - 1)}...` : m.label), { x: MARGIN + (m.indent ? 12 : 0), y, size: m.indent ? 9 : 10, font, color: m.indent ? GRAY : BLACK });
    page.drawText(pdfSafe(m.actual || '-'), { x: resultX, y, size: 10, font: bold, color: m.met ? GREEN : BLACK });
    page.drawText(pdfSafe(m.benchmark || '-'), { x: benchX, y, size: 10, font, color: m.benchmark ? BLACK : GRAY });
    page.drawText(pdfSafe(m.rank || '-'), { x: rankX, y, size: 10, font, color: BLACK });
    y -= 15;
  });
  const notes = (input.benchmarks ?? []).filter((b) => b.note);
  if (notes.length) {
    y -= 4;
    for (const b of notes) paragraph(`${b.label}: ${b.note}`, { size: 8.5, color: GRAY, gap: 11 });
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
      const url = a.url && isWebUrl(a.url) ? a.url : '';
      // The name opens the file, video or link when the card is viewed on a screen.
      if (url) {
        linkParagraph(`${kind}: ${a.name}`, url, { size: 10, f: bold, gap: 12 });
        // The address itself is printed too, when short enough, for a paper copy.
        if (url.length <= 90 && url !== a.name) linkParagraph(url, url, { size: 8.5, gap: 12 });
      } else {
        paragraph(`${kind}: ${a.name}`, { size: 10, f: bold, gap: 12 });
      }
    }
  }

  return pdfDoc.saveAsBase64();
}
