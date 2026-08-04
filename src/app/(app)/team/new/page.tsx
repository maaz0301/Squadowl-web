'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { DummyDataModal } from '@/components/DummyDataModal';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { Avatar, Button, Card, ErrorState, Input, LoadingState, PageHeader, SectionLabel, useAlert } from '@/components/ui';
import { canUseFeature, isAtTeamLimit } from '@/data/plans';
import type { DummyTeamOptions } from '@/data/testDataGenerator';
import {
  useClearDummyTeamsMutation,
  useCreateSeasonMutation,
  useCreateTeamMutation,
  useGenerateDummyTeamsMutation,
  useTeamsQuery,
  useUploadTeamLogoMutation,
} from '@/features/queries';
import { useUser } from '@/state/authStore';
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
  const genDummy = useGenerateDummyTeamsMutation();
  const clearDummy = useClearDummyTeamsMutation();
  const uploadLogo = useUploadTeamLogoMutation();
  const user = useUser();
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [showDummy, setShowDummy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [logo, setLogo] = useState<{ uri: string; type: string } | null>(null);

  const onLogoPicked = (file: File | undefined) => {
    if (!file) return;
    setLogo({ uri: URL.createObjectURL(file), type: file.type || 'image/jpeg' });
  };

  const isAssociation = canUseFeature(user?.planTier ?? 'free', 'enterprise');

  const { control, handleSubmit } = useForm<Form>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: '', season: '2025-26' },
  });

  const onSubmit = handleSubmit(async (data) => {
    const count = teamsQuery.data?.length ?? 0;
    if (isAtTeamLimit(user?.planTier ?? 'free', count)) {
      setLimitMsg('You have reached the maximum number of teams for your current plan.');
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
    if (logo) {
      try {
        await uploadLogo.mutateAsync({ teamId: team.id, fileUri: logo.uri, fileType: logo.type });
      } catch (e) {
        await alert('Logo Upload Error', `The team was created, but uploading the logo failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }
    router.push(`/team/${team.id}`);
  });

  const runDummy = async (options: DummyTeamOptions) => {
    const existing = teamsQuery.data?.length ?? 0;
    if (isAtTeamLimit(user?.planTier ?? 'free', existing + options.teams - 1)) {
      setShowDummy(false);
      setLimitMsg('You have reached the maximum number of teams for your current plan.');
      return;
    }
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
          <Button
            type="submit"
            label="Create Team"
            loading={createTeam.isPending || createSeason.isPending || uploadLogo.isPending}
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
        onClose={() => setShowDummy(false)}
        onSubmit={runDummy}
      />
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </div>
  );
}
