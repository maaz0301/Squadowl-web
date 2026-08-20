'use client';

import { useParams, useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { useTeamsQuery, useSeasonsQuery } from '@/features/queries';
import { TeamChat } from '@/components/TeamChat';

function EditIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 20h9" strokeLinecap="round" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function TeamChatPage() {
  const routeParams = useParams();
  const id = Array.isArray(routeParams?.id) ? routeParams.id[0] : (routeParams?.id as string);
  const router = useRouter();
  const colors = useThemeColors();

  const teamsQuery = useTeamsQuery();
  const seasonsQuery = useSeasonsQuery();

  if (teamsQuery.isLoading || seasonsQuery.isLoading) return <LoadingState message="Loading chat..." />;
  if (teamsQuery.isError || seasonsQuery.isError) {
    return <ErrorState message="Could not load chat." onRetry={() => { teamsQuery.refetch(); seasonsQuery.refetch(); }} />;
  }

  const team = teamsQuery.data?.find((t) => t.id === id);
  if (!team) {
    return <ErrorState message="Team not found." onRetry={() => teamsQuery.refetch()} />;
  }
  const seasonId = seasonsQuery.data?.find((s) => s.teamId === id)?.id;

  return (
    // Same full-height brand-color wash as the team hub, so a personalized
    // team stays themed when a coach follows the Chat tab off onto this
    // separate route.
    <div
      className="-mx-4 -my-6 flex min-h-dvh flex-col px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      style={{ backgroundColor: team.brandColor ? `${team.brandColor}14` : undefined }}
    >
      <PageHeader
        title={team.name}
        subtitle="Team Chat"
        showBack
        backHref={`/team/${id}`}
        right={
          <button
            type="button"
            aria-label="Edit team"
            onClick={() => router.push(`/team/${id}?tab=settings`)}
            className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:brightness-125"
            style={{ backgroundColor: colors.tile, color: colors.ink }}
          >
            <EditIcon />
          </button>
        }
      />
      <TeamChat
        seasonId={seasonId}
        noSeasonMessage="This team doesn't have a season yet. Add a practice or game under Schedule, and the chat opens for everyone on the roster and their guardians."
        heightClassName="flex-1 min-h-[420px]"
      />
    </div>
  );
}
