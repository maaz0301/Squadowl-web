'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { CreateAssessmentFormSchema, SPORTS, EVENT_TYPES, type CreateAssessmentForm } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Button,
  Card,
  Chip,
  DateField,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  SectionLabel,
  TimeField,
} from '@/components/ui';
import { useCreateTryoutMutation, useTeamsQuery, useTryoutsQuery } from '@/features/queries';
import { useSessionStore } from '@/state/sessionStore';
import { useUser } from '@/state/authStore';
import { isAtAssessmentLimit } from '@/data/plans';
import { LimitReachedModal } from '@/components/LimitReachedModal';

function NewAssessmentForm() {
  const colors = useThemeColors();
  const router = useRouter();
  const params = useSearchParams();
  const createTryout = useCreateTryoutMutation();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const user = useUser();
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  const { control, handleSubmit, watch, setValue } = useForm<CreateAssessmentForm>({
    resolver: zodResolver(CreateAssessmentFormSchema),
    defaultValues: {
      name: '',
      sport: 'Hockey',
      eventType: 'Tryout',
      tryoutDate: '',
      startTime: '',
      endTime: '',
      rink: '',
      // Pre-linked when created from a team's Events section.
      teamId: params.get('teamId') ?? undefined,
    },
  });

  const sport = watch('sport');
  const eventType = watch('eventType');
  const teamId = watch('teamId');

  const onSubmit = handleSubmit(async (data) => {
    const count = tryoutsQuery.data?.length ?? 0;
    if (isAtAssessmentLimit(user?.planTier ?? 'free', count)) {
      setLimitMsg('You have reached the maximum number of assessments for your current plan.');
      return;
    }
    const tryout = await createTryout.mutateAsync(data);
    setCurrentTryout(tryout.id);
    router.replace(`/assessment/${tryout.id}/settings?welcome=1`);
  });

  if (teamsQuery.isLoading || tryoutsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (teamsQuery.isError || tryoutsQuery.isError) {
    return (
      <>
        <PageHeader title="New Assessment" showBack />
        <ErrorState
          message="Could not load required data."
          onRetry={() => {
            teamsQuery.refetch();
            tryoutsQuery.refetch();
          }}
        />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New Assessment" showBack backHref="/dashboard" />

      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <Controller
            control={control}
            name="name"
            render={({ field, fieldState }) => (
              <Input
                label="Assessment Name"
                placeholder="Spring U14 Tryout"
                {...field}
                error={fieldState.error?.message}
              />
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

          <div>
            <SectionLabel className="mb-2">Event Type</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {EVENT_TYPES.map((t) => (
                <Chip key={t} label={t} active={eventType === t} onClick={() => setValue('eventType', t)} />
              ))}
            </div>
          </div>

          {teamsQuery.data && teamsQuery.data.length > 0 ? (
            <div>
              <SectionLabel className="mb-2">Team (optional)</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {teamsQuery.data.map((team) => (
                  <Chip
                    key={team.id}
                    label={team.name}
                    active={teamId === team.id}
                    onClick={() => setValue('teamId', teamId === team.id ? undefined : team.id)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <Controller
              control={control}
              name="tryoutDate"
              render={({ field }) => <DateField label="Date" value={field.value} onChange={field.onChange} />}
            />
            <Controller
              control={control}
              name="startTime"
              render={({ field }) => (
                <TimeField label="Start Time" value={field.value} onChange={field.onChange} />
              )}
            />
            <Controller
              control={control}
              name="endTime"
              render={({ field }) => (
                <TimeField label="End Time" value={field.value} onChange={field.onChange} />
              )}
            />
          </div>

          <Controller
            control={control}
            name="rink"
            render={({ field }) => <Input label="Location / Rink" placeholder="Rink A" {...field} />}
          />

          <Button type="submit" label="Create Assessment" loading={createTryout.isPending} size="lg" />
        </form>
      </Card>

      <p className="mt-3 text-xs" style={{ color: colors.inkFaint }}>
        You&apos;ll set rubrics, assessors and registration options on the next screen.
      </p>

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </div>
  );
}

export default function NewAssessmentPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <NewAssessmentForm />
    </Suspense>
  );
}
