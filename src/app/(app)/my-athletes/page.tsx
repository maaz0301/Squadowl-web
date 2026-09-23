'use client';

import { useThemeColors } from '@/theme/ThemeProvider';
import { CardGridSkeleton, EmptyState, ErrorState, PageHeader } from '@/components/ui';
import { GuardianAthleteCard } from '@/components/GuardianAthleteCard';
import { useGuardianRostersQuery } from '@/features/queries';
import { useUser } from '@/state/authStore';

/**
 * A coach/assessor whose email is also linked as a guardian on one or more
 * athletes (e.g. coaching one team while parenting a player on another) —
 * the same "My Athletes" view a pure guardian gets on /dashboard, at its own
 * route so it doesn't collide with the coach's evaluations home.
 */
export default function MyAthletesPage() {
  const colors = useThemeColors();
  const user = useUser();
  const guardianQuery = useGuardianRostersQuery();

  if (guardianQuery.isLoading) {
    return (
      <>
        <PageHeader title="My Athletes" subtitle={`Hi, ${user?.displayName ?? 'there'}`} />
        <CardGridSkeleton count={2} lines={3} columns="sm:grid-cols-2" />
      </>
    );
  }

  if (guardianQuery.isError) {
    return (
      <>
        <PageHeader title="My Athletes" subtitle={`Hi, ${user?.displayName ?? 'there'}`} />
        <ErrorState
          message={`Could not load your athletes: ${guardianQuery.error?.message || 'Unknown error'}`}
          onRetry={() => guardianQuery.refetch()}
        />
      </>
    );
  }

  const athletes = guardianQuery.data ?? [];

  return (
    <>
      <PageHeader title="My Athletes" subtitle={`Hi, ${user?.displayName ?? 'there'}`} />
      {athletes.length === 0 ? (
        <EmptyState
          title="No athletes linked yet"
          message="Once you're linked as a guardian on an athlete's profile, they'll appear here."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {athletes.map((ath) => (
            <GuardianAthleteCard key={ath.id} athlete={ath} colors={colors} />
          ))}
        </div>
      )}
    </>
  );
}
