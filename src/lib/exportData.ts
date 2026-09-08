import type { Tryout, ExportFormat } from '@/data/types';
import { buildTeamBuilderExportRows, formatExportCsv, type TeamBuilderState } from '@/data/teamBuilder';
import { buildFullResultsCsvRows, buildPlayerFullResults, buildReportDocInfo, buildResultsSummary } from '@/data/resultsExport';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import * as XLSX from 'xlsx';

/** Escapes a value for a CSV cell — wraps in quotes and doubles any embedded quotes if needed. */
function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Column widths for the full-results sheet: the first column holds row labels
 * ("CAT/CRITERIA SCORE-RANK" is the widest), and the columns after it carry
 * scores and free-text notes, so they get room before Excel clips them.
 */
function fullResultsColumnWidths(rows: (string | number)[][]): { wch: number }[] {
  const widest = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return Array.from({ length: widest }, (_, i) => ({ wch: i === 0 ? 26 : 18 }));
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const GRAY = rgb(0.45, 0.45, 0.45);
const BLACK = rgb(0, 0, 0);
const RULE = rgb(0.8, 0.8, 0.8);

/** Breaks `text` into lines no wider than `maxWidth` at `size` in font `f`. */
function wrapText(text: string, f: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && f.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/**
 * Full printable results report: one page per roster player with a
 * metric/score/rank table (ranked against the whole roster) and every
 * evaluation's raw scores condensed onto a couple of dense lines.
 */
async function renderFullResultsPdf(tryout: Tryout): Promise<string> {
  const docInfo = buildReportDocInfo(tryout);
  const cards = buildPlayerFullResults(tryout);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const drawLine = (
    text: string,
    opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; gap?: number } = {},
  ) => {
    const size = opts.size ?? 9;
    const f = opts.f ?? font;
    ensureSpace(size + 4);
    page.drawText(text, { x: opts.x ?? MARGIN, y, size, font: f, color: opts.color ?? BLACK });
    y -= opts.gap ?? size + 4;
  };

  const drawWrapped = (
    text: string,
    opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; maxWidth?: number; gap?: number } = {},
  ) => {
    const size = opts.size ?? 9;
    const f = opts.f ?? font;
    const x = opts.x ?? MARGIN;
    const maxWidth = opts.maxWidth ?? PAGE_WIDTH - MARGIN - x;
    for (const line of wrapText(text, f, size, maxWidth)) {
      drawLine(line, { size, f, color: opts.color, x, gap: opts.gap ?? size + 3 });
    }
  };

  drawLine(docInfo.title, { size: 18, f: fontBold, gap: 24 });
  drawWrapped(docInfo.subtitle, { size: 9, color: GRAY, gap: 13 });
  y -= 10;

  const scoreX = MARGIN + 260;
  const rankX = MARGIN + 380;

  cards.forEach((card, idx) => {
    if (idx > 0) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }

    const meta = `#${card.jersey || '—'} • ${card.pos || '—'} • Shoots ${card.shoots || '—'} • Evals ${card.evalCount}`;
    page.drawText(card.name, { x: MARGIN, y, size: 15, font: fontBold, color: BLACK });
    const metaWidth = font.widthOfTextAtSize(meta, 9);
    page.drawText(meta, { x: PAGE_WIDTH - MARGIN - metaWidth, y: y + 3, size: 9, font, color: GRAY });
    y -= 26;

    drawLine('Scoring and Ranking', { size: 11, f: fontBold, gap: 16 });

    ensureSpace(14);
    page.drawText('METRIC', { x: MARGIN, y, size: 9, font: fontBold, color: GRAY });
    page.drawText('SCORE', { x: scoreX, y, size: 9, font: fontBold, color: GRAY });
    page.drawText('RANK', { x: rankX, y, size: 9, font: fontBold, color: GRAY });
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: RULE });
    y -= 12;

    const metricRows = [{ label: 'Overall', score: card.overallScore, rank: card.overallRank }, ...card.metrics];
    for (const m of metricRows) {
      ensureSpace(14);
      page.drawText(m.label, { x: MARGIN, y, size: 9, font, color: BLACK });
      page.drawText(m.score, { x: scoreX, y, size: 9, font, color: BLACK });
      page.drawText(m.rank, { x: rankX, y, size: 9, font, color: BLACK });
      y -= 14;
    }
    y -= 8;

    drawWrapped(`Recommendation: ${card.recommendation || '—'}`, { size: 9.5, gap: 13 });
    drawWrapped(`Strengths: ${card.strengths || '—'}`, { size: 9.5, gap: 13 });
    drawWrapped(`Improve: ${card.improve || '—'}`, { size: 9.5, gap: 13 });
    y -= 10;

    for (const ev of card.evals) {
      ensureSpace(36);
      const header = `Eval ${ev.index} • ${ev.date} • ${ev.evaluator} • ${ev.session}`;
      const scoreLine = ev.values.map((v) => `${v.abbr}:${v.text || '—'}`).join(' • ');
      const footer = `Rec: ${ev.recommendation || '—'} | Str: ${ev.strengths || '—'} | Imp: ${ev.improve || '—'}`;
      drawWrapped(header, { size: 9, f: fontBold, gap: 13 });
      drawWrapped(scoreLine, { size: 8, color: GRAY, gap: 11 });
      drawWrapped(footer, { size: 8.5, gap: 11 });
      y -= 6;
    }
  });

  return pdfDoc.saveAsBase64();
}

