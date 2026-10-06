import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from 'pdf-lib';

import type { PlayerFullResults, ReportDocInfo } from '@/data/resultsExport';
import { BRAND_LOGO_DATA_URI } from '@/lib/brandLogo';

/**
 * Pieces of the printable results report that both the app and the web app
 * share: several players on one page, and a logo strip for club accounts.
 * Kept identical in both repos (src/lib/reportPdf.ts).
 */

/** How many player cards share one page. 1 is the original one-player-per-page report. */
export type PlayersPerPage = 1 | 2 | 4 | 6;
export const PLAYERS_PER_PAGE_OPTIONS: PlayersPerPage[] = [1, 2, 4, 6];

export interface ReportPdfOptions {
  playersPerPage?: PlayersPerPage;
  /**
   * With one player per page, run players on continuously instead: each starts
   * straight after the last, with no page break and no blank space between them,
   * and keeps its full per-evaluation detail.
   */
  continuous?: boolean;
  /** Logo image URLs to print at the top of every page (team, organization). Unreachable or unsupported ones are skipped. */
  logoUrls?: string[];
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const GRAY = rgb(0.45, 0.45, 0.45);
const BLACK = rgb(0, 0, 0);
const RULE = rgb(0.8, 0.8, 0.8);
const BLUE = rgb(0.1, 0.32, 0.6);

// ---------------------------------------------------------------------------
// Text safety
// ---------------------------------------------------------------------------

/**
 * The standard PDF fonts encode WinAnsi (cp1252) only, and pdf-lib throws the
 * moment it is asked to draw a character outside it, so one accented or emoji
 * character in a name or a coach's notes would kill the whole export. Fold what
 * can be folded (accents become the base letter) and replace the rest.
 */
const WIN_ANSI_HIGH =
  '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

function isWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WIN_ANSI_HIGH.includes(ch);
}

const TRANSLITERATE: Record<string, string> = {
  'Ł': 'L',
  'ł': 'l',
  'Đ': 'D',
  'đ': 'd',
  'Ħ': 'H',
  'ħ': 'h',
  'Ŧ': 'T',
  'ŧ': 't',
  'ı': 'i',
  'Ĳ': 'IJ',
  'ĳ': 'ij',
  'Ŋ': 'N',
  'ŋ': 'n',
  '′': "'",
  '″': '"',
};

export function pdfSafe(text: string): string {
  if (!text) return text ?? '';
  let out = '';
  for (const ch of text) {
    if (ch === '\t') {
      out += ' ';
    } else if (TRANSLITERATE[ch] !== undefined) {
      out += TRANSLITERATE[ch];
    } else if (isWinAnsi(ch)) {
      out += ch;
    } else {
      const folded =
        typeof ch.normalize === 'function' ? ch.normalize('NFD').replace(/[̀-ͯ]/g, '') : '';
      const kept = Array.from(folded).filter(isWinAnsi).join('');
      out += kept || '?';
    }
  }
  return out;
}

