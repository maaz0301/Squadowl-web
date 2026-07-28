import type { Evaluation, Sport, ScoringType, RankingDirection } from './types';

export type Scale = '1-5' | '1-10';

/** A single scored line item, e.g. "SK1 Accel" → "Acceleration / First 3 Steps". */
export interface SubSkill {
  key: string;
  label: string;
  scale?: Scale;
  scoringType?: ScoringType;
  unit?: string;
  minVal?: number;
  maxVal?: number;
  rankingDirection?: RankingDirection;
}

/** A weighted group of sub-skills, e.g. "Skating" → 5 sub-skills. */
export interface RubricCategory {
  key: string;
  label: string;
  role: 'skater' | 'goalie';
  subskills: SubSkill[];
}

export function getDefaultRubrics(_sport: Sport): {
  skater: RubricCategory[];
  goalie: RubricCategory[];
} {
  // 7.1 Template Rubrics Removed: All rubrics are built custom from scratch by assessor
  return { skater: [], goalie: [] };
}

export function getDefaultWeights(_sport: Sport): {
  skater: Record<string, number>;
  goalie: Record<string, number>;
} {
  return { skater: {}, goalie: {} };
}

export function isGoaliePosition(pos?: string): boolean {
  if (!pos) return false;
  const p = pos.toUpperCase();
  return p === 'GTL' || p.includes('GOAL');
}

export function compareSubskillScores(
  valA: number | undefined,
  valB: number | undefined,
  direction: RankingDirection = 'higher_is_better',
): number {
  if (valA == null && valB == null) return 0;
  if (valA == null) return 1;
  if (valB == null) return -1;
  return direction === 'lower_is_better' ? valA - valB : valB - valA;
}

function customToCategory(
  r: {
    key: string;
    label: string;
    scale?: string;
    scoringType?: ScoringType;
    unit?: string;
    minVal?: number;
    maxVal?: number;
    rankingDirection?: RankingDirection;
    role?: string;
  },
  role: 'skater' | 'goalie',
): RubricCategory {
  const scale: Scale = r.scale === '1-10' ? '1-10' : '1-5';
  const scoringType: ScoringType = r.scoringType ?? 'skill';
  const rankingDirection: RankingDirection = r.rankingDirection ?? (scoringType === 'time' ? 'lower_is_better' : 'higher_is_better');
  return {
    key: r.key,
    label: r.label,
    role,
    subskills: [{ key: r.key, label: r.label, scale, scoringType, unit: r.unit, minVal: r.minVal, maxVal: r.maxVal, rankingDirection }],
  };
}

/** Categories (with sub-skills) that apply to a given player. */
export function getPlayerCategories(
  sport: Sport,
  pos?: string,
  customRubrics: {
    key: string;
    label: string;
    scale?: string;
    scoringType?: ScoringType;
    unit?: string;
    minVal?: number;
    maxVal?: number;
    rankingDirection?: RankingDirection;
    role?: string;
  }[] = [],
): RubricCategory[] {
  const goalie = isGoaliePosition(pos);
  const role: 'skater' | 'goalie' = goalie ? 'goalie' : 'skater';
  const customs = customRubrics
    .filter((r) => !r.role || r.role === 'all' || r.role === role)
    .map((r) => customToCategory(r, role));
  return customs;
}

/** Backwards-compatible alias returning categories for a player. */
export const getPlayerRubrics = getPlayerCategories;

/** Flat list of every sub-skill that applies to a player. */
export function getPlayerSubskills(
  sport: Sport,
  pos?: string,
  customRubrics: {
    key: string;
    label: string;
    scale?: string;
    scoringType?: ScoringType;
    unit?: string;
    minVal?: number;
    maxVal?: number;
    rankingDirection?: RankingDirection;
    role?: string;
  }[] = [],
): SubSkill[] {
  return getPlayerCategories(sport, pos, customRubrics).flatMap((c) => c.subskills);
}

/** Equal weight split across categories (used for "reset weights"). */
export function buildDefaultWeights(categories: RubricCategory[]): Record<string, number> {
  const count = categories.length || 1;
  const weight = Math.round((1 / count) * 1000) / 1000;
  return Object.fromEntries(categories.map((c) => [c.key, weight]));
}

// ─── Scoring math (matches the web prototype) ────────────────────────────────

/** 1–10 scores or metric benchmarks normalize onto the 1–5 scale. */
export function normalizeScore(
  value: number | undefined,
  scale: Scale = '1-5',
  scoringType: ScoringType = 'skill',
  minVal?: number,
  maxVal?: number,
): number | null {
  if (value == null || Number.isNaN(value)) return null;

  if (scoringType !== 'skill') {
    if (minVal != null && maxVal != null && maxVal !== minVal) {
      if (scoringType === 'time') {
        // Lower is better (minVal = best = 5, maxVal = worst = 1)
        if (value <= minVal) return 5;
        if (value >= maxVal) return 1;
        const ratio = (value - minVal) / (maxVal - minVal);
        return Math.round((5 - ratio * 4) * 100) / 100;
      } else {
        // Distance or Speed: Higher is better (maxVal = best = 5, minVal = worst = 1)
        if (value >= maxVal) return 5;
        if (value <= minVal) return 1;
        const ratio = (value - minVal) / (maxVal - minVal);
        return Math.round((1 + ratio * 4) * 100) / 100;
      }
    }
    // If no min/max benchmark is defined, return raw metric
    return value;
  }

  const max = scale === '1-10' ? 10 : 5;
  const clamped = Math.max(1, Math.min(max, value));
  return scale === '1-10' ? clamped / 2 : clamped;
}

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Maps legacy rubric keys (e.g. 'SK1') to current keys (e.g. 'SK1 Accel') */
export function mapLegacyScores(
  scores: Record<string, number>,
  categories: RubricCategory[]
): Record<string, number> {
  if (!scores) return {};
  const mapped = { ...scores };
  for (const cat of categories) {
    for (const skill of cat.subskills) {
      const prefix = skill.key.split(' ')[0];
      if (mapped[prefix] !== undefined && mapped[skill.key] === undefined) {
        mapped[skill.key] = mapped[prefix];
      }
    }
  }
  return mapped;
}

