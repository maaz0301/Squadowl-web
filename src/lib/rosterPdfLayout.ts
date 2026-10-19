/**
 * Column layout for the team roster PDF. Every column is as wide as its widest
 * entry (header included), so nothing is cut short or runs into its neighbour.
 * When that does not fit the page the text shrinks a little, and only if it still
 * does not fit does the page grow wider. Kept identical in both repos.
 */
export interface RosterPdfLayout {
  /** Font size for the table text. */
  size: number;
  /** Width of each column, padding included. */
  widths: number[];
  pageWidth: number;
}

export function planRosterPdfColumns(opts: {
  headers: string[];
  rows: string[][];
  /** Width of `text` in points at `size` (`bold` for header text). */
  measure: (text: string, size: number, bold: boolean) => number;
  pageWidth?: number;
  margin?: number;
  baseSize?: number;
  minSize?: number;
  /** Space left between columns. */
  gap?: number;
  /** A very long entry (an email) is allowed this much before it is cut. */
  maxColumn?: number;
}): RosterPdfLayout {
  const { headers, rows, measure } = opts;
  const page = opts.pageWidth ?? 842;
  const margin = opts.margin ?? 36;
  const base = opts.baseSize ?? 8;
  const minSize = opts.minSize ?? 6.5;
  const gap = opts.gap ?? 8;
  const maxColumn = opts.maxColumn ?? 170;

  const natural = headers.map((h, i) => {
    let w = measure(h, base, true);
    for (const r of rows) w = Math.max(w, measure(r[i] ?? '', base, false));
    return Math.min(w, maxColumn) + gap;
  });
  const total = natural.reduce((a, b) => a + b, 0);
  const avail = page - margin * 2;

  if (total <= avail) {
    // Spare room is shared out in proportion, so the table fills the page.
    const k = avail / total;
    return { size: base, widths: natural.map((w) => w * k), pageWidth: page };
  }
  const size = Math.max(minSize, (base * avail) / total);
  const widths = natural.map((w) => (w * size) / base);
  const needed = widths.reduce((a, b) => a + b, 0);
  return { size, widths, pageWidth: needed <= avail ? page : Math.ceil(needed + margin * 2) };
}
