import * as XLSX from 'xlsx';

import { normalizePosition } from '@/data/positions';
import { AddPlayerFormSchema, type AddPlayerForm } from '@/data/types';
import { parseBirth } from '@/lib/birthDate';

/**
 * Reading a roster out of whatever spreadsheet a club already keeps it in.
 *
 * Everything here is deliberately pure and file-format-agnostic once the sheet
 * is read: a club's headings never match the app's fields, so the parse only
 * *guesses* the mapping and the coach confirms it. Nothing is written until
 * they have seen what the guess produced.
 */

/** One column of the app's player form that a spreadsheet column can feed. */
export interface ImportField {
  key: ImportFieldKey;
  label: string;
  /** Headings that mean this field, best match first. */
  synonyms: string[];
}

export type ImportFieldKey =
  | 'fullName'
  | 'first'
  | 'last'
  | 'jersey'
  | 'pos'
  | 'yearOfBirth'
  | 'playerEmail'
  | 'guardianName'
  | 'guardianEmail'
  | 'guardianPhone'
  | 'medicalInfo';

/**
 * Order matters twice over: it is the order the mapping step lists fields in,
 * and the order they claim columns in, so the specific headings ("guardian
 * email") win their column before the vague ones ("email") get a look.
 */
export const IMPORT_FIELDS: ImportField[] = [
  { key: 'first', label: 'First Name', synonyms: ['first name', 'firstname', 'first', 'given name', 'fname'] },
  { key: 'last', label: 'Last Name', synonyms: ['last name', 'lastname', 'last', 'surname', 'family name', 'lname'] },
  {
    key: 'fullName',
    label: 'Full Name (split into first/last)',
    synonyms: ['player name', 'athlete name', 'full name', 'name', 'player', 'athlete'],
  },
  { key: 'jersey', label: 'Jersey #', synonyms: ['jersey number', 'jersey', 'sweater', 'number', 'no', '#'] },
  { key: 'pos', label: 'Position', synonyms: ['position', 'pos', 'primary position'] },
  {
    key: 'yearOfBirth',
    label: 'Date of Birth',
    synonyms: ['year of birth', 'birth year', 'yob', 'date of birth', 'birthdate', 'dob', 'born'],
  },
  { key: 'playerEmail', label: 'Player Email', synonyms: ['player email', 'athlete email', 'email'] },
  {
    key: 'guardianName',
    label: 'Guardian Name',
    synonyms: ['guardian name', 'parent name', 'guardian', 'parent', 'mother', 'father', 'emergency contact'],
  },
  {
    key: 'guardianEmail',
    label: 'Guardian Email',
    synonyms: ['guardian email', 'parent email', 'contact email', 'email address', 'email'],
  },
  {
    key: 'guardianPhone',
    label: 'Guardian Phone',
    synonyms: ['guardian phone', 'parent phone', 'contact number', 'phone number', 'phone', 'mobile', 'cell'],
  },
  { key: 'medicalInfo', label: 'Medical Info', synonyms: ['medical info', 'medical', 'allergies', 'notes'] },
];

/** A column index per field; null means "nothing in the file feeds this". */
export type ColumnMapping = Partial<Record<ImportFieldKey, number | null>>;

export interface SheetRow {
  /** 1-based line in the file, so an error points at the row a coach can see. */
  line: number;
  /** Cells, padded out to `headers.length`. */
  cells: string[];
}

export interface ParsedSheet {
  /** Every sheet in the workbook, so a coach can pick a different tab. */
  sheetNames: string[];
  sheetName: string;
  /** The heading row, as written in the file. */
  headers: string[];
  rows: SheetRow[];
  /** 1-based line of the heading row. */
  headerLine: number;
}

/**
 * Anything but letters and digits is noise in a heading, so "Guardian E-Mail",
 * "guardian_email" and "Guardian Email" all reduce to the same thing — the
 * "e mail" fold included, since the hyphenated spelling is common in exports.
 */
export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\be mail\b/g, 'email')
    .trim();
}

function cellText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

/**
 * The block of the sheet that actually holds cells.
 *
 * A sheet's declared range (`!ref`, from the file's <dimension> tag) is only a
 * claim, and exporters get it wrong: a file that says `A1` or `A1:E2` over a
 * twenty-row table reads back as one row, and a sheet with no dimension at all
 * reads back as empty — the "imported one name out of twenty" case. So the range
 * read is the union of what the file claims and where the cells really are.
 */
