import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from 'pdf-lib';

import type { PlayerFullResults, ReportDocInfo, ReportFilter, ReportSort } from '@/data/resultsExport';
import { BRAND_LOGO_DATA_URI } from '@/lib/brandLogo';

/**
 * Pieces of the printable results report that both the app and the web app
 * share: several players on one page, and a logo strip for club accounts.
 * Kept identical in both repos (src/lib/reportPdf.ts).
 */

/** How many player cards share one page. 1 is the original one-player-per-page report. */
export type PlayersPerPage = 1 | 2 | 4 | 6;
export const PLAYERS_PER_PAGE_OPTIONS: PlayersPerPage[] = [1, 2, 4, 6];

/** What each printed player card shows. Everything is on unless the coach turns it off. */
export interface ReportContent {
  /** Each rubric's score (and the raw evaluation values). */
  rubricScores: boolean;
  /** The overall rank, and each rubric's rank. */
  ranking: boolean;
  /** Recommendation, strengths and areas to improve. */
  comments: boolean;
  /** Who scored each evaluation. */
  assessor: boolean;
  /** When each evaluation was done. */
  date: boolean;
  /** The player's position (and level), which a coach who already knows it can leave off to save room. */
  position: boolean;
}

export const DEFAULT_REPORT_CONTENT: ReportContent = {
  rubricScores: true,
  ranking: true,
  comments: true,
  assessor: true,
  date: true,
  position: true,
};

/** Player cards (one or several to a page), or a compact list: names, scores and ranking only. */
export type ReportLayout = 'cards' | 'list';

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
  /** Order players by jersey number (default), name, age, result or position. */
  sortBy?: ReportSort;
  /** Which players to include; unset means everyone. */
  filter?: ReportFilter;
  /** What each card shows; unset means everything. */
  content?: ReportContent;
  /** Cards (default) or a compact list. */
  layout?: ReportLayout;
  /** The team the evaluation belongs to, printed on the report and added to the spreadsheet. */
  teamName?: string;
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
 * team's, then the app's own (which a coach can leave off once they have a
 * logo of their own). The team's logo prints on every plan, since a
 * coach uploads it for their own team; the organization logo is a Club-plan
 * touch, and the app logo is on every report.
 */
export function reportLogoUrls(opts: {
  club: boolean;
  organizationLogoUrl?: string;
  teamLogoUrl?: string;
  /** Print the SquadOwl logo too. On unless a coach turns it off; only honoured when they have a logo of their own to print. */
  appLogo?: boolean;
}): string[] {
  const own = [opts.club ? opts.organizationLogoUrl : undefined, opts.teamLogoUrl].filter((u): u is string => !!u);
  // A report with no logo of its own always keeps the SquadOwl one, so a page is never left bare.
  const showApp = opts.appLogo !== false || own.length === 0;
  return showApp ? [...own, BRAND_LOGO_DATA_URI] : own;
}

/**
 * Draws the logos along the top of the page, inside the border, on one line: the
 * organization and team logos from the left edge, and the last logo (the app's
 * own) against the right edge. With a single logo it stays on the left.
 */
export function drawLogoStrip(page: PDFPage, logos: EmbeddedLogo[], left: number): void {
  const y = (logo: EmbeddedLogo) => PAGE_HEIGHT - 32 - logo.height;
  const rightLogo = logos.length > 1 ? logos[logos.length - 1] : undefined;
  const leftLogos = rightLogo ? logos.slice(0, -1) : logos;
  let x = left;
  for (const logo of leftLogos) {
    page.drawImage(logo.image, { x, y: y(logo), width: logo.width, height: logo.height });
    x += logo.width + 12;
  }
  if (rightLogo) {
    page.drawImage(rightLogo.image, {
      x: PAGE_WIDTH - left - rightLogo.width,
      y: y(rightLogo),
      width: rightLogo.width,
      height: rightLogo.height,
    });
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
  content: ReportContent = DEFAULT_REPORT_CONTENT,
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
      drawCompactCard(page, fonts, card, { x: x0, yTop, w: slotW, h: slotH, pad }, content);
    });
  }
}

