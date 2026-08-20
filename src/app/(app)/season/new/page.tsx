'use client';

import { Suspense } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';

import { CreateSeasonFormSchema, SPORTS, type CreateSeasonForm } from '@/data/types';
import { Button, Card, Chip, ErrorState, Input, LoadingState, PageHeader, SectionLabel } from '@/components/ui';
import { useCreateSeasonMutation, useTeamsQuery } from '@/features/queries';
import { PlanGate } from '@/components/PlanGate';
import { effectiveTierForTeam } from '@/data/plans';
import { useUser } from '@/state/authStore';

function NewSeasonForm() {
  const router = useRouter();
  const params = useSearchParams();
  const createSeason = useCreateSeasonMutation();
  const teamsQuery = useTeamsQuery();

  // Arriving from a team pre-links that team so the coach doesn't re-pick it.
  const presetTeamId = params.get('teamId') ?? undefined;
  const presetTeamName = params.get('teamName') ?? '';

  const { control, handleSubmit, watch, setValue } = useForm<CreateSeasonForm>({
    resolver: zodResolver(CreateSeasonFormSchema),
    defaultValues: {
      name: '',
      teamName: presetTeamName,
      sport: 'Hockey',
      year: '2025-26',
      teamId: presetTeamId,
    },
  });

  const sport = watch('sport');
  const selectedTeamId = watch('teamId');
  const user = useUser();
  // A season created for (or linked to) a delegated team gates against the
  // owning club's tier, not the viewer's own.
  const selectedTeam = selectedTeamId ? teamsQuery.data?.find((t) => t.id === selectedTeamId) : undefined;
  const tier = effectiveTierForTeam(selectedTeam, user?.planTier ?? 'free');

  const onSubmit = handleSubmit(async (data) => {
    const season = await createSeason.mutateAsync(data);
    router.replace(`/season/${season.id}`);
  });

  if (teamsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (teamsQuery.isError) {
    return (
      <>
        <PageHeader title="New Season" showBack />
        <ErrorState message="Could not load teams." onRetry={() => teamsQuery.refetch()} />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New Season" subtitle="Team Hub setup" showBack backHref="/seasons" />

      <PlanGate feature="seasonHub" title="Season Hub (Coach+)" tierOverride={tier}>
        <Card>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Controller
              control={control}
              name="name"
              render={({ field, fieldState }) => (
                <Input
                  label="Season Name"
                  placeholder="2025-26 U14 Season"
                  {...field}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="teamName"
              render={({ field, fieldState }) => (
                <Input label="Team Name" {...field} error={fieldState.error?.message} />
              )}
            />

            <div>
              <SectionLabel className="mb-2">Sport</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {SPORTS.map((s) => (
                  <Chip key={s} label={s} active={sport === s} onClick={() => setValue('sport', s)} />
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={control}
                name="year"
                render={({ field }) => <Input label="Year" {...field} value={field.value ?? ''} />}
              />
              <Controller
                control={control}
                name="division"
                render={({ field }) => (
                  <Input label="Division" placeholder="U14 AA" {...field} value={field.value ?? ''} />
                )}
              />
            </div>

            {presetTeamId ? (
              <div>
                <SectionLabel className="mb-2">Linked Team</SectionLabel>
                <Chip label={presetTeamName} active />
              </div>
            ) : teamsQuery.data?.length ? (
              <div>
                <SectionLabel className="mb-2">Link Team</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {teamsQuery.data.map((t) => (
                    <Chip
                      key={t.id}
                      label={t.name}
                      active={watch('teamId') === t.id}
                      onClick={() => {
                        setValue('teamId', t.id);
                        setValue('teamName', t.name);
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <Button type="submit" label="Create Season" loading={createSeason.isPending} size="lg" />
          </form>
        </Card>
      </PlanGate>
    </div>
  );
}

export default function NewSeasonPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <NewSeasonForm />
    </Suspense>
  );
}
