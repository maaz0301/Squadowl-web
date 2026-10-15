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

/** How a roster entry is recognised as the same person on another evaluation. */
function personKeys(
  tryoutId: string,
  player: { id: string; athleteId?: string; first: string; last: string; yearOfBirth?: string },
) {
  const own = `p:${tryoutId}:${player.id}`;
  const name = `${player.first} ${player.last}`.trim().toLowerCase().replace(/\s+/g, ' ');
  return {
    person: player.athleteId ? `a:${player.athleteId}` : own,
    // The same name and birth year is the same person even under two athlete records; without a year, stay apart.
    nameKey: player.yearOfBirth ? `n:${name}|${player.yearOfBirth}` : own,
  };
}

/**
 * One person, one row: a player added to several evaluations (each filing its own athlete
 * record) keeps only their best figure, instead of crowding a board with copies of themselves.
 */
function bestPerPerson<T extends { person: string; nameKey: string; overall: number }>(
  items: T[],
  lowerIsBetter: boolean,
): T[] {
  const better = (a: number, b: number) => (lowerIsBetter ? a < b : a > b);
  const best = new Map<string, T>();
  for (const item of items) {
    const kept = best.get(item.person) ?? best.get(item.nameKey);
    const winner = !kept || better(item.overall, kept.overall) ? item : kept;
    for (const k of [item.person, item.nameKey, kept?.person, kept?.nameKey]) if (k) best.set(k, winner);
  }
  return [...new Set(best.values())];
}

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
  const everyone: (TopPerformer & { person: string; nameKey: string })[] = [];
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
        ...personKeys(tryout.id, r.player),
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
    topPerformers: bestPerPerson(everyone, false)
      .sort((a, b) => b.overall - a.overall)
      .slice(0, topLimit)
      .map(({ person: _person, nameKey: _nameKey, ...leader }) => leader),
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
  const leaders: (RubricLeader & { lower: boolean; person: string; nameKey: string })[] = [];
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
        ...personKeys(tryout.id, player),
      });
    }
  }
  const lower = leaders.length > 0 && leaders.every((l) => l.lower);
  return bestPerPerson(leaders, lower)
    .sort((a, b) => (lower ? a.overall - b.overall : b.overall - a.overall))
    .slice(0, topLimit)
    .map(({ lower: _lower, person: _person, nameKey: _nameKey, ...leader }) => leader);
}

/** A team whose evaluations the top performers can be limited to. */
export interface ReportTeamOption {
  id: string;
  name: string;
}

/** Teams that have at least one of these evaluations, A to Z, so the picker never offers an empty team. */
export function listReportTeams(tryouts: Tryout[], teams: { id: string; name: string }[]): ReportTeamOption[] {
  const used = new Set(tryouts.map((t) => t.teamId).filter((id): id is string => !!id));
  return teams
    .filter((t) => used.has(t.id))
    .map((t) => ({ id: t.id, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Just one team's evaluations, or all of them when no team is picked. */
export function filterTryoutsByTeam(tryouts: Tryout[], teamId: string | null | undefined): Tryout[] {
  return teamId ? tryouts.filter((t) => t.teamId === teamId) : tryouts;
}
