'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AddToRosterModal, type RosterDestination } from '@/components/assessment/AddToRosterModal';
import { RegistrationForm } from '@/components/assessment/RegistrationForm';
import { RegistrationProfileModal } from '@/components/assessment/RegistrationProfileModal';
import { DummyDataModal } from '@/components/DummyDataModal';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { PlanGate } from '@/components/PlanGate';
import { QrCode } from '@/components/QrCode';
import { CoachOnlyState } from '@/components/assessment/CoachOnlyState';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  SectionLabel,
  Tabs,
  useAlert,
} from '@/components/ui';
import { isAtPlayerLimit, playerRoom } from '@/data/plans';
import { useCanUseDummyData } from '@/features/useCanUseDummyData';
import type { DummyDataOptions } from '@/data/testDataGenerator';
import {
  useClearTestDataMutation,
  useDismissRegistrationMutation,
  useEnsureCloudSessionMutation,
  useGenerateTestDataMutation,
  usePlaceRegistrationsMutation,
  useRegistrationsQuery,
  useSubmitRegistrationMutation,
  useTryoutQuery,
  useTryoutSummariesQuery,
} from '@/features/queries';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { useThemeColors } from '@/theme/ThemeProvider';
import { APP_CONFIG } from '@/config/app';

type RegTab = 'pending' | 'all' | 'dismissed';

