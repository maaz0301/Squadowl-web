'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { DummyDataModal } from '@/components/DummyDataModal';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { TeamColorPicker } from '@/components/TeamColorPicker';
import { Avatar, Badge, Button, Card, Chip, ErrorState, FormLock, Input, PageHeader, SectionLabel, useAlert } from '@/components/ui';
import { canUseFeature, isAtTeamLimit, playerRoom, teamRoom, assessmentRoom } from '@/data/plans';
import { useCanUseDummyData } from '@/features/useCanUseDummyData';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { getDataSource } from '@/data';
import { queryKeys } from '@/lib/queryClient';
import type { DummyTeamOptions } from '@/data/testDataGenerator';
import type { Team } from '@/data/types';
import {
  useClearDummyTeamsMutation,
  useCreateSeasonMutation,
  useCreateTeamMutation,
  useUpdateTeamMutation,
  useGenerateDummyTeamsMutation,
  useTeamCountQuery,
  useTryoutSummariesQuery,
  useUploadTeamLogoMutation,
} from '@/features/queries';
import { useConnectStatus } from '@/features/useConnectStatus';
import { useUser, useAuthStore } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';

const FormSchema = z.object({
  name: z.string().min(2, 'Team name required'),
  season: z.string().optional(),
});

type Form = z.infer<typeof FormSchema>;

