import { describe, expect, it } from 'vitest';
import { buildTeams, parseTeamCountFromPrompt, parseTiersFromPrompt } from './teamBuilder';
import { computePlayerResults } from './scoring';
import type { Evaluation, Player, Tryout } from './types';

function makeTryout(roster: Player[], evals: Evaluation[]): Tryout {
  return {
    id: 't1',
    name: 'Sort Out',
    createdAt: 0,
    updatedAt: 0,
    eventType: 'Tryout',
    sport: 'Hockey',
    assessors: [],
    roster,
    evals,
    settings: {
      skaterWeights: { skating: 1 },
      goalieWeights: { skating: 1 },
      customRubrics: [
        {
          key: 'skating',
          label: 'Skating',
          scoringType: 'skill',
          scale: '1-5',
          rankingDirection: 'higher_is_better',
          role: 'all',
        },
      ],
    },
    archived: false,
  };
}

/**
 * `count` players whose skating scores sweep the full 1-5 range, so a naive
 * split has plenty of room to come out lopsided. `scoredRatio` leaves the rest
 * unevaluated, which is the case that actually broke: the balance bar averages
 * evaluated players only.
 */
function makeRoster(count: number, opts: { scoredRatio?: number; goalieEvery?: number } = {}) {
  const { scoredRatio = 1, goalieEvery } = opts;
  const roster: Player[] = [];
  const evals: Evaluation[] = [];
  const scoredCount = Math.round(count * scoredRatio);
  for (let i = 0; i < count; i++) {
    const id = `p${i}`;
    roster.push({
      id,
      first: `First${i}`,
      last: `Last${i}`,
      pos: goalieEvery && i % goalieEvery === 0 ? 'GTL' : 'FWD',
      createdAt: i,
    });
    if (i < scoredCount) {
      evals.push({
        id: `e${i}`,
        playerId: id,
        date: '2026-01-01',
        evaluator: 'Coach',
        session: 'Session 1',
        recommendation: '',
        // Sweeps 1..5 across the roster.
        scores: { skating: 1 + ((i * 4) / Math.max(1, scoredCount - 1)) },
        createdAt: i,
      });
    }
  }
  return { roster, evals };
}

/**
 * The same number the Team Builder screen puts on its balance bar: the mean
 * overall of a team's *evaluated* players. Asserting on this rather than on an
 * internal figure is the point — it's what the coach actually sees.
 */
function displayedAverages(tryout: Tryout, teams: { players: string[] }[]): number[] {
  const results = computePlayerResults(tryout);
  return teams
    .map((team) => {
      const ids = new Set(team.players);
      const scored = results.filter((r) => ids.has(r.player.id) && r.evalCount > 0 && r.overall > 0);
      return scored.length ? scored.reduce((s, r) => s + r.overall, 0) / scored.length : null;
    })
    .filter((v): v is number => v != null);
}

const spread = (values: number[]) => Math.max(...values) - Math.min(...values);

describe('parseTeamCountFromPrompt', () => {
  it('reads a count with words between the number and "teams"', () => {
    // The exact phrasing that fell through to the 2-team default in the app.
    expect(parseTeamCountFromPrompt('build 10 evenly ranked teams')).toBe(10);
    expect(parseTeamCountFromPrompt('make 4 balanced teams please')).toBe(4);
    expect(parseTeamCountFromPrompt('6 teams')).toBe(6);
    expect(parseTeamCountFromPrompt('Build 8 Teams')).toBe(8);
  });

  it('takes the team count, not the team size', () => {
    expect(parseTeamCountFromPrompt('4 teams of 11')).toBe(4);
    expect(parseTeamCountFromPrompt('11 players per team')).toBeUndefined();
    expect(parseTeamCountFromPrompt('teams of 11')).toBeUndefined();
    expect(parseTeamCountFromPrompt('5 athletes each team')).toBeUndefined();
  });

  it('adds up every mention, so a tiered request gets the right total', () => {
    // Taking only the first match built 5 teams for this exact prompt.
    expect(parseTeamCountFromPrompt('build 5 teams for 3 ranking and 5 teams for 4 ranking')).toBe(10);
    expect(parseTeamCountFromPrompt('3 teams of A and 2 teams of B')).toBe(5);
  });

  it('returns undefined when there is no usable count', () => {
    expect(parseTeamCountFromPrompt('')).toBeUndefined();
    expect(parseTeamCountFromPrompt('balance the teams evenly')).toBeUndefined();
    // A single team isn't a split.
    expect(parseTeamCountFromPrompt('1 team')).toBeUndefined();
  });
});

