import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { isAuthExpiredError } from './authErrors';

/**
 * A dead session surfaces as a failed read or write like any other error, so
 * both caches funnel it here: tear the session down and flag it as expired,
 * which sends AuthGate to /login and gets the user told why rather than
 * silently bounced.
 *
 * This used to test `error.message === 'Not authenticated'`, which nothing
 * throws — the string is `'User not authenticated'` (resolveUserId), so an
 * exact match never fired and an expired session just rendered as a broken
 * screen. isAuthExpiredError() matches on the Auth API's error *code* first.
 */
function handleAuthError(error: unknown) {
  if (!isAuthExpiredError(error)) return;
  // Dynamic import rather than a static one: authStore imports queryClient
  // (to clear the cache on logout), so a top-level import here would be
  // circular. Deferring the resolution until the callback actually fires
  // sidesteps the module-load-time cycle.
  import('../state/authStore')
    .then(({ useAuthStore }) => useAuthStore.getState().expireSession())
    .catch((e) => console.error('Failed to sign out after an expired session:', e));
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthError }),
  // Mutations had no auth handling at all: a session that died between page
  // load and "Save" left the user staring at a failed write with no hint that
  // signing in again was the fix.
  mutationCache: new MutationCache({ onError: handleAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Well past staleTime on purpose. staleTime decides when to refetch;
      // gcTime decides how long the answer survives having no subscriber. At
      // the 5-minute default, wandering off to a team page and back after a
      // few minutes dropped the dashboard's cached list, so the screen fell
      // all the way back to a blocking spinner instead of painting the old
      // list and refreshing it underneath.
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

export const queryKeys = {
  session: ['session'] as const,
  profile: ['profile'] as const,
  teams: ['teams'] as const,
  teamCount: ['teams', 'count'] as const,
  teamRoster: (teamId: string) => ['teams', teamId, 'roster'] as const,
  /**
   * Per-team headcounts for the Teams list. Covers every team at once, so
   * unlike `teamRoster` it can't live under a single team's prefix — the
   * roster writes refresh it through invalidateTeamRoster() instead. Still
   * under ['teams'], so the team create/delete invalidations reach it.
   */
  teamPlayerCounts: (teamIds?: string[]) =>
    teamIds ? (['teams', 'playerCounts', teamIds] as const) : (['teams', 'playerCounts'] as const),
  teamManagers: (teamId?: string) => (teamId ? (['team', teamId, 'managers'] as const) : (['team', 'managers'] as const)),
  teamBuilderResults: (tryoutId: string) => ['tryout', tryoutId, 'teamBuilderResults'] as const,
  teamMessages: (seasonId: string) => ['season', seasonId, 'messages'] as const,
  teamMessagesUnread: (seasonId: string, sinceMs: number) =>
    ['season', seasonId, 'messages', 'unread', sinceMs] as const,
  referralSummary: ['referral', 'summary'] as const,
  coachDirectory: ['coachDirectory'] as const,
  athleteShares: (athleteId: string) => ['athleteShares', athleteId] as const,
  sharedAthletes: ['sharedAthletes'] as const,
  athleteShare: (shareId: string) => ['athleteShare', shareId] as const,
  shareComments: (shareId: string) => ['shareComments', shareId] as const,
  tryouts: (archived?: boolean) => ['tryouts', { archived }] as const,
  /**
   * The light list-screen read (listTryoutSummaries). Keyed as a *superset* of
   * `tryouts(archived)` on purpose: react-query matches object segments
   * partially, so every existing `invalidateQueries({ queryKey: tryouts(x) })`
   * refreshes the summaries too and no write path had to learn a second key.
   */
  tryoutSummaries: (archived?: boolean) => ['tryouts', { archived, view: 'summary' }] as const,
  assessmentCount: ['tryouts', 'count'] as const,
  assignedTryouts: ['tryouts', 'assigned'] as const,
  /** Same superset trick as tryoutSummaries, against `assignedTryouts`. */
  assignedTryoutSummaries: ['tryouts', 'assigned', { view: 'summary' }] as const,
  tryout: (id: string) => ['tryout', id] as const,
  registrations: (tryoutId: string) => ['registrations', tryoutId] as const,
  results: (tryoutId: string) => ['results', tryoutId] as const,
  seasons: ['seasons'] as const,
  /** Same superset trick as tryoutSummaries, against `seasons`. */
  seasonSummaries: ['seasons', { view: 'summary' }] as const,
  season: (id: string) => ['season', id] as const,
  /**
   * The paged roster read behind the Season Roster page. Deliberately a
   * *suffix* of `season(id)`: react-query matches key prefixes, so every write
   * path that already invalidates the season refreshes these pages too, and
   * none of them had to learn a second key.
   */
  seasonRosterPages: (id: string) => ['season', id, 'roster'] as const,
  org: ['org'] as const,
  /**
   * `includeTeamManagers` is a suffix rather than a separate key so the plain
   * ['org', 'members'] prefix every org write invalidates still reaches it.
   */
  orgMembers: (userId?: string, includeTeamManagers?: boolean) =>
    userId
      ? includeTeamManagers
        ? (['org', 'members', userId, 'withTeamManagers'] as const)
        : (['org', 'members', userId] as const)
      : (['org', 'members'] as const),
  enterprisePayments: ['enterprise', 'payments'] as const,
  connectAccountStatus: ['connect', 'account-status'] as const,
  adminStats: ['admin', 'stats'] as const,
  adminUsers: ['admin', 'users'] as const,
  aiPlayer: (tryoutId: string, playerId: string) => ['ai', 'player', tryoutId, playerId] as const,
  guardianRosters: (userId?: string) => userId ? ['guardian', 'rosters', userId] as const : ['guardian', 'rosters'] as const,
};

/**
 * Shared mutation key for the long-running writes that add players to a tryout
 * (bulk registration placement, dummy-data generation). These can run for
 * minutes and are often started from a different screen than the one showing
 * the roster, so any screen displaying that tryout can call `useIsMutating`
 * with this key to tell "this roster is genuinely empty" apart from "players
 * are still being written into it right now".
 */
export const tryoutBulkWriteKey = (tryoutId: string) => ['tryoutBulkWrite', tryoutId] as const;
