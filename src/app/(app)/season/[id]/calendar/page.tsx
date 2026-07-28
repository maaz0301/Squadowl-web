'use client';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useSeasonQuery } from '@/features/queries';
import { useSeasonId } from '@/features/useSeasonId';

export default function SeasonCalendarPage() {
  const id = useSeasonId();
  const colors = useThemeColors();
  const seasonQuery = useSeasonQuery(id);

  if (seasonQuery.isLoading) return <LoadingState />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return <ErrorState message="Could not load calendar." onRetry={() => seasonQuery.refetch()} />;
  }
  const season = seasonQuery.data;

  const byMonth = season.events.reduce<Record<string, typeof season.events>>((acc, ev) => {
    const month = ev.date.slice(0, 7);
    if (!acc[month]) acc[month] = [];
    acc[month].push(ev);
    return acc;
  }, {});

  if (Object.keys(byMonth).length === 0) {
    return <EmptyState title="No events" message="Your calendar is empty." />;
  }

  return (
    <div>
      {Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, events]) => (
          <div key={month} className="mb-7">
            <h2
              className="mb-3 text-lg font-bold"
              style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}
            >
              {month}
            </h2>
            <div className="flex flex-col gap-2">
              {[...events]
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((ev) => (
                  <Card key={ev.id} className="flex items-center gap-4">
                    <span
                      className="w-12 text-center text-2xl font-bold"
                      style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                    >
                      {ev.date.slice(8)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold" style={{ color: colors.ink }}>
                        {ev.title}
                      </span>
                      <span className="block text-sm" style={{ color: colors.inkMuted }}>
                        {ev.startTime ?? '—'} · {ev.location ?? 'TBD'}
                      </span>
                    </span>
                    <Badge label={ev.type} />
                  </Card>
                ))}
            </div>
          </div>
        ))}
    </div>
  );
}
