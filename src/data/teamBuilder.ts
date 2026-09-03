import type { Player, Tryout } from './types';
import {
  generateId,
  getPlayerCategories,
  isGoaliePosition,
  playerDisplayName,
  weightedOverallAcrossEvals,
} from './rubrics';
import { computePlayerResults } from '@/data/scoring';

export interface FriendPackage {
  id: string;
  name: string;
  playerIds: string[];
  highlighted?: boolean;
}

export interface TeamBuilderTeam {
  index: number;
  id: string;
  name: string;
  players: string[];
  skaters: string[];
  goalies: string[];
}

export interface TeamBuilderState {
  generatedAt: number;
  sortMethod: 'snake' | 'balanced';
  config: {
    teamCount: number;
    teamNames: string[];
    keepFriendPackages: boolean;
    splitGoalies: boolean;
  };
  ranks: { playerId: string; overall: number; rank: number }[];
  warnings: string[];
  explanation?: string;
  teams: TeamBuilderTeam[];
  /** Roster player IDs that didn't fit within the requested team count x team size and were left out on purpose, instead of being piled onto a team. */
  unassigned: string[];
}

/**
 * The rules a split has to satisfy, as opposed to how it is computed.
 *
 * These come out of the coach's free-text instructions — extracted by the AI in
 * `generateTeamBuilder`, which reads the request and hands the numbers here.
 * The model never assigns players: partitioning a roster into equal-strength
 * teams is arithmetic, and this file does it deterministically.
 */
export interface TeamBuilderConstraints {
  /** Exact players per team. Anyone who doesn't fit lands in `unassigned` rather than on a team. */
  teamSize?: number;
  /** Exact number of players of a position on EVERY team, keyed by position (case-insensitive). */
  positionQuotas?: Record<string, number>;
  /** Ceiling on how many players of any one position may share a team. */
  positionCap?: number;
  /**
   * Skill bands, when the coach wants an A group and a B group rather than one
   * level field — "5 teams for 3 ranking and 5 teams for 4 ranking". Teams stay
   * balanced *within* each band and deliberately differ *between* bands. Fewer
   * than two bands is the ordinary single-level split.
   */
  tiers?: TeamBuilderTier[];
}

export interface TeamBuilderConfig extends TeamBuilderConstraints {
  teamCount: number;
  prompt?: string;
  teamNames?: string[];
  sortMethod?: 'snake' | 'balanced';
  keepFriendPackages?: boolean;
  splitGoalies?: boolean;
}

function detectFriendPackages(roster: Player[]): FriendPackage[] {
  const packages: FriendPackage[] = [];
  const seen = new Set<string>();
  // Precompute lowercased full names once instead of re-deriving them on every
  // comparison inside the loop below — cuts the constant factor of the O(n²)
  // friend-name matching enough to stay usable on 1000+ player rosters.
  const nameLowerById = new Map<string, string>();
  for (const p of roster) nameLowerById.set(p.id, `${p.first} ${p.last}`.toLowerCase());

  for (const player of roster) {
    if (!player.friend1Name && !player.friend2Name) continue;
    const friend1 = player.friend1Name?.toLowerCase();
    const friend2 = player.friend2Name?.toLowerCase();
    const friends = roster.filter((p) => {
      if (p.id === player.id) return false;
      const name = nameLowerById.get(p.id)!;
      return (!!friend1 && name.includes(friend1)) || (!!friend2 && name.includes(friend2));
    });
    if (friends.length === 0) continue;
    const ids = [player.id, ...friends.map((f) => f.id)].sort();
    const key = ids.join('-');
    if (seen.has(key)) continue;
    seen.add(key);
    packages.push({
      id: generateId('pkg'),
      name: `${player.first}'s group`,
      playerIds: ids,
    });
  }
  return packages;
}

/**
 * How many teams a coach asked for, read straight from their sentence.
 *
 * Used as the fallback when the AI constraint extraction is unavailable (see
 * generateTeamBuilder), so a split still comes out the right shape rather than
 * silently defaulting to two teams.
 *
 * Words are allowed between the number and "teams" — "build 10 evenly ranked
 * teams" is the phrasing that actually gets typed, and a pattern anchored
 * straight to the noun misses it. Filler that turns the number into a per-team
 * *size* instead ("11 players per team") is rejected, and "teams of 11" never
 * matches at all because the number follows the noun there.
 */