/** Average of all scored sub-skills in a category, from a single score map. */
export function categoryAverage(
  scores: Record<string, number>,
  subskills: SubSkill[],
): number | null {
  const vals: number[] = [];
  for (const s of subskills) {
    const v = normalizeScore(scores[s.key], s.scale ?? '1-5', s.scoringType ?? 'skill', s.minVal, s.maxVal);
    if (v !== null) vals.push(v);
  }
  return mean(vals);
}

/** Average of all scored sub-skills in a category, pooled across every evaluation. */
export function categoryAverageAcrossEvals(
  evals: Evaluation[],
  subskills: SubSkill[],
): number | null {
  const vals: number[] = [];
  for (const e of evals) {
    for (const s of subskills) {
      const v = normalizeScore(e.scores?.[s.key], s.scale ?? '1-5', s.scoringType ?? 'skill', s.minVal, s.maxVal);
      if (v !== null) vals.push(v);
    }
  }
  return mean(vals);
}

function weightOf(
  catKey: string,
  weights: Record<string, number>,
  categories: RubricCategory[],
): number {
  if (weights[catKey] != null) return weights[catKey];
  // Custom categories without an explicit weight get an equal share.
  return 1 / (categories.length || 1);
}

/** Weighted overall from a single score map (used live while scoring). */
export function weightedOverall(
  scores: Record<string, number>,
  categories: RubricCategory[],
  weights: Record<string, number>,
): number {
  let sum = 0;
  let wsum = 0;
  const skillCats = categories.filter((cat) =>
    cat.subskills.some((s) => !s.scoringType || s.scoringType === 'skill'),
  );
  const targetCats = skillCats.length > 0 ? skillCats : categories;

  for (const cat of targetCats) {
    const avg = categoryAverage(scores, cat.subskills);
    if (avg === null) continue;
    const w = weightOf(cat.key, weights, categories);
    if (!w) continue;
    sum += avg * w;
    wsum += w;
  }
  return wsum ? Math.round((sum / wsum) * 100) / 100 : 0;
}

/** Weighted overall pooled across every evaluation for a player. */
export function weightedOverallAcrossEvals(
  evals: Evaluation[],
  categories: RubricCategory[],
  weights: Record<string, number>,
): number {
  let sum = 0;
  let wsum = 0;
  const skillCats = categories.filter((cat) =>
    cat.subskills.some((s) => !s.scoringType || s.scoringType === 'skill'),
  );
  const targetCats = skillCats.length > 0 ? skillCats : categories;

  for (const cat of targetCats) {
    const avg = categoryAverageAcrossEvals(evals, cat.subskills);
    if (avg === null) continue;
    const w = weightOf(cat.key, weights, categories);
    if (!w) continue;
    sum += avg * w;
    wsum += w;
  }
  return wsum ? Math.round((sum / wsum) * 100) / 100 : 0;
}

/** Per-category averages (1–5) pooled across evals, keyed by category key. */
export function categoryAveragesAcrossEvals(
  evals: Evaluation[],
  categories: RubricCategory[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cat of categories) {
    const avg = categoryAverageAcrossEvals(evals, cat.subskills);
    if (avg !== null) out[cat.key] = Math.round(avg * 100) / 100;
  }
  return out;
}

export function getScoreHeatLevel(score: number, max = 5): 'great' | 'good' | 'avg' | 'low' | 'poor' {
  const pct = score / max;
  if (pct >= 0.9) return 'great';
  if (pct >= 0.75) return 'good';
  if (pct >= 0.6) return 'avg';
  if (pct >= 0.45) return 'low';
  return 'poor';
}

export function generateId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}_${rand}` : rand;
}

export function generateAthleteId(): string {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

export function generateCloudCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function playerDisplayName(p: { first?: string; last?: string; firstName?: string; lastName?: string; anonymous?: boolean }): string {
  if (p.anonymous) return 'Anonymous';
  const first = p.first ?? p.firstName ?? '';
  const last = p.last ?? p.lastName ?? '';
  const name = `${first} ${last}`.trim();
  return name || 'Unknown Player';
}

export function playerInitials(p: { first?: string; last?: string; firstName?: string; lastName?: string }): string {
  const first = p.first ?? p.firstName ?? '';
  const last = p.last ?? p.lastName ?? '';
  const f = first.charAt(0) || '';
  const l = last.charAt(0) || '';
  return `${f}${l}`.toUpperCase();
}
