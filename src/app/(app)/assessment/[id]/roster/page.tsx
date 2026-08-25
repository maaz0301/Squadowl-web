'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useIsMutating } from '@tanstack/react-query';

import { AddPlayerForm } from '@/components/assessment/AddPlayerForm';
import { DummyDataModal } from '@/components/DummyDataModal';
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
import { canUseFeature, isAtPlayerLimit } from '@/data/plans';
import { playerDisplayName } from '@/data/rubrics';
import type { AddPlayerForm as AddPlayerFormValues } from '@/data/types';
import {
  useAddPlayerMutation,
  useClearTestDataMutation,
  useGenerateTestDataMutation,
  useTryoutQuery,
  useUploadPlayerPhotoMutation,
} from '@/features/queries';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { tryoutBulkWriteKey } from '@/lib/queryClient';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { UsageNudgeBanner } from '@/components/UsageNudgeBanner';
import { useUser } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import { useThemeColors } from '@/theme/ThemeProvider';

export default function RosterPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const router = useRouter();
  const { alert, confirm } = useAlert();
  const tryoutQuery = useTryoutQuery(id);
  const addPlayer = useAddPlayerMutation(id!);
  const uploadPhoto = useUploadPlayerPhotoMutation(id!);
  const [dummyProgress, setDummyProgress] = useState<{ done: number; total: number } | null>(null);
  const genTest = useGenerateTestDataMutation(id!, (done, total) => setDummyProgress({ done, total }));
  const clearTest = useClearTestDataMutation(id!);
  const rosterFilter = useSessionStore((s) => s.rosterFilter);
  const setRosterFilter = useSessionStore((s) => s.setRosterFilter);
  const activeAssessor = useSessionStore((s) => s.activeAssessor);
  const setActiveAssessor = useSessionStore((s) => s.setActiveAssessor);
  const setCurrentPlayer = useSessionStore((s) => s.setCurrentPlayer);
  const user = useUser();
  const [showAdd, setShowAdd] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [showTestGen, setShowTestGen] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [playerSearch, setPlayerSearch] = useState('');
  // A bulk add started from another screen (the Registrations tab's dummy-data
  // dialog, typically) keeps writing players for minutes without this page's
  // query ever refetching — so without checking for it, an in-progress large
  // batch looks exactly like an assessment nobody has added anyone to.
  const bulkWriting = useIsMutating({ mutationKey: tryoutBulkWriteKey(id ?? '') }) > 0;

  const isAssociation = canUseFeature(user?.planTier ?? 'free', 'enterprise');

  useEffect(() => {
    if (tryoutQuery.data && user && !activeAssessor) {
      const me = tryoutQuery.data.assessors.find(
        (a) => (user.email && a.email === user.email) || (user.displayName && a.name === user.displayName),
      );
      if (me) setActiveAssessor(me);
    }
  }, [tryoutQuery.data, user, activeAssessor, setActiveAssessor]);

  const filteredRoster = useMemo(() => {
    if (!tryoutQuery.data) return [];
    const { roster, evals } = tryoutQuery.data;
    const scoredIds = new Set(evals.map((e) => e.playerId));
    let result: typeof roster;
    switch (rosterFilter) {
      case 'scored':
        result = roster.filter((p) => scoredIds.has(p.id));
        break;
      case 'unscored':
        result = roster.filter((p) => !scoredIds.has(p.id));
        break;
      case 'goalies':
        result = roster.filter((p) => p.pos?.toUpperCase() === 'GTL');
        break;
      case 'skaters':
        result = roster.filter((p) => p.pos?.toUpperCase() !== 'GTL');
        break;
      default:
        result = roster;
    }
    const search = playerSearch.trim().toLowerCase();
    if (search) {
      result = result.filter((p) => `${p.first} ${p.last}`.toLowerCase().includes(search));
    }
    return result;
  }, [tryoutQuery.data, rosterFilter, playerSearch]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading roster..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load roster." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;

  const openAdd = () => {
    if (isAtPlayerLimit(user?.planTier ?? 'free', tryout.roster.length)) {
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'players', 'players'));
      return;
    }
    setShowAdd(true);
  };

  // On failure, offers a Retry instead of just dead-ending — re-running this
  // same submit (including the photo-upload follow-up) rather than only the
  // add-player mutation, so a retry that succeeds still finishes the flow.
  const submitAddPlayer = async (data: AddPlayerFormValues) => {
    try {
      const player = await addPlayer.mutateAsync(data);
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
      setShowAdd(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add player.';
      const retry = await confirm({ title: 'Save Error', message, confirmLabel: 'Retry' });
      if (retry) await submitAddPlayer(data);
    }
  };

  const hasPlayers = tryout.roster.length > 0;
  const scoredCount = new Set(tryout.evals.map((e) => e.playerId)).size;
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
      desc: 'Import players from past seasons or other assessments.',
      go: () => router.push(href('roster-library')),
    },
    {
      label: 'Scan Sheet Import',
      desc: 'Import scores from printed OCR scanning sheets.',
      go: () => router.push(href('scan-sheet')),
    },
    ...(isAssociation
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
            tier={user?.planTier ?? 'free'}
            metric="players"
            count={tryout.roster.length}
            label="players in this roster"
          />
          <div className="flex flex-wrap gap-2">
            <Button label="Score Players" onClick={() => router.push(href('rinkside'))} />
            <Button label="+ Add Player" variant="secondary" onClick={openAdd} />
            <Button label="Tools" variant="ghost" onClick={() => setShowTools(true)} />
          </div>

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
            placeholder="Search players by name"
          />

          <div>
            <SectionLabel className="mb-1.5">Show</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {(['all', 'scored', 'unscored', 'skaters', 'goalies'] as const).map((f) => (
                <Chip key={f} label={f} active={rosterFilter === f} onClick={() => setRosterFilter(f)} />
              ))}
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
          message="Add players to this assessment, then you can start scoring."
          actionLabel="+ Add Player"
          onAction={openAdd}
        />
      ) : filteredRoster.length === 0 ? (
        <EmptyState
          title={playerSearch.trim() ? 'No players match' : 'No players match this filter'}
          message={
            playerSearch.trim()
              ? `No players match "${playerSearch.trim()}".`
              : `No ${rosterFilter} players. Try a different filter.`
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
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  setCurrentPlayer(item.id);
                  router.push(href(`player/${item.id}`));
                }}
                className="flex items-center gap-3 rounded-2xl border p-4 text-left transition-transform hover:-translate-y-0.5"
                style={{ backgroundColor: colors.card, borderColor: colors.border }}
              >
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
                  ) : (
                    <Badge label="Unscored" variant="warning" />
                  )}
                  {item.registrationSource === 'qr' ? <Badge label="QR" variant="info" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Modal visible={showAdd} title="Add Player" size="lg" onClose={() => setShowAdd(false)} hideDefaultFooter>
        <AddPlayerForm loading={addPlayer.isPending || uploadPhoto.isPending} onSubmit={submitAddPlayer} />
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

      <DummyDataModal
        variant="assessment"
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