export default function NewTeamPage() {
  const router = useRouter();
  const colors = useThemeColors();
  const { alert } = useAlert();
  const createTeam = useCreateTeamMutation();
  const createSeason = useCreateSeasonMutation();
  const teamCount = useTeamCountQuery();
  const [dummyProgress, setDummyProgress] = useState<{ done: number; total: number } | null>(null);
  const genDummy = useGenerateDummyTeamsMutation((done, total) => setDummyProgress({ done, total }));
  const clearDummy = useClearDummyTeamsMutation();
  const uploadLogo = useUploadTeamLogoMutation();
  const user = useUser();
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [showDummy, setShowDummy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [logo, setLogo] = useState<{ uri: string; type: string } | null>(null);
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [collectsFees, setCollectsFees] = useState(false);
  const [feeInput, setFeeInput] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [checkingLimit, setCheckingLimit] = useState(false);
  const updateTeam = useUpdateTeamMutation();
  const qc = useQueryClient();
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const connect = useConnectStatus();

  // Every write the submit fans out to. Drives both the button's spinner and
  // the form lock, so they can never disagree about whether a save is running.
  // checkingLimit covers the submit-time count refetch below — without it the
  // button gives no feedback while that's in flight, and a slow or failed
  // refetch reads as a dead button.
  const saving =
    checkingLimit ||
    createTeam.isPending ||
    createSeason.isPending ||
    uploadLogo.isPending ||
    updateTeam.isPending;

  const onLogoPicked = (file: File | undefined) => {
    if (!file) return;
    setLogo({ uri: URL.createObjectURL(file), type: file.type || 'image/jpeg' });
  };

  const showDummyTools = useCanUseDummyData(user?.planTier ?? 'free');
  // Every dummy team also gets a linked evaluation, so the batch is capped by
  // whichever of the two allowances runs out first. Until the counts have
  // loaded nothing is offered, rather than guessing a count of zero.
  const tryoutSummaries = useTryoutSummariesQuery(false);
  const dummyTier = user?.planTier ?? 'free';
  const dummyTeamRoom = teamCount.data !== undefined ? teamRoom(dummyTier, teamCount.data, user?.extraTeamLicenses ?? 0) : 0;
  const dummyEvaluationRoom = tryoutSummaries.data ? assessmentRoom(dummyTier, tryoutSummaries.data.length) : 0;
  const dummyMaxTeams = Math.min(dummyTeamRoom, dummyEvaluationRoom);
  const dummyBlockedBy: 'teams' | 'evaluations' | 'loading' | undefined =
    !tryoutSummaries.data || teamCount.data === undefined
      ? 'loading'
      : dummyEvaluationRoom < 1
        ? 'evaluations'
        : dummyTeamRoom < 1
          ? 'teams'
          : undefined;
  const canCollectFees = canUseFeature(user?.planTier ?? 'free', 'payments');
  const canManageTeamCoaches = canUseFeature(user?.planTier ?? 'free', 'teamManagers');

  const connectPayouts = async () => {
    try {
      setConnecting(true);
      const res = await getDataSource().createConnectAccountLink();
      if (!res?.url) return;
      window.open(res.url, '_blank', 'noopener,noreferrer');
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const { data: live } = await connect.refetch();
        await restoreSession(true);
        await qc.invalidateQueries({ queryKey: queryKeys.profile });
        const current = useAuthStore.getState().session?.user;
        if (live?.chargesEnabled || current?.connectChargesEnabled) break;
      }
    } catch (err) {
      await alert('Connect Error', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setConnecting(false);
    }
  };

  const { control, handleSubmit } = useForm<Form>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: '', season: '2025-26' },
  });

  const onSubmit = handleSubmit(async (data) => {
    // Delegated teams belong to the club that pays for them, not to this plan;
    // countTeams() only counts this account's own. Awaited here because the
    // form no longer waits for the count before rendering. Caught explicitly:
    // an uncaught rejection here (react-hook-form doesn't catch onValid errors)
    // used to leave the button looking dead — no spinner, no error, no retry.
    let count: number;
    try {
      setCheckingLimit(true);
      count = teamCount.data ?? (await teamCount.refetch()).data ?? 0;
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not check your team limit. Please try again.');
      return;
    } finally {
      setCheckingLimit(false);
    }
    if (isAtTeamLimit(user?.planTier ?? 'free', count, user?.extraTeamLicenses ?? 0)) {
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'teams', 'teams', user?.extraTeamLicenses ?? 0));
      return;
    }
    let team: Team;
    try {
      team = await createTeam.mutateAsync({ name: data.name, season: data.season });
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Failed to create team.');
      return;
    }

    // createTeam only takes name/season, so the season, the logo and the
    // branding are all follow-up writes — but none of them depends on any of
    // the others, so they go out together. Run one after another they were the
    // bulk of the wait between hitting Create and landing on the team.
    const updates: Partial<Team> = {};
    if (brandColor) updates.brandColor = brandColor;
    if (collectsFees && canCollectFees) {
      const dollars = parseFloat(feeInput);
      updates.collectsFees = true;
      updates.registrationFeeCents =
        !feeInput.trim() || isNaN(dollars) || dollars <= 0 ? 0 : Math.round(dollars * 100);
    }

    const describe = (e: unknown) => (e instanceof Error ? e.message : 'Unknown error');

    await Promise.all([
      // Events hang off a season, so every team gets one up front — the coach
      // never sees it, they just add practices and games on the team screen.
      // Non-fatal: the team exists, and its first event will create the season.
      createSeason
        .mutateAsync({
          name: data.season ? `${data.name} ${data.season}` : `${data.name} Season`,
          teamName: data.name,
          sport: 'Hockey',
          year: data.season,
          teamId: team.id,
        })
        .catch(() => {}),
      // The upload mutation writes logoUrl onto the team itself, so there is no
      // separate update to make here.
      logo
        ? uploadLogo
            .mutateAsync({ teamId: team.id, fileUri: logo.uri, fileType: logo.type })
            .catch((e) =>
              alert('Logo Upload Error', `The team was created, but uploading the logo failed: ${describe(e)}`),
            )
        : null,
      Object.keys(updates).length
        ? updateTeam
            .mutateAsync({ id: team.id, updates })
            .catch((e) =>
              alert('Branding Error', `The team was created, but saving its settings failed: ${describe(e)}`),
            )
        : null,
      // Coach+/Club only: let the same "creating a team" flow hand it straight
      // to another manager instead of making them find the new team
      // afterward just to invite someone to it. Always 'manager' — see
      // TeamManagersCard for why 'coach' isn't offered as an invite role.
      canManageTeamCoaches && managerEmail.trim()
        ? getDataSource()
            .inviteTeamManager(team.id, managerEmail.trim(), 'manager')
            .catch((e) =>
              alert('Invite Error', `The team was created, but inviting ${managerEmail.trim()} failed: ${describe(e)}`),
            )
        : null,
    ]);

    router.push(`/team/${team.id}?tab=settings`);
  });

  const runDummy = async (options: DummyTeamOptions) => {
    const existing = teamCount.data ?? (await teamCount.refetch()).data ?? 0;
    if (isAtTeamLimit(user?.planTier ?? 'free', existing + options.teams - 1, user?.extraTeamLicenses ?? 0)) {
      setShowDummy(false);
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'teams', 'teams', user?.extraTeamLicenses ?? 0));
      return;
    }
    if (options.teams > dummyMaxTeams) {
      setShowDummy(false);
      setLimitMsg(buildLimitReachedMessage(dummyTier, 'assessments', 'evaluations'));
      return;
    }
    setDummyProgress(null);
    try {
      const res = await genDummy.mutateAsync(options);
      await alert(
        'Dummy teams created',
        `Created ${res.teams} team${res.teams === 1 ? '' : 's'} with ${res.assessments} linked ` +
          `evaluation${res.assessments === 1 ? '' : 's'}, ${res.players} players, and ` +
          `${res.evaluations} evaluations.`,
      );
      router.push('/teams');
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Failed to generate dummy teams.');
    } finally {
      // In `finally`, not after the await: a partial run still created real
      // teams, and leaving the modal open over a stale form made it look like
      // nothing had happened at all.
      setShowDummy(false);
    }
  };

  const runClearDummy = async () => {
    try {
      const res = await clearDummy.mutateAsync();
      await alert(
        'Cleared',
        res.assessments === 0
          ? 'No dummy teams to remove.'
          : `Removed ${res.teams} team${res.teams === 1 ? '' : 's'} and ${res.assessments} ` +
            `evaluation${res.assessments === 1 ? '' : 's'}.`,
      );
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Failed to clear dummy teams.');
    }
  };

  // Only the plan-limit check needs the count, and onSubmit waits for it if it
  // hasn't landed — so the form itself renders straight away instead of behind
  // a spinner for a number nothing on screen displays.
  if (teamCount.isError) {
    return (
      <>
        <PageHeader title="New Team" showBack />
        <ErrorState message="Could not load teams." onRetry={() => teamCount.refetch()} />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New Team" showBack backHref="/teams" />

      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <FormLock busy={saving} className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center gap-1 self-center"
            >
              <Avatar first={logo ? '' : '+'} last="" uri={logo?.uri} size={72} />
              <span className="text-xs" style={{ color: colors.primary }}>
                {logo ? 'Change Team Logo' : 'Upload Team Logo'}
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onLogoPicked(e.target.files?.[0])}
            />
            <Controller
              control={control}
              name="name"
              render={({ field, fieldState }) => (
                <Input label="Team Name" {...field} error={fieldState.error?.message} />
              )}
            />
            <Controller
              control={control}
              name="season"
              render={({ field }) => <Input label="Season (optional)" {...field} value={field.value ?? ''} />}
            />

            <TeamColorPicker value={brandColor} onChange={setBrandColor} label="Team colour (optional)" />

            {canManageTeamCoaches ? (
              <div className="flex flex-col gap-2">
                <SectionLabel>Invite a manager (optional)</SectionLabel>
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  Give them this team&apos;s roster, schedule, and chat as soon as it&apos;s created, and let
                  them create its evaluations — but nothing else on your account. They&apos;ll get an email with an
                  Accept Invitation button. If they don&apos;t have a TryoutHQ account yet, it asks them to create one, and access is granted automatically when they do.
                </p>
                <Input
                  label="Email address"
                  value={managerEmail}
                  onChange={(e) => setManagerEmail(e.target.value)}
                  type="email"
                  autoCapitalize="none"
                  placeholder="manager@example.com"
                />
              </div>
            ) : null}

            {canCollectFees ? (
              <>
                <div className="flex flex-col gap-2">
                  <SectionLabel>Are you collecting fees?</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    <Chip label="No" active={!collectsFees} onClick={() => setCollectsFees(false)} />
                    <Chip label="Yes" active={collectsFees} onClick={() => setCollectsFees(true)} />
                  </div>
                </div>

                {collectsFees ? (
                  <Card className="flex flex-col gap-2">
                    <Input
                      label="Fee per player (CAD)"
                      value={feeInput}
                      onChange={(e) => setFeeInput(e.target.value)}
                      placeholder="0.00"
                    />
                    <p className="text-xs" style={{ color: colors.inkMuted }}>
                      Creating this team creates (or reuses) its season and adds everyone on the roster to it —
                      each player&apos;s guardian will then be asked to pay this fee, plus TryoutHQ&apos;s 0.5%
                      platform fee, from their portal. QR/link evaluation registration always stays free.
                    </p>
                    {connect.chargesEnabled ? (
                      <Badge label="Stripe connected" variant="success" />
                    ) : (
                      <>
                        <p className="text-xs" style={{ color: colors.warning }}>
                          {connect.onboardingIncomplete
                            ? "Your Stripe account isn't finished — Stripe needs more information before it will accept charges. You can still create the team now and finish after."
                            : 'Connect a Stripe account before guardians can pay — you can still create the team now and connect after.'}
                        </p>
                        <Button
                          label={connect.onboardingIncomplete ? 'Continue Stripe Setup' : 'Connect with Stripe'}
                          variant="secondary"
                          size="sm"
                          loading={connecting}
                          onClick={connectPayouts}
                        />
                      </>
                    )}
                  </Card>
                ) : null}
              </>
            ) : null}

          </FormLock>

          <Button type="submit" label="Create Team" loading={saving} size="lg" />
        </form>
      </Card>

      {showDummyTools ? (
        <Card className="mt-6 flex flex-col gap-2">
          <SectionLabel>Testing Tools</SectionLabel>
          <p className="text-xs" style={{ color: colors.inkMuted }}>
            Skip the form and generate whole teams — each with a linked evaluation, a rubric set, and a
            roster of dummy players you can optionally score.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button label="Dummy Data" size="sm" onClick={() => setShowDummy(true)} />
            <Button
              label="Clear Dummy Teams"
              size="sm"
              variant="ghost"
              loading={clearDummy.isPending}
              onClick={runClearDummy}
            />
          </div>
        </Card>
      ) : null}

      <DummyDataModal
        variant="team"
        maxTeams={dummyMaxTeams}
        teamsBlockedBy={dummyBlockedBy}
        maxPlayersPerTeam={playerRoom(dummyTier, 0)}
        visible={showDummy}
        loading={genDummy.isPending}
        progress={dummyProgress ?? undefined}
        onClose={() => setShowDummy(false)}
        onSubmit={runDummy}
      />
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </div>
  );
}
