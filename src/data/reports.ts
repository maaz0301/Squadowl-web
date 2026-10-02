import { getPlayerCategories } from './rubrics';
import { computePlayerResults } from './scoring';
import type { Tryout } from './types';

/** Buckets the recommendation breakdown is reported in. */
export const REPORT_RECOMMENDATIONS = ['Make', 'Keep', 'Bubble', 'Release', 'Undecided'] as const;
export type ReportRecommendation = (typeof REPORT_RECOMMENDATIONS)[number];

export interface EvaluationReportRow {
  id: string;
  name: string;
  sport: string;
  eventType: string;
  /** The evaluation's own date when it has one, else null. */
  date: string | null;
  players: number;
  /** Players with at least one evaluation. */
  scoredPlayers: number;
  /** Players still waiting on a first evaluation. */
  unscored: number;
  /** scoredPlayers / players, 0 for an empty roster. */
  completion: number;
  scoresRecorded: number;
  /** Mean overall of the players who have been scored; null when nobody has. */
  avgOverall: number | null;
  top: { name: string; overall: number } | null;
}

export interface TopPerformer {
  playerId: string;
  name: string;
  pos?: string;
  evaluationId: string;
  evaluationName: string;
  overall: number;
}

export interface ReportSummary {
  evaluationCount: number;
  /** Roster entries across every evaluation. */
  playerCount: number;
  scoredPlayerCount: number;
  scoresRecorded: number;
  /** Mean overall across every scored player; null when nobody has been scored. */
  avgOverall: number | null;
  /** scoredPlayerCount / playerCount, 0 when there are no players. */
  completion: number;
  /** Latest recommendation per scored player. */
  recommendations: Record<ReportRecommendation, number>;
  /** Newest first. */
  rows: EvaluationReportRow[];
  /** Highest overall first, capped at `topLimit`. */
  topPerformers: TopPerformer[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The numbers behind the Reports screen: how far along each evaluation is, how
 * its players are scoring, who is leading, and how the coaches' calls split.
 * Pure — the screen hands it whatever evaluations it loaded.
 */
export function buildReportSummary(tryouts: Tryout[], topLimit = 5): ReportSummary {
  const recommendations: Record<ReportRecommendation, number> = {
    Make: 0,
    Keep: 0,
    Bubble: 0,
    Release: 0,
    Undecided: 0,
  };
  const rows: EvaluationReportRow[] = [];
  const everyone: TopPerformer[] = [];
  let playerCount = 0;
  let scoredPlayerCount = 0;
  let scoresRecorded = 0;
  let overallSum = 0;

  const newestFirst = [...tryouts].sort((a, b) => b.createdAt - a.createdAt);
  for (const tryout of newestFirst) {
    const results = computePlayerResults(tryout);
    const scored = results.filter((r) => r.evalCount > 0);
    const sum = scored.reduce((acc, r) => acc + r.overall, 0);

    let best: (typeof scored)[number] | undefined;
    for (const r of scored) {
      if (!best || r.overall > best.overall) best = r;
      recommendations[r.latestRecommendation || 'Undecided'] += 1;
      everyone.push({
        playerId: r.player.id,
        name: `${r.player.first} ${r.player.last}`.trim(),
        pos: r.player.pos,
        evaluationId: tryout.id,
        evaluationName: tryout.name,
        overall: r.overall,
      });
    }

    rows.push({
      id: tryout.id,
      name: tryout.name,
      sport: tryout.sport,
      eventType: tryout.eventType,
      date: tryout.tryoutDate ?? null,
      players: results.length,
      scoredPlayers: scored.length,
      unscored: results.length - scored.length,
      completion: results.length ? scored.length / results.length : 0,
      scoresRecorded: tryout.evals.length,
      avgOverall: scored.length ? round1(sum / scored.length) : null,
      top: best ? { name: `${best.player.first} ${best.player.last}`.trim(), overall: best.overall } : null,
    });

    playerCount += results.length;
    scoredPlayerCount += scored.length;
    scoresRecorded += tryout.evals.length;
    overallSum += sum;
  }

  return {
    evaluationCount: tryouts.length,
    playerCount,
    scoredPlayerCount,
    scoresRecorded,
    avgOverall: scoredPlayerCount ? round1(overallSum / scoredPlayerCount) : null,
    completion: playerCount ? scoredPlayerCount / playerCount : 0,
    recommendations,
    rows,
    topPerformers: everyone.sort((a, b) => b.overall - a.overall).slice(0, topLimit),
  };
}

/** One measure (rubric) the leaders can be ranked on. */
export interface ReportRubricOption {
  /** Lower-cased label: measures are matched across evaluations by name, since their keys differ per evaluation. */
  key: string;
  label: string;
  unit?: string;
}

/** A leader on one measure: their average on it across the sessions scored, with where it was scored. */
export interface RubricLeader extends TopPerformer {
  unit?: string;
}

const rubricKey = (label: string) => label.trim().toLowerCase();

/** Every measure that has at least one score, across all the evaluations, alphabetical. */
export function listReportRubrics(tryouts: Tryout[]): ReportRubricOption[] {
  const found = new Map<string, ReportRubricOption>();
  for (const tryout of tryouts) {
    const scored = new Set<string>();
    for (const ev of tryout.evals) {
      for (const [key, value] of Object.entries(ev.scores)) if (value != null && value > 0) scored.add(key);
    }
    for (const player of tryout.roster) {
      for (const cat of getPlayerCategories(tryout.sport, player.pos, tryout.settings.customRubrics)) {
        for (const sub of cat.subskills) {
          if (!scored.has(sub.key)) continue;
          const key = rubricKey(sub.label);
          if (!found.has(key)) found.set(key, { key, label: sub.label.trim(), unit: sub.unit });
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Who leads on one measure, best first. A player's figure is their average on it
 * across every session they were scored on, in each evaluation. "Best" follows the
 * measure's own direction, so the fastest time leads on a time and the highest
 * score leads on a skill.
 */
export function topPerformersByRubric(tryouts: Tryout[], key: string, topLimit = 5): RubricLeader[] {
  const leaders: (RubricLeader & { lower: boolean })[] = [];
  for (const tryout of tryouts) {
    for (const player of tryout.roster) {
      const sub = getPlayerCategories(tryout.sport, player.pos, tryout.settings.customRubrics)
        .flatMap((c) => c.subskills)
        .find((s) => rubricKey(s.label) === key);
      if (!sub) continue;
      const values = tryout.evals
        .filter((e) => e.playerId === player.id)
        .map((e) => e.scores[sub.key])
        .filter((v): v is number => v != null && v > 0);
      if (values.length === 0) continue;
      leaders.push({
        playerId: player.id,
        name: `${player.first} ${player.last}`.trim(),
        pos: player.pos,
        evaluationId: tryout.id,
        evaluationName: tryout.name,
        overall: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
        unit: sub.unit,
        lower: sub.rankingDirection === 'lower_is_better',
      });
    }
  }
  const lower = leaders.length > 0 && leaders.every((l) => l.lower);
  return leaders
    .sort((a, b) => (lower ? a.overall - b.overall : b.overall - a.overall))
    .slice(0, topLimit)
    .map(({ lower: _lower, ...leader }) => leader);
}
