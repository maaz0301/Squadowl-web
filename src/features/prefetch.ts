import { getDataSource } from '@/data';
import { queryClient, queryKeys } from '@/lib/queryClient';

/**
 * Cache warming.
 *
 * Nothing here changes what a screen renders — it only moves the network wait
 * off the critical path. Two moments matter:
 *
 *  - **Right after a session lands.** Signing in clears the query cache, then
 *    routes to /dashboard. Without this the fetch can't start until Next has
 *    loaded the dashboard chunk and mounted its hooks, so the round trip is
 *    stacked *after* the navigation instead of running alongside it.
 *  - **On navigation intent.** Hovering or touching a nav item is a reliable
 *    ~100–300ms of warning before the click, and that is usually most of the
 *    query.
 *
 * All of it is best-effort: `prefetchQuery` resolves rather than rejecting on
 * error, and a screen that arrives before its prefetch lands just subscribes to
 * the in-flight query instead of starting a second one. Failures are swallowed
 * deliberately — the screen's own hook will surface a real error state.
 */

/** Prefetches respect this like any query, so a warm cache is left alone. */
const PREFETCH_STALE_TIME = 30_000;

function warm(queryKey: readonly unknown[], queryFn: () => Promise<unknown>): void {
  void queryClient
    .prefetchQuery({ queryKey, queryFn, staleTime: PREFETCH_STALE_TIME })
    .catch(() => {});
}

/** The dashboard's own reads, plus the teams list its overview card counts. */
export function prefetchDashboard(): void {
  warm(queryKeys.tryoutSummaries(false), () => getDataSource().listTryoutSummaries(false));
  warm(queryKeys.teams, () => getDataSource().listTeams());
  warm(queryKeys.assignedTryoutSummaries, () => getDataSource().listAssignedTryoutSummaries());
}

export function prefetchTeams(): void {
  warm(queryKeys.teams, () => getDataSource().listTeams());
  warm(queryKeys.seasons, () => getDataSource().listSeasons());
}

export function prefetchArchivedAssessments(): void {
  warm(queryKeys.tryoutSummaries(true), () => getDataSource().listTryoutSummaries(true));
}

/**
 * Search reads the *full* tryouts (it matches on player names), so this is the
 * one prefetch that pulls the heavy query — which is exactly why it's worth
 * starting on hover rather than on arrival.
 */
export function prefetchSearch(): void {
  warm(queryKeys.tryouts(true), () => getDataSource().listTryouts(true));
  warm(queryKeys.seasons, () => getDataSource().listSeasons());
}

/**
 * The full read for one assessment, warmed when a dashboard card is hovered or
 * touched. This is the query behind /assessment/[id]/roster, and it is the
 * heaviest single-record read in the app, so the head start is worth the most
 * here of anywhere.
 */
export function prefetchTryout(id: string): void {
  warm(queryKeys.tryout(id), () => getDataSource().getTryout(id));
}

/** What /team/[id] opens with. The team itself already comes from the cached list. */
export function prefetchTeamDetail(teamId: string): void {
  warm(queryKeys.teamRoster(teamId), () => getDataSource().listTeamRoster(teamId));
  warm(queryKeys.seasons, () => getDataSource().listSeasons());
  // The team page's Assessments tab and add-players picker want full rosters.
  warm(queryKeys.tryouts(false), () => getDataSource().listTryouts(false));
}

/** Route prefix → the data that route opens with. Unlisted routes are cheap. */
const BY_ROUTE: Record<string, () => void> = {
  '/dashboard': prefetchDashboard,
  '/teams': prefetchTeams,
  '/search': prefetchSearch,
  '/archived-assessments': prefetchArchivedAssessments,
};

/** Called from nav items on hover/focus/touch, keyed by href. */
export function prefetchRoute(href: string): void {
  BY_ROUTE[href]?.();
}

/**
 * Warms whichever landing screen a freshly authenticated user is headed for.
 *
 * Guardians land on the same /dashboard route but render the portal from a
 * different query, so they get that one instead of the coach reads. The role on
 * the profile is enough to tell them apart here — `usePermissions()` refines it
 * against org membership, but that lookup is itself a round trip and getting
 * this wrong only costs one wasted prefetch.
 */
export function warmAfterAuth(
  user: { id: string; role?: string | null; emailVerified?: boolean } | undefined,
): void {
  // A fresh signup is held on /verify-email until they confirm, so warming the
  // dashboard for them is a request whose answer nobody will ever look at.
  if (!user || user.emailVerified === false) return;
  if (user.role === 'guardian') {
    warm(queryKeys.guardianRosters(user.id), () => getDataSource().getGuardianRosters());
    return;
  }
  prefetchDashboard();
}
