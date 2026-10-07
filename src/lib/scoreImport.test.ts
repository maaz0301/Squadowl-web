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

describe('parseMeasureValue: distances', () => {
  const jump = (unit?: string) => measure({ scoringType: 'distance', unit, label: 'Long Jump 1ft Right Foot' });

  it('reads feet and inches in the ways people type them', () => {
    for (const text of ["6'4\"", "6' 4\"", '6 ft 4 in', '6ft4in', '6-4', '6\u20194\u201d']) {
      expect(parseMeasureValue(text, jump('ft'))).toEqual({ value: 6.33, error: null });
    }
  });

  it('expresses feet-inches in the measure unit, feet by default', () => {
    expect(parseMeasureValue("6'4\"", jump())).toEqual({ value: 6.33, error: null });
    expect(parseMeasureValue("6'4\"", jump('in'))).toEqual({ value: 76, error: null });
    expect(parseMeasureValue("6'4\"", jump('cm'))).toEqual({ value: 193.04, error: null });
    expect(parseMeasureValue("6'", jump('ft'))).toEqual({ value: 6, error: null });
  });

  it('converts a typed unit that differs from the measure unit, and leaves plain numbers alone', () => {
    expect(parseMeasureValue('190 cm', jump('ft'))).toEqual({ value: 6.23, error: null });
    expect(parseMeasureValue('72 in', jump('ft'))).toEqual({ value: 6, error: null });
    expect(parseMeasureValue('6.5 ft', jump('ft'))).toEqual({ value: 6.5, error: null });
    expect(parseMeasureValue('6.5', jump('ft'))).toEqual({ value: 6.5, error: null });
    expect(parseMeasureValue('6,5', jump('ft'))).toEqual({ value: 6.5, error: null });
    expect(parseMeasureValue('190 cm', jump())).toEqual({ value: 190, error: null });
  });

  it('still rejects things that are not distances', () => {
    expect(parseMeasureValue('far', jump('ft')).error).toMatch(/not a number/);
    expect(parseMeasureValue("6'14\"", jump('ft')).error).toMatch(/not a number/);
    expect(parseMeasureValue('-3', jump('ft')).error).toMatch(/negative/);
  });

  it('does not apply feet-inches reading to other measure types', () => {
    expect(parseMeasureValue("6'4\"", measure({ scoringType: 'time' })).error).toMatch(/not a number/);
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

describe('similarity and suggestions', () => {
  it('scores close spellings high and unrelated names low', async () => {
    const { similarity } = await import('@/lib/scoreImport');
    expect(similarity('Catherine Crow', 'catherine  crow')).toBe(1);
    expect(similarity('Crow, Catherine', 'Catherine Crow')).toBe(1);
    expect(similarity('Catherin Crow', 'Catherine Crow')).toBeGreaterThan(0.9);
    // Two letters swapped is one slip, not two.
    expect(similarity('Maaz Kahn', 'Maaz Khan')).toBeGreaterThanOrEqual(0.8);
    expect(similarity('Zoe Park', 'Catherine Crow')).toBeLessThan(0.5);
  });

  it('suggests the closest roster players, best first, and none for a stranger', async () => {
    const { suggestPlayers } = await import('@/lib/scoreImport');
    const roster = [player('1', 'Catherine', 'Crow'), player('2', 'Catherine', 'Crowe'), player('3', 'Zoe', 'Park')];
    expect(suggestPlayers('Katherine Crow', roster).map((s) => s.player.id)).toEqual(['1', '2']);
    expect(suggestPlayers('Quentin Vega', roster)).toEqual([]);
  });
});

describe('fuzzy heading match', () => {
  it('matches a close spelling to the measure, but not a vague resemblance', () => {
    const measures = [measure({ key: 'skating', label: 'Skating' }), measure({ key: 'shooting', label: 'Shooting' })];
    const headers = ['Name', 'Skatting', 'Shoot'];
    const m = guessMeasureMapping(headers, measures, guessIdentityMapping(headers));
    expect(m.skating).toBe(1);
    // "Shoot" is picked up by the existing loose pass, so it is still mapped.
    expect(m.shooting).toBe(2);
  });

  it('leaves a measure unmapped when two headings are equally close', () => {
    const measures = [measure({ key: 'skating', label: 'Skating' })];
    const headers = ['Name', 'Skatinx', 'Skatiny'];
    expect(guessMeasureMapping(headers, measures, guessIdentityMapping(headers)).skating).toBeNull();
  });

  it('reports how each measure was matched', async () => {
    const { headingMatches } = await import('@/lib/scoreImport');
    const measures = [measure({ key: 'a', label: 'Skating' }), measure({ key: 'b', label: 'Passing' }), measure({ key: 'c', label: 'Edge' })];
    const found = headingMatches(['Name', 'Skatting', 'passing'], measures, { a: 1, b: 2, c: null });
    expect(found.map((f) => f.kind)).toEqual(['close', 'exact', 'missing']);
  });
});

describe('resolving rows the match could not place', () => {
  const roster = [player('1', 'Catherine', 'Crow'), player('2', 'Delphine', 'Lavoie')];
  const measures = [measure({ key: 'skating', label: 'Skating' })];
  const data = sheet(['Name', 'Skating'], [
    ['Catherin Crow', '4'],
    ['Quentin Vega', '3'],
    ['Delphine Lavoie', '5'],
  ]);
  const ident = { fullName: 0 };
  const map = { skating: 1 };

  it('flags unmatched rows as conflicts with suggestions', () => {
    const rows = buildScoreImportRows(data, roster, ident, map, measures);
    expect(rows[0].conflict).toBe('unmatched');
    expect(rows[0].suggestions[0].player.id).toBe('1');
    expect(rows[1].conflict).toBe('unmatched');
    expect(rows[1].suggestions).toEqual([]);
    expect(rows[2].conflict).toBeUndefined();
    expect(rows[2].errors).toEqual([]);
  });

  it('imports a row once the coach picks the player, and drops one they skip', () => {
    const rows = buildScoreImportRows(data, roster, ident, map, measures, { 2: { playerId: '1' }, 3: 'skip' });
    expect(rows[0].player?.id).toBe('1');
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].scores).toEqual({ skating: 4 });
    expect(rows[1].skipped).toBe(true);
    expect(rows[1].errors).toEqual(['Left out']);
    expect(rows[1].conflict).toBeUndefined();
  });

  it('still refuses the same player twice after a pick', () => {
    const rows = buildScoreImportRows(
      sheet(['Name', 'Skating'], [['Catherine Crow', '4'], ['Catherin Crow', '5']]),
      roster,
      ident,
      map,
      measures,
      { 3: { playerId: '1' } },
    );
    expect(rows[1].errors.join(' ')).toMatch(/Same player as row/);
  });
});