export function download(fileName: string, content: string, encoding: 'utf8' | 'base64', mimeType: string) {
  let blob: Blob;
  if (encoding === 'base64') {
    const byteCharacters = atob(content);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
    blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  } else {
    blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  }
  const url = URL.createObjectURL(blob);
  // Android Chrome/WebView dispatch the actual download asynchronously after
  // `click()` — revoking the object URL in the same tick can cancel it before
  // it starts, producing a silently missing or empty file. Delay the revoke
  // instead of doing it immediately after the click.
  if ('download' in document.createElement('a')) {
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    // No `download` attribute support — open the file directly so the user
    // can still save it via their browser's own share/save sheet.
    window.open(url, '_blank', 'noopener');
  }
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Same three export formats as the app, delivered as a browser download. */
export async function exportTryoutData(tryout: Tryout, format: ExportFormat): Promise<void> {
  const safeName = tryout.name.replace(/\s+/g, '_');
  const fileName = `${safeName}_results.${format}`;

  if (format === 'csv') {
    const { infoLines, playerBlocks } = buildFullResultsCsvRows(tryout);
    const blocks = playerBlocks.map((rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n'));
    const text = [
      infoLines.map((r) => r.map(csvCell).join(',')).join('\n'),
      '',
      blocks.join('\n\n'),
    ].join('\n');
    download(fileName, text, 'utf8', 'text/csv');
    return;
  }

  if (format === 'xlsx') {
    // The full-results rows: the info header, then each player's
    // PLYR/CAT/STR/IMP rows and eval tables, blocks separated by a blank row so
    // one player's card stays readable on a printed page.
    const { infoLines, playerBlocks } = buildFullResultsCsvRows(tryout);
    const rows: (string | number)[][] = [...infoLines, []];
    playerBlocks.forEach((block, i) => {
      if (i > 0) rows.push([]);
      rows.push(...block);
    });

    const wb = XLSX.utils.book_new();

    // Sheet 1: the ranked summary table — one row per player, one column per
    // rubric — for sorting and filtering the whole roster at a glance.
    const summary = buildResultsSummary(tryout);
    const summarySheet = XLSX.utils.aoa_to_sheet([
      ...summary.infoLines,
      [],
      summary.headers,
      ...summary.rows,
    ]);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

    // Sheet 2: the same portrait, block-per-player layout as the CSV.
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = fullResultsColumnWidths(rows);
    XLSX.utils.book_append_sheet(wb, sheet, 'Full Results');

    download(
      fileName,
      XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }),
      'base64',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    return;
  }

  download(fileName, await renderFullResultsPdf(tryout), 'base64', 'application/pdf');
}

/** Team-builder style CSV export (roster + assignments). */
export async function exportTryoutToCsv(tryout: Tryout): Promise<void> {
  download(
    `${tryout.name.replace(/\s+/g, '_')}_results.csv`,
    formatExportCsv(tryout),
    'utf8',
    'text/csv',
  );
}

/**
 * Export a Team Builder result (all teams, or just one via `opts.teamId`) as
 * XLSX or PDF — grouped by team so it's easy to print and double-check.
 */
export async function exportTeamBuilderData(
  tryout: Tryout,
  state: TeamBuilderState,
  format: 'xlsx' | 'pdf',
  opts?: { teamId?: string },
): Promise<void> {
  const { headers, rows } = buildTeamBuilderExportRows(tryout, state, opts);
  const singleTeam = opts?.teamId ? state.teams.find((t) => t.id === opts.teamId) : undefined;

  const safeName = tryout.name.replace(/\s+/g, '_');
  const suffix = singleTeam ? `_${singleTeam.name.replace(/\s+/g, '_')}` : '_teams';
  const fileName = `${safeName}${suffix}.${format}`;

  if (format === 'xlsx') {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Team Builder');
    download(
      fileName,
      XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }),
      'base64',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    return;
  }

  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([600, 800]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const title = singleTeam ? `${tryout.name}: ${singleTeam.name}` : `${tryout.name}: Team Builder`;
  page.drawText(title, { x: 50, y: 750, size: 20, font: fontBold });

  let y = 700;
  const xOffsets = [50, 170, 320, 380, 430, 500];

  headers.forEach((h, i) => {
    page.drawText(h, { x: xOffsets[i], y, size: 10, font: fontBold });
  });
  y -= 20;

  for (const row of rows) {
    if (y < 50) {
      page = pdfDoc.addPage([600, 800]);
      y = 750;
    }
    row.forEach((cell, i) => {
      page.drawText(cell, { x: xOffsets[i], y, size: 10, font });
    });
    y -= 15;
  }

  download(fileName, await pdfDoc.saveAsBase64(), 'base64', 'application/pdf');
}
