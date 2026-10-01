import { isBinaryScoringType, isMetricScoringType, OBSERVATION_MAX } from '@/data/rubrics';
import type { CustomRubric, Player } from '@/data/types';
import { guessMapping, normalizeHeader, type ParsedSheet } from '@/lib/rosterImport';

/**
 * Reading assessment results out of a spreadsheet and matching them to the
 * measures already built into an evaluation.
 *
 * Same contract as the roster import: the parse only *guesses* which column
 * feeds which measure, the coach confirms, and nothing is written until the
 * rows about to be saved have been shown back.
 */

/** Columns that say which player a row belongs to. */
export type IdentityKey = 'first' | 'last' | 'fullName' | 'jersey';

export const IDENTITY_FIELDS: { key: IdentityKey; label: string }[] = [
  { key: 'fullName', label: 'Full Name' },
  { key: 'first', label: 'First Name' },
  { key: 'last', label: 'Last Name' },
  { key: 'jersey', label: 'Jersey #' },
];

export type IdentityMapping = Partial<Record<IdentityKey, number | null>>;
/** Measure key -> column index; null/absent = not in this file. */
export type MeasureMapping = Record<string, number | null>;

const FULL_NAME_SYNONYMS = ['player name', 'athlete name', 'full name', 'name', 'player', 'athlete'];

export function guessIdentityMapping(headers: string[]): IdentityMapping {
  const base = guessMapping(headers);
  const mapping: IdentityMapping = {
    first: base.first ?? null,
    last: base.last ?? null,
    fullName: base.fullName ?? null,
    jersey: base.jersey ?? null,
  };
  if (mapping.first == null && mapping.last == null && mapping.fullName == null) {
    const normalized = headers.map(normalizeHeader);
    for (const synonym of FULL_NAME_SYNONYMS) {
      const index = normalized.indexOf(synonym);
      if (index !== -1) {
        mapping.fullName = index;
        break;
      }
    }
  }
  return mapping;
}

/** Best guess at which column holds each measure: exact label/key first, then loose. */
export function guessMeasureMapping(
  headers: string[],
  measures: CustomRubric[],
  identity: IdentityMapping,
): MeasureMapping {
  const normalized = headers.map(normalizeHeader);
  const taken = new Set<number>(Object.values(identity).filter((v): v is number => v != null));
  const mapping: MeasureMapping = {};

  for (const loose of [false, true]) {
    for (const measure of measures) {
      if (mapping[measure.key] != null) continue;
      const names = [normalizeHeader(measure.label), normalizeHeader(measure.key)].filter(Boolean);
      const index = normalized.findIndex((h, i) => {
        if (taken.has(i) || h === '') return false;
        return names.some((n) => (loose ? h.includes(n) || (h.length >= 3 && n.includes(h)) : h === n));
      });
      if (index !== -1) {
        mapping[measure.key] = index;
        taken.add(index);
      }
    }
  }
  for (const m of measures) mapping[m.key] ??= null;
  return mapping;
}

const YES = new Set(['yes', 'y', 'true', '1', 'pass', 'effective']);
const NO = new Set(['no', 'n', 'false', '0', 'fail', 'not effective']);

