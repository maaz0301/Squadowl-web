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
import { Avatar, Badge, Button, Card, Chip, ErrorState, Input, LoadingState, PageHeader, SectionLabel, useAlert } from '@/components/ui';
import { canUseFeature, isAtTeamLimit } from '@/data/plans';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { getDataSource } from '@/data';
import { queryKeys } from '@/lib/queryClient';
import type { DummyTeamOptions } from '@/data/testDataGenerator';
import {
  useClearDummyTeamsMutation,
  useCreateSeasonMutation,
  useCreateTeamMutation,
  useUpdateTeamMutation,
  useGenerateDummyTeamsMutation,
  useTeamsQuery,
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
  const teamsQuery = useTeamsQuery();
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
  const [connecting, setConnecting] = useState(false);
  const updateTeam = useUpdateTeamMutation();
  const qc = useQueryClient();
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const connect = useConnectStatus();

  const onLogoPicked = (file: File | undefined) => {
    if (!file) return;
    setLogo({ uri: URL.createObjectURL(file), type: file.type || 'image/jpeg' });
  };

  const isAssociation = canUseFeature(user?.planTier ?? 'free', 'enterprise');
  const canCollectFees = canUseFeature(user?.planTier ?? 'free', 'payments');

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
    // Delegated teams belong to the club that pays for them, not to this plan.
    const count = (teamsQuery.data ?? []).filter((t) => !t.managed).length;
    if (isAtTeamLimit(user?.planTier ?? 'free', count, user?.extraTeamLicenses ?? 0)) {
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'teams', 'teams', user?.extraTeamLicenses ?? 0));
      return;
    }
    const team = await createTeam.mutateAsync({ name: data.name, season: data.season });
    // Events hang off a season, so every team gets one up front — the coach
    // never sees it, they just add practices and games on the team screen.
    try {
      await createSeason.mutateAsync({
        name: data.season ? `${data.name} ${data.season}` : `${data.name} Season`,
        teamName: data.name,
        sport: 'Hockey',
        year: data.season,
        teamId: team.id,
      });
    } catch {
      // Non-fatal: the team exists, and its first event will create the season.
    }

    // createTeam only takes name/season, so branding is a follow-up write. Logo
    // and colour go together in one update when both are set, so a team that
    // picked both doesn't pay for two round trips.
    let logoUrl: string | undefined;
    if (logo) {
      try {
        logoUrl = await uploadLogo.mutateAsync({ teamId: team.id, fileUri: logo.uri, fileType: logo.type });
      } catch (e) {
        await alert('Logo Upload Error', `The team was created, but uploading the logo failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }
    if (logoUrl || brandColor) {
      try {
        await updateTeam.mutateAsync({
          id: team.id,
          updates: { ...(logoUrl ? { logoUrl } : {}), ...(brandColor ? { brandColor } : {}) },
        });
      } catch (e) {
        await alert('Branding Error', `The team was created, but saving its branding failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }

    if (collectsFees && canCollectFees) {
      const dollars = parseFloat(feeInput);
      const cents = !feeInput.trim() || isNaN(dollars) || dollars <= 0 ? 0 : Math.round(dollars * 100);
      try {
        await updateTeam.mutateAsync({ id: team.id, updates: { collectsFees: true, registrationFeeCents: cents } });
      } catch (e) {
        await alert('Fee Setup Error', `The team was created, but saving the fee failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }

    router.push(`/team/${team.id}`);
  });

  const runDummy = async (options: DummyTeamOptions) => {
    const existing = (teamsQuery.data ?? []).filter((t) => !t.managed).length;
    if (isAtTeamLimit(user?.planTier ?? 'free', existing + options.teams - 1, user?.extraTeamLicenses ?? 0)) {
      setShowDummy(false);
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'teams', 'teams', user?.extraTeamLicenses ?? 0));
      return;
    }
    setDummyProgress(null);
    try {
      const res = await genDummy.mutateAsync(options);
      setShowDummy(false);
      await alert(
        'Dummy teams created',
        `Created ${res.teams} team${res.teams === 1 ? '' : 's'} with ${res.assessments} linked ` +
          `assessment${res.assessments === 1 ? '' : 's'}, ${res.players} players, and ` +
          `${res.evaluations} evaluations.`,
      );
      router.push('/teams');
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Failed to generate dummy teams.');
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
            `assessment${res.assessments === 1 ? '' : 's'}.`,
      );
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Failed to clear dummy teams.');
    }
  };

  if (teamsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (teamsQuery.isError) {
    return (
      <>
        <PageHeader title="New Team" showBack />
        <ErrorState message="Could not load teams." onRetry={() => teamsQuery.refetch()} />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New Team" showBack backHref="/teams" />

      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
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

          {canCollectFees ? (
            <>
              <div className="flex flex-col gap-2">
                <SectionLabel>Are you collecting fees?</SectionLabel>
                <div className="flex gap-2">
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
                    platform fee, from their portal. QR/link assessment registration always stays free.
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

          <Button
            type="submit"
            label="Create Team"
            loading={createTeam.isPending || createSeason.isPending || uploadLogo.isPending || updateTeam.isPending}
            size="lg"
          />
        </form>
      </Card>

      {isAssociation ? (
        <Card className="mt-6 flex flex-col gap-2">
          <SectionLabel>Testing Tools</SectionLabel>
          <p className="text-xs" style={{ color: colors.inkMuted }}>
            Skip the form and generate whole teams — each with a linked assessment, a rubric set, and a
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
