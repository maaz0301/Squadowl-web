'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { useSeasonsQuery } from '@/features/queries';

export default function SeasonsPage() {
  const colors = useThemeColors();
  const router = useRouter();
  const seasonsQuery = useSeasonsQuery();

  if (seasonsQuery.isLoading) return <LoadingState message="Loading seasons..." />;
  if (seasonsQuery.isError) {
    return <ErrorState message="Could not load seasons." onRetry={() => seasonsQuery.refetch()} />;
  }

  const seasons = (seasonsQuery.data ?? []).filter((s) => !s.archived);

  return (
    <>
      <PageHeader
        title="Seasons"
        subtitle="Team hubs — schedules, rosters and availability"
        right={<Button label="+ New Season" onClick={() => router.push('/season/new')} />}
      />

      {seasons.length === 0 ? (
        <EmptyState
          title="No seasons yet"
          message="A season holds a team's schedule, roster and guardian availability."
          actionLabel="Create Season"
          onAction={() => router.push('/season/new')}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {seasons.map((s) => {
            const upcoming = s.events.filter((e) => e.date >= new Date().toISOString().split('T')[0]).length;
            return (
              <Link key={s.id} href={`/season/${s.id}`}>
                <Card interactive className="flex h-full flex-col gap-1">
                  <span
                    className="text-lg font-bold"
                    style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                  >
                    {s.name}
                  </span>
                  <span className="text-sm" style={{ color: colors.inkMuted }}>
                    {s.teamName} · {s.sport}
                    {s.year ? ` · ${s.year}` : ''}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-2">
                    <Badge label={`${s.roster.length} players`} variant="brand" />
                    <Badge label={`${upcoming} upcoming`} />
                  </span>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
