import { OBSERVATION_MAX, getPlayerSubskills, isBinaryScoringType, isMetricScoringType, type SubSkill } from '@/data/rubrics';
import type { Player, Tryout } from '@/data/types';

/**
 * A rubric's benchmark beside a player's own result: the target the coach set,
 * what it means in their words, and where this player stands against it.
 */
export interface BenchmarkLine {
  key: string;
  label: string;
  /** "30 in", "4/5". */
  target: string;
  /** The coach's explanation, '' when none was written. */
  note: string;
  /** The player's average on this rubric, formatted like the target; '' while unscored. */
  result: string;
  /** Whether the player has reached the target, or null while unscored. */
  met: boolean | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "30 in" for a measured rubric, "4/5" for a rating, "70/100" for an observation. */
export function formatBenchmarkValue(sub: Pick<SubSkill, 'scoringType' | 'scale' | 'unit'>, value: number): string {
  const n = round2(value);
  if (isMetricScoringType(sub.scoringType)) return sub.unit ? `${n} ${sub.unit}` : String(n);
  if (sub.scoringType === 'observation') return `${n}/${OBSERVATION_MAX}`;
  return `${n}/${sub.scale === '1-10' ? 10 : 5}`;
}

/** Whether a benchmark makes sense for a rubric: not for a yes/no style one. */
export function canHaveBenchmark(scoringType: SubSkill['scoringType']): boolean {
  return !isBinaryScoringType(scoringType);
}

/**
 * The benchmarks of the rubrics a player is scored on, with the player's
 * average beside each. Rubrics without a benchmark are left out, so an
 * evaluation that sets none gets no section at all.
 */
export function benchmarkLines(tryout: Pick<Tryout, 'sport' | 'settings' | 'evals'>, player: Pick<Player, 'id' | 'pos'>): BenchmarkLine[] {
  const subs = getPlayerSubskills(tryout.sport, player.pos, tryout.settings.customRubrics).filter(
    (s) => s.benchmark != null && canHaveBenchmark(s.scoringType),
  );
  if (subs.length === 0) return [];
  const evals = tryout.evals.filter((e) => e.playerId === player.id);
  return subs.map((s) => {
    const values = evals.map((e) => e.scores?.[s.key]).filter((v): v is number => typeof v === 'number' && v > 0);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
    const lowerBetter = s.rankingDirection === 'lower_is_better';
    return {
      key: s.key,
      label: s.label,
      target: formatBenchmarkValue(s, s.benchmark!),
      note: s.benchmarkNote ?? '',
      result: avg == null ? '' : formatBenchmarkValue(s, avg),
      met: avg == null ? null : lowerBetter ? avg <= s.benchmark! : avg >= s.benchmark!,
    };
  });
}
