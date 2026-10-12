import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';
import * as XLSX from 'xlsx';

import type { TeamRosterPlayer } from '@/data/types';
import { download } from '@/lib/exportData';

/**
 * The columns of a team roster export, in order. Contact details a coach needs
 * to reach a family are here; medical information is deliberately not — it is a
 * sensitive field with its own permission on the roster read, and a shared
 * spreadsheet or PDF outlives that permission.
 */
export const TEAM_ROSTER_EXPORT_HEADERS = [
  'Jersey',
  'First Name',
  'Last Name',
  'Position',
  'Year of Birth',
  'Height (cm)',
  'Player Email',
  'Guardian Name',
  'Guardian Email',
  'Guardian Phone',
  'Evaluation',
] as const;

/** One row per player, ordered by last then first name so a printed copy reads like a roll call. */
export function buildTeamRosterExportRows(players: TeamRosterPlayer[]): string[][] {
  return [...players]
    .sort(
      (a, b) =>
        (a.last || '').localeCompare(b.last || '', undefined, { sensitivity: 'base' }) ||
        (a.first || '').localeCompare(b.first || '', undefined, { sensitivity: 'base' }),
    )
    .map((p) => [
      p.jersey ?? '',
      p.first ?? '',
      p.last ?? '',
      p.pos ?? '',
      p.yearOfBirth != null ? String(p.yearOfBirth) : '',
      p.heightCm != null ? String(p.heightCm) : '',
      p.playerEmail ?? '',
      p.guardianName ?? '',
      p.guardianEmail ?? '',
      p.guardianPhone ?? '',
      p.sourceTryoutName ?? '',
    ]);
}

/** Lowercase, hyphenated, filename-safe. */
export function slugify(...parts: (string | undefined)[]): string {
  return (
    parts
      .filter(Boolean)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'export'
  );
}

/**
 * The standard PDF fonts encode WinAnsi (cp1252) only, and pdf-lib *throws* the
 * moment it is asked to draw a character outside it — so a single accented or
 * emoji character in a name would kill the whole export. Fold what can be
 * folded (accents -> base letter), replace the rest.
 */
const WIN_ANSI_HIGH =
  '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

function isWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WIN_ANSI_HIGH.includes(ch);
}

/** Characters NFD can't fold, because the stroke is part of the glyph. */
const TRANSLITERATE: Record<string, string> = {
  'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'Ħ': 'H', 'ħ': 'h',
  'Ŧ': 'T', 'ŧ': 't', 'ı': 'i', 'Ĳ': 'IJ', 'ĳ': 'ij', 'Ŋ': 'N', 'ŋ': 'n',
};

export function pdfSafe(text: string): string {
  if (!text) return text ?? '';
  let out = '';
  for (const ch of text) {
    if (ch === '\t') out += ' ';
    else if (TRANSLITERATE[ch] !== undefined) out += TRANSLITERATE[ch];
    else if (isWinAnsi(ch)) out += ch;
    else {
      const folded = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const kept = Array.from(folded).filter(isWinAnsi).join('');
      out += kept || '?';
    }
  }
  return out;
}

export interface TeamRosterFile {
  fileName: string;
  /** Base64 file contents. */
  content: string;
  mimeType: string;
}

/** Builds the roster file without delivering it, so the bytes can be checked. */
export async function buildTeamRosterFile(
  team: { name: string; season?: string },
  players: TeamRosterPlayer[],
  format: 'xlsx' | 'pdf',
): Promise<TeamRosterFile> {
  const headers = [...TEAM_ROSTER_EXPORT_HEADERS] as string[];
  const rows = buildTeamRosterExportRows(players);
  const fileName = `${slugify(team.name, 'roster')}.${format}`;
  const title = team.season ? `${team.name} (${team.season})` : team.name;

  if (format === 'xlsx') {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [8, 14, 16, 10, 13, 26, 20, 26, 16, 22].map((wch) => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Roster');
    return {
      fileName,
      content: XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // Landscape: ten columns don't fit a portrait page at a readable size.
  const PAGE_W = 842;
  const PAGE_H = 595;
  const MARGIN = 36;
  const widths = [34, 62, 70, 42, 46, 118, 84, 118, 68, 98];
  const scale = (PAGE_W - MARGIN * 2) / widths.reduce((sum, w) => sum + w, 0);
  const colX: number[] = [];
  let x = MARGIN;
  for (const w of widths) {
    colX.push(x);
    x += w * scale;
  }
  const colWidth = widths.map((w) => w * scale - 4);
  const SIZE = 8;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  /** Cut a cell to its column instead of letting it run into the next one. */
  const fit = (text: string, width: number, f: PDFFont): string => {
    const out = pdfSafe(text);
    if (f.widthOfTextAtSize(out, SIZE) <= width) return out;
    let cut = out;
    while (cut.length > 1 && f.widthOfTextAtSize(cut + '...', SIZE) > width) cut = cut.slice(0, -1);
    return cut + '...';
  };

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  // 16pt headline: long names are trimmed by width so they can't run off the page.
  let headline = pdfSafe(title);
  while (headline.length > 1 && fontBold.widthOfTextAtSize(headline, 16) > PAGE_W - MARGIN * 2) {
    headline = headline.slice(0, -1);
  }
  page.drawText(headline, { x: MARGIN, y: y - 6, size: 16, font: fontBold });
  y -= 26;
  page.drawText(pdfSafe(`Roster - ${players.length} ${players.length === 1 ? 'player' : 'players'}`), {
    x: MARGIN,
    y,
    size: 10,
    font,
  });
  y -= 22;

  const drawHeader = () => {
    headers.forEach((h, i) => page.drawText(fit(h, colWidth[i], fontBold), { x: colX[i], y, size: SIZE, font: fontBold }));
    y -= 14;
  };
  drawHeader();

  for (const row of rows) {
    if (y < MARGIN) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      drawHeader();
    }
    row.forEach((cell, i) => page.drawText(fit(cell, colWidth[i], font), { x: colX[i], y, size: SIZE, font }));
    y -= 13;
  }

  return { fileName, content: await pdfDoc.saveAsBase64(), mimeType: 'application/pdf' };
}

/**
 * Export a team's roster as Excel or PDF, delivered as a browser download.
 * Takes the whole roster rather than a page of it — the Players tab only ever
 * holds 50 rows of a large team.
 */
export async function exportTeamRosterData(
  team: { name: string; season?: string },
  players: TeamRosterPlayer[],
  format: 'xlsx' | 'pdf',
): Promise<void> {
  const file = await buildTeamRosterFile(team, players, format);
  download(file.fileName, file.content, 'base64', file.mimeType);
}
