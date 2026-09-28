'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useIsMutating } from '@tanstack/react-query';

import { AddPlayerForm, type ExtraFamilyContact } from '@/components/assessment/AddPlayerForm';
import { DeleteProgressModal } from '@/components/DeleteProgressModal';
import { DummyDataModal } from '@/components/DummyDataModal';
import { ImportPlayersModal } from '@/components/roster/ImportPlayersModal';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import {
  Avatar,
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  SectionLabel,
  Spinner,
  useAlert,
} from '@/components/ui';
import { isAtPlayerLimit, playerRoom } from '@/data/plans';
import { useCanUseDummyData } from '@/features/useCanUseDummyData';
import { isInPositionGroup, rosterPositionGroups } from '@/data/positions';
import { playerDisplayName } from '@/data/rubrics';
import { getDataSource } from '@/data';
import type { AddPlayerForm as AddPlayerFormValues } from '@/data/types';
import {
  useAddPlayerMutation,
  useDeletePlayersMutation,
  useImportTryoutPlayersMutation,
  useClearTestDataMutation,
  useGenerateTestDataMutation,
  useSessionProgressQuery,
  useTryoutQuery,
  useTryoutRosterInvitesMutation,
  useUploadPlayerPhotoMutation,
} from '@/features/queries';
import { useAssessmentHref, useAssessmentId, useIsAssessorOnly } from '@/features/useAssessmentId';
import { useCompleteAssessing } from '@/features/useCompleteAssessing';
import { describeInviteResult, inviteNeedsAttention } from '@/lib/inviteResult';
import { tryoutBulkWriteKey } from '@/lib/queryClient';
import { capImportRows, dropExistingPlayers, withSkippedRows } from '@/data/bulkTeamImport';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { UsageNudgeBanner } from '@/components/UsageNudgeBanner';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { useUser, usePermissions } from '@/state/authStore';
import { useSessionStore, type RosterFilter } from '@/state/sessionStore';
import { useThemeColors } from '@/theme/ThemeProvider';

