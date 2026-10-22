import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';
import * as XLSX from 'xlsx';

import { formatCompareDate, isTopPerformer, type CompareTable } from '@/data/compare';
import { embedLogos, pdfSafe } from '@/lib/reportPdf';
import { planRosterPdfColumns } from '@/lib/rosterPdfLayout';

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

  const PAGE_H = 595;
  const MARGIN = 36;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const textRows = rows.map((r) => r.map((c) => String(c)));
  const layout = planRosterPdfColumns({
    headers,
    rows: textRows,
    measure: (text, size, bold) => (bold ? fontBold : font).widthOfTextAtSize(pdfSafe(text), size),
  });
  const PAGE_W = layout.pageWidth;
  const SIZE = layout.size;
  const colX: number[] = [];
  let x = MARGIN;
  for (const w of layout.widths) {
    colX.push(x);
    x += w;
  }
  const colWidth = layout.widths.map((w) => w - 4);
  const fit = (text: string, width: number, f: PDFFont): string => {
    const out = pdfSafe(text);
    if (f.widthOfTextAtSize(out, SIZE) <= width) return out;
    let cut = out;
    while (cut.length > 1 && f.widthOfTextAtSize(cut + '...', SIZE) > width) cut = cut.slice(0, -1);
    return cut + '...';
  };

  const logos = await embedLogos(pdfDoc, opts.logoUrls);
  const LOGO_H = logos.length ? 30 : 0;
  const drawTop = (page: ReturnType<typeof pdfDoc.addPage>, pageNo: number, pages: number) => {
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
    page.drawText(
      pdfSafe(`Compared ${comparedOn} - ${rows.length} ${rows.length === 1 ? 'player' : 'players'} - page ${pageNo} of ${pages}`),
      { x: MARGIN, y: ty - 4, size: 10, font },
    );
    ty -= 22;
    headers.forEach((h, i) => page.drawText(fit(h, colWidth[i], fontBold), { x: colX[i], y: ty, size: SIZE, font: fontBold }));
    return ty - 14;
  };

  // How many rows fit on a page, so "page N of M" can be printed on each one.
  const firstTop = PAGE_H - MARGIN - (logos.length ? LOGO_H + 8 : 0) - 26 - 22 - 14;
  const perPage = Math.max(1, Math.floor((firstTop - MARGIN) / 13) + 1);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  for (let p = 0; p < pages; p++) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let y = drawTop(page, p + 1, pages);
    for (let i = p * perPage; i < Math.min(rows.length, (p + 1) * perPage); i++) {
      textRows[i].forEach((cell, c) => {
        const f = top[i][c] ? fontBold : font;
        page.drawText(fit(cell, colWidth[c], f), { x: colX[c], y, size: SIZE, font: f });
      });
      y -= 13;
    }
  }

  return { fileName, content: await pdfDoc.saveAsBase64(), mimeType: 'application/pdf' };
}
