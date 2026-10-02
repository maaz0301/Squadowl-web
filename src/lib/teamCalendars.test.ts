import { describe, expect, it } from 'vitest';

import type { Season, SeasonEvent } from '@/data/types';
import { groupCalendarTeams, linkedEvents } from './teamCalendars';

const ev = (id: string): SeasonEvent => ({ id, title: id, date: '2026-10-20', type: 'Event' }) as SeasonEvent;
const season = (id: string, teamId: string | undefined, teamName: string, events: SeasonEvent[]) =>
  ({ id, teamId, teamName, events }) as Season;

describe('calendar links', () => {
  const seasons = [
    season('s1', 't1', 'Comets', [ev('a')]),
    season('s2', 't1', 'Comets', [ev('b')]),
    season('s3', 't2', 'Thunder', [ev('c')]),
    season('s4', undefined, 'No team', [ev('d')]),
  ];

  it('groups every season of a team under one calendar and leaves out seasons with no team', () => {
    const teams = groupCalendarTeams(seasons);
    expect(teams.map((t) => [t.teamName, t.events.map((e) => e.id)])).toEqual([
      ['Comets', ['a', 'b']],
      ['Thunder', ['c']],
    ]);
  });

  it('returns only the events of calendars attached to the team, labelled by source', () => {
    const teams = groupCalendarTeams(seasons);
    const { events, teamByEvent } = linkedEvents('t2', teams, [{ viewerTeamId: 't2', sourceTeamId: 't1' }]);
    expect(events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(teamByEvent.get('a')).toBe('Comets');
  });

  it('shows nothing for a team with no attached calendars, and never its own events', () => {
    const teams = groupCalendarTeams(seasons);
    expect(linkedEvents('t2', teams, []).events).toEqual([]);
    expect(linkedEvents('t1', teams, [{ viewerTeamId: 't1', sourceTeamId: 't1' }]).events).toEqual([]);
    // the link points the other way: Thunder's calendar on Comets does not put Comets on Thunder
    expect(linkedEvents('t2', teams, [{ viewerTeamId: 't1', sourceTeamId: 't2' }]).events).toEqual([]);
  });
});