function occupiedRange(sheet: XLSX.WorkSheet): XLSX.Range | null {
  let range: XLSX.Range | null = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
  for (const key of Object.keys(sheet)) {
    if (key.charAt(0) === '!') continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (!range) {
      range = { s: { r, c }, e: { r, c } };
      continue;
    }
    if (r < range.s.r) range.s.r = r;
    if (c < range.s.c) range.s.c = c;
    if (r > range.e.r) range.e.r = r;
    if (c > range.e.c) range.e.c = c;
  }
  return range;
}

/**
 * Shape one sheet of a read workbook into a heading row plus data rows.
 *
 * The heading row is the first row that fills a majority of the sheet's
 * columns, not simply the first row: exported rosters routinely open with a
 * title line, a club name, a blank spacer, or a row of section labels
 * ("Player Information" / "Guardian Information") above the real headings —
 * all of which fill only a cell or two. Failing that, it falls back to the
 * first row with two filled cells, then the first row with anything in it at
 * all, for the sheets too narrow to ever have a majority-filled row.
 */
export function parseSheetOf(workbook: XLSX.WorkBook, sheetName?: string): ParsedSheet {
  if (workbook.SheetNames.length === 0) throw new Error('That file has no sheets in it.');
  const name = sheetName && workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];
  const range = sheet ? occupiedRange(sheet) : null;
  if (!sheet || !range) throw new Error('No column headings found in that sheet.');
  // sheet_to_json answers nothing at all for a sheet without a declared range,
  // whatever `range` it is handed, so the one measured above becomes the declared one.
  if (!sheet['!ref']) sheet['!ref'] = XLSX.utils.encode_range(range);
  // raw:false so dates and numbers arrive as the text the coach sees in Excel.
  // blankrows:true so a row's index in the grid is still its line in the file —
  // a blank spacer dropped here would shift every row number reported after it.
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
    range,
  });
  // The grid starts at the range's first row, which is only line 1 when the
  // sheet does — a range that starts lower would otherwise shift every line.
  const firstLine = range.s.r + 1;

  const filled = (row: unknown[]) => row.filter((c) => cellText(c) !== '').length;
  // A row of section labels above the real headings ("Player Information" /
  // "Guardian Information", each spanning several merged columns) fills just as
  // many cells as the ">= 2" bar below asks for, so it would otherwise win over
  // the real per-column header row underneath it. A row that fills a majority
  // of the sheet's columns is what an actual header row looks like, so it gets
  // first refusal; only when nothing clears that bar do we fall back to the
  // looser thresholds for title lines and single-column sheets.
  const sheetWidth = range.e.c - range.s.c + 1;
  const majority = Math.max(2, Math.ceil(sheetWidth * 0.5));
  let headerIndex = grid.findIndex((row) => filled(row) >= majority);
  if (headerIndex === -1) headerIndex = grid.findIndex((row) => filled(row) >= 2);
  if (headerIndex === -1) headerIndex = grid.findIndex((row) => filled(row) >= 1);
  if (headerIndex === -1) throw new Error('No column headings found in that sheet.');

  const headers = grid[headerIndex].map(cellText);
  const width = headers.length;
  const rows: SheetRow[] = grid
    .slice(headerIndex + 1)
    .map((row, i) => ({
      line: firstLine + headerIndex + 1 + i,
      cells: Array.from({ length: width }, (_, c) => cellText(row[c])),
    }))
    // Only now: blank rows carry no player, but they did carry a line number.
    .filter((row) => row.cells.some((c) => c !== ''));

  return {
    sheetNames: workbook.SheetNames,
    sheetName: name,
    headers,
    rows,
    headerLine: firstLine + headerIndex,
  };
}

/** Read a workbook into a heading row plus data rows. */
export function parseWorkbook(data: ArrayBuffer, sheetName?: string): ParsedSheet {
  const workbook = XLSX.read(data, { type: 'array' });
  if (sheetName) return parseSheetOf(workbook, sheetName);

  // No tab chosen yet: open on the first one that has players in it, so a
  // workbook that leads with a cover or instructions sheet doesn't read as an
  // empty roster. A workbook with nothing usable anywhere reports on its first.
  let first: ParsedSheet | null = null;
  let firstError: unknown = null;
  for (const candidate of workbook.SheetNames) {
    try {
      const parsed = parseSheetOf(workbook, candidate);
      if (parsed.rows.length > 0) return parsed;
      first ??= parsed;
    } catch (e) {
      firstError ??= e;
    }
  }
  if (first) return first;
  throw firstError ?? new Error('No column headings found in that sheet.');
}

export async function parseRosterFile(file: File, sheetName?: string): Promise<ParsedSheet> {
  return parseWorkbook(await file.arrayBuffer(), sheetName);
}

