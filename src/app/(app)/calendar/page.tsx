'use client';

import { useMemo, useState } from 'react';

import { MonthCalendar } from '@/components/MonthCalendar';
import { Badge, Button, Card, ErrorState, LoadingState, Modal, PageHeader, RefreshButton, useAlert } from '@/components/ui';
import { groupCalendarTeams, withAllTeams } from '@/lib/teamCalendars';
import { useSeasonsQuery, useSetTeamCalendarLinkMutation, useTeamCalendarLinksQuery, useTeamsQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

/** Every team's events on one month calendar, each marked with its team, plus which calendars are attached to which teams. */
export default function CalendarPage() {
  const colors = useThemeColors();
  const { alert } = useAlert();
  const seasonsQuery = useSeasonsQuery();
  const linksQuery = useTeamCalendarLinksQuery();
  const setLink = useSetTeamCalendarLinkMutation();
  // The calendar whose "shows on" list is being edited.
  const [managingId, setManagingId] = useState<string | null>(null);

  const seasons = seasonsQuery.data;
  const teamsQuery = useTeamsQuery();
  const allTeams = teamsQuery.data;
  const teams = useMemo(
    () => withAllTeams(groupCalendarTeams(seasons ?? []), allTeams ?? []),
    [seasons, allTeams],
  );
  const { events, teamByEvent, teamIdByEvent } = useMemo(() => {
    const teamByEvent = new Map<string, string>();
    const teamIdByEvent = new Map<string, string>();
    const events = (seasons ?? []).flatMap((s) => {
      for (const ev of s.events) {
        teamByEvent.set(ev.id, s.teamName);
        if (s.teamId) teamIdByEvent.set(ev.id, s.teamId);
      }
      return s.events;
    });
    return { events, teamByEvent, teamIdByEvent };
  }, [seasons]);

  if (seasonsQuery.isLoading) return <LoadingState />;
  if (seasonsQuery.isError) {
    return <ErrorState message="Could not load the calendar." onRetry={() => seasonsQuery.refetch()} />;
  }

  const links = linksQuery.data ?? [];
  const nameOf = (id: string) => teams.find((t) => t.teamId === id)?.teamName ?? 'Team';
  const managing = teams.find((t) => t.teamId === managingId);

  const toggle = async (viewerTeamId: string, sourceTeamId: string, attached: boolean) => {
    try {
      await setLink.mutateAsync({ viewerTeamId, sourceTeamId, attached });
    } catch (e) {
      await alert('Could Not Update Calendar', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Events from all of your teams"
        right={
          <RefreshButton
            onRefresh={() => Promise.all([seasonsQuery.refetch(), linksQuery.refetch(), teamsQuery.refetch()])}
          />
        }
      />

      {teams.length > 1 ? (
        <div className="mb-6">
          <h3 className="mb-2 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
            Your calendars
          </h3>
          <div className="flex flex-col gap-2">
            {teams.map((t) => {
              const shownOn = links.filter((l) => l.sourceTeamId === t.teamId).map((l) => nameOf(l.viewerTeamId));
              return (
                <Card key={t.teamId} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold" style={{ color: colors.ink }}>
                      {t.teamName}
                    </span>
                    <span className="block text-sm" style={{ color: colors.inkMuted }}>
                      {t.events.length} {t.events.length === 1 ? 'event' : 'events'}
                      {shownOn.length > 0 ? ` · also shown on ${shownOn.join(', ')}` : ' · not attached to other teams'}
                    </span>
                  </span>
                  {shownOn.length > 0 ? <Badge label={`On ${shownOn.length}`} variant="brand" /> : null}
                  <Button label="Attach to teams" variant="secondary" size="sm" onClick={() => setManagingId(t.teamId)} />
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}

      {teams.length === 1 ? (
        <p className="mb-4 text-sm" style={{ color: colors.inkMuted }}>
          Attaching calendars shows up once you have a second team.
        </p>
      ) : null}

      <MonthCalendar
        events={events}
        teamNameFor={(ev) => teamByEvent.get(ev.id)}
        eventHref={(ev) => {
          const teamId = teamIdByEvent.get(ev.id);
          return teamId ? `/team/${teamId}?tab=schedule&event=${ev.id}` : undefined;
        }}
      />

      <Modal
        visible={!!managing}
        title={managing ? `${managing.teamName} calendar` : ''}
        onClose={() => setManagingId(null)}
        hideDefaultFooter
      >
        {managing ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              Choose the teams whose Calendar should also show {managing.teamName}&apos;s events. Disconnecting only
              stops them showing; no events are changed.
            </p>
            {teams
              .filter((t) => t.teamId !== managing.teamId)
              .map((t) => {
                const attached = links.some((l) => l.viewerTeamId === t.teamId && l.sourceTeamId === managing.teamId);
                return (
                  <div
                    key={t.teamId}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                    style={{ backgroundColor: colors.tile, borderColor: colors.border }}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: colors.ink }}>
                      {t.teamName}
                    </span>
                    <Button
                      label={attached ? 'Disconnect' : 'Attach'}
                      variant={attached ? 'secondary' : 'primary'}
                      size="sm"
                      loading={
                        setLink.isPending &&
                        setLink.variables?.viewerTeamId === t.teamId &&
                        setLink.variables?.sourceTeamId === managing.teamId
                      }
                      onClick={() => void toggle(t.teamId, managing.teamId, !attached)}
                    />
                  </div>
                );
              })}
            <div className="flex justify-end pt-2">
              <Button label="Done" onClick={() => setManagingId(null)} />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