describe('parseTiersFromPrompt', () => {
  it('reads skill bands out of the sentence, with no AI involved', () => {
    expect(parseTiersFromPrompt('build 5 teams for 3 ranking and 5 teams for 4 ranking')).toEqual([
      { teamCount: 5, targetRating: 3 },
      { teamCount: 5, targetRating: 4 },
    ]);
    expect(parseTiersFromPrompt('3 teams at rating 5 and 3 teams at rating 2')).toEqual([
      { teamCount: 3, targetRating: 5 },
      { teamCount: 3, targetRating: 2 },
    ]);
  });

  it('reads a band whose second clause drops the word "teams"', () => {
    // "and 5 with ranking 4" — the elision people actually type. Matching only
    // the first band meant this was not treated as tiered at all.
    expect(parseTiersFromPrompt('build 5 teams with ranking 2 and 5 with ranking 4')).toEqual([
      { teamCount: 5, targetRating: 2 },
      { teamCount: 5, targetRating: 4 },
    ]);
    expect(parseTiersFromPrompt('4 teams at level 5 and 4 at level 1')).toEqual([
      { teamCount: 4, targetRating: 5 },
      { teamCount: 4, targetRating: 1 },
    ]);
  });

  it('does not mistake a team size for a band', () => {
    // "of 11" has no rating word, and 11 is off the 1-5 scale.
    expect(parseTiersFromPrompt('4 teams of 11 players')).toBeUndefined();
    expect(parseTiersFromPrompt('4 teams of 5')).toBeUndefined();
    expect(parseTiersFromPrompt('build 10 evenly ranked teams')).toBeUndefined();
  });

  it('needs at least two bands to count as tiering', () => {
    expect(parseTiersFromPrompt('5 teams for 3 ranking')).toBeUndefined();
    expect(parseTiersFromPrompt('')).toBeUndefined();
  });
});

