/**
 * Account-wide Compare: any player on the subscriber's account, across every
 * team, season and evaluation, ranked side by side.
 *
 * Pure logic only (filter, rank, sort, highlight), so the web and the app share
 * it unchanged and it stays quick at the 100-player ceiling. Kept identical in
 * both repos.
 */

export const MAX_COMPARE_TEAMS = 15;
export const MAX_COMPARE_PLAYERS = 100;

export interface CompareTeamRef {
  teamId: string;
  teamName: string;
}

/** One player the coach can pick, with just what the picker needs. */
export interface CompareCandidate {
  id: string;
  first: string;
  last: string;
  /** "YYYY-MM-DD" when known. */
  dateOfBirth?: string;
  yearOfBirth?: string;
  avatarUrl?: string;
  teams: CompareTeamRef[];
}

export interface CompareColumnMeta {
  label: string;
  /** The rubric's target in its own terms ("30 in", "4/5"), when a single rubric sets one. */
  benchmark?: string;
}

/** One evaluation a player was scored in, reduced to what the table shows. */
export interface CompareAssessment {
  tryoutId: string;
  tryoutName: string;
  /** "YYYY-MM-DD". */
  date?: string;
  sport?: string;
  teamName?: string;
  /** Weighted overall, 0 to 5 (0 when nothing is scored yet). */
  overall: number;
  evalCount: number;
  /** 1 to 5 score per column id (see columnId). */
  scores: Record<string, number>;
  columns: Record<string, CompareColumnMeta>;
}

/** Evaluations per player id, newest first. */
export type CompareAssessments = Record<string, CompareAssessment[]>;

/** Rubrics from different evaluations line up by name, as in the reports. */
export function columnId(label: string): string {
  return label.trim().toLowerCase();
}

// ---- Filtering ----------------------------------------------------------