export function parseTeamCountFromPrompt(text: string): number | undefined {
  if (!text) return undefined;
  // Every mention is added up, because a tiered request states the count more
  // than once — "5 teams for 3 ranking and 5 teams for 4 ranking" is ten teams,
  // and taking only the first match built five. Splitting them into actual
  // bands needs the AI extraction; this at least gets the shape right without it.
  let total = 0;
  const pattern = /(\d+)\s+((?:[A-Za-z]+\s+){0,3})teams?\b/gi;
  for (const match of text.matchAll(pattern)) {
    if (/\b(player|players|athlete|athletes|kid|kids|skater|skaters|people|person|per|of|each|apiece)\b/i.test(match[2])) {
      continue;
    }
    const count = Number(match[1]);
    if (Number.isFinite(count) && count >= 1) total += count;
  }
  return total >= 2 ? total : undefined;
}

/**
 * Skill bands read straight from the coach's sentence, or undefined when they
 * didn't ask for any.
 *
 * The AI extraction understands far more phrasings than this, but it only runs
 * server-side — so without this, tiering was impossible to use (or even test)
 * until the edge function was deployed. "5 teams for 3 ranking and 5 teams for
 * 4 ranking" is regular enough to read here, which makes the common request
 * work with no deployment at all.
 *
 * A rating word ("ranking", "rating", "level"…) is required deliberately: it is
 * the only thing separating a band from a team size, so "4 teams of 11" stays a
 * plain split rather than being misread as a band aimed at rating 11.
 */
export function parseTiersFromPrompt(text: string): TeamBuilderTier[] | undefined {
  if (!text) return undefined;
  // The rating word sits on either side of the number in practice — "3 ranking"
  // and "rating 3" are both common — so both orders are accepted.
  //
  // "teams" is optional because the second half of a tiered sentence routinely
  // drops it: "build 5 teams with ranking 2 and 5 with ranking 4". Requiring it
  // matched only the first band, and one band is not a tiered request, so the
  // whole thing silently fell back to a plain split. The rating word is what
  // keeps this honest — without one, nothing here matches at all.
  const RATING_WORD = '(?:ranking|rating|rank|level|tier|star)s?';
  const pattern = new RegExp(
    String.raw`(\d+)\s+(?:teams?\s+)?(?:for|at|with|in|of|on)?\s*(?:the\s+)?` +
      String.raw`(?:(\d+)\s*${RATING_WORD}|${RATING_WORD}\s*(\d+))\b`,
    'gi',
  );
  const tiers: TeamBuilderTier[] = [];
  for (const match of text.matchAll(pattern)) {
    const teamCount = Number(match[1]);
    const targetRating = Number(match[2] ?? match[3]);
    if (!Number.isFinite(teamCount) || teamCount < 1) continue;
    // Ratings are the app's 1-5 weighted overall; anything else is some other
    // number that happened to sit next to the word.
    if (!Number.isFinite(targetRating) || targetRating < 1 || targetRating > 5) continue;
    tiers.push({ teamCount, targetRating });
  }
  // One band is just an ordinary split.
  return tiers.length >= 2 ? tiers : undefined;
}

/** Positions are free text on a roster, so they're compared case/space-insensitively. */
function normalizePos(pos?: string | null): string {
  return (pos ? String(pos) : 'N/A').trim().toUpperCase() || 'N/A';
}

/** A team being filled, with the running totals the balancing decisions read. */
interface TeamSlot {
  team: TeamBuilderTeam;
  /** Sum and count over EVALUATED players only — see teamAverage. */
  scoredSum: number;
  scoredCount: number;
  posCounts: Map<string, number>;
  size: number;
}

