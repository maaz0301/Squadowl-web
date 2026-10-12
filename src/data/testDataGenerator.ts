import type { AddPlayerForm, CustomRubric, Recommendation, RegistrationSubmit, Sport } from './types';
import { OBSERVATION_MAX, type SubSkill } from './rubrics';

/**
 * Pure helpers for generating large batches of dummy player profiles with
 * realistic, correlated scoring data. Used by the association-only "Testing
 * Tools" in registrations to stress-test rankings, filters, and reports at
 * scale. No side effects — the DataSource wires the output into the DB.
 */

/**
 * Sentinel stored in a generated player's `currentTeam` so the whole batch can
 * later be bulk-cleared without touching real roster entries.
 */
export const TEST_DATA_TAG = 'AA Test Data';

const FIRST_NAMES = [
  'Liam', 'Noah', 'Oliver', 'Ethan', 'Mason', 'Logan', 'Lucas', 'Jackson',
  'Aiden', 'Elijah', 'Carter', 'Owen', 'Wyatt', 'Leo', 'Nathan', 'Ryan',
  'Emma', 'Olivia', 'Ava', 'Sophia', 'Isabella', 'Mia', 'Charlotte', 'Amelia',
  'Harper', 'Evelyn', 'Abigail', 'Ella', 'Scarlett', 'Grace', 'Chloe', 'Zoe',
  'Xavier', 'Diego', 'Mateo', 'Kai', 'Jayden', 'Cole', 'Finn', 'Hudson',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Green',
];

const LEVELS = ['AAA', 'AA', 'A', 'BB', 'House'];

/**
 * Position pools per sport, using the same codes as `POSITION_OPTIONS_BY_SPORT`
 * / `POSITION_GROUPS_BY_SPORT` (see data/positions.ts) so a dummy-generated
 * player's `pos` lands in the same roster filter chip a manually-added player
 * with that position would. Goalie-type codes ('G'/'GTL'/'GK') are recognized
 * by `isGoaliePosition`, ensuring goalie-role rubrics get exercised where the
 * sport has one.
 */
