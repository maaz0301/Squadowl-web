'use client';

import { ErrorState, LoadingState } from '@/components/ui';
import { MonthCalendar } from '@/components/MonthCalendar';
import { useSeasonQuery } from '@/features/queries';
import { useSeasonId } from '@/features/useSeasonId';

export default function SeasonCalendarPage() {
  const id = useSeasonId();
  const seasonQuery = useSeasonQuery(id);

  if (seasonQuery.isLoading) return <LoadingState />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return <ErrorState message="Could not load calendar." onRetry={() => seasonQuery.refetch()} />;
  }
  return <MonthCalendar events={seasonQuery.data.events} teamName={seasonQuery.data.teamName} />;
}