/**
 * A team's strength: the mean overall of its **evaluated** players.
 *
 * Unevaluated players are excluded rather than counted as zero, because that is
 * exactly how the Team Builder screen computes the number it puts on the
 * balance bar (`results.filter((r) => r.evalCount > 0)`). Averaging zeros in
 * here would optimise a figure nobody ever sees — a team of three strong
 * players and eleven unscored ones looks weak to the optimiser and strong on
 * screen, so the bars stay lopsided no matter how good the split is. An
 * unevaluated player says nothing about strength either way; they are spread by
 * headcount instead (see the second placement pass).
 */
function teamAverage(slot: TeamSlot): number {
  return slot.scoredCount > 0 ? slot.scoredSum / slot.scoredCount : 0;
}

/**
 * One band of a tiered split — "5 teams for 3 ranking" is one of these.
 *
 * Tiering is the opposite of balancing, and both are legitimate: a coach either
 * wants ten equal teams, or an A group and a B group. Within a tier the teams
 * are balanced exactly as they always are; it is only *between* tiers that the
 * levels differ.
 */
export interface TeamBuilderTier {
  /** How many teams this band gets. */
  teamCount: number;
  /** The rating this band is aimed at. Used to order bands strongest-first. */
  targetRating?: number;
}

/** Bands strongest-first, or a single implicit band when no tiering was asked for. */
function resolveTiers(config: TeamBuilderConfig, teamCount: number): TeamBuilderTier[] {
  const raw = (config.tiers ?? [])
    .map((t) => ({ ...t, teamCount: Math.floor(t.teamCount) }))
    .filter((t) => Number.isFinite(t.teamCount) && t.teamCount >= 1);
  if (raw.length < 2) return [{ teamCount }];
  // Strongest band first, so the highest-ranked players land in it. Ordering by
  // the stated rating rather than the order they were typed means "5 teams for 3
  // ranking and 5 teams for 4 ranking" puts the 4s on top, as intended.
  const rated = raw.every((t) => typeof t.targetRating === 'number');
  return rated ? [...raw].sort((a, b) => (b.targetRating ?? 0) - (a.targetRating ?? 0)) : raw;
}

/**
 * How many players each band should hold.
 *
 * With an exact team size the answer is fixed. Otherwise the roster is shared
 * out in proportion to each band's team count, with the remainder going to the
 * earliest (strongest) bands so no band ends a player short of another.
 */
