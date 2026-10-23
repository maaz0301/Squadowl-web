import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';
import * as XLSX from 'xlsx';

import { formatCompareDate, isTopPerformer, type CompareTable } from '@/data/compare';
import { embedLogos, pdfSafe } from '@/lib/reportPdf';
import { planCompareBands, wrapHeader } from '@/lib/comparePdfLayout';

/**
 * Compare exports: an Excel sheet (one row per player, one column per rubric,
 * real numbers so it sorts) and a paginated PDF of the same ranked table.
 * Builds the file only; each platform delivers it. Kept identical in both repos.
 */

export const COMPARE_FIXED_HEADERS = ['Rank', 'Player', 'Team', 'Date of Birth', 'Evaluation', 'Evaluation Date', 'Overall'];

export interface CompareExportTable {
  headers: string[];
  rows: (string | number)[][];
  /** Same shape as rows: true where the cell is the best in its column. */
  top: boolean[][];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The table as rows in the order the coach sees them, benchmarks folded into the column headers. */
export function buildCompareExportTable(table: CompareTable): CompareExportTable {
  const headers = [
    ...COMPARE_FIXED_HEADERS,
    ...table.columns.map((c) => (c.benchmark ? `${c.label} (benchmark ${c.benchmark})` : c.label)),
  ];
  const rows: (string | number)[][] = [];
  const top: boolean[][] = [];
  for (const r of table.rows) {
    rows.push([
      r.rank ?? '',
      r.name,
      r.teamNames.join(', '),
      r.dateOfBirth ?? r.yearOfBirth ?? '',
      r.assessment?.tryoutName ?? '',
      formatCompareDate(r.assessment?.date),
      r.overall != null ? round2(r.overall) : '',
      ...table.columns.map((c) => {
        const v = r.scores[c.id];
        return v != null ? round2(v) : '';
      }),
    ]);
    top.push([
      false,
      false,
      false,
      false,
      false,
      false,
      isTopPerformer(table, 'overall', r.overall),
      ...table.columns.map((c) => isTopPerformer(table, c.id, r.scores[c.id])),
    ]);
  }
  return { headers, rows, top };
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'comparison'
  );
}

export interface CompareFile {
  fileName: string;
  /** Base64 file contents. */
  content: string;
  mimeType: string;
}

