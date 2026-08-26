'use client';

import { ErrorState } from '@/components/ui';

/**
 * What a team surface shows when the teams read succeeded but simply didn't
 * include the team in the URL.
 *
 * For a delegated team manager that is the ordinary shape of having their
 * access revoked: `listTeams` merges in `list_teams_managed_by_me`, so the
 * moment the owning club removes them the team stops coming back and every
 * team route falls into its `!team` branch. Those branches used to render
 * ErrorState's default "Something went wrong" title over "Team not found.",
 * which reads as a fault in the app and tells a manager nothing about why a
 * team they had open a minute ago has vanished.
 *
 * The client genuinely cannot tell the two causes apart — a revoked manager and
 * a deleted team look identical once the row stops being returned — so the copy
 * names both rather than guessing at one. Shared between the team hub and the
 * team chat route so the two can't drift apart.
 */
export function TeamUnavailableState({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorState
      title="Team unavailable"
      message="You've either been removed from this team, or it no longer exists."
      onRetry={onRetry}
    />
  );
}
