import type { Season, SeasonEvent } from '@/data/types';

export interface CalendarTeam {
  teamId: string;
  teamName: string;
  events: SeasonEvent[];
}

export interface CalendarLink {
  viewerTeamId: string;
  sourceTeamId: string;
}

/** One calendar per team: every season's events under the team that owns them. Seasons without a team have no calendar to attach. */
export function groupCalendarTeams(seasons: Season[]): CalendarTeam[] {
  const byTeam = new Map<string, CalendarTeam>();
  for (const s of seasons) {
    if (!s.teamId) continue;
    const entry = byTeam.get(s.teamId) ?? { teamId: s.teamId, teamName: s.teamName, events: [] };
    entry.events.push(...s.events);
    byTeam.set(s.teamId, entry);
  }
  return [...byTeam.values()].sort((a, b) => a.teamName.localeCompare(b.teamName));
}

/** The events of every calendar attached to `teamId`, and which team each one came from. */
export function linkedEvents(
  teamId: string,
  teams: CalendarTeam[],
  links: CalendarLink[],
): { events: SeasonEvent[]; teamByEvent: Map<string, string> } {
  const sourceIds = new Set(links.filter((l) => l.viewerTeamId === teamId).map((l) => l.sourceTeamId));
  const teamByEvent = new Map<string, string>();
  const events: SeasonEvent[] = [];
  for (const t of teams) {
    if (t.teamId === teamId || !sourceIds.has(t.teamId)) continue;
    for (const ev of t.events) {
      teamByEvent.set(ev.id, t.teamName);
      events.push(ev);
    }
  }
  return { events, teamByEvent };
}
