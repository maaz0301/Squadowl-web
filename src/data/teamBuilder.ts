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

export interface TeamBuilderConfig {
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

export function buildTeams(tryout: Tryout, config: TeamBuilderConfig): TeamBuilderState {
  const results = computePlayerResults(tryout);
  const ranked = [...results]
    .filter((r) => r.overall > 0)
    .sort((a, b) => b.overall - a.overall)
    .map((r, i) => ({ playerId: r.player.id, overall: r.overall, rank: i + 1 }));

  const rankedIds = new Set(ranked.map((r) => r.playerId));
  const unscored = tryout.roster.filter((p) => !rankedIds.has(p.id));
  for (const p of unscored) {
    ranked.push({ playerId: p.id, overall: 0, rank: ranked.length + 1 });
  }

  // Built once and reused below instead of re-scanning the roster/ranks with
  // .find() inside per-player assignment loops — the O(n²) lookups that made
  // this function noticeably slow at 1000+ players.
  const playerById = new Map(tryout.roster.map((p) => [p.id, p]));
  const overallByPlayerId = new Map(ranked.map((r) => [r.playerId, r.overall]));

  let teamCount = Math.max(2, config.teamCount);
  let sortMethod = config.sortMethod ?? 'snake';
  
  // Mock AI parsing from prompt
  if (config.prompt) {
    const promptLower = config.prompt.toLowerCase();
    const match = promptLower.match(/(\d+)\s*teams?/);
    if (match) {
      teamCount = Math.max(2, parseInt(match[1], 10));
    }
    if (promptLower.includes('balanced') || promptLower.includes('average')) {
      sortMethod = 'balanced';
    }
  }

  const teamNames =
    config.teamNames ??
    Array.from({ length: teamCount }, (_, i) => `Team ${String.fromCharCode(65 + i)}`);

  const friendPackages = config.keepFriendPackages !== false ? detectFriendPackages(tryout.roster) : [];
  const warnings: string[] = [];
  const teams: TeamBuilderTeam[] = teamNames.map((name, index) => ({
    index,
    id: generateId('tbteam'),
    name,
    players: [],
    skaters: [],
    goalies: [],
  }));

  const assigned = new Set<string>();

  // Assign friend packages first
  for (const pkg of friendPackages) {
    const unassigned = pkg.playerIds.filter((id) => !assigned.has(id));
    if (unassigned.length === 0) continue;
    const targetTeam = teams.reduce((best, t) =>
      t.players.length < best.players.length ? t : best,
    );
    for (const pid of unassigned) {
      targetTeam.players.push(pid);
      assigned.add(pid);
      const player = playerById.get(pid);
      if (player?.pos?.toUpperCase() === 'GTL') targetTeam.goalies.push(pid);
      else targetTeam.skaters.push(pid);
    }
  }

  const pool = ranked.filter((r) => !assigned.has(r.playerId));

  if (sortMethod === 'snake') {
    let direction = 1;
    let teamIdx = 0;
    for (const entry of pool) {
      while (teams[teamIdx].players.length >= Math.ceil(tryout.roster.length / teamCount)) {
        teamIdx += direction;
        if (teamIdx >= teamCount || teamIdx < 0) {
          direction *= -1;
          teamIdx += direction;
        }
      }
      const player = playerById.get(entry.playerId)!;
      teams[teamIdx].players.push(entry.playerId);
      if (player.pos?.toUpperCase() === 'GTL') teams[teamIdx].goalies.push(entry.playerId);
      else teams[teamIdx].skaters.push(entry.playerId);
      assigned.add(entry.playerId);
      teamIdx += direction;
      if (teamIdx >= teamCount || teamIdx < 0) {
        direction *= -1;
        teamIdx += direction;
      }
    }
  } else {
    // Maintain a running sum/count per team instead of recomputing every
    // team's average from scratch (via nested .reduce/.find) for every player
    // placed — that was O(n²) and dominated on large rosters. Seed the running
    // totals from any players already placed via friend packages above so the
    // averages stay identical to the previous recompute-from-scratch approach.
    const teamSum = teams.map((t) =>
      t.players.reduce((s, pid) => s + (overallByPlayerId.get(pid) ?? 0), 0),
    );
    const teamPlayerCount = teams.map((t) => t.players.length);
    for (const entry of pool) {
      let bestIdx = 0;
      let bestAvg = teamPlayerCount[0] === 0 ? 0 : teamSum[0] / teamPlayerCount[0];
      for (let i = 1; i < teams.length; i++) {
        const avg = teamPlayerCount[i] === 0 ? 0 : teamSum[i] / teamPlayerCount[i];
        if (avg < bestAvg) {
          bestAvg = avg;
          bestIdx = i;
        }
      }
      const targetTeam = teams[bestIdx];
      const player = playerById.get(entry.playerId)!;
      targetTeam.players.push(entry.playerId);
      if (player.pos?.toUpperCase() === 'GTL') targetTeam.goalies.push(entry.playerId);
      else targetTeam.skaters.push(entry.playerId);
      teamSum[bestIdx] += overallByPlayerId.get(entry.playerId) ?? 0;
      teamPlayerCount[bestIdx] += 1;
    }
  }

  if (config.splitGoalies) {
    for (const t of teams) {
      if (t.goalies.length > 1) {
        warnings.push(`${t.name} has ${t.goalies.length} goalies — consider redistributing.`);
      }
    }
  }

  return {
    generatedAt: Date.now(),
    sortMethod,
    config: {
      teamCount,
      teamNames,
      keepFriendPackages: config.keepFriendPackages !== false,
      splitGoalies: config.splitGoalies ?? true,
    },
    ranks: ranked,
    warnings,
    teams,
    unassigned: [],
  };
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
