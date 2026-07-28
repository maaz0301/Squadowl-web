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
  SectionLabel,
} from '@/components/ui';
import { Icon } from '@/components/Icons';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { useUser, usePermissions } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import {
  useTeamsQuery,
  useTryoutsQuery,
  useAssignedTryoutsQuery,
  useGuardianRostersQuery,
} from '@/features/queries';
import { APP_CONFIG } from '@/config/app';
import { canUseFeature, isAtAssessmentLimit } from '@/data/plans';

export default function DashboardPage() {
  const colors = useThemeColors();
  const router = useRouter();
  const user = useUser();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const setActiveAssessor = useSessionStore((s) => s.setActiveAssessor);
  const combineIds = useSessionStore((s) => s.combineTryoutIds);
  const toggleCombineTryout = useSessionStore((s) => s.toggleCombineTryout);

  const [combineMode, setCombineMode] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [assignedExpanded, setAssignedExpanded] = useState(true);

  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const assignedQuery = useAssignedTryoutsQuery();
  const guardianQuery = useGuardianRostersQuery();

  const { isGuardian } = usePermissions();

  const openAssigned = (id: string) => {
    setCurrentTryout(id);
    setActiveAssessor(
      user?.displayName
        ? { name: user.displayName, email: user.email, role: 'assessor', status: 'accepted' }
        : null,
    );
    router.push(`/assessment/${id}/roster?assessor=1`);
  };

  const openTryout = (id: string) => {
    if (combineMode) {
      toggleCombineTryout(id);
      return;
    }
    setCurrentTryout(id);
    router.push(`/assessment/${id}/roster`);
  };

  if (isGuardian) {
    if (guardianQuery.isLoading) return <LoadingState message="Loading portal..." />;
    if (guardianQuery.isError) {
      return (
        <ErrorState
          message={`Could not load guardian dashboard: ${guardianQuery.error?.message || 'Unknown error'}`}
          onRetry={() => guardianQuery.refetch()}
        />
      );
    }

    const athletes = guardianQuery.data ?? [];
    return (
      <>
        <PageHeader title="My Athletes" subtitle={`Hi, ${user?.displayName ?? 'Guardian'}`} />
        {athletes.length === 0 ? (
          <EmptyState
            title="No athletes linked yet"
            message="Once a coach links your athlete to a tryout or season, they'll appear here."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {athletes.map((ath) => (
              <Link key={ath.id} href={`/guardian/${ath.id}`}>
                <Card interactive className="h-full">
                  <div className="flex items-center gap-3">
                    <Avatar first={ath.firstName} last={ath.lastName} uri={ath.avatarUrl} size={44} />
                    <span
                      className="text-base font-bold"
                      style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                    >
                      {ath.firstName} {ath.lastName}
                    </span>
                  </div>

                  {ath.tryouts.length === 0 && ath.seasons.length === 0 ? (
                    <p className="mt-3 text-sm" style={{ color: colors.inkMuted }}>
                      No active tryouts or seasons assigned yet.
                    </p>
                  ) : null}

                  {ath.tryouts.length > 0 ? (
                    <div className="mt-3">
                      <SectionLabel className="mb-1">Tryouts</SectionLabel>
                      {ath.tryouts.map((t) => (
                        <p key={t.participantId} className="text-sm" style={{ color: colors.primary }}>
                          • {t.name} ({t.sport})
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {ath.seasons.length > 0 ? (
                    <div className="mt-3">
                      <SectionLabel className="mb-1">Seasons</SectionLabel>
                      {ath.seasons.map((s) => (
                        <p key={s.id} className="text-sm" style={{ color: colors.primary }}>
                          • {s.name} — {s.teamName}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </Card>
              </Link>
            ))}
          </div>
        )}
      </>
    );
  }

  if (teamsQuery.isLoading || tryoutsQuery.isLoading) return <LoadingState message="Loading dashboard..." />;
  if (teamsQuery.isError || tryoutsQuery.isError) {
    const errorMsg = teamsQuery.error?.message || tryoutsQuery.error?.message || 'Unknown error';
    return (
      <ErrorState
        message={`Could not load dashboard data: ${errorMsg}`}
        onRetry={() => {
          teamsQuery.refetch();
          tryoutsQuery.refetch();
        }}
      />
    );
  }

  const tryouts = tryoutsQuery.data ?? [];
  const teams = teamsQuery.data ?? [];
  const planTier = user?.planTier ?? 'free';

  const newAssessment = () => {
    if (isAtAssessmentLimit(planTier, tryouts.length)) {
      setLimitMsg('You have reached the maximum number of assessments for your current plan.');
      return;
    }
    router.push('/assessment/new');
  };

  return (
    <>
      <PageHeader
        title={APP_CONFIG.appName}
        subtitle={`Hi, ${user?.displayName ?? 'Coach'}`}
        right={
          <>
            <Button label="Search" variant="secondary" onClick={() => router.push('/search')} />
            <Button label="+ New Assessment" onClick={newAssessment} />
          </>
        }
      />

      {canUseFeature(planTier, 'enterprise') ? (
        <Link href="/enterprise" className="mb-4 block">
          <Card accent interactive className="flex items-center gap-3">
            <Icon name="enterprise" size={22} color={colors.primary} />
            <span className="flex-1">
              <span className="block text-base font-bold" style={{ color: colors.ink }}>
                Enterprise Dashboard
              </span>
              <span className="block text-xs" style={{ color: colors.inkMuted }}>
                Organization-wide reporting & members
              </span>
            </span>
            <Icon name="chevronRight" size={18} color={colors.inkMuted} />
          </Card>
        </Link>
      ) : null}

      {/* Overview & jump points */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card accent className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Icon name="assessments" size={18} color={colors.primary} />
            <Badge label={`${tryouts.length}`} variant="brand" />
          </div>
          <span className="mt-1 text-sm font-bold" style={{ color: colors.ink }}>
            Evaluations
          </span>
          <span className="text-xs" style={{ color: colors.inkMuted }}>
            Tryouts &amp; Tests
          </span>
        </Card>

        <Link href="/teams">
          <Card interactive className="flex h-full flex-col gap-1">
            <div className="flex items-center justify-between">
              <Icon name="teams" size={18} color={colors.primary} />
              <Badge label={`${teams.length}`} />
            </div>
            <span className="mt-1 text-sm font-bold" style={{ color: colors.ink }}>
              Teams
            </span>
            <span className="text-xs" style={{ color: colors.inkMuted }}>
              Rosters &amp; Schedules
            </span>
          </Card>
        </Link>

        <Link href="/archived-assessments">
          <Card interactive className="flex h-full flex-col gap-1">
            <div className="flex items-center justify-between">
              <Icon name="archive" size={18} color={colors.primary} />
            </div>
            <span className="mt-1 text-sm font-bold" style={{ color: colors.ink }}>
              Archived
            </span>
            <span className="text-xs" style={{ color: colors.inkMuted }}>
              Past assessments
            </span>
          </Card>
        </Link>
      </div>

      {/* Assigned to me */}
      {assignedQuery.data && assignedQuery.data.length > 0 ? (
        <div className="mb-5">
          <button
            type="button"
            onClick={() => setAssignedExpanded((v) => !v)}
            className="mb-2 flex w-full items-center justify-between py-1"
          >
            <SectionLabel>Assigned to me</SectionLabel>
            <Icon name={assignedExpanded ? 'chevronDown' : 'chevronRight'} size={16} color={colors.inkMuted} />
          </button>
          {assignedExpanded
            ? assignedQuery.data.map((t) => (
                <Card
                  key={t.id}
                  interactive
                  className="mb-2 flex items-center justify-between gap-3"
                  onClick={() => openAssigned(t.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-base font-bold"
                      style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                    >
                      {t.name}
                    </span>
                    <span className="block text-sm" style={{ color: colors.inkMuted }}>
                      {t.sport} · {t.roster?.length ?? 0} players
                    </span>
                  </span>
                  <Badge label="Score" variant="brand" />
                </Card>
              ))
            : null}
        </div>
      ) : null}

      {/* Assessment list */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Assessments &amp; Tryouts</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <Button
            label={combineMode ? 'Cancel Combine' : 'Combine Mode'}
            size="sm"
            variant={combineMode ? 'primary' : 'secondary'}
            onClick={() => setCombineMode((m) => !m)}
          />
          {combineMode && combineIds.length >= 2 ? (
            <Button label="View Combined" size="sm" onClick={() => router.push('/combine')} />
          ) : null}
        </div>
      </div>

      {tryouts.length === 0 ? (
        <EmptyState
          title="No assessments yet"
          message="Create your first tryout or evaluation to begin scoring players."
          actionLabel="Create Assessment"
          onAction={newAssessment}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tryouts.map((item) => {
            const selected = combineIds.includes(item.id);
            return (
              <Card
                key={item.id}
                interactive
                accent={selected || combineMode}
                className="flex h-full items-start justify-between gap-3"
                onClick={() => openTryout(item.id)}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-lg font-bold"
                    style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                  >
                    {item.name}
                  </span>
                  <span className="mt-1 block text-sm" style={{ color: colors.inkMuted }}>
                    {item.sport} · {item.eventType}
                  </span>
                  {item.tryoutDate ? (
                    <span className="block text-sm" style={{ color: colors.inkFaint }}>
                      {item.tryoutDate} {item.startTime ? `· ${item.startTime}` : ''}
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-col items-end gap-1">
                  <Badge label={`${item.roster?.length ?? 0} players`} />
                  {selected ? <Badge label="Selected" variant="brand" /> : null}
                </span>
              </Card>
            );
          })}
        </div>
      )}

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </>
  );
}