function tierCapacities(tiers: TeamBuilderTier[], totalPlayers: number, teamSize?: number): number[] {
  if (teamSize !== undefined) return tiers.map((t) => t.teamCount * teamSize);
  const totalTeams = tiers.reduce((sum, t) => sum + t.teamCount, 0) || 1;
  const exact = tiers.map((t) => (totalPlayers * t.teamCount) / totalTeams);
  const base = exact.map((n) => Math.floor(n));
  let left = totalPlayers - base.reduce((a, b) => a + b, 0);
  const order = exact
    .map((n, i) => ({ i, frac: n - Math.floor(n) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i] += 1;
    left -= 1;
  }
  return base;
}

/**
 * Deterministically splits a roster into teams of equal average strength.
 *
 * Two passes and a refinement, per tier:
 *  1. Evaluated players, strongest first, each onto the eligible team with the
 *     fewest players (ties broken by lowest average).
 *  2. Unevaluated players onto the smallest eligible team, so headcount evens
 *     out without disturbing the averages.
 *  3. `refineBalance` trades pairs between the strongest and weakest teams
 *     until no swap narrows the gap.
 *
 * Team size, per-team position quotas and position caps are honoured
 * throughout, so a split can satisfy "10 teams, one goalie each" and still come
 * out level. When `config.tiers` asks for bands, the roster is cut into them by
 * rank first and each band is then built exactly this way.
 */
export function buildTeams(tryout: Tryout, config: TeamBuilderConfig): TeamBuilderState {
  const results = computePlayerResults(tryout);
  const playerById = new Map(tryout.roster.map((p) => [p.id, p]));

  // A player counts as rated only with a usable overall, not merely an
  // evaluation row. `computePlayerResults` returns 0 for someone whose
  // evaluations carry no score this rubric set recognises — scored against
  // rubrics that have since been renamed or removed, say — and 0 is not a
  // rating on a 1-5 scale, it is the absence of one. Treating those players as
  // the weakest in the roster sent every one of them to the bottom band and
  // dragged a "3 ranking" tier down to 0.2. They are spread by headcount
  // instead, exactly like a player with no evaluations at all.
  const rated = results
    .filter((r) => r.evalCount > 0 && r.overall > 0)
    .sort((a, b) => b.overall - a.overall);
  const unrated = results.filter((r) => !(r.evalCount > 0 && r.overall > 0));

  const ranked = [...rated, ...unrated].map((r, i) => ({
    playerId: r.player.id,
    overall: r.overall,
    rank: i + 1,
  }));
  const overallByPlayerId = new Map(ranked.map((r) => [r.playerId, r.overall]));
  const scoredIds = new Set(rated.map((r) => r.player.id));

  const requestedTeamCount = Math.max(2, Math.floor(config.teamCount) || 2);
  const sortMethod = config.sortMethod ?? 'balanced';
  const teamSize =
    config.teamSize && config.teamSize > 0 ? Math.floor(config.teamSize) : undefined;
  const positionCap =
    config.positionCap && config.positionCap > 0 ? Math.floor(config.positionCap) : undefined;
  const quotas = new Map<string, number>(
    Object.entries(config.positionQuotas ?? {}).map(([pos, n]) => [
      normalizePos(pos),
      Math.max(0, Math.floor(n)),
    ]),
  );

  const tiers = resolveTiers(config, requestedTeamCount);
  const tiered = tiers.length > 1;
  const teamCount = tiered
    ? tiers.reduce((sum, t) => sum + t.teamCount, 0)
    : requestedTeamCount;

  // A caller-supplied name list that doesn't match the team count would leave
  // teams unnamed or drop some entirely, so it's only used when it lines up.
  const suppliedNames =
    config.teamNames && config.teamNames.length === teamCount ? config.teamNames : undefined;

  const warnings: string[] = [];
  const posOf = (id: string) => normalizePos(playerById.get(id)?.pos);

  // Friend groups travel as one unit so a band boundary can't cut through them;
  // the group rides with its highest-ranked member.
  const friendPackages =
    config.keepFriendPackages !== false ? detectFriendPackages(tryout.roster) : [];
  const packageByPlayer = new Map<string, FriendPackage>();
  for (const pkg of friendPackages) {
    for (const id of pkg.playerIds) if (!packageByPlayer.has(id)) packageByPlayer.set(id, pkg);
  }

  /** Players in rank order, friend groups collapsed into a single unit. */
  const units: string[][] = [];
  const consumed = new Set<string>();
  for (const r of ranked) {
    const id = r.playerId;
    if (consumed.has(id)) continue;
    const pkg = packageByPlayer.get(id);
    if (pkg) {
      const members = pkg.playerIds.filter((m) => playerById.has(m) && !consumed.has(m));
      for (const m of members) consumed.add(m);
      units.push(members);
    } else {
      consumed.add(id);
      units.push([id]);
    }
  }

  // Cut the ranked units into bands. A single band is the ordinary case and
  // simply takes everyone.
  const tierUnits: string[][][] = tiers.map(() => []);
  const leftover: string[] = [];
  if (tiered) {
    const ratedUnits = units.filter((u) => u.some((id) => scoredIds.has(id)));
    const unratedUnits = units.filter((u) => !u.some((id) => scoredIds.has(id)));

    /** Walks units in order, filling each band up to its share before moving on. */
    const fill = (list: string[][], shares: number[]) => {
      let tierIndex = 0;
      let placed = 0;
      for (const unit of list) {
        while (tierIndex < tiers.length && placed >= shares[tierIndex]) {
          tierIndex += 1;
          placed = 0;
        }
        if (tierIndex >= tiers.length) {
          leftover.push(...unit);
          continue;
        }
        tierUnits[tierIndex].push(unit);
        placed += unit.length;
      }
    };

    // Rated players are what the bands are actually about, so they are shared
    // out strongest-first. Unrated players have no rating to band on, so they
    // are spread across every band rather than sinking into the lowest one.
    const ratedCount = ratedUnits.reduce((n, u) => n + u.length, 0);
    const unratedCount = unratedUnits.reduce((n, u) => n + u.length, 0);
    fill(ratedUnits, tierCapacities(tiers, ratedCount, undefined));
    fill(unratedUnits, tierCapacities(tiers, unratedCount, undefined));
  } else {
    tierUnits[0] = units;
  }

  const allTeams: TeamBuilderTeam[] = [];
  const unassigned: string[] = [...leftover];
  let nameIndex = 0;

  tiers.forEach((tier, tierIdx) => {
    const slots: TeamSlot[] = Array.from({ length: tier.teamCount }, (_, i) => {
      // Numbered straight through, tiered or not. With bands, the teams are
      // emitted strongest-first, so Team 1..5 are the top band and 6..10 the
      // next — the Team Balance ratings show which is which.
      const position = nameIndex + i;
      return {
        team: {
          index: position,
          id: generateId('tbteam'),
          name: suppliedNames?.[position] ?? `Team ${position + 1}`,
          players: [],
          skaters: [],
          goalies: [],
        },
        scoredSum: 0,
        scoredCount: 0,
        posCounts: new Map<string, number>(),
        size: 0,
      };
    });
    nameIndex += tier.teamCount;

    const place = (slot: TeamSlot, id: string) => {
      slot.team.players.push(id);
      const pos = posOf(id);
      slot.posCounts.set(pos, (slot.posCounts.get(pos) ?? 0) + 1);
      slot.size += 1;
      if (scoredIds.has(id)) {
        slot.scoredSum += overallByPlayerId.get(id) ?? 0;
        slot.scoredCount += 1;
      }
    };

    /** Whether `slot` can seat every one of `ids` without breaking size or position rules. */
    const canSeat = (slot: TeamSlot, ids: string[]): boolean => {
      if (teamSize !== undefined && slot.size + ids.length > teamSize) return false;
      const projected = new Map(slot.posCounts);
      for (const id of ids) {
        const pos = posOf(id);
        const next = (projected.get(pos) ?? 0) + 1;
        // A quota is an exact per-team count, so it doubles as that position's
        // ceiling; the cap applies to every other position.
        const limit = quotas.get(pos) ?? positionCap;
        if (limit !== undefined && next > limit) return false;
        projected.set(pos, next);
      }
      return true;
    };

    /**
     * The eligible team that takes the next player: the one with the fewest
     * players, and among those the weakest.
     *
     * Headcount has to come first. Picking purely by lowest average looks right
     * and is badly unstable — a team that accepts a weak player drops its own
     * average, which makes it the lowest again, so it takes the next weak player
     * too. On a 142-player roster that put nine players on nine teams and the
     * other 133 on the tenth. Filling evenly and using strength only to break
     * ties turns the same loop into a self-correcting draft.
     */
    const weakestFor = (ids: string[]): TeamSlot | undefined => {
      let best: TeamSlot | undefined;
      for (const slot of slots) {
        if (!canSeat(slot, ids)) continue;
        if (!best) {
          best = slot;
          continue;
        }
        if (slot.size !== best.size) {
          if (slot.size < best.size) best = slot;
          continue;
        }
        if (teamAverage(slot) < teamAverage(best) - 1e-9) best = slot;
      }
      return best;
    };

    /** The eligible team with the fewest players — used for players with no score. */
    const smallestFor = (id: string): TeamSlot | undefined => {
      let best: TeamSlot | undefined;
      for (const slot of slots) {
        if (!canSeat(slot, [id])) continue;
        if (!best || slot.size < best.size) best = slot;
      }
      return best;
    };

    const assigned = new Set<string>();
    /** Players seated as part of a friend group, so the swap pass leaves them alone. */
    const grouped = new Set<string>();

    const myUnits = tierUnits[tierIdx];
    const myIds = new Set(myUnits.flat());

    // Friend groups are seated together first, while every team is still empty
    // enough to take a whole group.
    for (const unit of myUnits) {
      if (unit.length < 2) continue;
      const members = unit.filter((id) => !assigned.has(id));
      if (members.length === 0) continue;
      const target = weakestFor(members);
      if (!target) {
        warnings.push(
          `A friend group could not be kept together within the requested team sizes — those players were placed individually.`,
        );
        continue;
      }
      for (const id of members) {
        place(target, id);
        assigned.add(id);
        grouped.add(id);
      }
    }

    if (sortMethod === 'snake') {
      // Serpentine draft order, kept because it is a legitimate alternative a
      // caller can ask for explicitly. Nothing in the UI selects it today, and it
      // deliberately skips the balancing refinement below — the point of a snake
      // draft is the draft order itself.
      let direction = 1;
      let teamIdx = 0;
      for (const r of ranked) {
        if (!myIds.has(r.playerId) || assigned.has(r.playerId)) continue;
        let guard = 0;
        while (!canSeat(slots[teamIdx], [r.playerId]) && guard < slots.length * 2) {
          teamIdx += direction;
          if (teamIdx >= slots.length || teamIdx < 0) {
            direction *= -1;
            teamIdx += direction;
          }
          guard += 1;
        }
        if (!canSeat(slots[teamIdx], [r.playerId])) continue;
        place(slots[teamIdx], r.playerId);
        assigned.add(r.playerId);
        teamIdx += direction;
        if (teamIdx >= slots.length || teamIdx < 0) {
          direction *= -1;
          teamIdx += direction;
        }
      }
    } else {
      for (const r of rated) {
        if (!myIds.has(r.player.id) || assigned.has(r.player.id)) continue;
        const target = weakestFor([r.player.id]);
        if (!target) continue; // No legal seat — reported as unassigned below.
        place(target, r.player.id);
        assigned.add(r.player.id);
      }
      for (const r of unrated) {
        if (!myIds.has(r.player.id) || assigned.has(r.player.id)) continue;
        const target = smallestFor(r.player.id);
        if (!target) continue;
        place(target, r.player.id);
        assigned.add(r.player.id);
      }
      refineBalance(slots, overallByPlayerId, scoredIds, posOf, grouped);
    }

    for (const id of myIds) if (!assigned.has(id)) unassigned.push(id);

    // Derived once at the end rather than maintained during placement, so the
    // swaps above can't leave the two lists out of step with `players`.
    for (const slot of slots) {
      slot.team.skaters = slot.team.players.filter((id) => !isGoaliePosition(playerById.get(id)?.pos));
      slot.team.goalies = slot.team.players.filter((id) => isGoaliePosition(playerById.get(id)?.pos));
      allTeams.push(slot.team);
    }
  });

  if (unassigned.length > 0) {
    warnings.push(
      `${unassigned.length} player(s) did not fit the requested team count and size, and were left unassigned rather than added to a team.`,
    );
  }

  for (const [pos, quota] of quotas) {
    const available = tryout.roster.filter((p) => normalizePos(p.pos) === pos).length;
    const needed = quota * teamCount;
    if (available < needed) {
      warnings.push(
        `You asked for ${quota} ${pos} on every team, but the roster only has ${available} of them — ${needed} would be needed for ${teamCount} teams.`,
      );
    }
  }

  if (config.splitGoalies) {
    for (const team of allTeams) {
      if (team.goalies.length > 1) {
        warnings.push(`${team.name} has ${team.goalies.length} goalies — consider redistributing.`);
      }
    }
  }

  return {
    generatedAt: Date.now(),
    sortMethod,
    config: {
      teamCount,
      teamNames: allTeams.map((t) => t.name),
      keepFriendPackages: config.keepFriendPackages !== false,
      splitGoalies: config.splitGoalies ?? true,
    },
    ranks: ranked,
    warnings,
    teams: allTeams,
    unassigned,
  };
}

/** Averages closer than this are treated as level; further refinement is noise. */
const BALANCE_TOLERANCE = 0.01;

/**
 * Narrows the gap between the strongest and weakest teams by trading pairs.
 *
 * The placement pass only ever adds a player and never reconsiders one, so a
 * run of similar scores early on can leave a gap it has no way to close. Each
 * round takes the current highest- and lowest-average teams and applies the
 * single swap that shrinks the gap most, stopping as soon as nothing helps.
 *
 * Only players sharing a position are exchanged. That keeps every team's
 * position counts byte-for-byte as the placement passes left them, so a quota,
 * a cap and the even spread of goalies all survive the refinement untouched —
 * the swap moves strength around and nothing else. Members of a friend group
 * are excluded outright, since moving one of them individually is exactly what
 * "keep friends together" rules out.
 */
function refineBalance(
  slots: TeamSlot[],
  overallById: Map<string, number>,
  scoredIds: Set<string>,
  posOf: (id: string) => string,
  grouped: Set<string>,
): void {
  // Each round strictly narrows the gap, so this only bounds pathological input.
  const MAX_ROUNDS = 1000;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let hi = slots[0];
    let lo = slots[0];
    for (const slot of slots) {
      if (teamAverage(slot) > teamAverage(hi)) hi = slot;
      if (teamAverage(slot) < teamAverage(lo)) lo = slot;
    }
    if (hi === lo) return;
    const gap = teamAverage(hi) - teamAverage(lo);
    if (gap <= BALANCE_TOLERANCE) return;

    let bestGap = gap;
    let bestPair: [string, string] | null = null;
    for (const a of hi.team.players) {
      if (!scoredIds.has(a) || grouped.has(a)) continue;
      const va = overallById.get(a) ?? 0;
      for (const b of lo.team.players) {
        if (!scoredIds.has(b) || grouped.has(b)) continue;
        if (posOf(a) !== posOf(b)) continue;
        const vb = overallById.get(b) ?? 0;
        // Only moving strength from the stronger team to the weaker one can help.
        if (va <= vb) continue;
        const nextGap = Math.abs(
          (hi.scoredSum - va + vb) / hi.scoredCount - (lo.scoredSum - vb + va) / lo.scoredCount,
        );
        if (nextGap < bestGap - 1e-9) {
          bestGap = nextGap;
          bestPair = [a, b];
        }
      }
    }
    if (!bestPair) return;

    const [a, b] = bestPair;
    const va = overallById.get(a) ?? 0;
    const vb = overallById.get(b) ?? 0;
    hi.team.players[hi.team.players.indexOf(a)] = b;
    lo.team.players[lo.team.players.indexOf(b)] = a;
    hi.scoredSum += vb - va;
    lo.scoredSum += va - vb;
    // Sizes, scored counts and position counts are all unchanged: the pair share
    // a position and both are evaluated.
  }
}

