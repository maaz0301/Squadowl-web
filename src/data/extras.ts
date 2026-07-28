import type { Player, SeasonPlayer, Tryout } from './types';
import { generateId } from './rubrics';

export interface RosterLibraryEntry {
  key: string;
  first: string;
  last: string;
  jersey?: string;
  pos?: string;
  athleteId?: string;
  sourceTryoutId: string;
  sourceTryoutName: string;
}

export interface SearchResults {
  assessments: { id: string; name: string; sport: string }[];
  players: { id: string; name: string; tryoutId: string; tryoutName: string }[];
  seasons: { id: string; name: string; teamName: string }[];
}

export interface FeedbackSubmission {
  overallExperience: number;
  easeOfUse: number;
  teamHubScheduling: number;
  valueForMoney: number;
  whatIsWorkingWell: string;
  whatCanBeImproved: string;
}

export function buildRosterLibrary(tryouts: Tryout[], excludeTryoutId?: string): RosterLibraryEntry[] {
  const seen = new Set<string>();
  const entries: RosterLibraryEntry[] = [];
  for (const t of tryouts) {
    if (t.archived || t.id === excludeTryoutId) continue;
    for (const p of t.roster) {
      const key = p.athleteId ?? `${p.first}-${p.last}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        key,
        first: p.first,
        last: p.last,
        jersey: p.jersey,
        pos: p.pos,
        athleteId: p.athleteId,
        sourceTryoutId: t.id,
        sourceTryoutName: t.name,
      });
    }
  }
  return entries.sort((a, b) => `${a.last}${a.first}`.localeCompare(`${b.last}${b.first}`));
}

export function globalSearch(tryouts: Tryout[], seasons: { id: string; name: string; teamName: string }[], q: string): SearchResults {
  const query = q.trim().toLowerCase();
  if (!query) return { assessments: [], players: [], seasons: [] };

  const assessments = Object.values(tryouts)
    .filter((t) => !t.archived && t.name.toLowerCase().includes(query))
    .map((t) => ({ id: t.id, name: t.name, sport: t.sport }));

  const players: SearchResults['players'] = [];
  for (const t of Object.values(tryouts)) {
    if (t.archived) continue;
    for (const p of t.roster) {
      const name = `${p.first} ${p.last}`.toLowerCase();
      if (name.includes(query) || p.jersey?.includes(query)) {
        players.push({ id: p.id, name: `${p.first} ${p.last}`, tryoutId: t.id, tryoutName: t.name });
      }
    }
  }

  const seasonResults = seasons
    .filter((s) => s.name.toLowerCase().includes(query) || s.teamName.toLowerCase().includes(query))
    .map((s) => ({ id: s.id, name: s.name, teamName: s.teamName }));

  return { assessments, players, seasons: seasonResults };
}

export function playerToSeasonPlayer(p: Player): SeasonPlayer {
  return {
    id: generateId('sp'),
    firstName: p.first,
    lastName: p.last,
    jersey: p.jersey,
    guardianEmail: p.guardianEmail,
    guardianPhone: p.guardianPhone,
  };
}

export function libraryEntryToAddForm(entry: RosterLibraryEntry) {
  return {
    first: entry.first,
    last: entry.last,
    jersey: entry.jersey,
    pos: entry.pos,
    registrationSource: 'import' as const,
  };
}