export interface CompareFilters {
  /** Partial names in any order: every word has to appear in "first last". */
  query?: string;
  /** Up to MAX_COMPARE_TEAMS. Empty means every team. */
  teamIds?: string[];
  /** Option 1: a single birth year. */
  year?: string;
  /** Option 2: an inclusive date range, "YYYY-MM-DD". */
  from?: string;
  to?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function birthYear(c: CompareCandidate): number | null {
  const fromDate = c.dateOfBirth && ISO_DATE.test(c.dateOfBirth) ? Number(c.dateOfBirth.slice(0, 4)) : null;
  if (fromDate) return fromDate;
  const y = c.yearOfBirth ? Number(c.yearOfBirth) : NaN;
  return Number.isFinite(y) && y > 0 ? y : null;
}

export function availableBirthYears(candidates: CompareCandidate[]): string[] {
  const years = new Set<number>();
  for (const c of candidates) {
    const y = birthYear(c);
    if (y) years.add(y);
  }
  return [...years].sort((a, b) => b - a).map(String);
}

export function candidateName(c: Pick<CompareCandidate, 'first' | 'last'>): string {
  return `${c.first ?? ''} ${c.last ?? ''}`.trim();
}

export function filterCandidates(candidates: CompareCandidate[], filters: CompareFilters): CompareCandidate[] {
  const words = (filters.query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const teamIds = filters.teamIds?.length ? new Set(filters.teamIds) : null;
  const from = filters.from && ISO_DATE.test(filters.from) ? filters.from : undefined;
  const to = filters.to && ISO_DATE.test(filters.to) ? filters.to : undefined;
  const fromYear = from ? Number(from.slice(0, 4)) : undefined;
  const toYear = to ? Number(to.slice(0, 4)) : undefined;

  return candidates.filter((c) => {
    if (words.length) {
      const hay = `${c.first ?? ''} ${c.last ?? ''}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    if (teamIds && !c.teams.some((t) => teamIds.has(t.teamId))) return false;
    if (filters.year) {
      if (String(birthYear(c) ?? '') !== filters.year) return false;
    }
    if (from || to) {
      if (c.dateOfBirth && ISO_DATE.test(c.dateOfBirth)) {
        if (from && c.dateOfBirth < from) return false;
        if (to && c.dateOfBirth > to) return false;
      } else {
        // Only a birth year is known: keep the player when that year falls inside the range.
        const y = birthYear(c);
        if (y == null) return false;
        if (fromYear != null && y < fromYear) return false;
        if (toYear != null && y > toYear) return false;
      }
    }
    return true;
  });
}

/** Distinct teams across the candidates, by name, for the team filter. */
export function teamsOf(candidates: CompareCandidate[]): CompareTeamRef[] {
  const byId = new Map<string, CompareTeamRef>();
  for (const c of candidates) for (const t of c.teams) if (!byId.has(t.teamId)) byId.set(t.teamId, t);
  return [...byId.values()].sort((a, b) => a.teamName.localeCompare(b.teamName, undefined, { sensitivity: 'base' }));
}

/** Adds up to the limit, keeping what is already chosen. */
export function addToSelection(current: string[], toAdd: string[], limit = MAX_COMPARE_PLAYERS): string[] {
  const out = [...current];
  const have = new Set(out);
  for (const id of toAdd) {
    if (out.length >= limit) break;
    if (!have.has(id)) {
      out.push(id);
      have.add(id);
    }
  }
  return out;
}

// ---- The comparison -----------------------------------------------------

export type CompareSortKey = 'rank' | 'name' | 'overall' | string;
export interface CompareSort {
  key: CompareSortKey;
  dir: 'asc' | 'desc';
}

export interface CompareRow {
  athleteId: string;
  name: string;
  teamNames: string[];
  dateOfBirth?: string;
  yearOfBirth?: string;
  avatarUrl?: string;
  /** The evaluation the scores come from; undefined when the player has none. */
  assessment?: CompareAssessment;
  /** Other evaluations the coach can switch to, newest first. */
  evaluations: CompareAssessment[];
  /** Position by overall, ties sharing a place; null when nothing is scored. */
  rank: number | null;
  overall: number | null;
  scores: Record<string, number | null>;
}

export interface CompareColumn {
  id: string;
  label: string;
  benchmark?: string;
}

export interface CompareTable {
  columns: CompareColumn[];
  rows: CompareRow[];
  /** Highest value in each column (and 'overall'), for the top-performer highlight. */
  top: Record<string, number>;
}

/** The evaluation shown by default: the newest one with real scores, else the newest. */
export function defaultAssessment(list: CompareAssessment[] | undefined): CompareAssessment | undefined {
  if (!list?.length) return undefined;
  return list.find((a) => a.evalCount > 0) ?? list[0];
}

export function buildComparison(input: {
  candidates: CompareCandidate[];
  assessments: CompareAssessments;
  selectedIds: string[];
  /** Player id to tryout id, where the coach switched away from the newest evaluation. */
  choices?: Record<string, string>;
  sort?: CompareSort;
}): CompareTable {
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const rows: CompareRow[] = [];
  const columns = new Map<string, CompareColumn>();

  for (const id of input.selectedIds) {
    const c = byId.get(id);
    if (!c) continue;
    const evaluations = input.assessments[id] ?? [];
    const chosen = input.choices?.[id];
    const assessment = (chosen && evaluations.find((a) => a.tryoutId === chosen)) || defaultAssessment(evaluations);
    const scored = !!assessment && assessment.evalCount > 0;
    const scores: Record<string, number | null> = {};
    if (assessment) {
      for (const [colId, meta] of Object.entries(assessment.columns)) {
        const existing = columns.get(colId);
        if (!existing) columns.set(colId, { id: colId, label: meta.label, benchmark: meta.benchmark });
        else if (existing.benchmark !== meta.benchmark) existing.benchmark = undefined;
        scores[colId] = assessment.scores[colId] ?? null;
      }
    }
    rows.push({
      athleteId: id,
      name: candidateName(c),
      teamNames: c.teams.map((t) => t.teamName),
      dateOfBirth: c.dateOfBirth,
      yearOfBirth: c.yearOfBirth,
      avatarUrl: c.avatarUrl,
      assessment,
      evaluations,
      rank: null,
      overall: scored ? assessment!.overall : null,
      scores,
    });
  }

  // Standard competition ranking: equal overalls share a place, the next place skips.
  const ranked = rows.filter((r) => r.overall != null).sort((a, b) => (b.overall as number) - (a.overall as number));
  let place = 0;
  ranked.forEach((r, i) => {
    if (i === 0 || r.overall !== ranked[i - 1].overall) place = i + 1;
    r.rank = place;
  });

  const cols = [...columns.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  const top: Record<string, number> = {};
  for (const r of rows) {
    if (r.overall != null && (top.overall == null || r.overall > top.overall)) top.overall = r.overall;
    for (const [colId, v] of Object.entries(r.scores)) {
      if (v != null && (top[colId] == null || v > top[colId])) top[colId] = v;
    }
  }

  return { columns: cols, rows: sortRows(rows, input.sort ?? { key: 'rank', dir: 'asc' }), top };
}

/** Unscored players always sort last, whichever way the column runs. */
export function sortRows(rows: CompareRow[], sort: CompareSort): CompareRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const valueOf = (r: CompareRow): number | string | null => {
    if (sort.key === 'name') return r.name.toLowerCase();
    if (sort.key === 'rank') return r.rank;
    if (sort.key === 'overall') return r.overall;
    return r.scores[sort.key] ?? null;
  };
  return [...rows].sort((a, b) => {
    const x = valueOf(a);
    const y = valueOf(b);
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'string' && typeof y === 'string') return sign * x.localeCompare(y);
    if (x === y) return a.name.localeCompare(b.name);
    return sign * ((x as number) - (y as number));
  });
}

/** Clicking a header: same column flips direction, a new one starts at its natural direction. */
export function nextSort(current: CompareSort, key: CompareSortKey): CompareSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'name' || key === 'rank' ? 'asc' : 'desc' };
}

export function isTopPerformer(table: CompareTable, colId: string, value: number | null | undefined): boolean {
  if (value == null || value <= 0) return false;
  return table.top[colId] === value;
}

// ---- Saved comparisons --------------------------------------------------

export interface SavedComparison {
  id: string;
  name: string;
  athleteIds: string[];
  choices: Record<string, string>;
  filters: CompareFilters;
  sort: CompareSort;
  createdAt: number;
  updatedAt: number;
}

export interface SavedComparisonInput {
  name: string;
  athleteIds: string[];
  choices?: Record<string, string>;
  filters?: CompareFilters;
  sort?: CompareSort;
}

export function formatCompareDate(value?: string): string {
  if (!value) return '';
  return ISO_DATE.test(value) ? value : value.slice(0, 10);
}