/** Shortens `text` with an ellipsis until it fits `maxWidth`. */
function fitText(text: string, f: PDFFont, size: number, maxWidth: number): string {
  const safe = pdfSafe(text);
  if (f.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let end = safe.length;
  while (end > 1 && f.widthOfTextAtSize(`${safe.slice(0, end)}...`, size) > maxWidth) end -= 1;
  return `${safe.slice(0, end).trimEnd()}...`;
}

// ---------------------------------------------------------------------------
// Logos
// ---------------------------------------------------------------------------

/** Height of the strip logos are drawn in, and how far content moves down to make room for it. */
export const LOGO_HEIGHT = 30;
export const LOGO_BAND = LOGO_HEIGHT + 6;

export interface EmbeddedLogo {
  image: PDFImage;
  width: number;
  height: number;
}

/**
 * Downloads each logo and embeds it. PNG and JPEG only: those are what pdf-lib
 * can embed, so a WebP or SVG logo is skipped rather than failing the export.
 * A logo that cannot be fetched is skipped for the same reason; the report is
 * more useful without it than not at all.
 */
export async function embedLogos(pdfDoc: PDFDocument, urls: string[] | undefined): Promise<EmbeddedLogo[]> {
  const out: EmbeddedLogo[] = [];
  for (const url of urls ?? []) {
    if (!url) continue;
    try {
      if (url.startsWith('data:image/png')) {
        const image = await pdfDoc.embedPng(url);
        const scale = LOGO_HEIGHT / image.height;
        out.push({ image, width: image.width * scale, height: LOGO_HEIGHT });
        continue;
      }
      const res = await fetch(url);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
      if (!isPng && !isJpg) continue;
      const image = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      const scale = LOGO_HEIGHT / image.height;
      out.push({ image, width: image.width * scale, height: LOGO_HEIGHT });
    } catch {
      // Skipped on purpose; see above.
    }
  }
  return out;
}

/**
 * The logos a printed report carries, left to right: the organization's, the
 * team's, then the app's own. The organization and team logos are a Club-plan
 * touch; the app logo is on every report.
 */
export function reportLogoUrls(opts: { club: boolean; organizationLogoUrl?: string; teamLogoUrl?: string }): string[] {
  const own = opts.club ? [opts.organizationLogoUrl, opts.teamLogoUrl] : [];
  return [...own, BRAND_LOGO_DATA_URI].filter((u): u is string => !!u);
}

/** Draws the logos side by side along the top-left of the page, inside the border. */
export function drawLogoStrip(page: PDFPage, logos: EmbeddedLogo[], left: number): void {
  let x = left;
  for (const logo of logos) {
    page.drawImage(logo.image, { x, y: PAGE_HEIGHT - 32 - logo.height, width: logo.width, height: logo.height });
    x += logo.width + 12;
  }
}

// ---------------------------------------------------------------------------
// Several players per page
// ---------------------------------------------------------------------------

const GRID: Record<Exclude<PlayersPerPage, 1>, { cols: number; rows: number }> = {
  2: { cols: 1, rows: 2 },
  4: { cols: 2, rows: 2 },
  6: { cols: 2, rows: 3 },
};

/**
 * Lays player cards out in a grid, several to a page. Each card carries the
 * player's name, overall score and rank, every category's score and rank, and
 * the recommendation, strengths and improvement notes. The per-evaluation raw
 * score lines are left to the one-player-per-page report; they are what would
 * make a card too tall to share a page.
 */
export function renderCompactResults(
  pdfDoc: PDFDocument,
  fonts: { font: PDFFont; bold: PDFFont },
  docInfo: ReportDocInfo,
  cards: PlayerFullResults[],
  perPage: Exclude<PlayersPerPage, 1>,
  logos: EmbeddedLogo[],
): void {
  const { font, bold } = fonts;
  const { cols, rows } = GRID[perPage];
  const side = 40;
  const gap = 10;
  const top = PAGE_HEIGHT - 40 - (logos.length ? LOGO_BAND : 0);
  const bottom = 40;

  // Title block, then the grid below it.
  const headerH = 34;
  const gridTop = top - headerH;
  const slotW = (PAGE_WIDTH - side * 2 - gap * (cols - 1)) / cols;
  const slotH = (gridTop - bottom - gap * (rows - 1)) / rows;
  const pad = 7;
  const perSheet = cols * rows;
  const pageCount = Math.max(1, Math.ceil(cards.length / perSheet));

  for (let p = 0; p < pageCount; p++) {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawRectangle({
      x: 24,
      y: 24,
      width: PAGE_WIDTH - 48,
      height: PAGE_HEIGHT - 48,
      borderColor: BLACK,
      borderWidth: 1,
    });
    if (logos.length) drawLogoStrip(page, logos, side);

    page.drawText(fitText(docInfo.title, bold, 13, PAGE_WIDTH - side * 2), {
      x: side,
      y: top - 12,
      size: 13,
      font: bold,
      color: BLACK,
    });
    const pageLabel = `Page ${p + 1} of ${pageCount}`;
    page.drawText(pageLabel, {
      x: PAGE_WIDTH - side - font.widthOfTextAtSize(pageLabel, 7.5),
      y: top - 24,
      size: 7.5,
      font,
      color: GRAY,
    });
    page.drawText(fitText(docInfo.subtitle, font, 7.5, PAGE_WIDTH - side * 2 - 70), {
      x: side,
      y: top - 24,
      size: 7.5,
      font,
      color: GRAY,
    });

    const batch = cards.slice(p * perSheet, (p + 1) * perSheet);
    batch.forEach((card, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x0 = side + col * (slotW + gap);
      const yTop = gridTop - row * (slotH + gap);
      drawCompactCard(page, fonts, card, { x: x0, yTop, w: slotW, h: slotH, pad });
    });
  }
}

function drawCompactCard(
  page: PDFPage,
  { font, bold }: { font: PDFFont; bold: PDFFont },
  card: PlayerFullResults,
  box: { x: number; yTop: number; w: number; h: number; pad: number },
): void {
  const { x, yTop, w, h, pad } = box;
  page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderColor: RULE, borderWidth: 0.75 });

  const innerX = x + pad;
  const innerW = w - pad * 2;
  let y = yTop - pad - 11;

  // Name, with jersey/position on the right when there is room.
  const meta = pdfSafe(`#${card.jersey || '-'} | ${card.pos || '-'} | Evals ${card.evalCount}`);
  const metaW = font.widthOfTextAtSize(meta, 7.5);
  page.drawText(fitText(card.name, bold, 11, innerW - metaW - 8), { x: innerX, y, size: 11, font: bold, color: BLACK });
  page.drawText(meta, { x: innerX + innerW - metaW, y: y + 1, size: 7.5, font, color: GRAY });
  y -= 13;

  // Overall.
  page.drawText(
    fitText(`Overall ${card.overallScore || '-'}   Rank ${card.overallRank || '-'}`, bold, 9, innerW),
    { x: innerX, y, size: 9, font: bold, color: BLUE },
  );
  y -= 6;
  page.drawLine({ start: { x: innerX, y }, end: { x: innerX + innerW, y }, thickness: 0.5, color: RULE });
  y -= 4;

  // Notes are budgeted first so the metric rows shrink to fit around them.
  const noteLines = [
    ['Rec', card.recommendation],
    ['Str', card.strengths],
    ['Imp', card.improve],
  ] as const;
  const noteSize = 7;
  const notesH = noteLines.length * (noteSize + 3) + 4;
  const metricsAvail = y - (yTop - h + pad) - notesH;
  const n = card.metrics.length;
  const rowH = Math.max(6.5, Math.min(11, n ? metricsAvail / (n + 1) : 11));
  const size = Math.min(8, rowH - 1.5);
  const scoreX = innerX + innerW * 0.62;
  const rankX = innerX + innerW * 0.82;

  page.drawText('METRIC', { x: innerX, y: y - size, size: size - 1, font: bold, color: GRAY });
  page.drawText('SCORE', { x: scoreX, y: y - size, size: size - 1, font: bold, color: GRAY });
  page.drawText('RANK', { x: rankX, y: y - size, size: size - 1, font: bold, color: GRAY });
  y -= rowH;

  const fits = Math.max(0, Math.floor(metricsAvail / rowH) - 1);
  const shown = card.metrics.slice(0, fits);
  for (const m of shown) {
    page.drawText(fitText(m.label, font, size, scoreX - innerX - 4), { x: innerX, y: y - size, size, font, color: BLACK });
    page.drawText(pdfSafe(m.score), { x: scoreX, y: y - size, size, font, color: BLACK });
    page.drawText(pdfSafe(m.rank), { x: rankX, y: y - size, size, font, color: BLACK });
    y -= rowH;
  }
  if (shown.length < n) {
    page.drawText(`+${n - shown.length} more`, { x: innerX, y: y - size, size: size - 1, font, color: GRAY });
  }

  // Notes pinned to the bottom of the card.
  let ny = yTop - h + pad + notesH - 6;
  for (const [label, value] of noteLines) {
    const line = fitText(`${label}: ${value || '-'}`, font, noteSize, innerW);
    page.drawText(line, { x: innerX, y: ny, size: noteSize, font, color: label === 'Rec' ? BLUE : BLACK });
    ny -= noteSize + 3;
  }
}
