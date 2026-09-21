import { describe, expect, it } from 'vitest';

import * as XLSX from 'xlsx';

import { buildImportRows, guessMapping, parseSheetOf, parseWorkbook, type ParsedSheet } from './rosterImport';

function sheet(headers: string[], rows: string[][], headerLine = 1): ParsedSheet {
  return {
    sheetNames: ['Sheet1'],
    sheetName: 'Sheet1',
    headers,
    rows: rows.map((cells, i) => ({ line: headerLine + 1 + i, cells })),
    headerLine,
  };
}

describe('guessMapping', () => {
  it('matches headings however they are punctuated or cased', () => {
    const mapping = guessMapping(['First Name', 'LAST NAME', 'Jersey #', 'Guardian E-Mail']);
    expect(mapping.first).toBe(0);
    expect(mapping.last).toBe(1);
    expect(mapping.jersey).toBe(2);
    expect(mapping.guardianEmail).toBe(3);
  });

  it('gives an exact "Guardian Email" its column before a bare "Email" claims it', () => {
    const mapping = guessMapping(['Name', 'Email', 'Guardian Email']);
    expect(mapping.guardianEmail).toBe(2);
    expect(mapping.playerEmail).toBe(1);
  });

  it('maps a single name column instead of first/last', () => {
    const mapping = guessMapping(['Player Name', 'Position']);
    expect(mapping.fullName).toBe(0);
    expect(mapping.first).toBeUndefined();
    expect(mapping.last).toBeUndefined();
  });

  it('prefers real first/last columns over a full-name split', () => {
    const mapping = guessMapping(['First Name', 'Last Name', 'Name']);
    expect(mapping.first).toBe(0);
    expect(mapping.last).toBe(1);
    expect(mapping.fullName).toBeUndefined();
  });

  it('leaves unmatched fields unmapped rather than guessing wildly', () => {
    expect(guessMapping(['Column A', 'Column B']).first).toBeUndefined();
  });
});

describe('buildImportRows', () => {
  const headers = ['First Name', 'Last Name', 'Guardian Email', 'Date of Birth'];
  const mapping = { first: 0, last: 1, guardianEmail: 2, yearOfBirth: 3 };

  it('reads a year out of whatever date format the sheet used', () => {
    const rows = buildImportRows(
      sheet(headers, [
        ['Maaz', 'Khan', 'a@b.com', '2011-04-02'],
        ['Sam', 'Lee', 'c@d.com', '04/02/2012'],
        ['Ana', 'Diaz', 'e@f.com', '2013'],
      ]),
      mapping,
    );
    expect(rows.map((r) => r.form.yearOfBirth)).toEqual(['2011', '2012', '2013']);
    expect(rows.every((r) => r.errors.length === 0)).toBe(true);
  });

  it('numbers rows by their line in the file', () => {
    expect(buildImportRows(sheet(headers, [['Maaz', 'Khan', 'a@b.com', '']], 3), mapping)[0].line).toBe(4);
  });

  it('flags a row with no name, but not a row with no contact address', () => {
    const rows = buildImportRows(
      sheet(headers, [
        ['', '', 'a@b.com', ''],
        ['Sam', 'Lee', '', ''],
      ]),
      mapping,
    );
    expect(rows[0].errors.length).toBeGreaterThan(0);
    expect(rows[1].errors).toEqual([]);
  });

  it('flags an address the mail server would reject', () => {
    const rows = buildImportRows(sheet(headers, [['Sam', 'Lee', 'not-an-email', '']]), mapping);
    expect(rows[0].errors).toContain('Please enter a valid email address');
  });

  it('flags the second listing of the same player', () => {
    const rows = buildImportRows(
      sheet(headers, [
        ['Maaz', 'Khan', 'a@b.com', ''],
        ['maaz', 'khan', 'A@B.com', ''],
      ]),
      mapping,
    );
    expect(rows[0].errors).toEqual([]);
    expect(rows[1].errors).toContain('Same player as row 2');
  });

  // The import modal lets a coach strike rows off the preview, and it does that
  // by dropping them from the sheet and rebuilding rather than filtering the
  // built rows. This is why: removing the row a duplicate points at has to
  // clear the duplicate, not leave it accusing a row that is no longer there.
  it('clears the duplicate flag when the row it points at is dropped first', () => {
    const all = sheet(headers, [
      ['Maaz', 'Khan', 'a@b.com', ''],
      ['maaz', 'khan', 'A@B.com', ''],
    ]);
    const withoutFirst = { ...all, rows: all.rows.filter((r) => r.line !== 2) };
    const rows = buildImportRows(withoutFirst, mapping);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ line: 3, errors: [] });
  });

  it('splits a full-name column both ways round', () => {
    const rows = buildImportRows(
      sheet(['Name', 'Guardian Email'], [['Maaz Khan', 'a@b.com'], ['Khan, Sam', 'c@d.com']]),
      { fullName: 0, guardianEmail: 1 },
    );
    expect(rows[0].form).toMatchObject({ first: 'Maaz', last: 'Khan' });
    expect(rows[1].form).toMatchObject({ first: 'Sam', last: 'Khan' });
  });
});

