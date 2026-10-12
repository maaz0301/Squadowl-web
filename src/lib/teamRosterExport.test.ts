import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx';

import type { TeamRosterPlayer } from '@/data/types';
import {
  TEAM_ROSTER_EXPORT_HEADERS,
  buildTeamRosterExportRows,
  buildTeamRosterFile,
  pdfSafe,
  slugify,
} from './teamRosterExport';

const mk = (i: number, o: Partial<TeamRosterPlayer> = {}): TeamRosterPlayer =>
  ({
    id: `r${i}`,
    athleteId: `a${i}`,
    first: `First${i}`,
    last: `Last${i}`,
    jersey: String(i % 99),
    pos: 'LW',
    yearOfBirth: 2010,
    playerEmail: '',
    guardianEmail: `g${i}@x.com`,
    guardianName: `Guardian ${i}`,
    guardianPhone: '5551234567',
    medicalInfo: 'ALLERGIC TO PEANUTS',
    sourceTryoutName: 'Hello',
    ...o,
  }) as TeamRosterPlayer;

describe('team roster export', () => {
  it('has no medical column', () => {
    expect(TEAM_ROSTER_EXPORT_HEADERS.some((h) => /medical/i.test(h))).toBe(false);
  });

  it('sorts by last then first name, maps every field, leaks no medical text', () => {
    const rows = buildTeamRosterExportRows([
      mk(2),
      mk(10),
      mk(1, { first: 'Zed', last: 'Adams' }),
      mk(3, { yearOfBirth: undefined }),
    ]);
    expect(rows.map((r) => r[2])).toEqual(['Adams', 'Last10', 'Last2', 'Last3']);
    expect(rows.every((r) => r.length === TEAM_ROSTER_EXPORT_HEADERS.length)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('PEANUTS');
    expect(rows[3][4]).toBe('');
  });

  it('writes an Excel file with every one of 999 players', async () => {
    const file = await buildTeamRosterFile({ name: 'team for testing. 01', season: '2025-26' }, Array.from({ length: 999 }, (_, i) => mk(i + 1)), 'xlsx');
    expect(file.fileName).toBe('team-for-testing-01-roster.xlsx');
    const wb = XLSX.read(file.content, { type: 'base64' });
    const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    expect(grid[0]).toEqual([...TEAM_ROSTER_EXPORT_HEADERS]);
    expect(grid).toHaveLength(1000);
    expect(JSON.stringify(grid)).not.toContain('PEANUTS');
  });

  it('keeps accents, apostrophes, commas and emoji in Excel', async () => {
    const file = await buildTeamRosterFile({ name: 'Équipe / Ünï: test?' }, [mk(1, { first: 'Zoë', last: "O'Brien, Jr.", guardianName: 'Renée 😀' })], 'xlsx');
    expect(file.fileName).toMatch(/^[a-z0-9-]+\.xlsx$/);
    const grid = XLSX.utils.sheet_to_json<string[]>(XLSX.read(file.content, { type: 'base64' }).Sheets.Roster, { header: 1 });
    expect(grid[1][1]).toBe('Zoë');
    expect(grid[1][2]).toBe("O'Brien, Jr.");
    expect(grid[1][7]).toContain('😀');
  });

  it('writes a valid multi-page landscape PDF for 999 players', async () => {
    const file = await buildTeamRosterFile({ name: 'team for testing. 01', season: '2025-26' }, Array.from({ length: 999 }, (_, i) => mk(i + 1)), 'pdf');
    const doc = await PDFDocument.load(Buffer.from(file.content, 'base64'));
    expect(doc.getPageCount()).toBeGreaterThan(10);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
    expect(file.mimeType).toBe('application/pdf');
  });

  it('does not throw on emoji, accents or very long text in a PDF', async () => {
    const long = 'x'.repeat(300);
    const file = await buildTeamRosterFile(
      { name: 'A very long team name '.repeat(10), season: '2025-26' },
      [mk(1, { first: 'Zoë 😀', last: long, guardianEmail: long, sourceTryoutName: 'Łódź' })],
      'pdf',
    );
    await PDFDocument.load(Buffer.from(file.content, 'base64'));
  });

  it('handles one player and an empty list', async () => {
    await PDFDocument.load(Buffer.from((await buildTeamRosterFile({ name: 'One' }, [mk(1)], 'pdf')).content, 'base64'));
    await PDFDocument.load(Buffer.from((await buildTeamRosterFile({ name: 'None' }, [], 'pdf')).content, 'base64'));
  });

  it('slugifies and folds text', () => {
    expect(slugify('Team A / B', 'roster')).toBe('team-a-b-roster');
    expect(slugify('')).toBe('export');
    expect(pdfSafe('Zoë 😀')).toBe('Zoë ?');
  });
});
