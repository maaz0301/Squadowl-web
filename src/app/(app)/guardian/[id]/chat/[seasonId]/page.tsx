'use client';

import { useParams } from 'next/navigation';

import { ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { useGuardianRostersQuery } from '@/features/queries';
import { TeamChat } from '@/components/TeamChat';

export default function GuardianTeamChatPage() {
  const routeParams = useParams();
  const playerId = Array.isArray(routeParams?.id) ? routeParams.id[0] : (routeParams?.id as string);
  const seasonId = Array.isArray(routeParams?.seasonId) ? routeParams.seasonId[0] : (routeParams?.seasonId as string);

  const guardianQuery = useGuardianRostersQuery();

  if (guardianQuery.isLoading) return <LoadingState message="Loading chat..." />;
  if (guardianQuery.isError) {
    return <ErrorState message="Could not load chat." onRetry={() => guardianQuery.refetch()} />;
  }

  const athlete = guardianQuery.data?.find((a) => a.id === playerId);
  const season = athlete?.seasons.find((s) => s.id === seasonId);
  if (!athlete || !season) {
    return <ErrorState message="Team not found." onRetry={() => guardianQuery.refetch()} />;
  }

  return (
    <div className="-mx-4 -my-6 flex min-h-dvh flex-col px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <PageHeader title={season.teamName} subtitle={season.name} showBack backHref={`/guardian/${playerId}`} />
      <TeamChat seasonId={season.id} heightClassName="flex-1 min-h-[420px]" />
    </div>
  );
}
