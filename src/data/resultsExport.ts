import { formatBenchmarkValue } from '@/data/benchmarks';
import { sportProfile } from '@/data/sportProfile';
import { termsFor } from '@/lib/termsCore';
import type { Evaluation, Player, RankingDirection, ScoringType, Tryout } from './types';
import { compareResultsBestFirst, computePlayerResults } from './scoring';
import {
  binaryLabels,
  getPlayerCategories,
  type SubSkill,
  getPlayerSubskills,
  isBinaryScoringType,
  playerDisplayName,
} from './rubrics';

/** One rubric column shared by the summary table and a player's eval-history table. */
export interface ResultsExportColumn {
  key: string;
  label: string;
  scoringType?: string;
  unit?: string;
  scale?: SubSkill['scale'];
  benchmark?: number;
  /** The key evaluations store this column's raw entry under, when it is a single rubric. */
  rawKey?: string;
  rankingDirection?: RankingDirection;
}

export interface ResultsSummary {
  infoLines: string[][];
  headers: string[];
  rows: (string | number)[][];
}

export interface ReportDocInfo {
  title: string;
  subtitle: string;
}

export interface FullResultsMetric {
  label: string;
  abbr: string;
  score: string;
  rank: string;
  /** The player's average in the rubric's own terms ("31.2 in", "4.5/5"); '' when the line is a group of rubrics. */
  actual?: string;
  /** The rubric's benchmark in the same terms; '' when none was set. */
  benchmark?: string;
  /** Whether the average reaches the benchmark, null when there is nothing to compare. */
  met?: boolean | null;
}

export interface FullResultsEvalValue {
  abbr: string;
  text: string;
}

export interface FullResultsEval {
  index: number;
  date: string;
  evaluator: string;
  session: string;
  recommendation: string;
  strengths: string;
  improve: string;
  values: FullResultsEvalValue[];
}

export interface PlayerFullResults {
  /** The roster entry this card is for (Player.id). */
  playerId: string;
  name: string;
  jersey: string;
  pos: string;
  shoots: string;
  overallScore: string;
  overallRank: string;
  evalCount: number;
  metrics: FullResultsMetric[];
  recommendation: string;
  strengths: string;
  improve: string;
  evals: FullResultsEval[];
}

export interface FullResultsCsv {
  infoLines: (string | number)[][];
  playerBlocks: (string | number)[][][];
}