/** "12", "12.5", "12,5", "1:05.3" (mm:ss) -> number, or null. */
function parseNumber(raw: string, allowClock: boolean): number | null {
  const text = raw.trim().replace(/,/g, '.');
  if (allowClock && /^\d+:\d{1,2}(\.\d+)?$/.test(text)) {
    const [m, s] = text.split(':');
    return Number(m) * 60 + Number(s);
  }
  // A trailing unit ("4.2s", "9 ft") is tolerated; anything else is not a number.
  if (!/^-?\d+(\.\d+)?\s*[a-z%"']*$/i.test(text)) return null;
  return Number(text.match(/^-?\d+(\.\d+)?/)![0]);
}

/** Parse one cell against a measure; `value: null, error: null` means blank (skipped). */
export function parseMeasureValue(
  raw: string,
  measure: CustomRubric,
): { value: number | null; error: string | null } {
  const text = raw.trim();
  if (text === '') return { value: null, error: null };

  if (isBinaryScoringType(measure.scoringType)) {
    const key = text.toLowerCase();
    if (YES.has(key)) return { value: 1, error: null };
    if (NO.has(key)) return { value: 0, error: null };
    return { value: null, error: `${measure.label}: "${text}" is not a yes/no` };
  }

  const n = parseNumber(text, measure.scoringType === 'time');
  if (n == null) return { value: null, error: `${measure.label}: "${text}" is not a number` };

  if (measure.scoringType === 'observation') {
    if (n < 1 || n > OBSERVATION_MAX) return { value: null, error: `${measure.label}: ${n} is outside 1-${OBSERVATION_MAX}` };
  } else if (!measure.scoringType || measure.scoringType === 'skill') {
    const max = measure.scale === '1-10' ? 10 : 5;
    if (n < 1 || n > max) return { value: null, error: `${measure.label}: ${n} is outside 1-${max}` };
  } else if (isMetricScoringType(measure.scoringType) && n < 0) {
    return { value: null, error: `${measure.label}: ${n} cannot be negative` };
  }
  return { value: n, error: null };
}

export interface ImportSetupIssue {
  /** `error` blocks the import; `warning` is worth a look but does not. */
  level: 'error' | 'warning';
  message: string;
}

/**
 * Checks the column choices before any row is read: a player column, no column
 * used twice, headings that are present and unambiguous, and at least one measure.
 */
export function validateImportSetup(
  headers: string[],
  identity: IdentityMapping,
  mapping: MeasureMapping,
  measures: CustomRubric[],
): ImportSetupIssue[] {
  const issues: ImportSetupIssue[] = [];
  const name = (i: number) => (headers[i]?.trim() ? `"${headers[i].trim()}"` : `Column ${i + 1}`);

  if (identity.first == null && identity.last == null && identity.fullName == null && identity.jersey == null) {
    issues.push({ level: 'error', message: 'Choose the column that identifies each player (name or jersey number).' });
  }

  const used = new Map<number, number>();
  const picked: number[] = [
    ...Object.values(identity).filter((v): v is number => v != null),
    ...measures.map((m) => mapping[m.key]).filter((v): v is number => v != null),
  ];
  for (const i of picked) used.set(i, (used.get(i) ?? 0) + 1);
  for (const [i, count] of used) {
    if (count > 1) issues.push({ level: 'error', message: `${name(i)} is assigned more than once.` });
    if (!headers[i]?.trim()) issues.push({ level: 'warning', message: `${name(i)} has no heading.` });
  }

  const byHeading = new Map<string, number[]>();
  for (const i of used.keys()) {
    const key = normalizeHeader(headers[i] ?? '');
    if (key) byHeading.set(key, [...(byHeading.get(key) ?? []), i]);
  }
  for (const group of byHeading.values()) {
    if (group.length > 1) {
      issues.push({ level: 'warning', message: `Columns ${group.map((i) => i + 1).join(' and ')} share the heading ${name(group[0])}.` });
    }
  }

  const mapped = measures.filter((m) => mapping[m.key] != null);
  if (mapped.length === 0) {
    issues.push({ level: 'error', message: 'Assign a column to at least one measure.' });
  } else if (mapped.length < measures.length) {
    const missing = measures.filter((m) => mapping[m.key] == null).map((m) => m.label);
    issues.push({ level: 'warning', message: `Not in this file: ${missing.join(', ')}.` });
  }
  return issues;
}

export interface ScoreImportRow {
  line: number;
  /** The name/jersey as written in the file, for the preview. */
  label: string;
  player: Player | null;
  scores: Record<string, number>;
  /** Blocking problems; a row with any is left out. */
  errors: string[];
  /** Non-blocking notes: a bad cell is dropped, the rest of the row still imports. */
  warnings: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Match rows to roster players and parse their scores.
 * A player is found by name (first+last, full name, or "Last, First"), falling
 * back to jersey number when there is no name or the name is unmatched.
 * Ambiguous or unknown players are errors, never guesses.
 */
export function buildScoreImportRows(
  sheet: ParsedSheet,
  roster: Player[],
  identity: IdentityMapping,
  mapping: MeasureMapping,
  measures: CustomRubric[],
): ScoreImportRow[] {
  const cell = (cells: string[], index: number | null | undefined) => (index == null ? '' : (cells[index] ?? '').trim());

  const byName = new Map<string, Player[]>();
  const byJersey = new Map<string, Player[]>();
  for (const p of roster) {
    const name = norm(`${p.first} ${p.last}`);
    byName.set(name, [...(byName.get(name) ?? []), p]);
    const j = (p.jersey ?? '').trim().replace(/^#/, '');
    if (j) byJersey.set(j, [...(byJersey.get(j) ?? []), p]);
  }

  const seen = new Map<string, number>();

  return sheet.rows.map(({ line, cells }) => {
    let first = cell(cells, identity.first);
    let last = cell(cells, identity.last);
    const full = cell(cells, identity.fullName);
    const jersey = cell(cells, identity.jersey).replace(/^#/, '');

    let nameKey = '';
    if (first || last) nameKey = norm(`${first} ${last}`);
    else if (full) {
      if (full.includes(',')) {
        const [l, f] = full.split(',');
        last = l.trim();
        first = (f ?? '').trim();
        nameKey = norm(`${first} ${last}`);
      } else {
        nameKey = norm(full);
      }
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    let player: Player | null = null;

    if (!nameKey && !jersey) {
      errors.push('No player name or jersey number in this row');
    } else {
      let matches = nameKey ? (byName.get(nameKey) ?? []) : [];
      if (matches.length === 0 && jersey) matches = byJersey.get(jersey) ?? [];
      if (matches.length === 1) player = matches[0];
      else if (matches.length > 1) errors.push('More than one player matches, add a jersey number');
      else errors.push('No player on the roster matches this row');
    }

    if (player) {
      const previous = seen.get(player.id);
      if (previous != null) errors.push(`Same player as row ${previous}`);
      else seen.set(player.id, line);
    }

    const scores: Record<string, number> = {};
    for (const m of measures) {
      const idx = mapping[m.key];
      if (idx == null) continue;
      const { value, error } = parseMeasureValue(cells[idx] ?? '', m);
      if (error) warnings.push(error);
      else if (value != null) scores[m.key] = value;
    }
    if (player && errors.length === 0 && Object.keys(scores).length === 0) errors.push('No scores to import in this row');

    const label = full || `${first} ${last}`.trim() || (jersey ? `#${jersey}` : `Row ${line}`);
    return { line, label, player, scores, errors, warnings };
  });
}
