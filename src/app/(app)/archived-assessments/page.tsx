'use client';

import { useState } from 'react';
import Link from 'next/link';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardGridSkeleton,
  EmptyState,
  ErrorState,
  PageHeader,
  useAlert,
} from '@/components/ui';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { isAtAssessmentLimit, isAtTeamLimit } from '@/data/plans';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { useUser } from '@/state/authStore';
import {
  useArchivedTeamsQuery,
  useAssessmentCountQuery,
  useRestoreTeamMutation,
  useRestoreTryoutMutation,
  useTeamsQuery,
  useTryoutSummariesQuery,
} from '@/features/queries';

/**
 * Everything archived, in one place: evaluations and teams the coach archived or
 * a plan downgrade retired (deleted teams are not listed — they stay gone).
 * Restores are held to the plan's limits, so one only works once the plan has
 * room for it again.
 */
export default function ArchivedAssessmentsPage() {
  const colors = useThemeColors();
  const { alert, toast } = useAlert();
  const user = useUser();
  // Card fields only — see useTryoutSummariesQuery.
  const tryoutsQuery = useTryoutSummariesQuery(true);
  const restoreTryout = useRestoreTryoutMutation();
  const assessmentCount = useAssessmentCountQuery();
  const archivedTeamsQuery = useArchivedTeamsQuery();
  const teamsQuery = useTeamsQuery();
  const restoreTeam = useRestoreTeamMutation();
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  // The mutations are shared across rows, so track which card fired one.
  const [restoringId, setRestoringId] = useState<string | null>(null);

  if (tryoutsQuery.isLoading || archivedTeamsQuery.isLoading || teamsQuery.isLoading) {
    return (
      <>
        <PageHeader
          title="Archived"
          subtitle="Past evaluations and teams you can restore"
          showBack
          backHref="/dashboard"
        />
        <CardGridSkeleton count={3} lines={2} />
      </>
    );
  }
  if (tryoutsQuery.isError || archivedTeamsQuery.isError || teamsQuery.isError) {
    return (
      <>
        <PageHeader title="Archived" showBack backHref="/dashboard" />
        <ErrorState
          message="Could not load archived items."
          onRetry={() => {
            void tryoutsQuery.refetch();
            void archivedTeamsQuery.refetch();
            void teamsQuery.refetch();
          }}
        />
      </>
    );
  }

  const tier = user?.planTier ?? 'free';
  const licenses = user?.extraTeamLicenses ?? 0;
  const archived = (tryoutsQuery.data ?? []).filter((t) => t.archived);
  const archivedTeams = archivedTeamsQuery.data ?? [];
  // Delegated teams belong to the club that pays for them, not to this plan.
  const activeTeamCount = (teamsQuery.data ?? []).filter((t) => !t.managed).length;

  const handleRestoreTryout = async (id: string, name: string) => {
    // Restoring adds a live evaluation, so it is held to the plan limit the
    // same way creating one is — otherwise a downgrade's archive could be undone
    // on the spot. Waits for the count rather than reading a not-yet-loaded 0.
    const count = assessmentCount.data ?? (await assessmentCount.refetch()).data ?? 0;
    if (isAtAssessmentLimit(tier, count)) {
      setLimitMsg(buildLimitReachedMessage(tier, 'assessments', 'evaluations'));
      return;
    }
    setRestoringId(id);
    try {
      await restoreTryout.mutateAsync(id);
      toast(`"${name}" restored`, 'success');
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not restore the evaluation.');
    } finally {
      setRestoringId(null);
    }
  };

  const handleRestoreTeam = async (id: string, name: string) => {
    if (isAtTeamLimit(tier, activeTeamCount, licenses)) {
      setLimitMsg(buildLimitReachedMessage(tier, 'teams', 'teams', licenses));
      return;
    }
    setRestoringId(id);
    try {
      await restoreTeam.mutateAsync(id);
      toast(`"${name}" restored`, 'success');
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not restore the team.');
    } finally {
      setRestoringId(null);
    }
  };

  const busy = restoreTryout.isPending || restoreTeam.isPending;

  return (
    <>
      <PageHeader
        title="Archived"
        subtitle="Past evaluations and teams you can restore"
        showBack
        backHref="/dashboard"
      />

      {archived.length === 0 && archivedTeams.length === 0 ? (
        <EmptyState
          title="Nothing archived"
          message="Evaluations and teams you archive — or that a plan change archives — will appear here. You can restore them at any time your plan has room."
        />
      ) : null}

      {archived.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide" style={{ color: colors.inkMuted }}>
            Evaluations
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((item) => (
              <Card key={item.id} className="flex h-full flex-col gap-2">
                <Link href={`/assessment/${item.id}/settings`} className="min-w-0">
                  <span
                    className="block truncate text-lg font-bold"
                    style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                  >
                    {item.name}
                  </span>
                  <span className="mt-1 block text-sm" style={{ color: colors.inkMuted }}>
                    {item.sport} · {item.playerCount} players
                  </span>
                </Link>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                  <Badge
                    label={item.archivedReason === 'plan_downgrade' ? 'Archived · plan change' : 'Archived'}
                    variant="warning"
                  />
                  <Button
                    label="Restore"
                    size="sm"
                    loading={restoringId === item.id}
                    disabled={busy}
                    onClick={() => handleRestoreTryout(item.id, item.name)}
                  />
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {archivedTeams.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide" style={{ color: colors.inkMuted }}>
            Teams
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {archivedTeams.map((team) => (
              <Card
                key={team.id}
                className="flex h-full flex-col gap-2"
                style={team.brandColor ? { borderLeftWidth: 3, borderLeftColor: team.brandColor } : undefined}
              >
                <div className="flex items-center gap-3">
                  <Avatar first={team.name} last="" uri={team.logoUrl} size={40} ringColor={team.brandColor} />
                  <div className="min-w-0">
                    <span
                      className="block truncate text-lg font-bold"
                      style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                    >
                      {team.name}
                    </span>
                    {team.season ? (
                      <span className="block truncate text-sm" style={{ color: colors.inkMuted }}>
                        {team.season}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                  <Badge
                    label={team.archivedReason === 'plan_downgrade' ? 'Archived · plan change' : 'Archived'}
                    variant="warning"
                  />
                  <Button
                    label="Restore"
                    size="sm"
                    loading={restoringId === team.id}
                    disabled={busy}
                    onClick={() => handleRestoreTeam(team.id, team.name)}
                  />
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </>
  );
}
