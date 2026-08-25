'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { usePermissions } from '@/state/authStore';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  SectionLabel,
  Spinner,
  useAlert,
} from '@/components/ui';
import {
  useTryoutQuery,
  useUpdatePlayerMutation,
  useDeletePlayerMutation,
  useAiPlayerSummaryMutation,
  useLinkGuardianMutation,
  useInviteMemberMutation,
  useResendInviteMutation,
  useCreateAndInviteMemberMutation,
  useUploadPlayerPhotoMutation,
} from '@/features/queries';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { playerDisplayName, weightedOverall, getPlayerCategories, isGoaliePosition } from '@/data/rubrics';
import { AddPlayerForm } from '@/components/assessment/AddPlayerForm';
import { PlanGate } from '@/components/PlanGate';
import { mockAiPlayerSummary } from '@/data/teamBuilder';

const AI_IDLE_TEXT = 'Generating...';
const AI_LOADING_TEXTS = ['Gathering data...', 'Ranking evaluations...', 'Analyzing strengths...', 'Finalizing insight...'];

export default function PlayerHubPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const params = useParams();
  const playerId = Array.isArray(params?.playerId) ? params.playerId[0] : (params?.playerId as string);
  const colors = useThemeColors();
  const router = useRouter();
  const { alert, confirm } = useAlert();

  const tryoutQuery = useTryoutQuery(id);
  const updatePlayer = useUpdatePlayerMutation(id!);
  const deletePlayer = useDeletePlayerMutation(id!);
  const uploadPhoto = useUploadPlayerPhotoMutation(id!);
  const aiSummary = useAiPlayerSummaryMutation(id!);

  const linkGuardianMut = useLinkGuardianMutation();
  const inviteMut = useInviteMemberMutation();
  const resendInviteMut = useResendInviteMutation();
  const createAndInviteMut = useCreateAndInviteMemberMutation();

  const [showEdit, setShowEdit] = useState(false);
  const [showGuardianLink, setShowGuardianLink] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiTextIndex, setAiTextIndex] = useState(0);

  // The interval is a real external-system subscription (a timer), so it
  // stays an effect — but nothing in the effect body sets state synchronously
  // on mount/dependency-change; the index only advances inside the interval
  // callback, and the idle case is handled by deriving aiLoadingText below
  // instead of resetting state here.
  useEffect(() => {
    if (!aiSummary.isPending) return;
    const int = setInterval(() => setAiTextIndex((i) => i + 1), 2500);
    return () => clearInterval(int);
  }, [aiSummary.isPending]);

  const aiLoadingText = aiSummary.isPending
    ? AI_LOADING_TEXTS[aiTextIndex % AI_LOADING_TEXTS.length]
    : AI_IDLE_TEXT;

  const player = tryoutQuery.data?.roster.find((p) => p.athleteId === playerId || p.id === playerId);
  const { canManageTeam } = usePermissions();

  const categories = useMemo(() => {
    if (!tryoutQuery.data || !player) return [];
    return getPlayerCategories(tryoutQuery.data.sport, player.pos, tryoutQuery.data.settings.customRubrics);
  }, [tryoutQuery.data, player]);

  const weights = useMemo(() => {
    if (!tryoutQuery.data || !player) return {};
    return isGoaliePosition(player.pos)
      ? tryoutQuery.data.settings.goalieWeights
      : tryoutQuery.data.settings.skaterWeights;
  }, [tryoutQuery.data, player]);

  if (tryoutQuery.isLoading) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Player not found." onRetry={() => tryoutQuery.refetch()} />;
  }
  if (!player) return <EmptyState title="Player not found" />;

  const tryout = tryoutQuery.data;
  const evals = tryout.evals.filter((e) => e.playerId === playerId).sort((a, b) => b.createdAt - a.createdAt);
  const heuristic = mockAiPlayerSummary(tryout, playerId);
  const deepDive = tryout.aiAssessments?.[playerId];

  const runAi = async () => {
    try {
      await aiSummary.mutateAsync(playerId);
      setAiError(null);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Failed to generate AI summary');
    }
  };

  const recreateGuardian = async () => {
    try {
      // Re-create the account first and only re-point the athlete's link once
      // that succeeds — linkGuardianMut overwrites whatever guardian_user_id
      // was there before in a single UPDATE, so there's no need to null it out
      // first. Unlinking up front used to mean a transient failure in the
      // create step left the athlete with no guardian link at all instead of
      // just keeping the old (still-broken) one until a retry succeeds.
      const defaultPassword = Math.random().toString(36).slice(-6) + 'Aa1!';
      const newMember = await createAndInviteMut.mutateAsync({
        email: player.guardianEmail!,
        password: defaultPassword,
        name: player.guardianName || 'Guardian',
        role: 'guardian',
      });
      await linkGuardianMut.mutateAsync({
        guardianId: newMember.userId!,
        tryoutId: id!,
        playerId: player.athleteId!,
      });
      await alert(
        'Guardian Re-created',
        `An account was created for ${player.guardianEmail} and an email was sent containing their temporary password:\n\n${defaultPassword}`,
      );
    } catch (createErr) {
      await alert(
        'Invite Failed',
        createErr instanceof Error ? createErr.message : 'Could not re-create guardian account.',
      );
    }
  };

  const resendInvite = async () => {
    try {
      await resendInviteMut.mutateAsync({
        userId: player.linkedGuardianId!,
        email: player.guardianEmail!,
        role: 'guardian',
      });
      await alert('Invite Sent', `Resent invite to ${player.guardianEmail} with a new temporary password.`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (
        msg.includes('User not found') ||
        msg.includes('not found') ||
        msg.includes('Database error') ||
        msg.includes('finding user')
      ) {
        const ok = await confirm({
          title: 'Invite Failed',
          message: 'This login account no longer exists. Would you like to unlink it and send a new invite?',
          confirmLabel: 'Re-invite',
        });
        if (ok) await recreateGuardian();
      } else {
        await alert('Invite Failed', msg || 'Could not resend invite.');
      }
    }
  };

  const linkGuardian = async () => {
    const email = player.guardianEmail!;
    try {
      const member = await inviteMut.mutateAsync({ email, role: 'guardian' });
      await linkGuardianMut.mutateAsync({
        guardianId: member.userId!,
        tryoutId: id!,
        playerId: player.athleteId!,
      });
      setShowGuardianLink(false);
      await alert('Success', 'Guardian account linked and invitation sent successfully.');
    } catch (error) {
      if (error instanceof Error && error.message?.includes('User not found')) {
        try {
          const defaultPassword = Math.random().toString(36).slice(-6) + 'Aa1!';
          const newMember = await createAndInviteMut.mutateAsync({
            email,
            password: defaultPassword,
            name: player.guardianName || 'Guardian',
            role: 'guardian',
          });
          await linkGuardianMut.mutateAsync({
            guardianId: newMember.userId!,
            tryoutId: id!,
            playerId: player.athleteId!,
          });
          setShowGuardianLink(false);
          await alert(
            'Guardian Created',
            `An account was created for ${email} and an email was sent to them containing their temporary password:\n\n${defaultPassword}`,
          );
        } catch (createErr) {
          await alert(
            'Invite Failed',
            createErr instanceof Error ? createErr.message : 'Could not auto-create guardian account.',
          );
        }
      } else {
        await alert('Invite Failed', error instanceof Error ? error.message : 'Could not link guardian.');
      }
    }
  };

  const aiNotice = aiError ? (
    <div className="mt-3 rounded-xl p-3" style={{ backgroundColor: colors.tile }}>
      <p className="font-bold" style={{ color: colors.ink }}>
        Notice
      </p>
      <p className="mt-1" style={{ color: colors.inkMuted }}>
        {aiError.toLowerCase().includes('key') || aiError.toLowerCase().includes('developed')
          ? 'This feature relies on an API key that is currently missing or in development. It will be built out soon.'
          : aiError}
      </p>
      <Button
        label="Retry"
        size="sm"
        variant="secondary"
        className="mt-2"
        onClick={() => {
          setAiError(null);
          aiSummary.mutate(playerId);
        }}
      />
    </div>
  ) : null;

  return (
    <>
      <PageHeader
        title={playerDisplayName(player)}
        subtitle={`#${player.jersey ?? '—'} · ${player.pos ?? '—'}`}
        showBack
        backHref={href('roster')}
        right={
          <>
            <Button label="Score Player" onClick={() => router.push(href(`score/${playerId}`))} />
            {canManageTeam ? <Button label="Edit" variant="secondary" onClick={() => setShowEdit(true)} /> : null}
          </>
        }
      />

      <div className="grid min-w-0 gap-5 lg:grid-cols-[280px_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="flex flex-col items-center gap-2 py-6">
            <Avatar first={player.first} last={player.last} pos={player.pos} size={88} uri={player.avatarUrl} />
            <span className="text-lg font-bold" style={{ color: colors.ink }}>
              {playerDisplayName(player)}
            </span>
            <span className="text-sm" style={{ color: colors.inkMuted }}>
              #{player.jersey ?? '—'} · {player.pos ?? '—'}
            </span>
            {player.registrationSource === 'qr' ? <Badge label="QR Registered" variant="info" /> : null}
            {player.yearOfBirth ? <Badge label={`Born ${player.yearOfBirth}`} /> : null}
          </Card>

          <Card className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>Guardian Access</SectionLabel>
              {player.linkedGuardianId ? <Badge label="Linked" variant="success" /> : null}
            </div>

            {player.guardianName ? (
              <span className="break-words" style={{ color: colors.ink }}>{player.guardianName}</span>
            ) : null}
            {player.guardianEmail ? (
              <span className="break-words" style={{ color: colors.inkMuted }}>{player.guardianEmail}</span>
            ) : null}
            {!player.guardianName && !player.guardianEmail ? (
              <span style={{ color: colors.inkFaint }}>No guardian info provided.</span>
            ) : null}

            {canManageTeam ? (
              player.linkedGuardianId && player.guardianEmail ? (
                <Button
                  label="Resend Invite"
                  variant="secondary"
                  size="sm"
                  onClick={resendInvite}
                  loading={resendInviteMut.isPending}
                />
              ) : !player.linkedGuardianId ? (
                <Button
                  label="Link Account"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowGuardianLink(true)}
                />
              ) : null
            ) : null}
          </Card>

          {canManageTeam ? (
            <Button
              label="Delete Player"
              variant="danger"
              loading={deletePlayer.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Delete Player',
                  message: 'Are you sure you want to delete this player? This cannot be undone.',
                  confirmLabel: 'Delete',
                  destructive: true,
                });
                if (!ok) return;
                await deletePlayer.mutateAsync(playerId);
                router.push(href('roster'));
              }}
            />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card accent className="flex flex-col gap-2">
            <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
              Development Summary
            </span>
            <span style={{ color: colors.inkMuted }}>{heuristic.summary}</span>
            <span className="text-sm" style={{ color: colors.primary }}>
              Role fit: {heuristic.role_fit}
            </span>

            <PlanGate feature="aiSummaries" title="Deep AI Insights (Club+)">
              {deepDive ? (
                <div className="mt-2 border-t pt-3" style={{ borderColor: colors.border }}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-bold" style={{ color: colors.primary }}>
                      AI Advanced Analysis
                    </span>
                    <Button
                      label={aiSummary.isPending ? 'Processing...' : '↻ Regenerate'}
                      size="sm"
                      variant="ghost"
                      onClick={runAi}
                      loading={aiSummary.isPending}
                    />
                  </div>
                  {aiSummary.isPending ? (
                    <div className="flex flex-col items-center gap-2 p-4">
                      <Spinner size={28} />
                      <span style={{ color: colors.ink }}>{aiLoadingText}</span>
                    </div>
                  ) : (
                    <>
                      <p style={{ color: colors.ink }}>{deepDive.summary}</p>
                      {deepDive.key_strengths?.map((s: string) => (
                        <p key={s} className="mt-1 text-sm" style={{ color: colors.success }}>
                          + {s}
                        </p>
                      ))}
                      {deepDive.key_growth?.map((s: string) => (
                        <p key={s} className="mt-1 text-sm" style={{ color: colors.primary }}>
                          - {s}
                        </p>
                      ))}
                    </>
                  )}
                  {aiNotice}
                </div>
              ) : (
                <div className="mt-2">
                  {aiSummary.isPending ? (
                    <div className="flex flex-col items-center gap-2 p-4">
                      <Spinner size={28} />
                      <span style={{ color: colors.ink }}>{aiLoadingText}</span>
                    </div>
                  ) : (
                    <Button label="Generate AI Deep Dive" size="sm" onClick={runAi} loading={aiSummary.isPending} />
                  )}
                  {aiNotice}
                </div>
              )}
            </PlanGate>
          </Card>

          <Card className="flex flex-col items-start gap-2">
            <p className="font-display font-bold" style={{ color: colors.ink }}>Player Profile</p>
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              View full assessment history, score trends, and season-over-season comparison.
            </p>
            <Button
              label="View Full Profile"
              variant="secondary"
              disabled={!player.athleteId}
              onClick={() => router.push(`/player/${player.athleteId}`)}
            />
          </Card>

          <div>
            <SectionLabel className="mb-3">Evaluations ({evals.length})</SectionLabel>
            {evals.length === 0 ? (
              <EmptyState title="No evaluations yet" message="Use Score Player to add the first evaluation." />
            ) : (
              <div className="flex flex-col gap-2">
                {evals.map((ev) => {
                  const overall = weightedOverall(ev.scores ?? {}, categories, weights);
                  return (
                    <Card key={ev.id} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold" style={{ color: colors.ink }}>
                          {ev.session} · {ev.date} {overall > 0 ? `· Score: ${overall.toFixed(1)}` : ''}
                        </span>
                        {ev.recommendation ? <Badge label={ev.recommendation} variant="brand" /> : null}
                      </div>
                      <span className="text-sm" style={{ color: colors.inkMuted }}>
                        {ev.evaluator}
                      </span>
                      {ev.strengths ? (
                        <span className="mt-1 text-sm" style={{ color: colors.ink }}>
                          + {ev.strengths}
                        </span>
                      ) : null}
                      {ev.improve ? (
                        <span className="text-sm" style={{ color: colors.inkMuted }}>
                          → {ev.improve}
                        </span>
                      ) : null}
                      <div>
                        <Button
                          label="Edit Score"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const base = href(`score/${playerId}`);
                            router.push(`${base}${base.includes('?') ? '&' : '?'}evalId=${ev.id}`);
                          }}
                        />
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal visible={showEdit} title="Edit Player" size="lg" onClose={() => setShowEdit(false)} hideDefaultFooter>
        <AddPlayerForm
          defaultValues={player}
          loading={updatePlayer.isPending || uploadPhoto.isPending}
          onSubmit={async (data) => {
            try {
              if (player.athleteId && data.avatarUrl?.startsWith('blob:')) {
                try {
                  data.avatarUrl = await uploadPhoto.mutateAsync({
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
              await updatePlayer.mutateAsync({ playerId, updates: data });
              setShowEdit(false);
            } catch (err) {
              await alert('Save Error', `Failed to update player: ${err instanceof Error ? err.message : ''}`);
            }
          }}
        />
      </Modal>

      <Modal visible={showGuardianLink} title="Link Guardian" onClose={() => setShowGuardianLink(false)}>
        <div className="flex flex-col gap-3">
          <p style={{ color: colors.ink }}>
            Link {player.first} to a guardian account to grant them portal access.
          </p>
          {player.guardianEmail ? (
            <>
              {player.linkedGuardianId ? (
                <p className="text-sm" style={{ color: colors.inkMuted }}>
                  This guardian is already linked. Sending a new invite will refresh their access.
                </p>
              ) : null}
              <Button
                label={`Invite ${player.guardianEmail}`}
                onClick={linkGuardian}
                loading={inviteMut.isPending || linkGuardianMut.isPending || createAndInviteMut.isPending}
              />
            </>
          ) : (
            <p style={{ color: colors.inkMuted }}>
              No email on file. Edit the player profile to add a guardian email first.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