/**
 * How many rubric rows a several-per-page card can print before the rest are cut
 * to "+N more". The same arithmetic drawCompactCard uses, so the export page can
 * warn before anyone exports a PDF that leaves rubrics out.
 */
export function compactMetricCapacity(
  perPage: Exclude<PlayersPerPage, 1>,
  hasLogo: boolean,
  content: ReportContent = DEFAULT_REPORT_CONTENT,
): number {
  const { rows } = GRID[perPage];
  const gap = 10;
  const top = PAGE_HEIGHT - 40 - (hasLogo ? LOGO_BAND : 0);
  const gridTop = top - 34;
  const slotH = (gridTop - 40 - gap * (rows - 1)) / rows;
  // Name, overall and rule take 41 points off the top of the card; notes are pinned at the bottom.
  const notesH = content.comments ? 3 * (7 + 3) + 4 : 0;
  const metricsAvail = slotH - 48 - notesH;
  return Math.max(0, Math.floor(metricsAvail / 6.5) - 1);
}

function drawCompactCard(
  page: PDFPage,
  { font, bold }: { font: PDFFont; bold: PDFFont },
  card: PlayerFullResults,
  box: { x: number; yTop: number; w: number; h: number; pad: number },
  content: ReportContent,
): void {
  const { x, yTop, w, h, pad } = box;
  page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderColor: RULE, borderWidth: 0.75 });

  const innerX = x + pad;
  const innerW = w - pad * 2;
  let y = yTop - pad - 11;

  // Name, with jersey/position on the right when there is room.
  const meta = pdfSafe(
    [`#${card.jersey || '-'}`, ...(content.position ? [card.pos || '-'] : []), ...(card.birthDate ? [`Born ${card.birthDate}`] : []), `Evals ${card.evalCount}`].join(' | '),
  );
  const metaW = font.widthOfTextAtSize(meta, 7.5);
  page.drawText(fitText(card.name, bold, 11, innerW - metaW - 8), { x: innerX, y, size: 11, font: bold, color: BLACK });
  page.drawText(meta, { x: innerX + innerW - metaW, y: y + 1, size: 7.5, font, color: GRAY });
  y -= 13;

  // Overall.
  page.drawText(
    fitText(
      content.ranking
        ? `Overall ${card.overallScore || '-'}   Rank ${card.overallRank || '-'}`
        : `Overall ${card.overallScore || '-'}`,
      bold,
      10,
      innerW,
    ),
    { x: innerX, y, size: 10, font: bold, color: BLUE },
  );
  y -= 6;
  page.drawLine({ start: { x: innerX, y }, end: { x: innerX + innerW, y }, thickness: 0.5, color: RULE });
  y -= 4;

  // Notes are budgeted first so the metric rows shrink to fit around them.
  const noteLines = content.comments
    ? ([
        ['Rec', card.recommendation],
        ['Str', card.strengths],
        ['Imp', card.improve],
      ] as const)
    : ([] as const);
  const noteSize = 7;
  const notesH = noteLines.length ? noteLines.length * (noteSize + 3) + 4 : 0;
  const metricsAvail = y - (yTop - h + pad) - notesH;
  const metrics = content.rubricScores ? card.metrics : [];
  const n = metrics.length;
  const rowH = Math.max(6.5, Math.min(11, n ? metricsAvail / (n + 1) : 11));
  const size = Math.min(8, rowH - 1.5);
  // Scores read larger and bolder than the labels beside them, as far as the row allows.
  const scoreSize = Math.min(size + 2, rowH - 0.5);
  const scoreX = innerX + innerW * 0.62;
  const rankX = innerX + innerW * 0.82;

  if (n) {
    page.drawText('METRIC', { x: innerX, y: y - size, size: size - 1, font: bold, color: GRAY });
    page.drawText('SCORE', { x: scoreX, y: y - size, size: size - 1, font: bold, color: GRAY });
    if (content.ranking) page.drawText('RANK', { x: rankX, y: y - size, size: size - 1, font: bold, color: GRAY });
    y -= rowH;
  }

  const fits = Math.max(0, Math.floor(metricsAvail / rowH) - 1);
  const shown = metrics.slice(0, fits);
  for (const m of shown) {
    page.drawText(fitText(m.label, font, size, scoreX - innerX - 4), { x: innerX, y: y - size, size, font, color: BLACK });
    page.drawText(pdfSafe(m.score), { x: scoreX, y: y - size, size: scoreSize, font: bold, color: BLACK });
    if (content.ranking) page.drawText(pdfSafe(m.rank), { x: rankX, y: y - size, size, font, color: BLACK });
    y -= rowH;
  }
  if (shown.length < n) {
    page.drawText(`+${n - shown.length} more`, { x: innerX, y: y - size, size: size - 1, font, color: GRAY });
  }

  // Notes pinned to the bottom of the card (none when comments are off).
  let ny = yTop - h + pad + notesH - 6;
  for (const [label, value] of noteLines) {
    const line = fitText(`${label}: ${value || '-'}`, font, noteSize, innerW);
    page.drawText(line, { x: innerX, y: ny, size: noteSize, font, color: label === 'Rec' ? BLUE : BLACK });
    ny -= noteSize + 3;
  }
}

