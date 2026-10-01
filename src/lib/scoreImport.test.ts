import { describe, expect, it } from 'vitest';

import type { CustomRubric, Player } from '@/data/types';
import { parseWorkbook, type ParsedSheet } from '@/lib/rosterImport';
import {
  buildScoreImportRows,
  guessIdentityMapping,
  guessMeasureMapping,
  parseMeasureValue,
  validateImportSetup,
} from '@/lib/scoreImport';

const measure = (over: Partial<CustomRubric>): CustomRubric =>
  ({ key: 'k', label: 'L', scoringType: 'skill', scale: '1-5', rankingDirection: 'higher_is_better', ...over }) as CustomRubric;

const player = (id: string, first: string, last: string, jersey?: string) => ({ id, first, last, jersey }) as Player;

const sheet = (headers: string[], rows: string[][]): ParsedSheet => ({
  sheetNames: ['S'],
  sheetName: 'S',
  headers,
  headerLine: 1,
  rows: rows.map((cells, i) => ({ line: i + 2, cells })),
});

describe('parseMeasureValue', () => {
  it('validates skill scale', () => {
    expect(parseMeasureValue('4', measure({}))).toEqual({ value: 4, error: null });
    expect(parseMeasureValue('7', measure({})).error).toMatch(/outside 1-5/);
    expect(parseMeasureValue('7', measure({ scale: '1-10' })).value).toBe(7);
  });
  it('reads yes/no and blanks', () => {
    const yn = measure({ scoringType: 'yes_no' });
    expect(parseMeasureValue('Yes', yn).value).toBe(1);
    expect(parseMeasureValue('n', yn).value).toBe(0);
    expect(parseMeasureValue('maybe', yn).error).toBeTruthy();
    expect(parseMeasureValue('  ', yn)).toEqual({ value: null, error: null });
  });
  it('reads times and units', () => {
    const t = measure({ scoringType: 'time' });
    expect(parseMeasureValue('1:05.5', t).value).toBeCloseTo(65.5);
    expect(parseMeasureValue('4,2s', t).value).toBe(4.2);
    expect(parseMeasureValue('abc', t).error).toBeTruthy();
  });
});

describe('buildScoreImportRows', () => {
  const measures = [measure({ key: 'skate', label: 'Skating' }), measure({ key: 'dash', label: '40 Dash', scoringType: 'time' })];
  const roster = [player('1', 'Ann', 'Lee', '9'), player('2', 'Bob', 'Ray', '10'), player('3', 'Bob', 'Ray', '11')];

  it('guesses columns and matches players by name and jersey', () => {
    const headers = ['First Name', 'Last Name', 'Skating', '40 Dash'];
    const ident = guessIdentityMapping(headers);
    const mapping = guessMeasureMapping(headers, measures, ident);
    expect(mapping).toEqual({ skate: 2, dash: 3 });
    const rows = buildScoreImportRows(sheet(headers, [['Ann', 'Lee', '4', '5.1'], ['Bob', 'Ray', '3', '']]), roster, ident, mapping, measures);
    expect(rows[0].player?.id).toBe('1');
    expect(rows[0].scores).toEqual({ skate: 4, dash: 5.1 });
    expect(rows[1].errors[0]).toMatch(/More than one/);
  });

  it('falls back to jersey, flags unknowns, duplicates and empty rows', () => {
    const headers = ['Name', 'Jersey', 'Skating'];
    const ident = guessIdentityMapping(headers);
    expect(ident.fullName).toBe(0);
    const mapping = guessMeasureMapping(headers, measures, ident);
    const rows = buildScoreImportRows(
      sheet(headers, [['Lee, Ann', '', '5'], ['', '11', '2'], ['Zed Zed', '', '3'], ['Ann Lee', '', '4'], ['Bob Ray', '10', '']]),
      roster, ident, mapping, measures,
    );
    expect(rows[0].player?.id).toBe('1');
    expect(rows[1].player?.id).toBe('3');
    expect(rows[2].errors[0]).toMatch(/No player/);
    expect(rows[3].errors[0]).toMatch(/Same player as row 2/);
  });

  it('reads a real workbook', async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['Player', 'Skating'], ['Ann Lee', 5]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const parsed = parseWorkbook(buf);
    const ident = guessIdentityMapping(parsed.headers);
    const rows = buildScoreImportRows(parsed, roster, ident, guessMeasureMapping(parsed.headers, measures, ident), measures);
    expect(rows[0].scores).toEqual({ skate: 5 });
  });
});

describe('validateImportSetup', () => {
  const m = [measure({ key: 'a', label: 'Speed' }), measure({ key: 'b', label: 'Shot' })];
  const msgs = (i: ReturnType<typeof validateImportSetup>, level: 'error' | 'warning') =>
    i.filter((x) => x.level === level).map((x) => x.message);

  it('passes a clean mapping', () => {
    const issues = validateImportSetup(['Name', 'Speed', 'Shot'], { fullName: 0 }, { a: 1, b: 2 }, m);
    expect(issues).toEqual([]);
  });
  it('blocks when no player column or no measure is chosen', () => {
    const issues = validateImportSetup(['A', 'B'], {}, { a: null, b: null }, m);
    expect(msgs(issues, 'error')).toHaveLength(2);
  });
  it('blocks a column assigned twice', () => {
    const issues = validateImportSetup(['Name', 'Score'], { fullName: 0 }, { a: 1, b: 1 }, m);
    expect(msgs(issues, 'error')[0]).toMatch(/assigned more than once/);
  });
  it('warns about blank and repeated headings and unmapped measures', () => {
    const issues = validateImportSetup(['Name', '', 'Speed', 'speed'], { fullName: 0 }, { a: 1, b: null }, m);
    expect(msgs(issues, 'error')).toEqual([]);
    expect(msgs(issues, 'warning').join(' ')).toMatch(/no heading/);
    expect(msgs(issues, 'warning').join(' ')).toMatch(/Not in this file: Shot/);
    const dup = validateImportSetup(['Name', 'Speed', 'speed'], { fullName: 0 }, { a: 1, b: 2 }, m);
    expect(msgs(dup, 'warning').join(' ')).toMatch(/share the heading/);
  });
});
