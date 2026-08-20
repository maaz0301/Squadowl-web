'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Spinner,
  useAlert,
} from '@/components/ui';
import { Icon } from '@/components/Icons';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { useSeasonsQuery, useTeamsQuery, useDeleteTeamMutation } from '@/features/queries';
import { useUser } from '@/state/authStore';
import { isAtTeamLimit } from '@/data/plans';
import { buildLimitReachedMessage } from '@/lib/usageNudges';

export default function TeamsPage() {
  const colors = useThemeColors();
  const router = useRouter();
  const { confirm } = useAlert();
  const user = useUser();
  const teamsQuery = useTeamsQuery();
  const seasonsQuery = useSeasonsQuery();
  const deleteTeam = useDeleteTeamMutation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  if (teamsQuery.isLoading) return <LoadingState message="Loading teams..." />;
  if (teamsQuery.isError) {
    return <ErrorState message="Could not load teams." onRetry={() => teamsQuery.refetch()} />;
  }

  const teams = teamsQuery.data ?? [];
  const seasons = seasonsQuery.data ?? [];

  const newTeam = () => {
    // Delegated teams belong to the club that pays for them, not to this plan.
    const count = teams.filter((t) => !t.managed).length;
    if (isAtTeamLimit(user?.planTier ?? 'free', count, user?.extraTeamLicenses ?? 0)) {
      setLimitMsg(
        buildLimitReachedMessage(user?.planTier ?? 'free', 'teams', 'teams', user?.extraTeamLicenses ?? 0),
      );
      return;
    }
    router.push('/team/new');
  };

  const handleDeleteTeam = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete Team',
      message: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setBusyId(id);
    deleteTeam.mutate(id, { onSettled: () => setBusyId(null) });
  };

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle="Rosters, schedules and season events"
        right={<Button label="+ New Team" onClick={newTeam} />}
      />

      {teams.length === 0 ? (
        <EmptyState
          title="No teams created"
          message="Create a team to group rosters, schedule practices and games, and manage assessments."
          actionLabel="Create Team"
          onAction={newTeam}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => {
            const season = seasons.find((s) => s.teamId === team.id);
            const isBusy = busyId === team.id;
            return (
              <Link
                key={team.id}
                href={`/team/${team.id}`}
                onClick={(e) => {
                  if (isBusy) e.preventDefault();
                }}
              >
                <Card
                  interactive={!isBusy}
                  className="flex h-full flex-col gap-1"
                  style={{
                    ...(team.brandColor ? { borderLeftWidth: 3, borderLeftColor: team.brandColor } : undefined),
                    ...(isBusy ? { opacity: 0.5 } : undefined),
                  }}
                >
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar first={team.name} last="" uri={team.logoUrl} size={40} ringColor={team.brandColor} />
                      <span
                        className="truncate text-lg font-bold"
                        style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                      >
                        {team.name}
                      </span>
                      {team.managed ? <Badge label="Managed" variant="info" /> : null}
                    </div>
                    {isBusy ? (
                      <Spinner size={16} color={colors.danger} />
                    ) : team.managed ? null : (
                      <button
                        type="button"
                        aria-label="Delete team"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDeleteTeam(team.id, team.name);
                        }}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors hover:brightness-125"
                      >
                        <Icon name="trash" size={16} color={colors.danger} />
                      </button>
                    )}
                  </div>
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

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </>
  );
}
