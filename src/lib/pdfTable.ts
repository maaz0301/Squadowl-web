import type { ParsedSheet, SheetRow } from '@/lib/rosterImport';

/**
 * Reading a results table out of a PDF.
 *
 * A PDF has no rows or columns, only pieces of text at positions. This puts the
 * pieces back into lines (same height), splits each line into cells (a gap wider
 * than a space), takes the widest early line as the heading row, and drops every
 * later cell under the heading it sits closest to. The result is the same
 * heading-plus-rows shape a spreadsheet gives, so the coach maps and reviews it
 * exactly the same way. It is a guess: the review step is where it gets checked.
 */

/** One run of text as the PDF draws it. Coordinates are in PDF points, origin bottom-left. */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

/** Items closer in height than this are the same line. */
const LINE_TOLERANCE = 3;
/** A gap wider than this between two runs starts a new cell. */
const CELL_GAP = 9;
/** How many lines down the heading row may sit (titles, dates and logos come first). */
const HEADING_SEARCH_LINES = 12;

interface Cell {
  text: string;
  x0: number;
  x1: number;
}

/** Group a page's text runs into lines, top to bottom, each split into cells left to right. */
export function pageLines(items: PdfTextItem[]): Cell[][] {
  const runs = items.filter((i) => i.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfTextItem[][] = [];
  for (const run of runs) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - run.y) <= LINE_TOLERANCE) line.push(run);
    else lines.push([run]);
  }
  return lines.map((line) => {
    const cells: Cell[] = [];
    for (const run of [...line].sort((a, b) => a.x - b.x)) {
      const last = cells[cells.length - 1];
      if (last && run.x - last.x1 <= CELL_GAP) {
        // Runs this close are one cell; a space is added only where there was a visible gap.
        last.text += (run.x - last.x1 > 1 ? ' ' : '') + run.str.trim();
        last.x1 = run.x + run.width;
      } else {
        cells.push({ text: run.str.trim(), x0: run.x, x1: run.x + run.width });
      }
    }
    return cells;
  });
}

const sameRow = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v.trim().toLowerCase() === b[i].trim().toLowerCase());

/** Build the heading row and data rows from every page's text runs. */
export function pdfPagesToSheet(pages: PdfTextItem[][]): ParsedSheet {
  const pageCells = pages.map(pageLines);
  const all = pageCells.flat();

  // The heading row: the widest of the first few multi-cell lines.
  let headingIndex = -1;
  let widest = 1;
  for (let i = 0; i < Math.min(all.length, HEADING_SEARCH_LINES); i++) {
    if (all[i].length > widest) {
      widest = all[i].length;
      headingIndex = i;
    }
  }
  if (headingIndex === -1) {
    throw new Error('No table was found in that PDF. It needs a heading row with the column names.');
  }

  const heading = all[headingIndex];
  const headers = heading.map((c) => c.text);
  const columnFor = (cell: Cell): number => {
    const centre = (cell.x0 + cell.x1) / 2;
    let best = 0;
    let bestDistance = Infinity;
    heading.forEach((h, i) => {
      const distance = Math.min(
        Math.abs(cell.x0 - h.x0),
        Math.abs(cell.x1 - h.x1),
        Math.abs(centre - (h.x0 + h.x1) / 2),
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  };

  const rows: SheetRow[] = [];
  let index = -1;
  for (const cells of pageCells.flat()) {
    index += 1;
    if (index <= headingIndex) continue; // the titles above the table, and the heading itself
    if (sameRow(cells.map((c) => c.text), headers)) continue; // heading repeated on a later page
    // A lone cell is a title, a page number or a footer, not a player.
    if (cells.length < 2) continue;
    const out = Array<string>(headers.length).fill('');
    for (const cell of cells) {
      const col = columnFor(cell);
      out[col] = out[col] ? `${out[col]} ${cell.text}` : cell.text;
    }
    rows.push({ line: index + 1, cells: out });
  }

  return { sheetNames: ['PDF'], sheetName: 'PDF', headers, rows, headerLine: headingIndex + 1 };
}

/** Read a PDF's text runs, page by page, with pdf.js (loaded only when a PDF is actually opened). */
export async function readPdfPages(data: ArrayBuffer): Promise<PdfTextItem[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Run pdf.js's own worker code on this thread: one small file at a time, and no
  // separate worker file for the bundler to find.
  if (typeof window !== 'undefined' && !(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker) {
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: PdfTextItem[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .filter((i): i is typeof i & { str: string; transform: number[]; width: number } => 'str' in i)
        .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], width: i.width })),
    );
  }
  return pages;
}

export async function parsePdfFile(file: File): Promise<ParsedSheet> {
  const sheet = pdfPagesToSheet(await readPdfPages(await file.arrayBuffer()));
  if (sheet.rows.length === 0) {
    throw new Error('A table heading was found but no rows below it. Scanned or image-only PDFs cannot be read.');
  }
  return sheet;
}