export default function RegistrationsPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const router = useRouter();
  const { alert, toast } = useAlert();
  const tryoutQuery = useTryoutQuery(id);
  // A team someone else owns is run on that team's plan, not the viewer's own.
  const effectiveTier = useEffectivePlanTier(tryoutQuery.data?.teamId);
  const regsQuery = useRegistrationsQuery(id!);
  const ensureCloud = useEnsureCloudSessionMutation();
  // Only the destination's roster size is read off this — summaries carry the
  // headcount without pulling every roster and evaluation in the account.
  const allTryouts = useTryoutSummariesQuery();
  const dismissReg = useDismissRegistrationMutation(id!);
  const submitReg = useSubmitRegistrationMutation(id!);
  const [dummyProgress, setDummyProgress] = useState<{ done: number; total: number } | null>(null);
  const genTest = useGenerateTestDataMutation(id!, (done, total) => setDummyProgress({ done, total }));
  const clearTest = useClearTestDataMutation(id!);
  const [showQr, setShowQr] = useState(false);
  const [showSimulate, setShowSimulate] = useState(false);
  const [showTestGen, setShowTestGen] = useState(false);
  const [tab, setTab] = useState<RegTab>('pending');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  // Registration ids waiting on a destination choice. Non-null == picker open.
  const [placing, setPlacing] = useState<string[] | null>(null);
  const [placingProgress, setPlacingProgress] = useState<{ done: number; total: number } | null>(null);
  const placeRegs = usePlaceRegistrationsMutation(id!, (done, total) => setPlacingProgress({ done, total }));
  // Registration whose submitted profile is open. Non-null == profile open.
  const [viewingId, setViewingId] = useState<string | null>(null);

  const showDummyTools = useCanUseDummyData(effectiveTier);

  const cloudId = tryoutQuery.data?.cloud?.id;
  useEffect(() => {
    if (id && tryoutQuery.data && !cloudId) ensureCloud.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tryoutQuery.data, cloudId]);

  const filtered = useMemo(() => {
    const all = regsQuery.data ?? [];
    if (tab === 'all') return all;
    if (tab === 'dismissed') return all.filter((r) => r.status === 'dismissed');
    return all.filter((r) => r.status === 'pending');
  }, [regsQuery.data, tab]);

  // Resolved from the live list rather than held as a snapshot, so the status
  // and payment badges in the profile stay current while it's open.
  const viewing = useMemo(
    () => (regsQuery.data ?? []).find((r) => r.id === viewingId) ?? null,
    [regsQuery.data, viewingId],
  );

  if (tryoutQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load registrations." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  if (!tryout.viewerIsOwner) return <CoachOnlyState what="manage registrations" />;
  const cloudCode = tryout.cloud?.id ?? '------';
  const baseUrl =
    APP_CONFIG.webUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://www.tryouthq.ca');
  const registrationUrl = `${baseUrl}/register/${cloudCode}`;
  const pendingCount = (regsQuery.data ?? []).filter((r) => r.status === 'pending').length;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(registrationUrl);
      toast('Registration link copied', 'success');
    } catch {
      await alert('Registration link', registrationUrl);
    }
  };

  const toggleSelect = (regId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(regId)) next.delete(regId);
      else next.add(regId);
      return next;
    });
  };

  // What "Add N to Roster" actually places: the ticked registrations that are
  // still pending. A player dismissed (or placed elsewhere) after being ticked
  // stays in `selected`, and would otherwise be counted and sent anyway.
  const pendingIds = (regsQuery.data ?? []).filter((r) => r.status === 'pending').map((r) => r.id);
  const pendingIdSet = new Set(pendingIds);
  const selectedIds = [...selected].filter((regId) => pendingIdSet.has(regId));
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every((regId) => selected.has(regId));
  // The "Add to Roster" on a card means the whole ticked group when that card is
  // one of them — clicking it on one of several ticked players used to place only
  // that one, which is how a multi-select "sent one player".
  const addFromCard = (regId: string) =>
    setPlacing(selected.has(regId) && selectedIds.length > 1 ? selectedIds : [regId]);

  const runPlacement = async (destination: RosterDestination) => {
    const ids = placing ?? [];
    if (ids.length === 0) return;

    // The player limit is per-assessment, so it has to be measured against the
    // roster actually receiving these players — not this screen's assessment,
    // which may not be the destination. A team roster isn't capped this way.
    if (destination.kind === 'assessment') {
      const target = (allTryouts.data ?? []).find((t) => t.id === destination.id);
      const existing = target?.playerCount ?? 0;
      if (isAtPlayerLimit(effectiveTier, existing + ids.length - 1)) {
        setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'));
        return;
      }
    }

    try {
      setPlacingProgress({ done: 0, total: ids.length });
      await placeRegs.mutateAsync({ destination, registrationIds: ids });
      setSelected((prev) => {
        const next = new Set(prev);
        for (const regId of ids) next.delete(regId);
        return next;
      });
      setPlacing(null);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Failed to add players.');
    } finally {
      setPlacingProgress(null);
    }
  };

  const exportCsv = () => {
    const data = regsQuery.data ?? [];
    if (data.length === 0) return;
    const rows = data.map(
      (r) => `${r.firstName},${r.lastName},${r.guardianEmail},${r.status},${r.paymentStatus ?? 'unpaid'}`,
    );
    const csv = `first,last,email,status,payment\n${rows.join('\n')}`;
    const filename = `${tryout.name}_regs.csv`.replace(/\s+/g, '_').toLowerCase();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const hasRubrics = (tryout.settings.customRubrics?.length ?? 0) > 0;

  const runGenerate = async (options: DummyDataOptions) => {
    setDummyProgress(null);
    try {
      const res = await genTest.mutateAsync(options);
      const parts = [
        res.registrations ? `${res.registrations} pending registrations` : null,
        res.players ? `${res.players} roster players` : null,
        res.evaluations ? `${res.evaluations} evaluations` : null,
      ].filter(Boolean);
      await alert('Dummy data added', `Created ${parts.join(', ')}.`);
    } catch (e) {
      await alert(
        'Error',
        e instanceof Error && e.message === 'NO_RUBRICS'
          ? 'Add at least one rubric before generating scored players.'
          : e instanceof Error
            ? e.message
            : 'Failed to generate dummy data.',
      );
    } finally {
      // In `finally`, not after the await: generateTestData writes
      // incrementally, so a partial run still created real rows and the modal
      // must not stay open over a stale form.
      setShowTestGen(false);
      setDummyProgress(null);
    }
  };

  const clearTestData = async () => {
    try {
      const res = await clearTest.mutateAsync();
      await alert('Cleared', `Removed ${res.removed} generated record${res.removed === 1 ? '' : 's'}.`);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Failed to clear dummy data.');
    }
  };

  return (
    <>
      <PlanGate feature="qrRegistration" title="QR Registration (Coach+)">
        <Card accent className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <SectionLabel>Registration Code</SectionLabel>
            <p
              className="text-3xl font-bold tracking-[0.2em]"
              style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}
            >
              {cloudCode}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button label="Show QR" size="sm" onClick={() => setShowQr(true)} />
            <Button label="Copy Link" size="sm" variant="secondary" onClick={copyLink} />
            <Button label="Simulate QR Reg" size="sm" variant="ghost" onClick={() => setShowSimulate(true)} />
          </div>
        </Card>
      </PlanGate>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { key: 'pending', label: 'Pending', badge: pendingCount || undefined },
            { key: 'all', label: 'All' },
            { key: 'dismissed', label: 'Dismissed' },
          ]}
          activeKey={tab}
          onChange={(k) => setTab(k as RegTab)}
        />
        <span className="ml-auto flex flex-wrap gap-2">
          {tab === 'pending' && filtered.length > 0 ? (
            <Button
              label={allPendingSelected ? 'Deselect All' : 'Select All'}
              size="sm"
              variant="secondary"
              onClick={() => setSelected(allPendingSelected ? new Set() : new Set(pendingIds))}
            />
          ) : null}
          {tab === 'pending' && selectedIds.length > 0 ? (
            <Button
              label={`Add ${selectedIds.length} to Roster`}
              size="sm"
              onClick={() => setPlacing(selectedIds)}
            />
          ) : null}
          <Button label="Export CSV" variant="ghost" size="sm" onClick={exportCsv} />
        </span>
      </div>

      {showDummyTools ? (
        <Card className="mb-4 flex flex-col gap-2">
          <SectionLabel>Testing Tools</SectionLabel>
          <p className="text-xs" style={{ color: colors.inkMuted }}>
            Generate a batch of realistic dummy records — pending registrations, rostered players, or both —
            optionally scored across every rubric, to test rankings, filters, and reports at scale.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button label="Dummy Data" size="sm" onClick={() => setShowTestGen(true)} />
            <Button
              label="Clear Dummy Data"
              size="sm"
              variant="ghost"
              loading={clearTest.isPending}
              onClick={clearTestData}
            />
          </div>
        </Card>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          title={`No ${tab} registrations`}
          message="Share the QR code with athletes and guardians to register."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((item) => {
            const pending = item.status === 'pending';
            const isSelected = pending && selected.has(item.id);
            return (
              <Card key={item.id} className="flex flex-col gap-3" accent={isSelected}>
                <div className="flex items-start gap-3">
                  {/* The tick is its own big click target, so picking a player never
                      opens the profile and opening the profile never picks. */}
                  {pending ? (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      aria-label={`Select ${item.firstName} ${item.lastName}`}
                      onClick={() => toggleSelect(item.id)}
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-lg font-extrabold text-white"
                      style={{
                        borderColor: isSelected ? colors.primary : colors.border,
                        backgroundColor: isSelected ? colors.primary : 'transparent',
                      }}
                    >
                      {isSelected ? '✓' : null}
                    </button>
                  ) : null}

                  {/* Only the identity block opens the profile — the action buttons
                      below stay independently clickable. */}
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col gap-1 text-left"
                    onClick={() => setViewingId(item.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-xl font-bold" style={{ color: colors.ink }}>
                        {item.firstName} {item.lastName}
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <Badge
                          label={item.status}
                          variant={pending ? 'warning' : item.status === 'added' ? 'success' : 'info'}
                        />
                        {item.paymentStatus ? (
                          <Badge
                            label={item.paymentStatus}
                            variant={item.paymentStatus === 'paid' ? 'success' : 'warning'}
                          />
                        ) : null}
                      </span>
                    </div>
                    <span className="truncate text-base" style={{ color: colors.inkMuted }}>
                      {item.guardianName}
                    </span>
                    <span className="truncate text-sm" style={{ color: colors.inkFaint }}>
                      {item.guardianEmail}
                    </span>
                    {item.yearOfBirth || item.positionTryingOutFor ? (
                      <span className="text-sm" style={{ color: colors.inkFaint }}>
                        {[item.yearOfBirth, item.positionTryingOutFor, item.currentTeam].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                    <span className="text-xs" style={{ color: colors.inkFaint }}>
                      Click to view profile
                    </span>
                  </button>
                </div>

                {pending ? (
                  <div className="flex items-center gap-2">
                    {/* With a group ticked the bar below does the adding; repeating
                        "Add 9 to Roster" on every card only made them look alike. */}
                    {selectedIds.length === 0 ? (
                      <div className="flex-1">
                        <Button
                          label="Add to Roster"
                          className="w-full"
                          disabled={dismissReg.isPending && dismissReg.variables === item.id}
                          onClick={() => addFromCard(item.id)}
                        />
                      </div>
                    ) : (
                      <div className="flex-1" />
                    )}
                    <Button
                      label="Dismiss"
                      variant="ghost"
                      loading={dismissReg.isPending && dismissReg.variables === item.id}
                      onClick={() => dismissReg.mutate(item.id)}
                    />
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {/* Sticks to the bottom of the viewport, so the group action stays on
          screen however far down the list the coach has scrolled while ticking
          players. */}
      {tab === 'pending' && selectedIds.length > 0 ? (
        <div
          className="sticky bottom-0 z-10 mt-4 flex items-center gap-3 rounded-xl border px-4 py-4"
          style={{ borderColor: colors.border, backgroundColor: colors.card }}
        >
          <div className="flex-1">
            <p className="font-display text-xl font-bold" style={{ color: colors.ink }}>
              {selectedIds.length} selected
            </p>
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              of {pendingIds.length} pending
            </p>
          </div>
          <Button label="Clear" variant="ghost" onClick={() => setSelected(new Set())} />
          <Button label={`Add ${selectedIds.length}`} onClick={() => setPlacing(selectedIds)} />
        </div>
      ) : null}

      <Modal visible={showQr} title="Registration QR" size="sm" onClose={() => setShowQr(false)}>
        <div className="flex flex-col items-center gap-4 py-4">
          <QrCode value={registrationUrl} size={220} />
          <p className="text-center text-sm" style={{ color: colors.inkMuted }}>
            Scan to register for {tryout.name}
          </p>
          <Badge label={cloudCode} variant="brand" />
          <Input readOnly value={registrationUrl} containerClassName="w-full" onFocus={(e) => e.currentTarget.select()} />
        </div>
      </Modal>

      <Modal
        visible={showSimulate}
        title="Simulate Registration"
        size="lg"
        onClose={() => setShowSimulate(false)}
        hideDefaultFooter
      >
        <RegistrationForm
          loading={submitReg.isPending}
          onSubmit={async (data) => {
            await submitReg.mutateAsync(data);
            setShowSimulate(false);
          }}
        />
      </Modal>

      <DummyDataModal
        variant="assessment"
        maxPlayers={playerRoom(effectiveTier, tryout.roster.length)}
        visible={showTestGen}
        loading={genTest.isPending}
        progress={dummyProgress ?? undefined}
        hasRubrics={hasRubrics}
        onAddRubrics={() => {
          setShowTestGen(false);
          router.push(href('rubrics'));
        }}
        onClose={() => setShowTestGen(false)}
        onSubmit={runGenerate}
      />

      <RegistrationProfileModal
        registration={viewing}
        onClose={() => setViewingId(null)}
        onAddToRoster={
          viewing
            ? () => {
                setViewingId(null);
                setPlacing([viewing.id]);
              }
            : undefined
        }
        onDismiss={
          viewing
            ? () => {
                dismissReg.mutate(viewing.id);
                setViewingId(null);
              }
            : undefined
        }
      />

      <AddToRosterModal
        visible={placing !== null}
        count={placing?.length ?? 0}
        currentTryoutId={id}
        loading={placeRegs.isPending}
        progress={placingProgress ?? undefined}
        onClose={() => setPlacing(null)}
        onConfirm={runPlacement}
      />

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </>
  );
}
