'use client';

import { useTerms, sportLabel } from '@/lib/terms';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  CardGridSkeleton,
  ErrorState,
  Modal,
  PageHeader,
  Spinner,
  useAlert,
} from '@/components/ui';
import { Icon } from '@/components/Icons';
import { HomeIntro } from '@/components/home/HomeIntro';
import { HomeEmptyCard } from '@/components/home/HomeEmptyCard';
import { HomePanel } from '@/components/home/HomePanel';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { UsageNudgeBanner } from '@/components/UsageNudgeBanner';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { findViewersAssessorRow } from '@/lib/assessorInvite';
import { useUser, usePermissions } from '@/state/authStore';
import { getViewedPersonIds, useImpersonationStore } from '@/state/impersonationStore';
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
import { isAtAssessmentLimit, ownedTryouts } from '@/data/plans';
import { prefetchNewAssessment, prefetchTryout } from '@/features/prefetch';
import { NavPending } from '@/components/NavPending';
import { GuardianAthleteCard } from '@/components/GuardianAthleteCard';
import { EditEvaluationModal } from '@/components/assessment/EditEvaluationModal';
import type { TryoutSummary } from '@/data/types';

export default function DashboardPage() {
  const terms = useTerms();
  const colors = useThemeColors();
  const router = useRouter();
  const { alert: showAlert, confirm: confirmDialog, toast } = useAlert();
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
  const [actionTryout, setActionTryout] = useState<Pick<
    TryoutSummary,
    'id' | 'name' | 'tryoutDate' | 'startTime' | 'endTime' | 'rink'
  > | null>(null);
  const [editingTryout, setEditingTryout] = useState<Pick<
    TryoutSummary,
    'id' | 'name' | 'tryoutDate' | 'startTime' | 'endTime' | 'rink'
  > | null>(null);
  // Tracks which card is mid archive/delete so its spinner shows immediately —
  // mirrors mobile's dashboard, where relying on the mutation's own isPending
  // was flaky because the modal closes (and re-renders the list) before the
  // pending state has propagated.
  const [busyId, setBusyId] = useState<string | null>(null);
  // The Evaluations & Tryouts panel, so a Quick Access card can bring it into view.
  const evaluationsRef = useRef<HTMLDivElement>(null);

  const { isGuardian, role } = usePermissions();

  // The founder's read-only "view as" shows this screen exactly as the person
  // being viewed sees it — no founder-only markers. Subscribed rather than
  // read straight off the store so entering or leaving it re-renders, and used
  // below to read each assignment's invite state off that person rather than
  // off the founder's own identity.
  const viewingAs = useImpersonationStore((s) => !!s.target);
  const viewedIds = viewingAs ? getViewedPersonIds() : [];

  // Summaries, not full tryouts: these cards show a name, a sport, a date and a
  // headcount, and the full read drags every roster, evaluation, score and
  // registration in the account along with it. See useTryoutSummariesQuery.
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutSummariesQuery(false);

  // "All evaluations" on an evaluation page links here with #evaluations: bring
  // the list into view once it has rendered (it is not there while loading).
  const listReady = !tryoutsQuery.isLoading && !tryoutsQuery.isError;
  useEffect(() => {
    if (!listReady || window.location.hash !== '#evaluations') return;
    evaluationsRef.current?.scrollIntoView({ block: 'start' });
  }, [listReady]);
  const assignedQuery = useAssignedTryoutSummariesQuery(!isGuardian);
  // Guardians and coaches share this route but not this data — firing the
  // guardian read for a coach was a round trip whose result is never rendered.
  // (A coach who is also a guardian gets that view at its own route, /my-athletes.)
  const guardianQuery = useGuardianRostersQuery(true);
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


  const handleDeleteAssessment = (
    tryout: Pick<TryoutSummary, 'id' | 'name' | 'tryoutDate' | 'startTime' | 'endTime' | 'rink'>,
  ) => {
    setActionTryout(tryout);
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
              <GuardianAthleteCard key={ath.id} athlete={ath} colors={colors} />
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
  // A staff assessor finds their evaluations here rather than under Assigned to
  // me; once they Complete Assessing it leaves their list. Coaches and admins
  // are never filtered — completing is the assessor's own view only.
  const myEmail = user?.email?.toLowerCase();
  const allTryouts = (tryoutsQuery.data ?? []).filter(
    (t) =>
      role !== 'assessor' ||
      !t.assessors.some(
        (a) =>
          a.status === 'completed' &&
          ((!!user?.id && a.userId === user.id) || (!!myEmail && a.email?.toLowerCase() === myEmail)),
      ),
  );
  const teams = teamsQuery.data ?? [];
  // Evaluations on a team another club delegated to this user are theirs, not this plan's.
  const ownedEvalCount = ownedTryouts(allTryouts, teams).length;
  // The Evaluations list is for standalone evaluations. One created for a team
  // lives on that team's own Evaluations tab, so showing it here as well made it
  // look like it belonged to both. Only hidden when its team is one this user
  // can actually open — an evaluation pointing at a team that isn't in their list
  // would otherwise be unreachable from anywhere. The plan-limit checks below
  // still count every evaluation the account owns, team-linked included.
  const visibleTeamIds = new Set(teams.map((t) => t.id));
  const tryouts = allTryouts.filter((t) => !t.teamId || !visibleTeamIds.has(t.teamId));
  const planTier = user?.planTier ?? 'free';

  // Hover / keyboard focus / the touch before the tap: a few hundred ms of
  // warning, spent loading the form's route chunk and starting the two reads it
  // mounts with, so the screen is ready when the click lands.
  const warmNewAssessment = () => {
    router.prefetch('/assessment/new');
    prefetchNewAssessment();
  };

  const newAssessment = () => {
    if (isAtAssessmentLimit(planTier, ownedEvalCount)) {
      setLimitMsg(buildLimitReachedMessage(planTier, 'assessments', 'evaluations'));
      return;
    }
    router.push('/assessment/new');
  };

  return (
    <>
      <h1 className="sr-only">Tryouts</h1>

      {loadingTryouts ? null : (
        <UsageNudgeBanner tier={planTier} metric="assessments" count={ownedEvalCount} label="evaluations" />
      )}

      <HomeIntro
        active="evaluations"
        onEvaluations={() => evaluationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      />

      {/* Assigned to me */}
      {assignedQuery.data && assignedQuery.data.length > 0 ? (
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setAssignedExpanded((v) => !v)}
            aria-expanded={assignedExpanded}
            className="mb-3 flex w-full items-center justify-between py-1"
          >
            {/* Not HomeSectionLabel: that is a heading block with its own bottom
                margin, which doesn't belong inside a button. */}
            <span className="flex items-center gap-2">
              <span className="block h-3 w-[3px] rounded-sm" style={{ backgroundColor: colors.primary }} />
              <span className="text-xs font-bold tracking-wider uppercase" style={{ color: colors.inkMuted }}>
                Assigned to me
              </span>
            </span>
            <Icon name={assignedExpanded ? 'chevronDown' : 'chevronRight'} size={16} color={colors.inkMuted} />
          </button>
          {assignedExpanded
            ? assignedQuery.data.map((t) => {
                // Whose invite this card is — the person being viewed when
                // the founder is in "view as", the signed-in user otherwise.
                // See findViewersAssessorRow(): view as *organization* keeps
                // running as the founder, so matching the signed-in id here
                // found nothing and every accepted assignment read back as
                // still waiting to be accepted.
                const mine = findViewersAssessorRow(t.assessors, user, viewedIds);
                const isPending = (mine?.status ?? 'pending') === 'pending';
                return (
                  <Card key={t.id} className="mb-3 flex flex-col gap-3">
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
                          {sportLabel(t.sport, terms)} · {t.playerCount} {terms.players.toLowerCase()}
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

      {/* Evaluations & Tryouts: header, actions, the empty state and the cards
          all live inside one panel. */}
      <div ref={evaluationsRef} id="evaluations" className="scroll-mt-4">
        <HomePanel
          icon="calendar"
          label="Evaluations & Tryouts"
          right={
            <Button
              label="+ New Evaluation"
              size="sm"
              onClick={newAssessment}
              onMouseEnter={warmNewAssessment}
              onFocus={warmNewAssessment}
              onTouchStart={warmNewAssessment}
            />
          }
        >
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
            <Button label="Archived" size="sm" variant="ghost" onClick={() => router.push('/archived-assessments')} />
          </div>

          {loadingTryouts ? (
            <div className="mt-3">
              <CardGridSkeleton count={4} lines={2} columns="sm:grid-cols-2" />
            </div>
          ) : tryouts.length === 0 ? (
            <div className="mt-3">
              <HomeEmptyCard
                icon="target"
                title="No evaluations yet"
                message="Create your first tryout or evaluation to begin scoring players."
              />
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                        style={{ backgroundColor: 'rgba(255,107,43,0.12)' }}
                      >
                        <Icon name="assessments" size={20} color={colors.primary} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-lg font-bold"
                          style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                        >
                          {item.name}
                        </span>
                        <span className="mt-1 block text-sm" style={{ color: colors.inkMuted }}>
                          {sportLabel(item.sport, terms)} · {item.eventType}
                        </span>
                        {item.tryoutDate ? (
                          <span className="block text-sm" style={{ color: colors.inkFaint }}>
                            {item.tryoutDate} {item.startTime ? `· ${item.startTime}` : ''}
                          </span>
                        ) : null}
                        {/* Under the text on a phone, where the right-hand column has no room for it. */}
                        <span className="mt-1.5 block sm:hidden">
                          <Badge label={`${item.playerCount} ${item.playerCount === 1 ? 'player' : 'players'}`} />
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-2">
                        <span className="flex items-center gap-2">
                          <span className="hidden sm:inline-flex">
                            <Badge label={`${item.playerCount} ${item.playerCount === 1 ? 'player' : 'players'}`} />
                          </span>
                          <NavPending />
                          {isBusy ? (
                            <Spinner size={16} color={colors.danger} />
                          ) : (
                            <>
                              {/* Straight to the edit dialog, as on the app's tiles —
                                  no detour through the actions sheet. */}
                              <button
                                type="button"
                                aria-label={`Edit ${item.name}`}
                                title="Edit"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setEditingTryout(item);
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:brightness-125"
                              >
                                <Icon name="edit" size={16} color={colors.inkMuted} />
                              </button>
                              <button
                                type="button"
                                aria-label="Evaluation actions"
                                onClick={(e) => {
                                  // Inside a Link now, so the default has to go too.
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeleteAssessment(item);
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:brightness-125"
                              >
                                <Icon name="trash" size={16} color={colors.danger} />
                              </button>
                            </>
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
        </HomePanel>
      </div>

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
            label="Edit Details"
            variant="secondary"
            onClick={() => {
              const target = actionTryout;
              setActionTryout(null);
              // Straight from the tile instead of navigating to the
              // evaluation's Settings page to find the same fields.
              if (target) setEditingTryout(target);
            }}
          />
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
            onClick={async () => {
              const target = actionTryout;
              setActionTryout(null);
              if (!target) return;
              const ok = await confirmDialog({
                title: 'Delete Evaluation',
                message: `Permanently delete "${target.name}" and all of its scores? This can't be undone.`,
                confirmLabel: 'Delete',
                destructive: true,
                requireText: 'DELETE',
              });
              if (!ok) return;
              setBusyId(target.id);
              const { id, name } = target;
              deleteTryout.mutate(id, {
                onSettled: () => setBusyId(null),
                onSuccess: () => toast(`"${name}" deleted`, 'success'),
                onError: (e) =>
                  showAlert('Error', e instanceof Error ? e.message : 'Could not delete this evaluation.'),
              });
            }}
          />
        </div>
      </Modal>

      <EditEvaluationModal tryout={editingTryout} onClose={() => setEditingTryout(null)} />

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </>
  );
}
