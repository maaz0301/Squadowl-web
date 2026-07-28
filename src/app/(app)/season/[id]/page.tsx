'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, LoadingState, SectionLabel } from '@/components/ui';
import { useSeasonQuery } from '@/features/queries';
import { useSeasonId } from '@/features/useSeasonId';

export default function SeasonHubPage() {
  const id = useSeasonId();
  const colors = useThemeColors();
  const router = useRouter();
  const seasonQuery = useSeasonQuery(id);

  if (seasonQuery.isLoading) return <LoadingState />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return <ErrorState message="Could not load season hub." onRetry={() => seasonQuery.refetch()} />;
  }
  const season = seasonQuery.data;

  const upcoming = [...season.events]
    .filter((e) => e.date >= new Date().toISOString().split('T')[0])
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-start">
      <Card accent className="flex flex-col gap-2">
        <span className="text-xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          {season.teamName}
        </span>
        <span style={{ color: colors.inkMuted }}>
          {season.sport} · {season.year ?? '—'} · {season.division ?? '—'}
        </span>
        {season.coach ? <span style={{ color: colors.inkFaint }}>Coach: {season.coach}</span> : null}

        <div className="mt-2 flex flex-wrap gap-2">
          <Link href={`/season/${id}/roster`}>
            <Badge label={`${season.roster.length} players`} variant="brand" />
          </Link>
          <Link href={`/season/${id}/schedule`}>
            <Badge label={`${season.events.length} events`} />
          </Link>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <Button label="Add Event" variant="secondary" size="sm" onClick={() => router.push(`/season/${id}/schedule`)} />
          <Button label="Settings" variant="ghost" size="sm" onClick={() => router.push(`/season/${id}/settings`)} />
        </div>
      </Card>

      <div>
        <SectionLabel className="mb-3">Upcoming Events</SectionLabel>
        {upcoming.length === 0 ? (
          <Card>
            <p style={{ color: colors.inkMuted }}>No upcoming events. Add one in Schedule.</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {upcoming.map((ev) => (
              <Card key={ev.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold" style={{ color: colors.ink }}>
                    {ev.title}
                  </span>
                  <Badge label={ev.type} variant={ev.type === 'Game' ? 'brand' : 'info'} />
                </div>
                <span className="text-sm" style={{ color: colors.inkMuted }}>
                  {ev.date} · {ev.startTime ?? '—'} · {ev.location ?? 'TBD'}
                </span>
                <div className="mt-1">
                  <Button
                    label="Edit"
                    variant="secondary"
                    size="sm"
                    onClick={() => router.push(`/season/${id}/schedule?editEventId=${ev.id}`)}
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