export const POSITIONS_BY_SPORT: Record<Sport, string[]> = {
  Hockey: ['LW', 'C', 'RW', 'LD', 'RD', 'G'],
  Ringette: ['LF', 'C', 'RF', 'LD', 'RD', 'G'],
  Soccer: ['ST', 'CDM', 'CM', 'CB', 'FB', 'GK'],
  Football: ['QB', 'RB', 'WR', 'WR', 'OL', 'DL', 'LB', 'CB'],
  Basketball: ['PG', 'SG', 'SF', 'PF', 'C'],
  Tennis: ['S', 'DS'],
  Volleyball: ['S', 'OH', 'MB', 'OPP', 'L'],
  Lacrosse: ['A', 'M', 'M', 'D', 'G'],
  Baseball: ['P', 'C', '2B', 'SS', 'CF', 'RF'],
  Cricket: ['OB', 'MB', 'FIN', 'FB', 'SB', 'AR', 'WK'],
  Skating: ['Skater'],
  Other: ['FWD', 'DEF', 'GTL', 'Other'],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface GeneratedPlayer {
  form: AddPlayerForm;
  /** Latent 0..1 ability so a player's scores correlate across every rubric. */
  ability: number;
}

/** What a "Dummy Data" run should create inside an assessment. */
export type DummyTarget = 'registrations' | 'roster' | 'both';

/** Shared shape for the Dummy Data modal → DataSource round trip. */
export interface DummyDataOptions {
  target: DummyTarget;
  /** Players to create (or, for `both`, players on each side). */
  count: number;
  /** When false, roster players are inserted with no evaluations at all. */
  withScores: boolean;
  /** Scoring sessions ("assessments") to generate per rostered player. */
  sessionsPerPlayer: number;
}

/** Options for the New Team screen's dummy button. */
export interface DummyTeamOptions {
  /** The sport the dummy teams, their players' positions and rubrics are made for. Hockey when unset. */
  sport?: Sport;
  /** Teams to create. Each gets one linked assessment. */
  teams: number;
  playersPerTeam: number;
  withScores: boolean;
  sessionsPerPlayer: number;
}

export interface DummyDataResult {
  registrations: number;
  players: number;
  evaluations: number;
  /** Athlete ids of any roster players just created — unset for a registrations-only run. */
  athleteIds?: string[];
}

export interface DummyTeamResult extends DummyDataResult {
  teams: number;
  assessments: number;
}

export const DUMMY_LIMITS = {
  /** Bounds mirror the DataSource's own clamps, so the UI can't ask for more. */
  count: { min: 1, max: 1000 },
  teams: { min: 1, max: 10 },
  playersPerTeam: { min: 1, max: 1000 },
  sessionsPerPlayer: { min: 1, max: 5 },
} as const;

export function clampOption(value: string, { min, max }: { min: number; max: number }, fallback: number): number {
  const n = parseInt(value, 10);
  return clamp(isFinite(n) ? n : fallback, min, max);
}

/**
 * Build `count` dummy players for the given sport with varied ages, positions,
 * and levels, each with an invented player + guardian contact block (see
 * dummyGuardian). These used to be left blank, which made every generated
 * player render as "—" on the player detail and left the team roster's
 * "Send Invites" with nobody to send to.
 */
export function generateDummyPlayers(
  count: number,
  sport: Sport,
  currentYear: number,
): GeneratedPlayer[] {
  const positions = POSITIONS_BY_SPORT[sport] ?? POSITIONS_BY_SPORT.Other;
  const out: GeneratedPlayer[] = [];
  for (let i = 0; i < count; i++) {
    const age = randInt(8, 18);
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const guardian = dummyGuardian(last, i + 1);
    out.push({
      ability: Math.random(),
      form: {
        first,
        last,
        jersey: String(randInt(1, 99)),
        pos: pick(positions),
        yearOfBirth: String(currentYear - age),
        currentTeam: TEST_DATA_TAG,
        currentLevel: pick(LEVELS),
        playerEmail: dummyPlayerEmail(first, last, i + 1),
        guardianName: guardian.name,
        guardianEmail: guardian.email,
      },
    });
  }
  return out;
}

/**
 * Disposable-inbox testing domain — lets a tester actually open a dummy
 * guardian's "inbox" at yopmail.com to check invite/notification emails
 * during testing, unlike a non-routable reserved domain. Note this is a real,
 * unauthenticated public mail domain: anyone who knows/guesses an address can
 * view what's sent there, so don't put real PII in dummy-batch guardian names.
 */
const DUMMY_EMAIL_DOMAIN = 'yopmail.com';

/**
 * Deterministic guardian contact for dummy/test players — guardianEmail is
 * required on every player, so every dummy-data path needs to invent one of
 * these instead of leaving it blank. `unique` just needs to avoid citext
 * collisions on guardian_email within a batch (a loop index or short random
 * token both work).
 */
function dummyGuardian(last: string, unique: string | number): { name: string; email: string } {
  const guardianFirst = pick(FIRST_NAMES);
  const slug = `${guardianFirst}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');
  return {
    name: `${guardianFirst} ${last}`,
    email: `${slug}.${unique}@${DUMMY_EMAIL_DOMAIN}`,
  };
}

/**
 * The player's own address, on the same disposable domain as dummyGuardian.
 * Left blank, a dummy roster exercised only half of "Send Invites" — every
 * invite went to a guardian and the player-addressed path never ran.
 */
function dummyPlayerEmail(first: string, last: string, unique: string | number): string {
  const slug = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');
  return `${slug}.${unique}@${DUMMY_EMAIL_DOMAIN}`;
}

const ABOUT_SNIPPETS = [
  'Plays year-round and is looking to move up a level this season.',
  'Strong work ethic, still developing consistency under pressure.',
  'Returning athlete, was on the bubble at last season’s tryout.',
  'New to the association, moved from out of province over the summer.',
  'Coachable and vocal — often ends up leading warmups.',
];

const MEDICAL_SNIPPETS = [
  'No known allergies or conditions.',
  'Mild seasonal asthma — carries an inhaler.',
  'Recovered from a wrist sprain in the spring, fully cleared.',
  'Peanut allergy, carries an EpiPen.',
];

/**
 * Turn a generated player into a pending registration, inventing the guardian
 * contact block the roster path deliberately leaves blank. Emails are unique
 * per record (index-suffixed) so re-running the generator can't collide on the
 * citext guardian_email column.
 */
export function generateDummyRegistration(
  player: GeneratedPlayer,
  index: number,
  positions: string[],
): RegistrationSubmit {
  const { first, last } = player.form;
  const guardian = dummyGuardian(last, index + 1);
  return {
    firstName: first,
    lastName: last,
    yearOfBirth: player.form.yearOfBirth,
    positionTryingOutFor: player.form.pos || pick(positions),
    playerEmail: dummyPlayerEmail(first, last, index + 1),
    guardianName: guardian.name,
    guardianEmail: guardian.email,
    guardianPhone: `555${String(randInt(1000000, 9999999))}`,
    currentTeam: TEST_DATA_TAG,
    currentLevel: player.form.currentLevel,
    aboutPlayer: pick(ABOUT_SNIPPETS),
    medicalInfo: pick(MEDICAL_SNIPPETS),
  };
}

const TEAM_PLACES = [
  'Northside', 'Riverdale', 'Lakeshore', 'Westhill', 'Fairview', 'Summit',
  'Harbour', 'Ironwood', 'Redstone', 'Glenmore', 'Eastport', 'Silvercreek',
];

const TEAM_MASCOTS = [
  'Wolves', 'Thunder', 'Rangers', 'Titans', 'Falcons', 'Kings',
  'Storm', 'Blazers', 'Sharks', 'Wildcats', 'Rapids', 'Comets',
];

/**
 * Distinct "Place Mascot" names for a batch of dummy teams. Falls back to a
 * numeric suffix once the name pool is exhausted so `count` is always met.
 */
export function generateDummyTeamNames(count: number): string[] {
  const used = new Set<string>();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    let name = '';
    for (let attempt = 0; attempt < 20 && (!name || used.has(name)); attempt++) {
      name = `${pick(TEAM_PLACES)} ${pick(TEAM_MASCOTS)}`;
    }
    if (used.has(name)) name = `${name} ${i + 1}`;
    used.add(name);
    names.push(name);
  }
  return names;
}

/**
 * A ready-to-score rubric set spanning every scoring type, used when the dummy
 * generator has to stand up an assessment from scratch (the team flow). New
 * assessments ship with `customRubrics: []`, and scoring needs at least one
 * rubric — these give the ranking/report pipeline something to chew on.
 */
export function generateDummyRubrics(sport: Sport = 'Hockey'): CustomRubric[] {
  // Every rubric carries an explicit weight and the nine add up to exactly 100%,
  // so the rubric list never shows percentages that total more than that.
  return [
    { key: 'dummy_skating', label: dummyMovementLabel(sport), scoringType: 'skill', scale: '1-5', rankingDirection: 'higher_is_better', weight: 20, role: 'all' },
    { key: 'dummy_skills', label: 'Technical Skills', scoringType: 'skill', scale: '1-5', rankingDirection: 'higher_is_better', weight: 15, role: 'all' },
    { key: 'dummy_compete', label: 'Compete Level', scoringType: 'skill', scale: '1-10', rankingDirection: 'higher_is_better', weight: 10, role: 'all' },
    { key: 'dummy_gamesense', label: 'Game Sense (Observed)', scoringType: 'observation', scale: '1-5', rankingDirection: 'higher_is_better', weight: 10, role: 'all' },
    { key: 'dummy_sprint', label: 'Sprint Time', scoringType: 'time', scale: '1-5', unit: 's', minVal: 4.5, maxVal: 7.5, rankingDirection: 'lower_is_better', weight: 10, role: 'all' },
    { key: 'dummy_jump', label: 'Vertical Jump', scoringType: 'distance', scale: '1-5', unit: 'in', minVal: 8, maxVal: 40, rankingDirection: 'higher_is_better', weight: 10, role: 'all' },
    { key: 'dummy_topspeed', label: 'Top Speed', scoringType: 'speed', scale: '1-5', unit: 'km/h', minVal: 8, maxVal: 24, rankingDirection: 'higher_is_better', weight: 10, role: 'all' },
    { key: 'dummy_coachable', label: 'Coachable', scoringType: 'yes_no', scale: '1-5', rankingDirection: 'higher_is_better', weight: 8, role: 'all' },
    { key: 'dummy_forecheck', label: dummyEffectLabel(sport), scoringType: 'effectiveness', scale: '1-5', rankingDirection: 'higher_is_better', weight: 7, role: 'all' },
  ];
}

/** The first dummy rubric reads naturally for the sport the dummy team was made for. */
function dummyMovementLabel(sport: Sport): string {
  if (sport === 'Hockey' || sport === 'Ringette') return 'Skating';
  if (sport === 'Skating') return 'Edge Control';
  return 'Movement';
}

/** "Forecheck" only makes sense on the ice. */
function dummyEffectLabel(sport: Sport): string {
  return sport === 'Hockey' || sport === 'Ringette' ? 'Forecheck' : 'Defensive Effort';
}

/**
 * Produce a realistic raw score for each applicable sub-skill, respecting its
 * scoring type, scale, and benchmark range. Values track the player's latent
 * ability (with small per-skill noise) so rankings are meaningful, and are
 * emitted in each rubric's raw units — `time` lower-is-better, `distance` /
 * `speed` higher-is-better — matching how `normalizeScore` interprets them.
 */
export function generateScoresForPlayer(
  subskills: SubSkill[],
  ability: number,
): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const s of subskills) {
    const a = clamp(ability + (Math.random() - 0.5) * 0.3, 0, 1);
    const type = s.scoringType ?? 'skill';

    if (type === 'skill') {
      const max = s.scale === '1-10' ? 10 : 5;
      scores[s.key] = clamp(Math.round(1 + a * (max - 1)), 1, max);
    } else if (type === 'yes_no' || type === 'effectiveness') {
      // Two-state call: the stronger the player, the likelier the positive one.
      scores[s.key] = Math.random() < a ? 1 : 0;
    } else if (type === 'observation') {
      // 1–100 observation mark, flipped when the rubric ranks low numbers best.
      const raw = 1 + a * (OBSERVATION_MAX - 1);
      scores[s.key] = clamp(
        Math.round(s.rankingDirection === 'lower_is_better' ? OBSERVATION_MAX + 1 - raw : raw),
        1,
        OBSERVATION_MAX,
      );
    } else if (type === 'time') {
      // Lower is better: minVal = best (fast), maxVal = worst (slow).
      const best = s.minVal ?? 4.5;
      const worst = s.maxVal ?? 7.5;
      scores[s.key] = round2(worst - a * (worst - best));
    } else {
      // distance / speed: higher is better.
      const worst = s.minVal ?? (type === 'speed' ? 8 : 8);
      const best = s.maxVal ?? (type === 'speed' ? 24 : 40);
      scores[s.key] = round2(worst + a * (best - worst));
    }
  }
  return scores;
}

/** Map a latent ability to a plausible recommendation for the latest eval. */
export function pickRecommendation(ability: number): Recommendation {
  if (ability > 0.75) return 'Make';
  if (ability > 0.5) return 'Keep';
  if (ability > 0.3) return 'Bubble';
  return 'Release';
}

/**
 * Coerce an AI-supplied raw score into the valid range for a sub-skill,
 * respecting its scoring type / scale / benchmarks. Returns null if the value
 * isn't a usable number, so the caller can fall back to a derived score. This
 * is the guard that keeps AI-generated scores from breaking the ranking math.
 */
export function clampScoreToRubric(value: unknown, s: SubSkill): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n)) return null;
  const type = s.scoringType ?? 'skill';
  if (type === 'skill') {
    const max = s.scale === '1-10' ? 10 : 5;
    return clamp(Math.round(n), 1, max);
  }
  // Two-state rubrics only ever store 1 (Yes / Effective) or 0.
  if (type === 'yes_no' || type === 'effectiveness') return n > 0 ? 1 : 0;
  if (type === 'observation') return clamp(Math.round(n), 1, OBSERVATION_MAX);
  // time / distance / speed — benchmark bounds, in either direction.
  const a = s.minVal ?? (type === 'time' ? 4.5 : 8);
  const b = s.maxVal ?? (type === 'time' ? 7.5 : 40);
  return round2(clamp(n, Math.min(a, b), Math.max(a, b)));
}

/** One player as returned by the AI test-data generator (before DB mapping). */
export interface AITestPlayer {
  form: AddPlayerForm;
  ability: number;
  /** Raw score per rubric key; may be partial — missing keys fall back to derived scores. */
  scores: Record<string, number>;
  recommendation?: Recommendation;
}

/**
 * Convert one raw player object from the `generate-test-players` edge function
 * into the same `{form, ability, scores}` shape the DB-insert path consumes.
 * Sanitizes every field so a malformed AI response can't corrupt the batch;
 * returns null for an unusable record (caller drops it and tops up locally).
 */
export function mapAIPlayer(
  rawInput: unknown,
  sport: Sport,
  currentYear: number,
): AITestPlayer | null {
  if (!rawInput || typeof rawInput !== 'object') return null;
  const raw = rawInput as Record<string, unknown>;
  const first = String(raw.firstName ?? '').trim();
  const last = String(raw.lastName ?? '').trim();
  if (!first || !last) return null;

  const positions = POSITIONS_BY_SPORT[sport] ?? POSITIONS_BY_SPORT.Other;
  const pos = typeof raw.position === 'string' && positions.includes(raw.position) ? raw.position : pick(positions);
  const ageNum = Number(raw.age as string | number | undefined);
  const age = isFinite(ageNum) ? clamp(Math.round(ageNum), 8, 18) : randInt(8, 18);
  const level = typeof raw.level === 'string' && LEVELS.includes(raw.level) ? raw.level : pick(LEVELS);
  const abilityNum = Number(raw.ability as string | number | undefined);
  const ability = isFinite(abilityNum) ? clamp(abilityNum, 0, 1) : Math.random();

  const scores: Record<string, number> = {};
  if (raw.scores && typeof raw.scores === 'object') {
    for (const [k, v] of Object.entries(raw.scores as Record<string, unknown>)) {
      const num = Number(v as string | number);
      if (isFinite(num)) scores[k] = num;
    }
  }

  // No loop index here (records arrive from the AI one at a time), so a short
  // random token stands in as the uniqueness suffix.
  const token = Math.random().toString(36).slice(2, 8);
  const guardian = dummyGuardian(last, token);

  const recommendation = typeof raw.recommendation === 'string' ? raw.recommendation : '';
  const isRecommendation = (r: string): r is Recommendation =>
    r === '' || r === 'Make' || r === 'Keep' || r === 'Bubble' || r === 'Release';

  return {
    ability,
    scores,
    recommendation: isRecommendation(recommendation) ? recommendation : undefined,
    form: {
      first,
      last,
      jersey: String(randInt(1, 99)),
      pos,
      yearOfBirth: String(currentYear - age),
      currentTeam: TEST_DATA_TAG,
      currentLevel: level,
      aboutChild: typeof raw.bio === 'string' ? raw.bio.slice(0, 200) : undefined,
      playerEmail: dummyPlayerEmail(first, last, token),
      guardianName: guardian.name,
      guardianEmail: guardian.email,
    },
  };
}
