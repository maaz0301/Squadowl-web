import type { AssessorProgress, PlayerResult, Recommendation, Tryout } from './types';
import {
  categoryAveragesAcrossEvals,
  getPlayerCategories,
  getPlayerSubskills,
  isGoaliePosition,
  isMetricScoringType,
  normalizeScore,
  weightedOverallAcrossEvals,
} from './rubrics';

export function computePlayerResults(tryout: Tryout): PlayerResult[] {
  return tryout.roster.map((player) => {
    const playerEvals = tryout.evals.filter((e) => e.playerId === player.id);
    const categories = getPlayerCategories(tryout.sport, player.pos, tryout.settings.customRubrics);
    const weights = isGoaliePosition(player.pos)
      ? tryout.settings.goalieWeights
      : tryout.settings.skaterWeights;

    // Scores pool across every evaluation/session, matching the web prototype.
    const categoryScores = categoryAveragesAcrossEvals(playerEvals, categories);
    const overall = playerEvals.length
      ? weightedOverallAcrossEvals(playerEvals, categories, weights)
      : 0;

    const latestEval = [...playerEvals].sort((a, b) => b.createdAt - a.createdAt)[0];

    return {
      player,
      overall,
      evalCount: playerEvals.length,
      latestRecommendation: (latestEval?.recommendation ?? '') as Recommendation,
      categoryScores,
    };
  });
}

export function computeAssessorProgress(tryout: Tryout): AssessorProgress[] {
  const assessors = tryout.assessors.length
    ? tryout.assessors.map((a) => a.name)
    : [tryout.headAssessor ?? 'Coach'];

  return assessors.map((name) => {
    const scoredPlayerIds = new Set(
      tryout.evals.filter((e) => e.evaluator === name).map((e) => e.playerId),
    );
    return { name, scored: scoredPlayerIds.size, total: tryout.roster.length };
  });
}

/** One measured test (vertical jump, 40 m dash...) for one player, as raw figures. */
export interface MetricSummary {
  key: string;
  label: string;
  unit?: string;
  /** Average of the raw entries across the player's sessions. */
  raw: number;
  /** The 1 to 5 score that average converts to. */
  score: number | null;
  /** The average is at or past the best benchmark, so the score is held at 5.0. */
  capped: boolean;
  lowerIsBetter: boolean;
}

/**
 * Raw figures behind a player's measured tests. The 1 to 5 score clamps at the
 * rubric's best benchmark, so a Max set below what players actually reach turns
 * every score into 5.0; the raw figure is what still tells them apart.
 */
export function metricSummaries(tryout: Tryout, player: Tryout['roster'][number]): MetricSummary[] {
  const evals = tryout.evals.filter((e) => e.playerId === player.id);
  const out: MetricSummary[] = [];
  for (const s of getPlayerSubskills(tryout.sport, player.pos, tryout.settings.customRubrics)) {
    if (!isMetricScoringType(s.scoringType)) continue;
    const values = evals
      .map((e) => e.scores?.[s.key])
      .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
    if (!values.length) continue;
    const raw = values.reduce((a, b) => a + b, 0) / values.length;
    const lowerIsBetter = s.rankingDirection
      ? s.rankingDirection === 'lower_is_better'
      : s.scoringType === 'time';
    const hasRange = s.minVal != null && s.maxVal != null && s.maxVal !== s.minVal;
    const capped = hasRange && (lowerIsBetter ? raw <= s.minVal! : raw >= s.maxVal!);
    out.push({
      key: s.key,
      label: s.label,
      unit: s.unit,
      raw,
      score: normalizeScore(raw, s.scale, s.scoringType, s.minVal, s.maxVal, s.rankingDirection),
      capped,
      lowerIsBetter,
    });
  }
  return out;
}

/** "24.5 in" / "6.2 sec", trimmed so whole numbers read cleanly. */
export function formatMetricRaw(m: Pick<MetricSummary, 'raw' | 'unit'>): string {
  const n = Math.round(m.raw * 100) / 100;
  return m.unit ? `${n} ${m.unit}` : String(n);
}

/**
 * Orders results best first. Players tied on overall (everyone held at 5.0 by
 * a benchmark, say) are split by their raw measured figures, then by name, so a
 * tie never silently turns into an alphabetical list.
 */
export function compareResultsBestFirst(tryout: Tryout): (a: PlayerResult, b: PlayerResult) => number {
  const cache = new Map<string, Map<string, MetricSummary>>();
  const metricsOf = (r: PlayerResult) => {
    let m = cache.get(r.player.id);
    if (!m) {
      m = new Map(metricSummaries(tryout, r.player).map((x) => [x.key, x]));
      cache.set(r.player.id, m);
    }
    return m;
  };
  return (a, b) => {
    if (a.overall !== b.overall) return b.overall - a.overall;
    const ma = metricsOf(a);
    const mb = metricsOf(b);
    for (const [key, x] of ma) {
      const y = mb.get(key);
      if (!y || x.raw === y.raw) continue;
      return x.lowerIsBetter ? x.raw - y.raw : y.raw - x.raw;
    }
    const nameA = `${a.player.last ?? ''} ${a.player.first ?? ''}`.trim();
    const nameB = `${b.player.last ?? ''} ${b.player.first ?? ''}`.trim();
    return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  };
}