/**
 * Moves one player into `toTeamId` (or out of every team when it is null),
 * for the Team Builder's manual drag-and-drop adjustments. Which of the
 * target's skater/goalie lists the player lands in follows their position,
 * not where they were dropped.
 */
export function movePlayerToTeam(
  state: TeamBuilderState,
  playerId: string,
  toTeamId: string | null,
  isGoalie: boolean,
): TeamBuilderState {
  const teams = state.teams.map((t) => ({
    ...t,
    players: t.players.filter((id) => id !== playerId),
    skaters: t.skaters.filter((id) => id !== playerId),
    goalies: t.goalies.filter((id) => id !== playerId),
  }));
  const unassigned = state.unassigned.filter((id) => id !== playerId);

  if (toTeamId === null) {
    unassigned.push(playerId);
  } else {
    const target = teams.find((t) => t.id === toTeamId);
    if (!target) return state;
    target.players.push(playerId);
    if (isGoalie) target.goalies.push(playerId);
    else target.skaters.push(playerId);
  }

  return { ...state, teams, unassigned };
}

export function getPlayerNameMap(tryout: Tryout): Record<string, string> {
  return Object.fromEntries(
    tryout.roster.map((p) => [p.id, playerDisplayName(p)]),
  );
}

/**
 * Team Builder export rows, grouped by team. Pass `opts.teamId` to export just
 * one team; omitted, every team is included (used by the Team Builder page's
 * "Export All Teams").
 */