/** Every evaluation's distinct, non-empty note for a field, in eval order, condensed into one read. */
function aggregateNotes(evals: Evaluation[], field: 'strengths' | 'improve'): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of evals) {
    const v = (e[field] ?? '').trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out.join(' | ');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A category average (already pooled/normalized by computePlayerResults) — plain number, no unit. */
function formatCategoryScore(value: number | undefined): string {
  return value == null ? '' : String(round2(value));
}

/** Same average, padded to a fixed 2 decimals — the printed/CSV full-results report's convention. */
function formatScore2(value: number | undefined): string {
  return value == null ? '' : value.toFixed(2);
}

/** A single evaluation's raw entered value — carries its unit, e.g. "44 km/h", when the rubric has one, and reads back a two-state rubric as its own wording, e.g. "Effective". */
function formatEvalScore(value: number | undefined, column: ResultsExportColumn): string {
  if (value == null) return '';
  const type = column.scoringType as ScoringType | undefined;
  if (isBinaryScoringType(type)) {
    const [positive, negative] = binaryLabels(type);
    return value > 0 ? positive : negative;
  }
  if (type === 'time') return formatBenchmarkValue({ scoringType: type, scale: column.scale, unit: column.unit }, value);
  const rounded = round2(value);
  return type && type !== 'skill' && column.unit ? `${rounded} ${column.unit}` : String(rounded);
}

function sportLabel(tryout: Tryout): string {
  return tryout.sport === 'Other' ? (tryout.sportOther ?? 'Other') : tryout.sport;
}

function evalsByPlayerId(tryout: Tryout): Map<string, Evaluation[]> {
  const map = new Map<string, Evaluation[]>();
  for (const e of tryout.evals) {
    const list = map.get(e.playerId) ?? [];
    list.push(e);
    map.set(e.playerId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  return map;
}

/** Union of every category (grouped or standalone) any roster player is scored on, ordered by first appearance in the tryout's own rubric definitions. */
function resultsColumns(tryout: Tryout): ResultsExportColumn[] {
  const byKey = new Map<string, ResultsExportColumn>();
  for (const player of tryout.roster) {
    for (const cat of getPlayerCategories(tryout.sport, player.pos, tryout.settings.customRubrics)) {
      if (byKey.has(cat.key)) continue;
      const solo = cat.subskills.length === 1 ? cat.subskills[0] : undefined;
      byKey.set(cat.key, {
        key: cat.key,
        label: cat.label,
        scoringType: solo?.scoringType,
        unit: solo?.unit,
        scale: solo?.scale,
        benchmark: solo?.benchmark,
        rawKey: solo?.key,
        rankingDirection: solo?.rankingDirection,
      });
    }
  }
  const order: string[] = [];
  const seen = new Set<string>();
  for (const r of tryout.settings.customRubrics) {
    const catKey = r.category?.trim() || r.key;
    if (byKey.has(catKey) && !seen.has(catKey)) {
      seen.add(catKey);
      order.push(catKey);
    }
  }
  return order.map((k) => byKey.get(k)!);
}

/** The individual sub-skills that actually apply to one player (their role's rubrics), flat regardless of category grouping. */
function playerColumns(tryout: Tryout, player: Tryout['roster'][number]): ResultsExportColumn[] {
  return getPlayerSubskills(tryout.sport, player.pos, tryout.settings.customRubrics).map((s) => ({
    key: s.key,
    label: s.label,
    scoringType: s.scoringType,
    unit: s.unit,
    rankingDirection: s.rankingDirection,
  }));
}

/**
 * The average of a player's raw entries for a single-rubric column, in the
 * rubric's own units. A column that groups several rubrics has no one unit, so
 * it has none, and neither does a yes/no one.
 */
function actualAverage(column: ResultsExportColumn, evals: Evaluation[]): number | undefined {
  if (!column.scoringType || isBinaryScoringType(column.scoringType as ScoringType)) return undefined;
  const values = evals.map((e) => e.scores?.[column.rawKey ?? column.key]).filter((v): v is number => typeof v === 'number' && v > 0);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
}

/** A yes/no style rubric reads back as its own wording, "Yes" or "Effective", by what most of the player's entries said. */
function binaryActual(column: ResultsExportColumn, evals: Evaluation[]): string {
  const values = evals.map((e) => e.scores?.[column.rawKey ?? column.key]).filter((v): v is number => typeof v === 'number');
  if (!values.length) return '';
  const [positive, negative] = binaryLabels(column.scoringType as ScoringType);
  return values.filter((v) => v > 0).length * 2 >= values.length ? positive : negative;
}

/** Numeric-aware sort key so jersey "9" sorts before "10"; non-numeric jerseys sort last. */
function jerseySortKey(jersey?: string): number {
  const n = jersey != null && jersey.trim() !== '' ? parseFloat(jersey) : NaN;
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
}

/** A short, dense code for a rubric label — multi-word labels get one letter per word ("Top-End Speed" → "TES"); a single word is truncated to 6 letters ("Coachability" → "COACHA"). Mirrors the app's printed reports. */
function abbreviateLabel(label: string): string {
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length > 1) return words.map((w) => w[0]!.toUpperCase()).join('');
  return (words[0] ?? '').slice(0, 6).toUpperCase();
}

/** "<place>/<scored count>" for every player who has a value, ranked by that metric's own direction. */
function rankLabels(
  playerIds: string[],
  valueOf: (id: string) => number | undefined,
  direction: RankingDirection = 'higher_is_better',
): Map<string, string> {
  const scored = playerIds.filter((id) => valueOf(id) != null);
  const sorted = scored.slice().sort((a, b) => {
    const va = valueOf(a)!;
    const vb = valueOf(b)!;
    return direction === 'lower_is_better' ? va - vb : vb - va;
  });
  const out = new Map<string, string>();
  sorted.forEach((id, i) => out.set(id, `${i + 1}/${sorted.length}`));
  return out;
}

/** The ranked results table: one row per player, one column per rubric in use. */
export function buildResultsSummary(tryout: Tryout): ResultsSummary {
  const columns = resultsColumns(tryout);
  const results = computePlayerResults(tryout).slice().sort(compareResultsBestFirst(tryout));
  const evalsByPlayer = evalsByPlayerId(tryout);

  const infoLines: string[][] = [
    [
      'Assessment', tryout.name,
      'Event Type', tryout.eventType,
      'Date', tryout.tryoutDate ?? '',
      'Rink', tryout.rink ?? '',
      'Sport', sportLabel(tryout),
    ],
    ['Generated', new Date().toLocaleString()],
  ];

  const headers = [
    'Rank', 'Name', termsFor(tryout)('Jersey'), 'Position', 'Shoots', 'Overall',
    ...columns.map((c) => c.label),
    'Evaluations', 'Recommendation', 'Strengths', 'Areas to Improve',
  ];

  const rows = results.map((r, i) => {
    const playerEvals = evalsByPlayer.get(r.player.id) ?? [];
    return [
      i + 1,
      playerDisplayName(r.player),
      r.player.jersey ?? '',
      r.player.pos ?? '',
      r.player.shoots ?? '',
      r.evalCount ? round2(r.overall) : '',
      ...columns.map((c) => formatCategoryScore(r.categoryScores[c.key])),
      r.evalCount,
      r.latestRecommendation,
      aggregateNotes(playerEvals, 'strengths'),
      aggregateNotes(playerEvals, 'improve'),
    ];
  });

  return { infoLines, headers, rows };
}

/** Title + subtitle line for the printed full-results report. */
export function buildReportDocInfo(tryout: Tryout): ReportDocInfo {
  return {
    title: `${tryout.name} — Full Results`,
    subtitle: `Assessment: ${tryout.name} • Event Type: ${tryout.eventType} • Date: ${tryout.tryoutDate ?? ''} • Rink: ${tryout.rink ?? ''} • Sport: ${sportLabel(tryout)}`,
  };
}

/** How the printed report orders the players. */
export type ReportSort =
  | 'jersey'
  | 'name'
  | 'firstName'
  | 'ageYoungest'
  | 'ageOldest'
  | 'results'
  | 'resultsWorst'
  | 'position';

/**
 * The sort choices. The number option reads "Jersey #" unless the evaluation
 * renames it (e.g. to "Skate Ontario #"), which is how that number is kept.
 */
export function reportSortOptions(tryout?: Tryout): { key: ReportSort; label: string }[] {
  const numberLabel = tryout ? `${termsFor(tryout)('Jersey')} #` : 'Jersey #';
  return [
    { key: 'jersey', label: numberLabel },
    { key: 'name', label: 'Last name A–Z' },
    { key: 'firstName', label: 'First name A–Z' },
    { key: 'ageYoungest', label: 'Age: youngest to oldest' },
    { key: 'ageOldest', label: 'Age: oldest to youngest' },
    { key: 'results', label: 'Results: best first' },
    { key: 'resultsWorst', label: 'Results: worst first' },
    // A sport with no positions (figure skating) has nothing to sort by here.
    ...(tryout && !sportProfile(tryout.sport).positions ? [] : [{ key: 'position' as const, label: 'Position' }]),
  ];
}

export const REPORT_SORT_OPTIONS = reportSortOptions();

/**
 * Which players the printed report includes. Every field is optional and they
 * combine: a player must pass all that are set. Empty means everyone.
 */
export interface ReportFilter {
  /** Only the best N players by overall result. */
  topX?: number;
  /** Only these positions. */
  positions?: string[];
  /** Only these birth years. */
  birthYears?: string[];
  /** Leave out players with no evaluations yet. */
  scoredOnly?: boolean;
  /** Only players whose overall score is at least this. */
  minScore?: number;
}

export function isReportFilterActive(f: ReportFilter | undefined): boolean {
  return !!f && (f.topX != null || !!f.positions?.length || !!f.birthYears?.length || !!f.scoredOnly || f.minScore != null);
}

/** Year a player was born, from the full date when known. */
function birthYearOf(p: Player): string {
  if (p.dateOfBirth && /^\d{4}/.test(p.dateOfBirth)) return p.dateOfBirth.slice(0, 4);
  return (p.yearOfBirth ?? '').trim();
}

/** Birth moment as a number, for ordering by age; unknown ages come back as NaN. */
function birthTime(p: Player): number {
  if (p.dateOfBirth) {
    const t = Date.parse(p.dateOfBirth);
    if (!Number.isNaN(t)) return t;
  }
  const y = parseInt(p.yearOfBirth ?? '', 10);
  return Number.isNaN(y) ? NaN : Date.UTC(y, 0, 1);
}

/** The positions and birth years present on the roster, for the filter pickers. */
export function reportFilterChoices(tryout: Tryout): { positions: string[]; birthYears: string[] } {
  const positions = new Set<string>();
  const years = new Set<string>();
  for (const p of tryout.roster) {
    if (p.pos?.trim()) positions.add(p.pos.trim());
    const y = birthYearOf(p);
    if (y) years.add(y);
  }
  return {
    positions: [...positions].sort((a, b) => a.localeCompare(b)),
    birthYears: [...years].sort(),
  };
}

/**
 * One record per roster player, ordered by jersey number (the way a coach
 * reads a bench, not by rank): every category's score and its rank against
 * the whole roster, plus each evaluation's raw sub-skill values. Feeds both
 * the printed PDF report and the full-results CSV.
 */
export function buildPlayerFullResults(
  tryout: Tryout,
  sort: ReportSort = 'jersey',
  filter?: ReportFilter,
): PlayerFullResults[] {
  const results = computePlayerResults(tryout);
  const resultsById = new Map(results.map((r) => [r.player.id, r]));
  const evalsByPlayer = evalsByPlayerId(tryout);
  const playerIds = tryout.roster.map((p) => p.id);
  const columns = resultsColumns(tryout);

  const overallRanks = rankLabels(
    playerIds,
    (id) => (resultsById.get(id)?.evalCount ? resultsById.get(id)!.overall : undefined),
    'higher_is_better',
  );
  const columnRanks = new Map(
    columns.map((c) => [
      c.key,
      rankLabels(playerIds, (id) => resultsById.get(id)?.categoryScores[c.key], c.rankingDirection),
    ]),
  );

  const bestFirst = compareResultsBestFirst(tryout);
  const byLastName = (a: Player, b: Player) =>
    `${a.last ?? ''} ${a.first ?? ''}`.trim().localeCompare(`${b.last ?? ''} ${b.first ?? ''}`.trim(), undefined, { sensitivity: 'base' });
  const byFirstName = (a: Player, b: Player) =>
    `${a.first ?? ''} ${a.last ?? ''}`.trim().localeCompare(`${b.first ?? ''} ${b.last ?? ''}`.trim(), undefined, { sensitivity: 'base' });
  /** Best result first; players with no evaluations yet go last, in name order. */
  const byResults = (a: Player, b: Player) => {
    const ra = resultsById.get(a.id);
    const rb = resultsById.get(b.id);
    if (!ra?.evalCount || !rb?.evalCount) {
      if (ra?.evalCount) return -1;
      if (rb?.evalCount) return 1;
      return byLastName(a, b);
    }
    return bestFirst(ra, rb);
  };
  /** Worst result first; unscored players still go last. */
  const byWorstResults = (a: Player, b: Player) => {
    const ra = resultsById.get(a.id);
    const rb = resultsById.get(b.id);
    if (!ra?.evalCount || !rb?.evalCount) {
      if (ra?.evalCount) return -1;
      if (rb?.evalCount) return 1;
      return byLastName(a, b);
    }
    return bestFirst(rb, ra);
  };
  /** Ages ascending by birth time; players with no known age go last. */
  const byAge = (direction: 1 | -1) => (a: Player, b: Player) => {
    const ta = birthTime(a);
    const tb = birthTime(b);
    if (Number.isNaN(ta) || Number.isNaN(tb)) {
      if (!Number.isNaN(ta)) return -1;
      if (!Number.isNaN(tb)) return 1;
      return byLastName(a, b);
    }
    return ta === tb ? byLastName(a, b) : (tb - ta) * direction;
  };
  const byPosition = (a: Player, b: Player) => {
    const pa = (a.pos ?? '').trim();
    const pb = (b.pos ?? '').trim();
    if (!pa || !pb) return pa ? -1 : pb ? 1 : byLastName(a, b);
    return pa.localeCompare(pb) || byLastName(a, b);
  };

  // The filter looks at overall results, so "top X" is the best X of everyone
  // who passes the rest, and ranks printed on the cards stay against the full roster.
  let pool = tryout.roster.slice();
  if (filter?.positions?.length) pool = pool.filter((p) => filter.positions!.includes((p.pos ?? '').trim()));
  if (filter?.birthYears?.length) pool = pool.filter((p) => filter.birthYears!.includes(birthYearOf(p)));
  if (filter?.scoredOnly) pool = pool.filter((p) => !!resultsById.get(p.id)?.evalCount);
  if (filter?.minScore != null) {
    const min = filter.minScore;
    pool = pool.filter((p) => {
      const r = resultsById.get(p.id);
      return !!r?.evalCount && r.overall >= min;
    });
  }
  if (filter?.topX != null && filter.topX > 0) {
    pool = pool
      .filter((p) => !!resultsById.get(p.id)?.evalCount)
      .sort(byResults)
      .slice(0, Math.floor(filter.topX));
  }

  const ordered = pool.sort((a, b) => {
    if (sort === 'name') return byLastName(a, b);
    if (sort === 'firstName') return byFirstName(a, b);
    if (sort === 'results') return byResults(a, b);
    if (sort === 'resultsWorst') return byWorstResults(a, b);
    if (sort === 'ageYoungest') return byAge(1)(a, b);
    if (sort === 'ageOldest') return byAge(-1)(a, b);
    if (sort === 'position') return byPosition(a, b);
    const byJersey = jerseySortKey(a.jersey) - jerseySortKey(b.jersey);
    if (byJersey !== 0) return byJersey;
    return playerDisplayName(a).localeCompare(playerDisplayName(b));
  });

  return ordered.map((player) => {
    const r = resultsById.get(player.id)!;
    const playerEvals = evalsByPlayer.get(player.id) ?? [];
    const evalColumns = playerColumns(tryout, player);

    const metrics: FullResultsMetric[] = columns
      .filter((c) => r.categoryScores[c.key] != null)
      .map((c) => {
        const actual = actualAverage(c, playerEvals);
        const lowerBetter = c.rankingDirection === 'lower_is_better';
        const unitInfo = { scoringType: c.scoringType as ScoringType, scale: c.scale, unit: c.unit };
        return {
          label: c.label,
          abbr: abbreviateLabel(c.label),
          score: formatScore2(r.categoryScores[c.key]),
          rank: columnRanks.get(c.key)?.get(player.id) ?? '',
          actual: isBinaryScoringType(c.scoringType as ScoringType) ? binaryActual(c, playerEvals) : actual == null ? '' : formatBenchmarkValue(unitInfo, actual),
          benchmark: c.benchmark != null ? formatBenchmarkValue(unitInfo, c.benchmark) : '',
          met: actual == null || c.benchmark == null ? null : lowerBetter ? actual <= c.benchmark : actual >= c.benchmark,
        };
      });

    const evals: FullResultsEval[] = playerEvals.map((e, idx) => ({
      index: idx + 1,
      date: e.date,
      evaluator: e.evaluator,
      session: e.session,
      recommendation: e.recommendation || '',
      strengths: (e.strengths ?? '').trim(),
      improve: (e.improve ?? '').trim(),
      values: evalColumns.map((c) => ({ abbr: abbreviateLabel(c.label), text: formatEvalScore(e.scores?.[c.key], c) })),
    }));

    return {
      playerId: player.id,
      name: playerDisplayName(player),
      jersey: player.jersey ?? '',
      pos: player.pos ?? '',
      shoots: player.shoots ?? '',
      overallScore: r.evalCount ? formatScore2(r.overall) : '',
      overallRank: overallRanks.get(player.id) ?? '',
      evalCount: r.evalCount,
      metrics,
      recommendation: r.latestRecommendation,
      strengths: aggregateNotes(playerEvals, 'strengths'),
      improve: aggregateNotes(playerEvals, 'improve'),
      evals,
    };
  });
}

/** Metric columns per eval-history table before the CSV wraps to a new one — keeps rows to a printable width. */
const EVAL_CHUNK_SIZE = 8;

/** The full-results report as CSV rows: info header, then one block of rows per player (PLYR/CAT/STR/IMP + chunked eval tables). */
export function buildFullResultsCsvRows(tryout: Tryout, sort?: ReportSort, filter?: ReportFilter): FullResultsCsv {
  const infoLines: (string | number)[][] = [
    [
      'Assessment', tryout.name,
      'Event Type', tryout.eventType,
      'Date', tryout.tryoutDate ?? '',
      'Rink', tryout.rink ?? '',
      'Sport', sportLabel(tryout),
    ],
    ['Generated', new Date().toISOString(), 'Format', 'Portrait full results with score/rank columns'],
  ];

  const playerBlocks = buildPlayerFullResults(tryout, sort, filter).map((card) => {
    const rows: (string | number)[][] = [];

    rows.push([
      'PLYR', card.name,
      'J#', card.jersey,
      'POS', card.pos,
      'SHOT', card.shoots,
      'OVR SCORE', card.overallScore,
      'OVR RANK', card.overallRank,
      'EVALS', card.evalCount,
    ]);

    const catRow: (string | number)[] = ['CAT/CRITERIA SCORE-RANK'];
    for (const m of card.metrics) catRow.push(`${m.abbr} SCORE`, m.score, `${m.abbr} RANK`, m.rank);
    catRow.push('REC', card.recommendation);
    rows.push(catRow);

    rows.push(['STR', card.strengths]);
    rows.push(['IMP', card.improve]);

    const columnCount = card.evals[0]?.values.length ?? 0;
    const chunkCount = card.evals.length ? Math.max(1, Math.ceil(columnCount / EVAL_CHUNK_SIZE)) : 0;
    for (let i = 0; i < chunkCount; i++) {
      const start = i * EVAL_CHUNK_SIZE;
      const chunkAbbrs = card.evals[0].values.slice(start, start + EVAL_CHUNK_SIZE).map((v) => v.abbr);
      rows.push(['EV#', 'DATE', 'EVALR', 'SSN', 'REC', 'STR', 'IMP', ...chunkAbbrs]);
      for (const ev of card.evals) {
        const chunkValues = ev.values.slice(start, start + EVAL_CHUNK_SIZE).map((v) => v.text);
        rows.push([ev.index, ev.date, ev.evaluator, ev.session, ev.recommendation, ev.strengths, ev.improve, ...chunkValues]);
      }
    }

    return rows;
  });

  return { infoLines, playerBlocks };
}
