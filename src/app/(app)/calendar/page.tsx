'use client';

import { useMemo } from 'react';

import { MonthCalendar } from '@/components/MonthCalendar';
import { ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { useSeasonsQuery } from '@/features/queries';

/** Every team's events on one month calendar, each marked with its team. */
export default function CalendarPage() {
  const seasonsQuery = useSeasonsQuery();

  const { events, teamByEvent } = useMemo(() => {
    const teamByEvent = new Map<string, string>();
    const events = (seasonsQuery.data ?? []).flatMap((s) => {
      for (const ev of s.events) teamByEvent.set(ev.id, s.teamName);
      return s.events;
    });
    return { events, teamByEvent };
  }, [seasonsQuery.data]);

  if (seasonsQuery.isLoading) return <LoadingState />;
  if (seasonsQuery.isError) {
    return <ErrorState message="Could not load the calendar." onRetry={() => seasonsQuery.refetch()} />;
  }
  return (
    <div>
      <PageHeader title="Calendar" subtitle="Events from all of your teams" />
      <MonthCalendar events={events} teamNameFor={(ev) => teamByEvent.get(ev.id)} />
    </div>
  );
}