function workbook(aoa: unknown[][], type: 'xlsx' | 'csv'): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Roster');
  const out = XLSX.write(wb, { type: 'array', bookType: type });
  return out as ArrayBuffer;
}

const AOA = [
  ['Westside U15 — 2026 Roster'],            // title line above the headings
  [],
  ['Player Name', 'Jersey #', 'Position', 'Date of Birth', 'Parent Name', 'Parent E-Mail', 'Phone'],
  ['Maaz Khan', '23', 'fwd', '2011-04-02', 'A Khan', 'a.khan@example.com', '4165551234'],
  ['Lopez, Carlos', '7', 'GTL', '05/12/2012', 'R Lopez', 'r.lopez@example.com', '4165559876'],
  ['Sam Lee', '9', 'DEF', '2012', 'K Lee', 'not-an-email', ''],
  [],
];

describe.each(['xlsx', 'csv'] as const)('%s round trip', (type) => {
  it('reads, guesses and builds rows', () => {
    const sheet = parseWorkbook(workbook(AOA, type));
    expect(sheet.headerLine).toBe(3);
    expect(sheet.rows).toHaveLength(3);

    const mapping = guessMapping(sheet.headers);
    expect(mapping).toMatchObject({ fullName: 0, jersey: 1, pos: 2, yearOfBirth: 3, guardianName: 4, guardianEmail: 5, guardianPhone: 6 });

    const rows = buildImportRows(sheet, mapping);
    expect(rows[0]).toMatchObject({ line: 4, errors: [], form: { first: 'Maaz', last: 'Khan', jersey: '23', pos: 'FWD', yearOfBirth: '2011' } });
    expect(rows[1].form).toMatchObject({ first: 'Carlos', last: 'Lopez', yearOfBirth: '2012' });
    expect(rows[2].errors).toContain('Please enter a valid email address');
  });
});

describe('sheets whose declared range is wrong or missing', () => {
  const header = ['First Name', 'Last Name', 'Jersey', 'Position', 'Guardian Email'];
  const names = Array.from({ length: 20 }, (_, i) => [`First${i + 1}`, `Last${i + 1}`, String(i + 1), 'F', `p${i + 1}@x.com`]);
  const book = (aoa: unknown[][], mutate?: (ws: XLSX.WorkSheet) => void, sheetName = 'Roster') => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    mutate?.(ws);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return wb;
  };

  it('reads every row when the declared range says A1:E2', () => {
    const sheet = parseSheetOf(book([header, ...names], (ws) => { ws['!ref'] = 'A1:E2'; }));
    expect(sheet.rows).toHaveLength(20);
    expect(buildImportRows(sheet, guessMapping(sheet.headers)).filter((r) => r.errors.length === 0)).toHaveLength(20);
  });

  it('reads every row when the declared range is a single cell', () => {
    expect(parseSheetOf(book([header, ...names], (ws) => { ws['!ref'] = 'A1'; })).rows).toHaveLength(20);
  });

  it('reads a sheet with no declared range at all', () => {
    expect(parseSheetOf(book([header, ...names], (ws) => { delete ws['!ref']; })).rows).toHaveLength(20);
  });

  it('reads a sheet with a single Name column', () => {
    const sheet = parseSheetOf(book([['Name'], ...names.map((n) => [`${n[0]} ${n[1]}`])]));
    expect(sheet.headers).toEqual(['Name']);
    expect(sheet.rows).toHaveLength(20);
    const rows = buildImportRows(sheet, guessMapping(sheet.headers));
    expect(rows[0].form).toMatchObject({ first: 'First1', last: 'Last1' });
  });

  it('keeps line numbers true when the table starts lower down the sheet', () => {
    const sheet = parseSheetOf(book([[], [], header, names[0], names[1]]));
    expect(sheet.headerLine).toBe(3);
    expect(sheet.rows.map((r) => r.line)).toEqual([4, 5]);
  });

  it('opens on the first tab that has players when a cover sheet leads', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Instructions']]), 'Cover');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...names]), 'Roster');
    const sheet = parseWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    expect(sheet.sheetName).toBe('Roster');
    expect(sheet.rows).toHaveLength(20);
    expect(sheet.sheetNames).toEqual(['Cover', 'Roster']);
  });

  it('still honours an explicitly chosen tab', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...names]), 'Roster');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, names[0]]), 'Small');
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    expect(parseWorkbook(data, 'Small').rows).toHaveLength(1);
  });
});
