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
  CardGridSkeleton,
  ErrorState,
  Modal,
  PageHeader,
  SectionLabel,
  Spinner,
  useAlert,
} from '@/components/ui';
import { Icon } from '@/components/Icons';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { UsageNudgeBanner } from '@/components/UsageNudgeBanner';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { useUser, usePermissions } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import {
  useTeamsQuery,
  useTryoutSummariesQuery,
  useAssignedTryoutSummariesQuery,
  useGuardianRostersQuery,
  useAcceptAssignmentMutation,
  useRejectAssignmentMutation,
  useArchiveTryoutMutation,
  useDeleteTryoutMutation,
} from '@/features/queries';
import { canUseFeature, isAtAssessmentLimit } from '@/data/plans';
import { prefetchTryout } from '@/features/prefetch';
import { NavPending } from '@/components/NavPending';

export default function DashboardPage() {
  const colors = useThemeColors();
  const router = useRouter();
  const { alert: showAlert, toast } = useAlert();
  const user = useUser();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const setActiveAssessor = useSessionStore((s) => s.setActiveAssessor);
  const combineIds = useSessionStore((s) => s.combineTryoutIds);
  const toggleCombineTryout = useSessionStore((s) => s.toggleCombineTryout);

  const [combineMode, setCombineMode] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [assignedExpanded, setAssignedExpanded] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [actionTryout, setActionTryout] = useState<{ id: string; name: string } | null>(null);
  // Tracks which card is mid archive/delete so its spinner shows immediately —
  // mirrors mobile's dashboard, where relying on the mutation's own isPending
  // was flaky because the modal closes (and re-renders the list) before the
  // pending state has propagated.
  const [busyId, setBusyId] = useState<string | null>(null);

  const { isGuardian } = usePermissions();

  // Summaries, not full tryouts: these cards show a name, a sport, a date and a
  // headcount, and the full read drags every roster, evaluation, score and
  // registration in the account along with it. See useTryoutSummariesQuery.
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutSummariesQuery(false);
  const assignedQuery = useAssignedTryoutSummariesQuery(!isGuardian);
  // Guardians and coaches share this route but not this data — firing the
  // guardian read for a coach was a round trip whose result is never rendered.
  const guardianQuery = useGuardianRostersQuery(isGuardian);
  const acceptAssignment = useAcceptAssignmentMutation();
  const rejectAssignment = useRejectAssignmentMutation();
  const archiveTryout = useArchiveTryoutMutation();
  const deleteTryout = useDeleteTryoutMutation();

  // The session writes an assessor screen expects, without the navigation —
  // a <Link> does that part itself, and only the accept-then-open flow below
  // still has to push by hand.
  const markAssessorSession = (id: string) => {
    setCurrentTryout(id);
    setActiveAssessor(
      user?.displayName
        ? { name: user.displayName, email: user.email, role: 'assessor', status: 'accepted' }
        : null,
    );
  };

  const openAssigned = (id: string) => {
    markAssessorSession(id);
    router.push(`/assessment/${id}/roster?assessor=1`);
  };

  const acceptAssigned = (id: string) => {
    setAcceptingId(id);
    acceptAssignment.mutate(id, {
      onSettled: () => setAcceptingId(null),
      onSuccess: () => openAssigned(id),
      onError: (error: Error) => alert(error?.message || 'Could not accept this evaluation.'),
    });
  };

  const declineAssigned = (id: string, name: string) => {
    if (!confirm(`Decline "${name}"? You will lose access to score this evaluation unless invited again.`)) return;
    setDecliningId(id);
    rejectAssignment.mutate(id, {
      onSettled: () => setDecliningId(null),
      onError: (error: Error) => alert(error?.message || 'Could not decline this evaluation.'),
    });
  };


  const handleDeleteAssessment = (id: string, name: string) => {
    setActionTryout({ id, name });
  };

  if (isGuardian) {
    if (guardianQuery.isLoading) {
      return (
        <>
          <PageHeader title="My Athletes" subtitle={`Hi, ${user?.displayName ?? 'Guardian'}`} />
          <CardGridSkeleton count={2} lines={3} columns="sm:grid-cols-2" />
        </>
      );
    }
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

  // Only the assessment list is worth blocking on. The teams list feeds one
  // count badge, so waiting for it held the whole screen hostage to the slower
  // of two independent requests; it now fills in where it lands.
  if (tryoutsQuery.isError) {
    // A signup with zero membership rows — not invited to any organization
    // yet, and not a linked guardian either. The raw "No account for user"
    // reads as a crash; tell the user what's actually going on instead.
    if (/No account for user/i.test(tryoutsQuery.error?.message ?? '')) {
      return (
        <EmptyState
          title="Account not linked yet"
          message="Your account isn't linked to an organization yet. Ask a coach or admin to invite you, then try again."
          actionLabel="Try Again"
          onAction={() => {
            tryoutsQuery.refetch();
            teamsQuery.refetch();
          }}
        />
      );
    }
    return (
      <ErrorState
        message={`Could not load dashboard data: ${tryoutsQuery.error?.message || 'Unknown error'}`}
        onRetry={() => {
          tryoutsQuery.refetch();
          teamsQuery.refetch();
        }}
      />
    );
  }

  const loadingTryouts = tryoutsQuery.isLoading;
  const tryouts = tryoutsQuery.data ?? [];
  const teams = teamsQuery.data ?? [];
  const planTier = user?.planTier ?? 'free';

  const newAssessment = () => {
    if (isAtAssessmentLimit(planTier, tryouts.length)) {
      setLimitMsg(buildLimitReachedMessage(planTier, 'assessments', 'evaluations'));
      return;
    }
    router.push('/assessment/new');
  };

  return (
    <>
      <PageHeader
        title="Tryouts"
        right={
          <>
            <Button label="Search" variant="secondary" onClick={() => router.push('/search')} />
            <Button label="+ New Evaluation" onClick={newAssessment} />
          </>
        }
      />

      {loadingTryouts ? null : (
        <UsageNudgeBanner tier={planTier} metric="assessments" count={tryouts.length} label="evaluations" />
      )}

      {canUseFeature(planTier, 'enterprise') ? (
        <Link href="/enterprise" className="mb-4 block">
          <Card accent interactive className="flex items-center gap-3">
            <Icon name="enterprise" size={22} color={colors.primary} />
            <span className="flex-1">
              <span className="block text-base font-bold" style={{ color: colors.ink }}>
                Dashboard
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
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card accent className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Icon name="assessments" size={18} color={colors.primary} />
            {/* An em dash rather than 0 while the count is in flight — a real
                zero and an unknown count are different things to a coach. */}
            <Badge label={loadingTryouts ? '—' : `${tryouts.length}`} variant="brand" />
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
              <Badge label={teamsQuery.isLoading ? '—' : `${teams.length}`} />
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
              Past evaluations
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
            ? assignedQuery.data.map((t) => {
                const mine = t.assessors.find(
                  (a) => (user?.id && a.userId === user.id) || a.email?.toLowerCase() === user?.email?.toLowerCase(),
                );
                const isPending = (mine?.status ?? 'pending') === 'pending';
                return (
                  <Card key={t.id} className="mb-2 flex flex-col gap-3">
                    <Link
                      href={`/assessment/${t.id}/roster?assessor=1`}
                      className="flex items-center justify-between gap-3 text-left"
                      onClick={() => markAssessorSession(t.id)}
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-base font-bold"
                          style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                        >
                          {t.name}
                        </span>
                        <span className="block text-sm" style={{ color: colors.inkMuted }}>
                          {t.sport} · {t.playerCount} players
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge label="Score" variant="brand" />
                        <NavPending />
                      </span>
                    </Link>
                    {isPending ? (
                      <div className="flex gap-2">
                        <Button
                          label="Accept"
                          size="sm"
                          className="flex-1"
                          loading={acceptingId === t.id}
                          onClick={() => acceptAssigned(t.id)}
                        />
                        <Button
                          label="Decline"
                          size="sm"
                          variant="ghost"
                          className="flex-1"
                          loading={decliningId === t.id}
                          onClick={() => declineAssigned(t.id, t.name)}
                        />
                      </div>
                    ) : null}
                  </Card>
                );
              })
            : null}
        </div>
      ) : null}

      {/* Evaluation list */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Evaluations &amp; Tryouts</SectionLabel>
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

      {loadingTryouts ? (
        <CardGridSkeleton count={4} lines={2} columns="sm:grid-cols-2" />
      ) : tryouts.length === 0 ? (
        <EmptyState
          title="No evaluations yet"
          message="Create your first tryout or evaluation to begin scoring players."
          actionLabel="Create Evaluation"
          onAction={newAssessment}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tryouts.map((item) => {
            const selected = combineIds.includes(item.id);
            const isBusy = busyId === item.id;
            return (
              // A real <Link>, not a click handler that pushes: only a Link
              // gets Next's route prefetch, and with /assessment/[id]'s
              // loading boundary that is what makes the tap land on the next
              // screen immediately instead of after a server round trip.
              <Link
                key={item.id}
                href={`/assessment/${item.id}/roster`}
                className="block h-full"
                // The roster screen this opens needs the full assessment, which
                // the summary list deliberately doesn't carry. Starting that read
                // on hover/touch usually covers the whole gap before the tap.
                onMouseEnter={() => prefetchTryout(item.id)}
                onTouchStart={() => prefetchTryout(item.id)}
                onClick={(e) => {
                  // Combine mode turns the grid into a multi-select, so a tap
                  // picks the card rather than opening it.
                  if (isBusy || combineMode) {
                    e.preventDefault();
                    if (!isBusy) toggleCombineTryout(item.id);
                    return;
                  }
                  setCurrentTryout(item.id);
                }}
              >
                <Card
                  interactive={!isBusy}
                  accent={selected || combineMode}
                  className="flex h-full items-start justify-between gap-3"
                  style={isBusy ? { opacity: 0.5 } : undefined}
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
                  <span className="flex flex-col items-end gap-2">
                    <span className="flex items-center gap-2">
                      <Badge label={`${item.playerCount} players`} />
                      <NavPending />
                      {isBusy ? (
                        <Spinner size={16} color={colors.danger} />
                      ) : (
                        <button
                          type="button"
                          aria-label="Evaluation actions"
                          onClick={(e) => {
                            // Inside a Link now, so the default has to go too.
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteAssessment(item.id, item.name);
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:brightness-125"
                        >
                          <Icon name="trash" size={16} color={colors.danger} />
                        </button>
                      )}
                    </span>
                    {selected ? <Badge label="Selected" variant="brand" /> : null}
                  </span>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <Modal
        visible={!!actionTryout}
        title="Evaluation Actions"
        onClose={() => setActionTryout(null)}
        hideDefaultFooter
      >
        <div className="flex flex-col gap-3">
          <p className="mb-1 text-sm" style={{ color: colors.inkMuted }}>
            What would you like to do with &quot;{actionTryout?.name}&quot;?
          </p>
          <Button
            label="Archive Evaluation"
            variant="secondary"
            onClick={() => {
              if (actionTryout) {
                setBusyId(actionTryout.id);
                const { id, name } = actionTryout;
                // The mutation drops the card from the cached list itself once
                // the server confirms, so there is nothing to remove here — but
                // a rejected write used to fail silently, leaving the card in
                // place with no explanation.
                archiveTryout.mutate(id, {
                  onSettled: () => setBusyId(null),
                  onSuccess: () => toast(`"${name}" archived`, 'success'),
                  onError: (e) =>
                    showAlert('Error', e instanceof Error ? e.message : 'Could not archive this evaluation.'),
                });
              }
              setActionTryout(null);
            }}
          />
          <Button
            label="Delete Permanently"
            variant="danger"
            onClick={() => {
              if (actionTryout) {
                setBusyId(actionTryout.id);
                const { id, name } = actionTryout;
                deleteTryout.mutate(id, {
                  onSettled: () => setBusyId(null),
                  onSuccess: () => toast(`"${name}" deleted`, 'success'),
                  onError: (e) =>
                    showAlert('Error', e instanceof Error ? e.message : 'Could not delete this evaluation.'),
                });
              }
              setActionTryout(null);
            }}
          />
        </div>
      </Modal>

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </>
  );
}