export function buildTeamBuilderExportRows(
  tryout: Tryout,
  state: TeamBuilderState,
  opts?: { teamId?: string },
): { headers: string[]; rows: string[][] } {
  const results = computePlayerResults(tryout);
  const overallByPlayerId = new Map(results.map((r) => [r.player.id, r.overall]));
  const playerById = new Map(tryout.roster.map((p) => [p.id, p]));
  const headers = ['Team', 'Player', 'Jersey', 'Pos', 'Role', 'Overall'];
  const teams = opts?.teamId ? state.teams.filter((t) => t.id === opts.teamId) : state.teams;

  const rows: string[][] = [];
  for (const team of teams) {
    const addPlayers = (ids: string[], role: string) => {
      for (const pid of ids) {
        const p = playerById.get(pid);
        const overall = overallByPlayerId.get(pid);
        rows.push([
          team.name,
          p ? playerDisplayName(p) : pid,
          p?.jersey ?? '',
          p?.pos ?? '',
          role,
          overall != null ? overall.toFixed(2) : '',
        ]);
      }
    };
    addPlayers(team.skaters, 'Skater');
    addPlayers(team.goalies, 'Goalie');
  }
  return { headers, rows };
}

export function formatExportCsv(tryout: Tryout): string {
  const results = computePlayerResults(tryout);
  const headers = ['Rank', 'First', 'Last', 'Jersey', 'Pos', 'Overall', 'Recommendation'];
  const rows = results
    .sort((a, b) => b.overall - a.overall)
    .map((r, i) => [
      i + 1,
      r.player.first,
      r.player.last,
      r.player.jersey ?? '',
      r.player.pos ?? '',
      r.overall.toFixed(2),
      r.latestRecommendation,
    ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function mockAiPlayerSummary(tryout: Tryout, playerId: string) {
  const player = tryout.roster.find((p) => p.id === playerId);
  const evals = tryout.evals.filter((e) => e.playerId === playerId);
  if (!player) throw new Error('Player not found');
  const categories = getPlayerCategories(tryout.sport, player.pos, tryout.settings.customRubrics);
  const weights = isGoaliePosition(player.pos)
    ? tryout.settings.goalieWeights
    : tryout.settings.skaterWeights;
  const latest = [...evals].sort((a, b) => b.createdAt - a.createdAt)[0];
  const overall = evals.length ? weightedOverallAcrossEvals(evals, categories, weights) : 0;

  return {
    summary: `${playerDisplayName(player)} shows ${overall >= 4 ? 'strong' : overall >= 3 ? 'solid' : 'developing'} overall performance as a ${player.pos ?? 'player'}.`,
    key_strengths: latest?.strengths?.split(',').map((s) => s.trim()).filter(Boolean) ?? [
      'Competitive drive',
      'Coachability',
    ],
    key_growth: latest?.improve?.split(',').map((s) => s.trim()).filter(Boolean) ?? [
      'Consistency under pressure',
    ],
    role_fit: player.pos === 'GTL' ? 'Starting goalie candidate' : `${player.pos ?? 'Forward'} depth`,
    confidence: evals.length >= 2 ? 0.85 : evals.length === 1 ? 0.65 : 0.3,
    trend: evals.length >= 2 ? ('improving' as const) : evals.length === 1 ? ('steady' as const) : ('insufficient_data' as const),
  };
}

export function mockAiCompare(tryout: Tryout, playerIds: string[]) {
  const results = computePlayerResults(tryout).filter((r) => playerIds.includes(r.player.id));
  const top = [...results].sort((a, b) => b.overall - a.overall)[0];
  return {
    summary: `Comparing ${results.length} athletes — close competition across skating and compete categories.`,
    edge: top ? `${playerDisplayName(top.player)} leads with ${top.overall.toFixed(1)} overall.` : 'Insufficient data.',
    best_fit: top ? playerDisplayName(top.player) : '—',
    watch_list: results.slice(0, 3).map((r) => playerDisplayName(r.player)),
    recommendation: top?.latestRecommendation === 'Make'
      ? 'Strong roster candidates identified — prioritize for final cuts.'
      : 'Continue evaluating in next session before final decisions.',
  };
}