describe('buildTeams', () => {
  it('builds evenly ranked teams for the reported case (142 players, 10 teams)', () => {
    const { roster, evals } = makeRoster(142);
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, { teamCount: 10, prompt: 'build 10 evenly ranked teams' });

    expect(state.teams).toHaveLength(10);
    // The bug report showed 1.5 to 4.9 — a spread of 3.4 on a 1-5 scale.
    expect(spread(displayedAverages(tryout, state.teams))).toBeLessThan(0.1);
  });

  it('balances the average the UI shows when most of the roster is unevaluated', () => {
    // The optimiser used to score unevaluated players as 0 while the balance bar
    // ignored them, so it optimised a number nobody saw.
    const { roster, evals } = makeRoster(142, { scoredRatio: 0.3 });
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, { teamCount: 10 });

    expect(spread(displayedAverages(tryout, state.teams))).toBeLessThan(0.1);
    // Unevaluated players still even out headcount rather than piling up.
    const sizes = state.teams.map((t) => t.players.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('places every player exactly once and never invents one', () => {
    const { roster, evals } = makeRoster(57);
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, { teamCount: 6 });

    const placed = [...state.teams.flatMap((t) => t.players), ...state.unassigned];
    expect(placed).toHaveLength(roster.length);
    expect(new Set(placed).size).toBe(roster.length);
    expect(placed.every((id) => roster.some((p) => p.id === id))).toBe(true);
  });

  it('honours an exact team size and leaves the surplus unassigned', () => {
    const { roster, evals } = makeRoster(50);
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, { teamCount: 4, teamSize: 11 });

    expect(state.teams.every((t) => t.players.length === 11)).toBe(true);
    expect(state.unassigned).toHaveLength(50 - 44);
  });

  it('honours a per-team position quota while still balancing', () => {
    const { roster, evals } = makeRoster(60, { goalieEvery: 6 });
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, { teamCount: 5, positionQuotas: { GTL: 1 } });

    const goaliesPerTeam = state.teams.map(
      (t) => t.players.filter((id) => roster.find((p) => p.id === id)?.pos === 'GTL').length,
    );
    expect(goaliesPerTeam.every((n) => n === 1)).toBe(true);
    expect(spread(displayedAverages(tryout, state.teams))).toBeLessThan(0.35);
  });

  it('never exceeds a position cap', () => {
    const { roster, evals } = makeRoster(60, { goalieEvery: 3 });
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, { teamCount: 5, positionCap: 4 });

    for (const team of state.teams) {
      const goalies = team.players.filter((id) => roster.find((p) => p.id === id)?.pos === 'GTL');
      expect(goalies.length).toBeLessThanOrEqual(4);
    }
  });

  it('keeps friend groups on the same team', () => {
    const { roster, evals } = makeRoster(40);
    roster[0].friend1Name = 'First1 Last1';
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, { teamCount: 4, keepFriendPackages: true });

    const teamOf = (id: string) => state.teams.findIndex((t) => t.players.includes(id));
    expect(teamOf('p0')).toBe(teamOf('p1'));
  });

  it('splits skaters and goalies consistently with the assigned players', () => {
    const { roster, evals } = makeRoster(40, { goalieEvery: 5 });
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, { teamCount: 4 });

    for (const team of state.teams) {
      expect([...team.skaters, ...team.goalies].sort()).toEqual([...team.players].sort());
    }
  });

  it('survives an empty roster', () => {
    const tryout = makeTryout([], []);
    const state = buildTeams(tryout, { teamCount: 4 });
    expect(state.teams).toHaveLength(4);
    expect(state.teams.every((t) => t.players.length === 0)).toBe(true);
    expect(state.unassigned).toHaveLength(0);
  });

  it('spreads an entirely unevaluated roster by headcount without dividing by zero', () => {
    const { roster } = makeRoster(31, { scoredRatio: 0 });
    const tryout = makeTryout(roster, []);

    const state = buildTeams(tryout, { teamCount: 4 });

    const sizes = state.teams.map((t) => t.players.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(31);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.every((n) => Number.isFinite(n))).toBe(true);
  });

  it('handles more teams than players without losing anyone', () => {
    const { roster, evals } = makeRoster(3);
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, { teamCount: 8 });

    const placed = state.teams.flatMap((t) => t.players);
    expect(placed).toHaveLength(3);
    expect(new Set(placed).size).toBe(3);
  });

  it('warns when the roster cannot supply a requested per-team position count', () => {
    // Two goalies on the roster, but five teams asking for one each.
    const { roster, evals } = makeRoster(50, { goalieEvery: 25 });
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, { teamCount: 5, positionQuotas: { GTL: 1 } });

    expect(state.warnings.some((w) => w.includes('GTL'))).toBe(true);
  });

  it('never exceeds a requested quota even when the roster has a surplus', () => {
    const { roster, evals } = makeRoster(60, { goalieEvery: 2 }); // 30 goalies
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, { teamCount: 5, positionQuotas: { GTL: 1 } });

    for (const team of state.teams) {
      const goalies = team.players.filter((id) => roster.find((p) => p.id === id)?.pos === 'GTL');
      expect(goalies).toHaveLength(1);
    }
  });

  it('builds skill tiers: balanced within a band, stepped between bands', () => {
    // "build 5 teams for 3 ranking and 5 teams for 4 ranking"
    const { roster, evals } = makeRoster(200);
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, {
      teamCount: 10,
      tiers: [
        { teamCount: 5, targetRating: 3 },
        { teamCount: 5, targetRating: 4 },
      ],
    });

    expect(state.teams).toHaveLength(10);
    const averages = displayedAverages(tryout, state.teams);

    // The stronger band is listed first regardless of the order it was given in.
    const top = averages.slice(0, 5);
    const bottom = averages.slice(5);
    expect(spread(top)).toBeLessThan(0.1); // level within the band
    expect(spread(bottom)).toBeLessThan(0.1);
    expect(Math.min(...top)).toBeGreaterThan(Math.max(...bottom)); // stepped between bands

    // Named so a coach can tell the bands apart.
    expect(state.teams[0].name).toBe('Team 1');
    expect(state.teams[5].name).toBe('Team 6');
  });

  it('does not sink unscorable players into the bottom tier', () => {
    // An evaluation against a rubric key that no longer exists gives
    // evalCount > 0 and overall 0. Treating that as "very weak" sent every one
    // of those players to the lowest band and reported it at 0.2 on a 1-5 scale.
    const { roster, evals } = makeRoster(120, { scoredRatio: 0.5 });
    // p60-p99 have no real scores; give them an evaluation nothing can score.
    for (let i = 60; i < 100; i++) {
      evals.push({
        id: `stale${i}`,
        playerId: `p${i}`,
        date: '2026-01-01',
        evaluator: 'Coach',
        session: 'Stale',
        recommendation: '',
        scores: { retiredRubricKey: 4 },
        createdAt: 1000 + i,
      });
    }

    const tryout = makeTryout(roster, evals);
    const state = buildTeams(tryout, {
      teamCount: 4,
      tiers: [{ teamCount: 2, targetRating: 4 }, { teamCount: 2, targetRating: 3 }],
    });

    const averages = displayedAverages(tryout, state.teams);
    expect(averages).toHaveLength(4);
    // Every band sits on the real 1-5 scale rather than being dragged to zero.
    expect(Math.min(...averages)).toBeGreaterThan(1);
    expect(spread(averages.slice(0, 2))).toBeLessThan(0.2);
    expect(spread(averages.slice(2))).toBeLessThan(0.2);
  });

  it('places every player exactly once across tiers', () => {
    const { roster, evals } = makeRoster(97);
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, {
      teamCount: 6,
      tiers: [{ teamCount: 3, targetRating: 4 }, { teamCount: 3, targetRating: 2 }],
    });

    const placed = [...state.teams.flatMap((t) => t.players), ...state.unassigned];
    expect(placed).toHaveLength(97);
    expect(new Set(placed).size).toBe(97);
  });

  it('keeps a friend group inside one tier rather than splitting it across bands', () => {
    const { roster, evals } = makeRoster(60);
    // Strongest player befriends the weakest, straddling any band boundary.
    roster[0].friend1Name = 'First59 Last59';
    const tryout = makeTryout(roster, evals);

    const state = buildTeams(tryout, {
      teamCount: 4,
      tiers: [{ teamCount: 2, targetRating: 4 }, { teamCount: 2, targetRating: 2 }],
    });

    const teamOf = (id: string) => state.teams.findIndex((t) => t.players.includes(id));
    expect(teamOf('p0')).toBe(teamOf('p59'));
  });

  it('ignores a single tier and behaves exactly like an untiered split', () => {
    const { roster, evals } = makeRoster(40);
    const tryout = makeTryout(roster, evals);

    const tiered = buildTeams(tryout, { teamCount: 4, tiers: [{ teamCount: 4 }] });
    const plain = buildTeams(tryout, { teamCount: 4 });

    expect(tiered.teams.map((t) => t.players)).toEqual(plain.teams.map((t) => t.players));
    expect(tiered.teams[0].name).toBe('Team 1');
  });

  it('is deterministic — the same roster and rules give the same split', () => {
    const { roster, evals } = makeRoster(80, { goalieEvery: 8 });
    const tryout = makeTryout(roster, evals);

    const a = buildTeams(tryout, { teamCount: 8, positionQuotas: { GTL: 1 } });
    const b = buildTeams(tryout, { teamCount: 8, positionQuotas: { GTL: 1 } });

    expect(a.teams.map((t) => t.players)).toEqual(b.teams.map((t) => t.players));
  });
});
