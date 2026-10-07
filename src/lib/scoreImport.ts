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

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Edit distance between two strings: insert, delete, replace or swap two neighbours, each costing 1. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let beforePrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], beforePrev[j - 2] + 1);
      }
    }
    beforePrev = prev;
    prev = row;
  }
  return prev[b.length];
}

/**
 * How alike two names or headings are, 0 (nothing) to 1 (the same once case and
 * punctuation are ignored). Word order is ignored too, so "Crow, Catherine"
 * reads as "Catherine Crow", and a one-letter slip ("Catherin Crow") still scores high.
 */
export function similarity(a: string, b: string): number {
  const x = squash(a);
  const y = squash(b);
  if (!x || !y) return 0;
  const sorted = (t: string) => t.split(' ').sort().join(' ');
  const ratio = (m: string, n: string) => 1 - editDistance(m, n) / Math.max(m.length, n.length);
  return Math.max(ratio(x, y), ratio(sorted(x), sorted(y)));
}

export interface PlayerSuggestion {
  player: Player;
  /** 0-1, see similarity(). */
  score: number;
}

/** Below this a roster name is not offered as a possible match at all. */
const SUGGEST_FLOOR = 0.6;
/** At or above this the best suggestion is pre-selected in the review window (still confirmed by the coach). */
export const SUGGEST_PRESELECT = 0.8;

