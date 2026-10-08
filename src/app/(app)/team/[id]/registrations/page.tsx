'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import { RegistrationProfileModal } from '@/components/assessment/RegistrationProfileModal';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { PlanGate } from '@/components/PlanGate';
import { QrCode } from '@/components/QrCode';
import { TeamUnavailableState } from '@/components/TeamUnavailableState';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  SectionLabel,
  Tabs,
  useAlert,
} from '@/components/ui';
import { APP_CONFIG } from '@/config/app';
import { isAtPlayerLimit, playersTowardCap } from '@/data/plans';
import {
  useAccountPlayerCount,
  useAddTeamRegistrationsMutation,
  useDismissTeamRegistrationMutation,
  useEnsureTeamRegistrationLinkMutation,
  useSetTeamRegistrationOpenMutation,
  useTeamRegistrationsQuery,
  useTeamRosterAthleteIdsQuery,
  useTeamsQuery,
} from '@/features/queries';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useThemeColors } from '@/theme/ThemeProvider';

type RegTab = 'pending' | 'all' | 'dismissed';

/** Registrations made through a team's own sign-up link, ready to be added to its roster. */
export default function TeamRegistrationsPage() {
  const routeParams = useParams();
  const id = Array.isArray(routeParams?.id) ? routeParams.id[0] : (routeParams?.id as string);
  const colors = useThemeColors();
  const { alert, toast } = useAlert();

  const teamsQuery = useTeamsQuery();
  const team = teamsQuery.data?.find((t) => t.id === id);
  useDocumentTitle(team ? `${team.name} registrations` : undefined);
  const effectiveTier = useEffectivePlanTier(id);
  // Free plans share one pool of players across evaluations and teams.
  const accountPlayers = useAccountPlayerCount(effectiveTier === 'free');
  const rosterIds = useTeamRosterAthleteIdsQuery(id);
  const regsQuery = useTeamRegistrationsQuery(id);
  const ensureLink = useEnsureTeamRegistrationLinkMutation();
  const setOpen = useSetTeamRegistrationOpenMutation();
  const dismissReg = useDismissTeamRegistrationMutation(id);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const addRegs = useAddTeamRegistrationsMutation(id, (done, total) => setProgress({ done, total }));

  const [tab, setTab] = useState<RegTab>('pending');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showQr, setShowQr] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  // The link is created the first time a coach opens this page, so there is
  // always something to share. A team that already has one just reuses it.
  const code = team?.registrationCode;
  useEffect(() => {
    if (team && !code && !ensureLink.isPending && !ensureLink.isError) ensureLink.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, code]);

  const all = useMemo(() => regsQuery.data ?? [], [regsQuery.data]);
  const filtered = useMemo(() => {
    if (tab === 'all') return all;
    if (tab === 'dismissed') return all.filter((r) => r.status === 'dismissed');
    return all.filter((r) => r.status === 'pending');
  }, [all, tab]);
  const viewing = useMemo(() => all.find((r) => r.id === viewingId) ?? null, [all, viewingId]);

  if (teamsQuery.isLoading) return <LoadingState message="Loading registrations..." />;
  if (teamsQuery.isError) return <ErrorState message="Could not load the team." onRetry={() => teamsQuery.refetch()} />;
  if (!team) return <TeamUnavailableState onRetry={() => teamsQuery.refetch()} />;

  const baseUrl =
    APP_CONFIG.webUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://www.tryouthq.ca');
  const registrationUrl = code ? `${baseUrl}/register/${code}` : '';
  const isOpen = team.registrationOpen ?? false;
  const pendingIds = all.filter((r) => r.status === 'pending').map((r) => r.id);
  const pendingIdSet = new Set(pendingIds);
  // Only the ticked registrations that are still pending count: one dismissed
  // or placed after being ticked stays in `selected` and would be sent anyway.
  const selectedIds = [...selected].filter((rid) => pendingIdSet.has(rid));
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every((rid) => selected.has(rid));

  const toggleSelect = (rid: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });

  const copyLink = async () => {
    if (!registrationUrl) return;
    try {
      await navigator.clipboard.writeText(registrationUrl);
      toast('Registration link copied', 'success');
    } catch {
      await alert('Registration link', registrationUrl);
    }
  };

  const emailLink = () => {
    if (!registrationUrl) return;
    const subject = encodeURIComponent(`Register for ${team.name}`);
    const body = encodeURIComponent(
      `Hi,\n\nPlease use this link to register your player for ${team.name}:\n\n${registrationUrl}\n\nThank you.`,
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const toggleOpen = async () => {
    try {
      await setOpen.mutateAsync({ teamId: id, open: !isOpen });
      toast(isOpen ? 'Registration link turned off' : 'Registration link turned on', 'success');
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not change the registration link.');
    }
  };

  const addToTeam = async (ids: string[]) => {
    if (ids.length === 0) return;
    // The player limit is measured against this team's roster; on the Free plan
    // evaluations and teams share one pool, so the account total counts too.
    const existing = rosterIds.data?.length ?? 0;
    if (isAtPlayerLimit(effectiveTier, playersTowardCap(effectiveTier, existing, accountPlayers) + ids.length - 1)) {
      setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'));
      return;
    }
    try {
      setProgress({ done: 0, total: ids.length });
      await addRegs.mutateAsync(ids);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const rid of ids) next.delete(rid);
        return next;
      });
      toast(`${ids.length} player${ids.length === 1 ? '' : 's'} added to ${team.name}`, 'success');
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not add the players.');
    } finally {
      setProgress(null);
    }
  };

  return (
    <>
      <PageHeader title={team.name} subtitle="Registrations" showBack backHref={`/team/${id}`} />

      <PlanGate feature="qrRegistration" title="Registration link (Coach+)" tierOverride={effectiveTier}>
        <Card accent className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <SectionLabel>Registration Code</SectionLabel>
            <p
              className="text-3xl font-bold tracking-[0.2em]"
              style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}
            >
              {code ?? '------'}
            </p>
            <p className="mt-1 text-sm" style={{ color: colors.inkMuted }}>
              Send this link to families so they can register a player for {team.name}.
            </p>
            {code ? (
              <div className="mt-2">
                <Badge label={isOpen ? 'Accepting registrations' : 'Link turned off'} variant={isOpen ? 'success' : 'warning'} />
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button label="Email Link" size="sm" disabled={!code || !isOpen} onClick={emailLink} />
            <Button label="Copy Link" size="sm" variant="secondary" disabled={!code} onClick={copyLink} />
            <Button label="Show QR" size="sm" variant="secondary" disabled={!code} onClick={() => setShowQr(true)} />
            <Button
              label={isOpen ? 'Turn Off' : 'Turn On'}
              size="sm"
              variant="ghost"
              disabled={!code}
              loading={setOpen.isPending}
              onClick={toggleOpen}
            />
          </div>
        </Card>
      </PlanGate>

      {ensureLink.isError ? (
        <ErrorState
          message="Could not create the registration link."
          onRetry={() => ensureLink.mutate(id)}
        />
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { key: 'pending', label: 'Pending', badge: pendingIds.length || undefined },
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
              label={`Add ${selectedIds.length} to Team`}
              size="sm"
              loading={addRegs.isPending}
              onClick={() => addToTeam(selectedIds)}
            />
          ) : null}
        </span>
      </div>

      {regsQuery.isLoading ? (
        <LoadingState message="Loading registrations..." />
      ) : regsQuery.isError ? (
        <ErrorState message="Could not load registrations." onRetry={() => regsQuery.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={`No ${tab} registrations`}
          message="Share the link or QR code with families so they can register."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((item) => {
            const pending = item.status === 'pending';
            const isSelected = pending && selected.has(item.id);
            return (
              <Card key={item.id} className="flex flex-col gap-3" accent={isSelected}>
                <div className="flex items-start gap-3">
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
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col gap-1 text-left"
                    onClick={() => setViewingId(item.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-xl font-bold" style={{ color: colors.ink }}>
                        {item.firstName} {item.lastName}
                      </span>
                      <Badge
                        label={item.status}
                        variant={pending ? 'warning' : item.status === 'added' ? 'success' : 'info'}
                      />
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
                    {selectedIds.length === 0 ? (
                      <div className="flex-1">
                        <Button
                          label="Add to Team"
                          className="w-full"
                          loading={addRegs.isPending && addRegs.variables?.[0] === item.id}
                          onClick={() => addToTeam([item.id])}
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

      {progress ? (
        <p className="mt-3 text-sm" style={{ color: colors.inkMuted }}>
          Adding {progress.done} of {progress.total}...
        </p>
      ) : null}

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
          <Button label={`Add ${selectedIds.length}`} loading={addRegs.isPending} onClick={() => addToTeam(selectedIds)} />
        </div>
      ) : null}

      <Modal visible={showQr} title="Registration QR" size="sm" onClose={() => setShowQr(false)}>
        <div className="flex flex-col items-center gap-4 py-4">
          <QrCode value={registrationUrl} size={220} />
          <p className="text-center text-sm" style={{ color: colors.inkMuted }}>
            Scan to register for {team.name}
          </p>
          {code ? <Badge label={code} variant="brand" /> : null}
          <Input readOnly value={registrationUrl} containerClassName="w-full" onFocus={(e) => e.currentTarget.select()} />
        </div>
      </Modal>

      <RegistrationProfileModal
        addLabel="Add to Team"
        registration={viewing}
        onClose={() => setViewingId(null)}
        onAddToRoster={
          viewing && viewing.status === 'pending'
            ? () => {
                setViewingId(null);
                void addToTeam([viewing.id]);
              }
            : undefined
        }
        onDismiss={
          viewing && viewing.status === 'pending'
            ? () => {
                dismissReg.mutate(viewing.id);
                setViewingId(null);
              }
            : undefined
        }
      />

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </>
  );
}