/**
 * Best guess at which column feeds which field.
 *
 * Exact heading matches are taken first across every field, then loose ones, so
 * a sheet with both "Email" and "Guardian Email" doesn't let the vague heading
 * claim the guardian's column just because that field is listed earlier.
 */
export function guessMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: ColumnMapping = {};
  const taken = new Set<number>();

  const claim = (key: ImportFieldKey, index: number) => {
    mapping[key] = index;
    taken.add(index);
  };

  const isSummaryHeader = (header: string) =>
    /\b(total|count|summary|breakdown|average|avg|statistics|stats)\b/i.test(header) ||
    header.startsWith('number of');

  const findColumn = (field: ImportField, loose: boolean): number | undefined => {
    for (const synonym of field.synonyms) {
      const index = normalized.findIndex((header, i) => {
        if (taken.has(i) || header === '') return false;
        if (!loose) return header === synonym;
        // In loose mode, skip summary/count headers for name fields
        if (['first', 'last', 'fullName', 'guardianName'].includes(field.key) && isSummaryHeader(header)) {
          return false;
        }
        return header.includes(synonym) || (header.length >= 3 && synonym.includes(header));
      });
      if (index !== -1) return index;
    }
    return undefined;
  };

  for (const loose of [false, true]) {
    for (const field of IMPORT_FIELDS) {
      if (mapping[field.key] != null) continue;
      // A sheet with real first/last columns has no use for a full-name split,
      // and a sheet with one "Name" column has no use for the halves.
      if (field.key === 'fullName' && mapping.first != null && mapping.last != null) continue;
      if ((field.key === 'first' || field.key === 'last') && mapping.fullName != null) continue;
      const index = findColumn(field, loose);
      if (index !== undefined) claim(field.key, index);
    }
  }

  return mapping;
}

export interface ImportRow {
  /** 1-based line in the file, so an error points at the row the coach can see. */
  line: number;
  form: AddPlayerForm;
  display: { name: string; email: string };
  /** Blocking problems. A row with any is left out of the import. */
  errors: string[];
}

/** "Khan, Maaz" and "Maaz Khan" are both common; the comma decides which. */
function splitFullName(value: string): { first: string; last: string } {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return { first: '', last: '' };
  if (trimmed.includes(',')) {
    const [last, ...rest] = trimmed.split(',');
    return { first: rest.join(' ').trim(), last: last.trim() };
  }
  const parts = trimmed.split(' ');
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/**
 * Turn mapped rows into player forms, saying for each row whether it can be
 * imported and why not.
 *
 * Duplicates are caught within the file itself — the same person listed twice
 * in one sheet is a transcription slip, and importing them twice would leave
 * two of them on the roster to be deleted by hand.
 */
export function buildImportRows(sheet: ParsedSheet, mapping: ColumnMapping): ImportRow[] {
  const at = (row: string[], key: ImportFieldKey): string => {
    const index = mapping[key];
    return index == null ? '' : (row[index] ?? '').trim();
  };

  const seen = new Map<string, number>();

  return sheet.rows.map(({ line, cells: row }) => {
    const named = mapping.fullName != null ? splitFullName(at(row, 'fullName')) : null;
    const first = named ? named.first : at(row, 'first');
    const last = named ? named.last : at(row, 'last');

    const birth = parseBirth(at(row, 'yearOfBirth'));
    const form: AddPlayerForm = {
      first,
      last,
      jersey: at(row, 'jersey'),
      pos: normalizePosition(at(row, 'pos')),
      yearOfBirth: birth.yearOfBirth,
      dateOfBirth: birth.dateOfBirth || undefined,
      playerEmail: at(row, 'playerEmail'),
      guardianName: at(row, 'guardianName'),
      guardianEmail: at(row, 'guardianEmail'),
      guardianPhone: at(row, 'guardianPhone'),
      medicalInfo: at(row, 'medicalInfo'),
    };

    const errors: string[] = [];
    const parsed = AddPlayerFormSchema.safeParse(form);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (!errors.includes(issue.message)) errors.push(issue.message);
      }
    }

    // Case- and space-insensitive: the same person typed twice rarely matches
    // byte for byte.
    const identity = `${first} ${last} ${form.playerEmail} ${form.guardianEmail}`.toLowerCase().replace(/\s+/g, ' ').trim();
    const previous = seen.get(identity);
    if (identity && previous != null) errors.push(`Same player as row ${previous}`);
    else if (identity) seen.set(identity, line);

    return {
      line,
      form,
      display: {
        name: `${first} ${last}`.trim() || '(no name)',
        email: form.guardianEmail || form.playerEmail || '',
      },
      errors,
    };
  });
}