export async function buildCompareFile(opts: {
  title: string;
  table: CompareTable;
  format: 'xlsx' | 'pdf';
  /** Logos to print on every page (the SquadOwl one, or a club's own on the Club plan). */
  logoUrls?: string[];
  /** "YYYY-MM-DD"; defaults to today. */
  comparedOn?: string;
}): Promise<CompareFile> {
  const { headers, rows, top } = buildCompareExportTable(opts.table);
  const comparedOn = opts.comparedOn ?? new Date().toISOString().slice(0, 10);
  const fileName = `${slug(opts.title)}.${opts.format}`;

  if (opts.format === 'xlsx') {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((h, i) => ({ wch: i === 1 ? 24 : i === 2 || i === 4 ? 22 : Math.max(10, Math.min(28, h.length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comparison');
    return {
      fileName,
      content: XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // A4 landscape, always. The text stays a readable size; a table with more rubric
  // columns than fit is split into bands of columns instead of shrinking or widening the page.
  const PAGE_W = 842;
  const PAGE_H = 595;
  const MARGIN = 36;
  const SIZE = 8.5;
  const HEAD_SIZE = 7.5;
  const HEAD_LINE = 9;
  const ROW_H = 14;
  const GAP = 8;
  const SCORE_W = 62;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const textRows = rows.map((r) => r.map((c) => String(c)));
  const fixedCount = COMPARE_FIXED_HEADERS.length;
  const scoreCount = headers.length - fixedCount;

  // Identity columns: as wide as their widest entry, capped so a long name or evaluation is cut.
  const FIXED_CAP = [40, 130, 110, 66, 120, 66, 52];
  const naturalFixed = COMPARE_FIXED_HEADERS.map((h, i) => {
    let w = fontBold.widthOfTextAtSize(pdfSafe(h), HEAD_SIZE);
    for (const r of textRows) w = Math.max(w, font.widthOfTextAtSize(pdfSafe(r[i] ?? ''), SIZE));
    return Math.min(w, FIXED_CAP[i]) + GAP;
  });
  // The columns repeated on every page: rank, player, evaluation, overall.
  const REPEAT = [0, 1, 4, 6];
  const firstFixed = naturalFixed.reduce((a, b) => a + b, 0);
  const repeatFixed = REPEAT.reduce((a, i) => a + naturalFixed[i], 0);
  const available = PAGE_W - MARGIN * 2;
  const plan = planCompareBands({ available, firstFixed, repeatFixed, scoreWidth: SCORE_W, scoreCount });

  const fit = (text: string, width: number, f: PDFFont): string => {
    const out = pdfSafe(text);
    if (f.widthOfTextAtSize(out, SIZE) <= width) return out;
    let cut = out;
    while (cut.length > 1 && f.widthOfTextAtSize(cut + '...', SIZE) > width) cut = cut.slice(0, -1);
    return cut + '...';
  };

  const logos = await embedLogos(pdfDoc, opts.logoUrls);
  const LOGO_H = logos.length ? 30 : 0;

  // The columns on one band: which identity columns, then its slice of the score columns.
  let scoreStart = 0;
  const bands = plan.bands.map((count, bandIndex) => {
    const fixedIdx = bandIndex === 0 ? COMPARE_FIXED_HEADERS.map((_, i) => i) : REPEAT;
    const scoreIdx = Array.from({ length: count }, (_, k) => fixedCount + scoreStart + k);
    scoreStart += count;
    const colIdx = [...fixedIdx, ...scoreIdx];
    // Spare width on a band is shared out, so the table fills the page.
    const natural = colIdx.map((ci) => (ci < fixedCount ? naturalFixed[ci] : SCORE_W));
    const k = available / natural.reduce((a, b) => a + b, 0);
    const widths = natural.map((w) => (k > 1 ? w * k : w));
    return { colIdx, widths, scoreFrom: scoreIdx[0] != null ? scoreIdx[0] - fixedCount + 1 : 0, scoreTo: scoreIdx.length ? scoreIdx[scoreIdx.length - 1] - fixedCount + 1 : 0 };
  });

  const headerLines = (ci: number, width: number) =>
    wrapHeader(headers[ci], width - 4, 4, (t) => fontBold.widthOfTextAtSize(pdfSafe(t), HEAD_SIZE));
  const bandHeaderH = (band: (typeof bands)[number]) =>
    Math.max(...band.colIdx.map((ci, j) => headerLines(ci, band.widths[j]).length)) * HEAD_LINE + 6;

  const topBlock = PAGE_H - MARGIN - (logos.length ? LOGO_H + 8 : 0) - 26 - 22;
  const pagesPerBand = bands.map((band) => {
    const perPage = Math.max(1, Math.floor((topBlock - bandHeaderH(band) - MARGIN) / ROW_H) + 1);
    return { perPage, pages: Math.max(1, Math.ceil(rows.length / perPage)) };
  });
  const totalPages = pagesPerBand.reduce((a, b) => a + b.pages, 0);

  let pageNo = 0;
  bands.forEach((band, b) => {
    const { perPage, pages } = pagesPerBand[b];
    const colX: number[] = [];
    let x = MARGIN;
    for (const w of band.widths) {
      colX.push(x);
      x += w;
    }
    for (let p = 0; p < pages; p++) {
      pageNo += 1;
      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      let ty = PAGE_H - MARGIN;
      if (logos.length) {
        let lx = MARGIN;
        for (const logo of logos) {
          page.drawImage(logo.image, { x: lx, y: ty - logo.height, width: logo.width, height: logo.height });
          lx += logo.width + 12;
        }
        ty -= LOGO_H + 8;
      }
      let headline = pdfSafe(opts.title);
      while (headline.length > 1 && fontBold.widthOfTextAtSize(headline, 16) > PAGE_W - MARGIN * 2) headline = headline.slice(0, -1);
      page.drawText(headline, { x: MARGIN, y: ty - 12, size: 16, font: fontBold });
      ty -= 26;
      const scoreNote =
        scoreCount > 0 && bands.length > 1 && band.scoreTo
          ? ` - rubrics ${band.scoreFrom}-${band.scoreTo} of ${scoreCount}`
          : '';
      page.drawText(
        pdfSafe(`Compared ${comparedOn} - ${rows.length} ${rows.length === 1 ? 'player' : 'players'}${scoreNote} - page ${pageNo} of ${totalPages}`),
        { x: MARGIN, y: ty - 4, size: 10, font },
      );
      ty -= 22;
      // Column headings wrap onto up to four lines instead of being cut to a few letters.
      const headH = bandHeaderH(band);
      band.colIdx.forEach((ci, j) => {
        const lines = headerLines(ci, band.widths[j]);
        lines.forEach((line, li) =>
          page.drawText(line, { x: colX[j], y: ty - HEAD_LINE * (li + 1) + 2, size: HEAD_SIZE, font: fontBold }),
        );
      });
      let y = ty - headH;
      for (let i = p * perPage; i < Math.min(rows.length, (p + 1) * perPage); i++) {
        band.colIdx.forEach((ci, j) => {
          const f = top[i][ci] ? fontBold : font;
          page.drawText(fit(textRows[i][ci], band.widths[j] - GAP / 2, f), { x: colX[j], y, size: SIZE, font: f });
        });
        y -= ROW_H;
      }
    }
  });

  return { fileName, content: await pdfDoc.saveAsBase64(), mimeType: 'application/pdf' };
}
