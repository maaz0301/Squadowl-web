'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { LimitReachedModal } from '@/components/LimitReachedModal';
import { HubActions, LiveTryoutCard, ThisWeek, pickLiveTryout } from '@/components/hub/HubSections';
import { ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { isAtAssessmentLimit, ownedTryouts } from '@/data/plans';
import { useTeamsQuery, useTryoutSummariesQuery } from '@/features/queries';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { useUser } from '@/state/authStore';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Home: the evaluation in play, quick actions and what's on this week. */
export default function HubPage() {
  const router = useRouter();
  const user = useUser();
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutSummariesQuery(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  if (teamsQuery.isLoading || tryoutsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (teamsQuery.isError || tryoutsQuery.isError) {
    return <ErrorState message="Could not load the hub." onRetry={() => { teamsQuery.refetch(); tryoutsQuery.refetch(); }} />;
  }

  const tryouts = tryoutsQuery.data ?? [];
  const live = pickLiveTryout(tryouts);
  const planTier = user?.planTier ?? 'free';
  const firstName = (user?.displayName ?? '').split(' ')[0] || 'Coach';

  const createTryout = () => {
    if (isAtAssessmentLimit(planTier, ownedTryouts(tryouts, teamsQuery.data ?? []).length)) {
      setLimitMsg(buildLimitReachedMessage(planTier, 'assessments', 'evaluations'));
      return;
    }
    router.push('/assessment/new');
  };

  return (
    <>
      <PageHeader title={firstName} subtitle={`${greeting()},`} />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-6">
          {live ? (
            <LiveTryoutCard tryout={live.tryout} kind={live.kind} onResume={() => router.push(`/assessment/${live.tryout.id}/rinkside`)} />
          ) : null}
          <HubActions
            actions={[
              { key: 'schedule', label: 'Schedule\nEvents', icon: 'calendar', onClick: () => router.push('/calendar') },
              { key: 'create', label: 'Create\nTryout', icon: 'plus', onClick: createTryout },
              {
                key: 'sort',
                label: 'Sort\nOut',
                icon: 'teams',
                onClick: () => router.push(live ? `/assessment/${live.tryout.id}/team-builder` : '/dashboard'),
              },
            ]}
          />
        </div>
        <ThisWeek tryouts={tryouts} />
      </div>
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </>
  );
}