export default function RosterPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const router = useRouter();
  const { alert, confirm } = useAlert();
  const tryoutQuery = useTryoutQuery(id);
  // A team someone else owns is run on that team's plan, not the viewer's own.
  const effectiveTier = useEffectivePlanTier(tryoutQuery.data?.teamId);
  const isAssessorOnly = useIsAssessorOnly(tryoutQuery.data?.viewerIsOwner);
  const { canComplete, completing, complete } = useCompleteAssessing(tryoutQuery.data);
  const addPlayer = useAddPlayerMutation(id!);
  const inviteParticipant = useTryoutRosterInvitesMutation(id!);
  const importPlayers = useImportTryoutPlayersMutation(id!);
  const uploadPhoto = useUploadPlayerPhotoMutation(id!);
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);
  const deletePlayers = useDeletePlayersMutation(id!, (done, total) => setDeleteProgress({ done, total }));
  const [dummyProgress, setDummyProgress] = useState<{ done: number; total: number } | null>(null);
  const genTest = useGenerateTestDataMutation(id!, (done, total) => setDummyProgress({ done, total }));
  const clearTest = useClearTestDataMutation(id!);
  const rosterFilter = useSessionStore((s) => s.rosterFilter);
  const setRosterFilter = useSessionStore((s) => s.setRosterFilter);
  // The filter lives in the persisted session store, so without this a
  // "Scored" pick on one evaluation greets the next (or a fresh, all-unscored
  // one) with "No players match".
  useEffect(() => {
    setRosterFilter('all');
  }, [id, setRosterFilter]);
  const activeAssessor = useSessionStore((s) => s.activeAssessor);
  const setActiveAssessor = useSessionStore((s) => s.setActiveAssessor);
  const setCurrentPlayer = useSessionStore((s) => s.setCurrentPlayer);
  const user = useUser();
  const { canAssess } = usePermissions();
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [showTestGen, setShowTestGen] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [playerSearch, setPlayerSearch] = useState('');
  // 'recent' leaves the roster in whatever order the read returned (the order
  // players were added); 'name'/'age' sort it client-side — the whole roster
  // is already in memory here, unlike the paginated team roster, so no extra
  // read is needed.
  const [rosterSort, setRosterSort] = useState<'recent' | 'name' | 'age'>('recent');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  // A bulk add started from another screen (the Registrations tab's dummy-data
  // dialog, typically) keeps writing players for minutes without this page's
  // query ever refetching — so without checking for it, an in-progress large
  // batch looks exactly like an assessment nobody has added anyone to.
  const bulkWriting = useIsMutating({ mutationKey: tryoutBulkWriteKey(id ?? '') }) > 0;

  // An invited assessor scores; they don't seed data into the owner's evaluation.
  // Their own plan tier says nothing about that, so the tier alone must not
  // decide it now that the tools are no longer Association-only.
  const showDummyTools = useCanUseDummyData(effectiveTier) && !isAssessorOnly;

  useEffect(() => {
    if (tryoutQuery.data && user && !activeAssessor) {
      const me = tryoutQuery.data.assessors.find(
        (a) => (user.email && a.email === user.email) || (user.displayName && a.name === user.displayName),
      );
      if (me) setActiveAssessor(me);
    }
  }, [tryoutQuery.data, user, activeAssessor, setActiveAssessor]);

  // An assessor reads back none of the assessment's evaluations — scoring is
  // blind, so get_evaluations_for_tryouts() only returns rows to account staff
  // — and off `evals` alone every player they've just scored still counts as
  // unscored. For them "scored" comes from the session-progress RPC instead:
  // which players have a session saved, and nothing about the scores.
  const sessionProgressQuery = useSessionProgressQuery(id, isAssessorOnly);
  const scoredIds = useMemo(() => {
    const ids = new Set((tryoutQuery.data?.evals ?? []).map((e) => e.playerId));
    if (isAssessorOnly) {
      for (const [playerId, maxSession] of Object.entries(sessionProgressQuery.data ?? {})) {
        if (maxSession > 0) ids.add(playerId);
      }
    }
    return ids;
  }, [tryoutQuery.data?.evals, isAssessorOnly, sessionProgressQuery.data]);

  const positionGroups = useMemo(
    () => (tryoutQuery.data ? rosterPositionGroups(tryoutQuery.data.sport, tryoutQuery.data.roster) : []),
    [tryoutQuery.data],
  );
  // The filter is remembered across assessments, so a hockey one can leave
  // "Goalies" selected on a basketball roster that has no such category.
  const activeGroup = positionGroups.find((g) => `pos:${g.key}` === rosterFilter);
  const activeFilter: RosterFilter =
    rosterFilter === 'all' || rosterFilter === 'scored' || rosterFilter === 'unscored' || activeGroup
      ? rosterFilter
      : 'all';

  const filteredRoster = useMemo(() => {
    if (!tryoutQuery.data) return [];
    const { roster } = tryoutQuery.data;
    let result: typeof roster;
    switch (activeFilter) {
      case 'scored':
        result = roster.filter((p) => scoredIds.has(p.id));
        break;
      case 'unscored':
        result = roster.filter((p) => !scoredIds.has(p.id));
        break;
      case 'all':
        result = roster;
        break;
      default: {
        const group = positionGroups.find((g) => `pos:${g.key}` === activeFilter);
        result = group ? roster.filter((p) => isInPositionGroup(group, p.pos)) : roster;
      }
    }
    const search = playerSearch.trim().toLowerCase();
    if (search) {
      // Jersey number too, not just name: a coach scanning a bench sheet reads
      // numbers first, and on a roster in the hundreds "who's #59" is a much
      // faster search than spelling a last name right on the first try.
      result = result.filter(
        (p) => `${p.first} ${p.last}`.toLowerCase().includes(search) || p.jersey?.toLowerCase().includes(search),
      );
    }
    if (rosterSort === 'name') {
      result = [...result].sort((a, b) => a.first.localeCompare(b.first) || a.last.localeCompare(b.last));
    } else if (rosterSort === 'age') {
      // Oldest first, the usual reading order for a roster sorted "by age". A
      // missing/unparseable birth year sinks to the bottom on either sort
      // rather than being guessed at as oldest.
      const year = (p: (typeof result)[number]) => {
        const n = parseInt(p.yearOfBirth ?? '', 10);
        return Number.isFinite(n) ? n : null;
      };
      result = [...result].sort((a, b) => {
        const ay = year(a);
        const by = year(b);
        if (ay == null) return by == null ? 0 : 1;
        if (by == null) return -1;
        return ay - by;
      });
    }
    return result;
  }, [tryoutQuery.data, activeFilter, playerSearch, rosterSort, scoredIds, positionGroups]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading roster..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load roster." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;

  const openAdd = () => {
    if (isAtPlayerLimit(effectiveTier, tryout.roster.length)) {
      setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'));
      return;
    }
    setShowAdd(true);
  };

  // Same plan gate as adding one by hand — a spreadsheet is a faster way onto
  // the roster, not a way around the cap.
  const openImport = () => {
    if (isAtPlayerLimit(effectiveTier, tryout.roster.length)) {
      setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'));
      return;
    }
    setShowImport(true);
  };

  // On failure, offers a Retry instead of just dead-ending — re-running this
  // same submit (including the photo-upload follow-up) rather than only the
  // add-player mutation, so a retry that succeeds still finishes the flow.
  //
  // Saving a player here now links them to the portal too, same as adding one
  // to a season or team roster — until now an assessor could add a player with
  // a guardian email and that guardian had no way in at all, since a tryout
  // roster had no invite mechanism of any kind. `inviteEmails` is what the
  // form's Invite toggles marked, when this form shows them; without it every
  // address the player has on file is mailed.
  const submitAddPlayer = async (
    data: AddPlayerFormValues,
    inviteEmails?: string[],
    extraFamilyContacts?: ExtraFamilyContact[],
  ) => {
    let player: Awaited<ReturnType<typeof addPlayer.mutateAsync>>;
    try {
      player = await addPlayer.mutateAsync(data);
      // A freshly picked file is a blob: URL until it's uploaded to storage.
      if (player.athleteId && data.avatarUrl?.startsWith('blob:')) {
        try {
          await uploadPhoto.mutateAsync({
            athleteId: player.athleteId,
            fileUri: data.avatarUrl,
            fileType: 'image/jpeg',
          });
        } catch (e) {
          await alert(
            'Upload Error',
            `Failed to upload profile picture: ${e instanceof Error ? e.message : 'Unknown error'}`,
          );
        }
      }
      const contacts = (extraFamilyContacts ?? []).filter((c) => c.name.trim() || c.email.trim());
      if (player.athleteId && contacts.length > 0) {
        try {
          await Promise.all(
            contacts.map((c) =>
              getDataSource().addFamilyContact(player.athleteId!, { name: c.name || c.email, email: c.email || undefined }),
            ),
          );
        } catch (e) {
          await alert(
            'Family Members Not Saved',
            `The player was saved, but the additional family members couldn't be added: ${e instanceof Error ? e.message : 'Unknown error'}`,
          );
        }
      }
      setShowAdd(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add player.';
      const retry = await confirm({ title: 'Save Error', message, confirmLabel: 'Retry' });
      if (retry) await submitAddPlayer(data, inviteEmails, extraFamilyContacts);
      return;
    }

    // Its own try/catch, deliberately outside the one above: the player is on
    // the roster whatever the invite does, and a failed send here must never
    // trigger the Retry path above — that would re-run addPlayer and create a
    // second participant. Only a bounce or a guardian with no address on file
    // is worth a dialog; a send that simply worked stays quiet.
    try {
      const result = await inviteParticipant.mutateAsync({
        participantIds: [player.id],
        emails: inviteEmails,
      });
      if (inviteNeedsAttention(result)) {
        const { title, message } = describeInviteResult(result);
        await alert(title, message);
      }
    } catch (e) {
      await alert(
        'Invite Not Sent',
        `${`${data.first} ${data.last}`.trim()} was added to the roster, but the portal invite could not be sent: ${
          e instanceof Error ? e.message : 'Unknown error'
        }`,
      );
    }
  };

  const hasPlayers = tryout.roster.length > 0;
  const scoredCount = tryout.roster.filter((p) => scoredIds.has(p.id)).length;
  // A background refetch keeps rendering the *previous* cached tryout, which
  // right after a bulk add (dummy data, or registrations placed onto the
  // roster) is still the empty one — `isLoading` is false the whole time
  // because data technically exists. So an empty roster while a fetch or a
  // bulk write is in flight means "not known yet", not "no players".
  const rosterPending = !hasPlayers && (tryoutQuery.isFetching || bulkWriting);

  const tools = [
    {
      label: 'Team Builder',
      desc: 'Auto-split scored players into balanced teams.',
      go: () => router.push(href('team-builder')),
    },
    {
      label: 'Roster Library',
      desc: 'Import players from past seasons or other evaluations.',
      go: () => router.push(href('roster-library')),
    },
    {
      label: 'Scan Sheet Import',
      desc: 'Import scores from printed OCR scanning sheets.',
      go: () => router.push(href('scan-sheet')),
    },
    {
      label: 'Player Selection Letters',
      desc: 'Create and send offer or roster decision letters, with a copy attached to each player.',
      go: () => router.push(href('letters')),
    },
    ...(showDummyTools
      ? [
          {
            label: 'Dummy Data Generator',
            desc: 'Generate a batch of realistic dummy players with optional scoring data across rubrics.',
            go: () => setShowTestGen(true),
          },
          {
            label: 'Clear Dummy Data',
            desc: 'Remove all generated dummy players and evaluation scores.',
            go: async () => {
              try {
                const res = await clearTest.mutateAsync();
                await alert(
                  'Cleared',
                  `Removed ${res.removed} generated record${res.removed === 1 ? '' : 's'}.`,
                );
              } catch (e) {
                await alert('Error', e instanceof Error ? e.message : 'Failed to clear dummy data.');
              }
            },
          },
        ]
      : []),
  ];

  return (
    <>
      {hasPlayers ? (
        <div className="mb-5 flex flex-col gap-4">
          <UsageNudgeBanner
            tier={effectiveTier}
            metric="players"
            count={tryout.roster.length}
            label="players in this roster"
          />
          {selectMode ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                label="← Back"
                variant="ghost"
                onClick={() => {
                  setSelectMode(false);
                  setSelectedIds(new Set());
                }}
              />
              <Button
                label={selectedIds.size === filteredRoster.length ? 'Deselect All' : 'Select All'}
                variant="secondary"
                onClick={() =>
                  setSelectedIds(
                    selectedIds.size === filteredRoster.length
                      ? new Set()
                      : new Set(filteredRoster.map((p) => p.id)),
                  )
                }
              />
              <Button
                label={`Delete Selected${selectedIds.size ? ` (${selectedIds.size})` : ''}`}
                variant="danger"
                disabled={selectedIds.size === 0}
                loading={deletingSelected}
                onClick={async () => {
                  const ids = [...selectedIds];
                  const ok = await confirm({
                    title: 'Delete players?',
                    message: `${ids.length} player${ids.length === 1 ? '' : 's'} will be permanently removed from this roster.`,
                    confirmLabel: 'Delete',
                    destructive: true,
                  });
                  if (!ok) return;
                  setDeleteProgress({ done: 0, total: ids.length });
                  setDeletingSelected(true);
                  try {
                    const { deleted, failed } = await deletePlayers.mutateAsync(ids);
                    if (failed.length === 0) {
                      setSelectedIds(new Set());
                      setSelectMode(false);
                    } else {
                      // Keep only the players that are still on the roster selected,
                      // so a retry goes straight at what is left.
                      const gone = new Set(deleted);
                      setSelectedIds(new Set(ids.filter((pid) => !gone.has(pid))));
                      await alert(
                        'Some Players Were Not Deleted',
                        `${deleted.length} of ${ids.length} deleted. ${failed.length} could not be removed: ${failed[0].message}`,
                      );
                    }
                  } catch (e) {
                    await alert('Delete Failed', e instanceof Error ? e.message : 'Could not delete the selected players.');
                  } finally {
                    setDeletingSelected(false);
                    setDeleteProgress(null);
                  }
                }}
              />
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button label="Score Players" onClick={() => router.push(href('rinkside'))} />
              <Button label="+ Add Player" variant="secondary" onClick={openAdd} />
              <Button label="Import from File" variant="secondary" onClick={openImport} />
              <Button label="Select" variant="secondary" onClick={() => setSelectMode(true)} />
              <Button label="Tools" variant="ghost" onClick={() => setShowTools(true)} />
              {canComplete ? (
                <Button
                  label="Complete Assessing"
                  variant="secondary"
                  onClick={() => complete()}
                  loading={completing}
                />
              ) : null}
            </div>
          )}

          {tryout.assessors.length > 0 ? (
            <div>
              <SectionLabel className="mb-1.5">Scoring as</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {tryout.assessors.map((a, i) => {
                  const isMe = !!(
                    (user?.email && a.email === user.email) ||
                    (user?.displayName && a.name === user.displayName)
                  );
                  const tags: string[] = [];
                  if (isMe) tags.push('You');
                  if (a.role === 'lead') tags.push('Owner');
                  const label = tags.length ? `${a.name} (${tags.join(', ')})` : a.name;
                  const isActive = activeAssessor?.name === a.name && activeAssessor?.email === a.email;

                  return (
                    <Chip
                      key={`${a.name}-${a.email}-${i}`}
                      label={label}
                      active={isActive}
                      highlight={isMe}
                      onClick={() => setActiveAssessor(isActive ? null : a)}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}

          <Input
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
            placeholder="Search players by name or jersey #"
          />

          <div>
            <SectionLabel className="mb-1.5">Show</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {(['all', 'scored', 'unscored'] as const).map((f) => (
                <Chip key={f} label={f} active={activeFilter === f} onClick={() => setRosterFilter(f)} />
              ))}
              {positionGroups.map((g) => (
                <Chip
                  key={g.key}
                  label={g.label}
                  active={activeFilter === `pos:${g.key}`}
                  onClick={() => setRosterFilter(`pos:${g.key}`)}
                />
              ))}
            </div>
          </div>

          <div>
            <SectionLabel className="mb-1.5">Sort</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <Chip label="Recent" active={rosterSort === 'recent'} onClick={() => setRosterSort('recent')} />
              <Chip label="A–Z" active={rosterSort === 'name'} onClick={() => setRosterSort('name')} />
              <Chip label="Age" active={rosterSort === 'age'} onClick={() => setRosterSort('age')} />
            </div>
          </div>

          <p className="text-sm" style={{ color: colors.inkMuted }}>
            {tryout.roster.length} player{tryout.roster.length === 1 ? '' : 's'} · {scoredCount} scored
          </p>
        </div>
      ) : null}

      {rosterPending ? (
        <LoadingState message={bulkWriting ? 'Adding players...' : 'Loading roster...'} />
      ) : !hasPlayers ? (
        <EmptyState
          title="Add your players to get started"
          message="Add players to this evaluation, then you can start scoring."
          actionLabel="+ Add Player"
          onAction={openAdd}
          secondaryActionLabel="Import from File"
          onSecondaryAction={openImport}
        />
      ) : filteredRoster.length === 0 ? (
        <EmptyState
          title={playerSearch.trim() ? 'No players match' : 'No players match this filter'}
          message={
            playerSearch.trim()
              ? `No players match "${playerSearch.trim()}".`
              : activeGroup && activeFilter !== 'all'
                ? `No players under ${activeGroup.label}. Try a different filter.`
                : `No ${activeFilter} players. Try a different filter.`
          }
          actionLabel={playerSearch.trim() ? 'Clear search' : 'Show all'}
          onAction={() => {
            if (playerSearch.trim()) setPlayerSearch('');
            else setRosterFilter('all');
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filteredRoster.map((item) => {
            const evalCount = tryout.evals.filter((e) => e.playerId === item.id).length;
            const isSelected = selectedIds.has(item.id);
            const toggleSelected = () =>
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              });
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  if (selectMode) {
                    toggleSelected();
                    return;
                  }
                  setCurrentPlayer(item.id);
                  router.push(href(`player/${item.id}`));
                }}
                className="flex items-center gap-3 rounded-2xl border p-4 text-left transition-transform hover:-translate-y-0.5"
                style={{
                  backgroundColor: colors.card,
                  borderColor: isSelected ? colors.primary : colors.border,
                }}
              >
                {selectMode ? (
                  // A plain indicator, not the interactive Checkbox — this
                  // whole row is already a button that toggles selection, and
                  // nesting another focusable control inside it would double-fire.
                  <span
                    aria-hidden
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border text-[12px] font-bold text-white"
                    style={{
                      borderColor: isSelected ? colors.primary : colors.border,
                      backgroundColor: isSelected ? colors.primary : 'transparent',
                    }}
                  >
                    {isSelected ? '✓' : ''}
                  </span>
                ) : null}
                <Avatar first={item.first} last={item.last} pos={item.pos} uri={item.avatarUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-bold" style={{ color: colors.ink }}>
                    {playerDisplayName(item)}
                  </span>
                  <span className="block text-sm" style={{ color: colors.inkMuted }}>
                    #{item.jersey ?? '—'} · {item.pos ?? '—'}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  {evalCount > 0 ? (
                    <Badge label={`${evalCount} eval${evalCount > 1 ? 's' : ''}`} variant="success" />
                  ) : isAssessorOnly ? null : (
                    <Badge label="Unscored" variant="warning" />
                  )}
                  {item.registrationSource === 'qr' ? <Badge label="QR" variant="info" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <ImportPlayersModal
        visible={showImport}
        onClose={() => setShowImport(false)}
        target={tryout.name}
        atLimit={isAtPlayerLimit(effectiveTier, tryout.roster.length)}
        onLimitReached={() => setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'))}
        onImport={async (rows, onProgress) => {
          // A spreadsheet is a faster way onto the roster, not a way around the
          // plan's player cap: players already here are set aside first (they add
          // nobody, so they shouldn't spend the cap), then what fits goes in and
          // the rest is listed as not added.
          const { fresh, duplicates } = dropExistingPlayers(rows, tryout.roster);
          const capped = capImportRows(fresh, playerRoom(effectiveTier, tryout.roster.length));
          const allowed = capped.allowed;
          const skipped = [...duplicates, ...capped.skipped];
          if (allowed.length === 0) {
            return withSkippedRows({ added: 0, failed: [], athleteIds: [], participantIds: [] }, skipped);
          }
          const result = withSkippedRows(await importPlayers.mutateAsync({ rows: allowed, onProgress }), skipped);
          // The mutation only marks the roster stale; on a capped plan, wait for
          // the fresh count so the "Import more" check that follows never runs
          // against the old one. Unlimited plans have no such check, so they
          // don't wait on a full roster re-read (a thousand players is seconds).
          if (Number.isFinite(playerRoom(effectiveTier, 0))) {
            await tryoutQuery.refetch({ cancelRefetch: false });
          }
          // Same rule as adding one by hand above, and as the team import: the
          // import is what earns the portal invite, so a spreadsheet of players
          // with guardian emails links them all without anyone opening thirty
          // profiles. Scoped to the rows the import actually landed, so a
          // re-import doesn't re-mail the players already there.
          //
          // No dialog on the way out, unlike the manual add: the modal shows
          // its own per-row import summary the moment this returns, and a
          // second dialog in front of it — "no email on file for these four" —
          // buries the one the coach is waiting for.
          if (result.participantIds?.length) {
            try {
              await inviteParticipant.mutateAsync({ participantIds: result.participantIds });
            } catch (e) {
              console.warn('Portal invites failed after a roster import:', e);
            }
          }
          return result;
        }}
      />

      <Modal visible={showAdd} title="Add Player" size="lg" onClose={() => setShowAdd(false)} hideDefaultFooter>
        <AddPlayerForm
          loading={addPlayer.isPending || uploadPhoto.isPending || inviteParticipant.isPending}
          sport={tryout.sport}
          showFamilyContacts={canAssess}
          onSubmit={submitAddPlayer}
          submitLabel="Save Player & Send Invite"
        />
      </Modal>

      <Modal visible={showTools} title="Tools" onClose={() => setShowTools(false)}>
        {tools.map((t) => (
          <button
            type="button"
            key={t.label}
            disabled={runningTool !== null}
            onClick={async () => {
              setRunningTool(t.label);
              try {
                await t.go();
              } finally {
                setRunningTool(null);
                setShowTools(false);
              }
            }}
            className="flex w-full items-center justify-between gap-3 border-b py-3 text-left disabled:opacity-50"
            style={{ borderColor: colors.border }}
          >
            <span>
              <span className="block text-base font-bold" style={{ color: colors.ink }}>
                {t.label}
              </span>
              <span className="mt-0.5 block text-sm" style={{ color: colors.inkMuted }}>
                {t.desc}
              </span>
            </span>
            {runningTool === t.label ? <Spinner size={18} /> : null}
          </button>
        ))}
      </Modal>

      <DeleteProgressModal visible={deletingSelected} progress={deleteProgress} />

      <DummyDataModal
        variant="assessment"
        maxPlayers={playerRoom(effectiveTier, tryout.roster.length)}
        visible={showTestGen}
        loading={genTest.isPending}
        progress={dummyProgress ?? undefined}
        hasRubrics={(tryout.settings?.customRubrics?.length ?? 0) > 0}
        onAddRubrics={() => {
          setShowTestGen(false);
          router.push(href('rubrics'));
        }}
        onClose={() => setShowTestGen(false)}
        onSubmit={async (options) => {
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
            const msg =
              e instanceof Error && e.message === 'NO_RUBRICS'
                ? 'Add at least one rubric before generating scored players.'
                : e instanceof Error
                  ? e.message
                  : 'Failed to generate dummy data.';
            await alert('Error', msg);
          } finally {
            // In `finally`, not after the await: generateTestData writes
            // incrementally, so a partial run still created real rows and the
            // modal must not stay open over a stale form.
            setShowTestGen(false);
            setDummyProgress(null);
          }
        }}
      />
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </>
  );
}