// ---------------------------------------------------------------------------
// Compact list
// ---------------------------------------------------------------------------

/**
 * A plain ranked table: one row per player with rank, name, position and overall
 * score, plus each rubric's score when those are on. No notes or comments, so a
 * whole roster fits a page or two. When there are more rubrics than fit across
 * the page they continue in further tables below, each repeating rank and name.
 */
export function renderListResults(
  pdfDoc: PDFDocument,
  fonts: { font: PDFFont; bold: PDFFont },
  docInfo: ReportDocInfo,
  cards: PlayerFullResults[],
  logos: EmbeddedLogo[],
  content: ReportContent = DEFAULT_REPORT_CONTENT,
): void {
  const { font, bold } = fonts;
  const side = 40;
  const top = PAGE_HEIGHT - 40 - (logos.length ? LOGO_BAND : 0);
  const bottom = 46;
  const rowH = 17;
  const tableW = PAGE_WIDTH - side * 2;

  // Rubrics in the order they first appear, so every row lines up under one header.
  const metricLabels: string[] = [];
  if (content.rubricScores) {
    for (const card of cards) for (const m of card.metrics) if (!metricLabels.includes(m.label)) metricLabels.push(m.label);
  }

  const rankW = content.ranking ? 44 : 0;
  const nameW = 136;
  const posW = content.position ? 70 : 0;
  const bornW = 58;
  const overallW = 54;
  const metricW = 48;
  const fixedW = rankW + nameW + posW + bornW + overallW;
  const perChunk = Math.max(1, Math.floor((tableW - fixedW) / metricW));
  const chunks: string[][] = [];
  for (let i = 0; i < metricLabels.length; i += perChunk) chunks.push(metricLabels.slice(i, i + perChunk));
  if (!chunks.length) chunks.push([]);

  // Rubric names often share a start ("Vertical Jump 1FT Left" / "...Right"), so the
  // column headers wrap onto up to three lines instead of being cut short.
  const HEAD_SIZE = 6;
  const HEAD_LINE = 7.5;
  const wrapHead = (text: string, maxW: number): string[] => {
    const words = pdfSafe(text.toUpperCase()).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && bold.widthOfTextAtSize(next, HEAD_SIZE) > maxW) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    const capped = lines.slice(0, 3).map((l) => fitText(l, bold, HEAD_SIZE, maxW));
    if (lines.length > 3) capped[2] = fitText(`${lines[2]}...`, bold, HEAD_SIZE, maxW);
    return capped;
  };
  const headLines = Math.max(1, ...chunks.flat().map((l) => wrapHead(l, metricW - 4).length));
  const headBlock = headLines * HEAD_LINE;

  // Rows that fit under the title block and column header.
  const headerH = 34 + headBlock + 10;
  const rowsPerPage = Math.max(1, Math.floor((top - headerH - bottom) / rowH));
  const pageCount = chunks.length * Math.max(1, Math.ceil(cards.length / rowsPerPage));
  let pageNo = 0;

  for (const chunk of chunks) {
    for (let start = 0; start < Math.max(1, cards.length); start += rowsPerPage) {
      pageNo += 1;
      const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      page.drawRectangle({ x: 24, y: 24, width: PAGE_WIDTH - 48, height: PAGE_HEIGHT - 48, borderColor: BLACK, borderWidth: 1 });
      if (logos.length) drawLogoStrip(page, logos, side);

      page.drawText(fitText(docInfo.title, bold, 13, tableW), { x: side, y: top - 12, size: 13, font: bold, color: BLACK });
      const pageLabel = `Page ${pageNo} of ${pageCount}`;
      page.drawText(pageLabel, { x: PAGE_WIDTH - side - font.widthOfTextAtSize(pageLabel, 7.5), y: top - 24, size: 7.5, font, color: GRAY });
      page.drawText(fitText(docInfo.subtitle, font, 7.5, tableW - 70), { x: side, y: top - 24, size: 7.5, font, color: GRAY });

      // Column header: one line for the fixed columns, wrapped lines for the rubrics.
      const headTop = top - 34 - 2;
      let y = headTop - HEAD_SIZE;
      const colX = {
        rank: side,
        name: side + rankW,
        pos: side + rankW + nameW,
        born: side + rankW + nameW + posW,
        overall: side + rankW + nameW + posW + bornW,
        metric: side + fixedW,
      };
      const head = (text: string, x: number, w: number) =>
        page.drawText(fitText(text.toUpperCase(), bold, HEAD_SIZE + 1, w - 4), { x, y: headTop - HEAD_SIZE, size: HEAD_SIZE + 1, font: bold, color: GRAY });
      if (content.ranking) head('Rank', colX.rank, rankW);
      head('Player', colX.name, nameW);
      if (content.position) head('Pos', colX.pos, posW);
      head('Born', colX.born, bornW);
      head('Overall', colX.overall, overallW);
      chunk.forEach((label, i) => {
        wrapHead(label, metricW - 4).forEach((line, li) => {
          page.drawText(line, { x: colX.metric + i * metricW, y: headTop - HEAD_SIZE - li * HEAD_LINE, size: HEAD_SIZE, font: bold, color: GRAY });
        });
      });
      y = headTop - headBlock - 3;
      page.drawLine({ start: { x: side, y }, end: { x: side + tableW, y }, thickness: 0.5, color: RULE });
      y -= rowH - 4;

      cards.slice(start, start + rowsPerPage).forEach((card, i) => {
        if (i % 2 === 1) {
          page.drawRectangle({ x: side, y: y - 4, width: tableW, height: rowH, color: rgb(0.96, 0.96, 0.96) });
        }
        if (content.ranking) {
          page.drawText(fitText(card.overallRank || '-', font, 9, rankW - 4), { x: colX.rank, y, size: 9, font, color: GRAY });
        }
        page.drawText(fitText(card.name, bold, 9, nameW - 6), { x: colX.name, y, size: 9, font: bold, color: BLACK });
        if (content.position) page.drawText(fitText(card.pos || '-', font, 9, posW - 4), { x: colX.pos, y, size: 9, font, color: BLACK });
        page.drawText(fitText(card.birthDate || '-', font, 9, bornW - 4), { x: colX.born, y, size: 9, font, color: BLACK });
        page.drawText(fitText(card.overallScore || '-', bold, 10, overallW - 4), { x: colX.overall, y, size: 10, font: bold, color: BLUE });
        chunk.forEach((label, ci) => {
          const m = card.metrics.find((x) => x.label === label);
          page.drawText(fitText(m?.display || m?.score || '-', font, 9, metricW - 4), { x: colX.metric + ci * metricW, y, size: 9, font, color: BLACK });
        });
        y -= rowH;
      });

      if (!cards.length) {
        page.drawText('No players match these filters.', { x: side, y, size: 10, font, color: GRAY });
      }
    }
  }
}
