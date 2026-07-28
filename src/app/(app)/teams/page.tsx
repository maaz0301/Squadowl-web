'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { useSeasonsQuery, useTeamsQuery } from '@/features/queries';

export default function TeamsPage() {
  const colors = useThemeColors();
  const router = useRouter();
  const teamsQuery = useTeamsQuery();
  const seasonsQuery = useSeasonsQuery();

  if (teamsQuery.isLoading) return <LoadingState message="Loading teams..." />;
  if (teamsQuery.isError) {
    return <ErrorState message="Could not load teams." onRetry={() => teamsQuery.refetch()} />;
  }

  const teams = teamsQuery.data ?? [];
  const seasons = seasonsQuery.data ?? [];

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle="Rosters, schedules and season events"
        right={<Button label="+ New Team" onClick={() => router.push('/team/new')} />}
      />

      {teams.length === 0 ? (
        <EmptyState
          title="No teams created"
          message="Create a team to group rosters, schedule practices and games, and manage assessments."
          actionLabel="Create Team"
          onAction={() => router.push('/team/new')}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => {
            const season = seasons.find((s) => s.teamId === team.id);
            return (
              <Link key={team.id} href={`/team/${team.id}`}>
                <Card interactive className="flex h-full flex-col gap-1">
                  <span
                    className="text-lg font-bold"
                    style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                  >
                    {team.name}
                  </span>
                  {team.season ? (
                    <span className="text-sm" style={{ color: colors.inkMuted }}>
                      {team.season}
                    </span>
                  ) : null}
                  {season ? (
                    <span className="mt-2">
                      <Badge label={`${season.roster.length} players · ${season.events.length} events`} />
                    </span>
                  ) : null}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
