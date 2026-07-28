'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

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
  LoadingState,
  Modal,
  SectionLabel,
  useAlert,
} from '@/components/ui';
import { canUseFeature, isAtPlayerLimit } from '@/data/plans';
import { playerDisplayName } from '@/data/rubrics';
import {
  useAddPlayerMutation,
  useClearTestDataMutation,
  useGenerateTestDataMutation,
  useTryoutQuery,
  useUploadPlayerPhotoMutation,
} from '@/features/queries';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { useUser } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import { useThemeColors } from '@/theme/ThemeProvider';

export default function RosterPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const router = useRouter();
  const { alert } = useAlert();
  const tryoutQuery = useTryoutQuery(id);
  const addPlayer = useAddPlayerMutation(id!);
  const uploadPhoto = useUploadPlayerPhotoMutation(id!);
  const genTest = useGenerateTestDataMutation(id!);
  const clearTest = useClearTestDataMutation(id!);
  const rosterFilter = useSessionStore((s) => s.rosterFilter);
  const setRosterFilter = useSessionStore((s) => s.setRosterFilter);
  const activeAssessor = useSessionStore((s) => s.activeAssessor);
  const setActiveAssessor = useSessionStore((s) => s.setActiveAssessor);
  const setCurrentPlayer = useSessionStore((s) => s.setCurrentPlayer);
  const user = useUser();
  const [showAdd, setShowAdd] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showTestGen, setShowTestGen] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

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
    switch (rosterFilter) {
      case 'scored':
        return roster.filter((p) => scoredIds.has(p.id));
      case 'unscored':
        return roster.filter((p) => !scoredIds.has(p.id));
      case 'goalies':
        return roster.filter((p) => p.pos?.toUpperCase() === 'GTL');
      case 'skaters':
        return roster.filter((p) => p.pos?.toUpperCase() !== 'GTL');
      default:
        return roster;
    }
  }, [tryoutQuery.data, rosterFilter]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading roster..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load roster." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;

  const openAdd = () => {
    if (isAtPlayerLimit(user?.planTier ?? 'free', tryout.roster.length)) {
      setLimitMsg('You have reached the maximum number of players for your current plan.');
      return;
    }
    setShowAdd(true);
  };

  const hasPlayers = tryout.roster.length > 0;
  const scoredCount = new Set(tryout.evals.map((e) => e.playerId)).size;

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

      {!hasPlayers ? (
        <EmptyState
          title="Add your players to get started"
          message="Add players to this assessment, then you can start scoring."
          actionLabel="+ Add Player"
          onAction={openAdd}
        />
      ) : filteredRoster.length === 0 ? (
        <EmptyState
          title="No players match this filter"
          message={`No ${rosterFilter} players. Try a different filter.`}
          actionLabel="Show all"
          onAction={() => setRosterFilter('all')}
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
        <AddPlayerForm
          loading={addPlayer.isPending || uploadPhoto.isPending}
          onSubmit={async (data) => {
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
              await alert('Save Error', err instanceof Error ? err.message : 'Failed to add player.');
            }
          }}
        />
      </Modal>

      <Modal visible={showTools} title="Tools" onClose={() => setShowTools(false)}>
        {tools.map((t) => (
          <button
            type="button"
            key={t.label}
            onClick={() => {
              setShowTools(false);
              t.go();
            }}
            className="block w-full border-b py-3 text-left"
            style={{ borderColor: colors.border }}
          >
            <span className="block text-base font-bold" style={{ color: colors.ink }}>
              {t.label}
            </span>
            <span className="mt-0.5 block text-sm" style={{ color: colors.inkMuted }}>
              {t.desc}
            </span>
          </button>
        ))}
      </Modal>

      <DummyDataModal
        variant="assessment"
        visible={showTestGen}
        loading={genTest.isPending}
        hasRubrics={(tryout.settings?.customRubrics?.length ?? 0) > 0}
        onAddRubrics={() => {
          setShowTestGen(false);
          router.push(href('rubrics'));
        }}
        onClose={() => setShowTestGen(false)}
        onSubmit={async (options) => {
          try {
            const res = await genTest.mutateAsync(options);
            setShowTestGen(false);
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
          }
        }}
      />
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </>
  );
}