/** The roster players whose names are closest to `label`, best first. */
export function suggestPlayers(label: string, roster: Player[], limit = 3): PlayerSuggestion[] {
  return roster
    .map((player) => ({ player, score: similarity(label, `${player.first} ${player.last}`) }))
    .filter((s) => s.score >= SUGGEST_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
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
  // Last, a close spelling ("Skatting" for "Skating"): only for what is still unmatched,
  // and only a clear winner, so a heading is never pulled onto a measure it merely resembles.
  for (const measure of measures) {
    if (mapping[measure.key] != null) continue;
    let best = -1;
    let bestScore = 0;
    let runnerUp = 0;
    normalized.forEach((h, i) => {
      if (taken.has(i) || h === '') return;
      const score = Math.max(similarity(h, measure.label), similarity(h, measure.key));
      if (score > bestScore) {
        runnerUp = bestScore;
        bestScore = score;
        best = i;
      } else if (score > runnerUp) runnerUp = score;
    });
    if (best !== -1 && bestScore >= 0.8 && bestScore - runnerUp >= 0.1) {
      mapping[measure.key] = best;
      taken.add(best);
    }
  }
  for (const m of measures) mapping[m.key] ??= null;
  return mapping;
}

export type HeadingMatchKind = 'exact' | 'close' | 'missing';

/** For the review window: how each measure's column was found, so a close spelling can be confirmed. */
export function headingMatches(
  headers: string[],
  measures: CustomRubric[],
  mapping: MeasureMapping,
): { measure: CustomRubric; header: string | null; kind: HeadingMatchKind }[] {
  return measures.map((measure) => {
    const index = mapping[measure.key];
    if (index == null) return { measure, header: null, kind: 'missing' as const };
    const header = headers[index] ?? '';
    const exact = normalizeHeader(header) === normalizeHeader(measure.label) || normalizeHeader(header) === normalizeHeader(measure.key);
    return { measure, header, kind: exact ? ('exact' as const) : ('close' as const) };
  });
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

/** Metres per unit, to read a typed length and express it in the measure's own unit. */
const METRES_PER: Record<string, number> = {
  m: 1, meter: 1, meters: 1, metre: 1, metres: 1,
  cm: 0.01, centimeter: 0.01, centimeters: 0.01, centimetre: 0.01, centimetres: 0.01,
  ft: 0.3048, foot: 0.3048, feet: 0.3048,
  in: 0.0254, inch: 0.0254, inches: 0.0254,
  yd: 0.9144, yard: 0.9144, yards: 0.9144,
};
const METRES_PER_FOOT = 0.3048;
const METRES_PER_INCH = 0.0254;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A distance cell as people actually type it: 6.5, "6.5 ft", 6'4", "6 ft 4 in",
 * 6-4 (feet-inches), or "190 cm". Returns the length in the measure's own unit
 * (feet when the measure names no unit), or null when it is not one of those, in
 * which case the plain-number reader gets the cell. A plain number is never
 * converted: it is already in the measure's unit.
 */
function parseDistance(raw: string, measureUnit?: string): number | null {
  const text = raw
    .trim()
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/,/g, '.');
  const unitKey = (measureUnit ?? '').trim().toLowerCase().replace(/\.$/, '');
  const targetKnown = unitKey in METRES_PER;
  const perTarget = targetKnown ? METRES_PER[unitKey] : METRES_PER_FOOT;
  const toTarget = (metres: number) => round2(metres / perTarget);

  // 6'4"  6' 4  6 ft 4 in  6ft4in  6'
  const feetInches = text.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft\.?|feet|foot)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in\.?|inch|inches)?)?$/i);
  if (feetInches) {
    const inches = feetInches[2] ? Number(feetInches[2]) : 0;
    if (inches >= 12) return null;
    return toTarget(Number(feetInches[1]) * METRES_PER_FOOT + inches * METRES_PER_INCH);
  }

  // 6-4, read as feet-inches, only when the inches part is a real inches value.
  const hyphen = text.match(/^(\d+)\s*-\s*(\d{1,2}(?:\.\d+)?)$/);
  if (hyphen && Number(hyphen[2]) < 12) {
    return toTarget(Number(hyphen[1]) * METRES_PER_FOOT + Number(hyphen[2]) * METRES_PER_INCH);
  }

  // 190 cm, 2.1 m, 72 in: converted when the measure's unit is known and different.
  const withUnit = text.match(/^(\d+(?:\.\d+)?)\s*([a-z]+|"|')$/i);
  if (withUnit && targetKnown) {
    const typed = withUnit[2] === "'" ? 'ft' : withUnit[2] === '"' ? 'in' : withUnit[2].toLowerCase();
    if (typed in METRES_PER) {
      return typed === unitKey || METRES_PER[typed] === perTarget
        ? Number(withUnit[1])
        : toTarget(Number(withUnit[1]) * METRES_PER[typed]);
    }
  }
  return null;
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

  const n =
    (measure.scoringType === 'distance' ? parseDistance(text, measure.unit) : null) ??
    parseNumber(text, measure.scoringType === 'time');
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

/** A coach's decision about a row whose player could not be matched on its own. */
export type RowResolution = { playerId: string } | 'skip';
export type RowResolutions = Record<number, RowResolution>;

export interface ScoreImportRow {
  line: number;
  /** Why this row needs a decision: no roster player matches it, or several do. */
  conflict?: 'unmatched' | 'ambiguous';
  /** Closest roster names for an unmatched row, best first. */
  suggestions: PlayerSuggestion[];
  /** The coach chose to leave this row out (so it is not a conflict any more). */
  skipped?: boolean;
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
  resolutions: RowResolutions = {},
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
    let conflict: ScoreImportRow['conflict'];
    let skipped = false;
    const asWritten = full || `${first} ${last}`.trim();

    const decision = resolutions[line];
    if (decision === 'skip') {
      skipped = true;
      errors.push('Left out');
    } else if (decision) {
      player = roster.find((p) => p.id === decision.playerId) ?? null;
      if (!player) errors.push('The chosen player is no longer on the roster');
    } else if (!nameKey && !jersey) {
      errors.push('No player name or jersey number in this row');
    } else {
      let matches = nameKey ? (byName.get(nameKey) ?? []) : [];
      if (matches.length === 0 && jersey) matches = byJersey.get(jersey) ?? [];
      if (matches.length === 1) player = matches[0];
      else if (matches.length > 1) {
        conflict = 'ambiguous';
        errors.push('More than one player matches, add a jersey number');
      } else {
        conflict = 'unmatched';
        errors.push('No player on the roster matches this row');
      }
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
    const suggestions =
      conflict === 'unmatched' || conflict === 'ambiguous'
        ? suggestPlayers(asWritten || label, roster)
        : [];
    return { line, conflict, suggestions, skipped, label, player, scores, errors, warnings };
  });
}
