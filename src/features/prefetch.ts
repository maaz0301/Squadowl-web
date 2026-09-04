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

/**
 * `staleTime` is an override for the rare query whose own hook sets a longer
 * one. Warming such a query on the 30s default would refetch it on a hover the
 * screen itself would have answered from cache — the opposite of the point.
 */
function warm(
  queryKey: readonly unknown[],
  queryFn: () => Promise<unknown>,
  staleTime: number = PREFETCH_STALE_TIME,
): void {
  void queryClient.prefetchQuery({ queryKey, queryFn, staleTime }).catch(() => {});
}

/**
 * What a route's prefetch needs to know about who is asking.
 *
 * Passed in by the caller rather than read off the auth store: authStore
 * imports this module (warmAfterAuth), so importing it back would close a
 * module-load cycle. AppShell already has both facts to hand.
 */
export interface PrefetchContext {
  /** The signed-in user's id. Some queries key on it, so they can't warm without it. */
  userId?: string;
  /** Guardians share the /dashboard href with coaches but read a different query. */
  isGuardian?: boolean;
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

/**
 * The "+ New Evaluation" form. It renders straight away, but its team picker
 * and the count behind its plan-limit check are both round trips it starts on
 * mount — warmed on the button's hover, they are usually answered by the time
 * the route's chunk has loaded.
 */
export function prefetchNewAssessment(): void {
  warm(queryKeys.teams, () => getDataSource().listTeams());
  warm(queryKeys.assessmentCount, () => getDataSource().countAssessments());
}

/** The "+ New Team" form — the count its plan-limit check reads on mount. */
export function prefetchNewTeam(): void {
  warm(queryKeys.teamCount, () => getDataSource().countTeams());
}

/** What /team/[id] opens with. The team itself already comes from the cached list. */
export function prefetchTeamDetail(teamId: string): void {
  warm(queryKeys.teamRoster(teamId), () => getDataSource().listTeamRoster(teamId));
  warm(queryKeys.seasons, () => getDataSource().listSeasons());
  // The team page's Assessments tab and add-players picker want full rosters.
  warm(queryKeys.tryouts(false), () => getDataSource().listTryouts(false));
}

/** The coach's inbox of athletes guardians have shared with them. */
export function prefetchSharedAthletes(): void {
  warm(queryKeys.sharedAthletes, () => getDataSource().getSharedAthletesForCoach());
}

/**
 * The enterprise dashboard's headline metrics are computed across most of the
 * account at once — five reads it fires in parallel on mount, and the slowest
 * of them is the full archived-inclusive tryout list. Warming them together on
 * hover is the largest single saving in this file after prefetchTryout.
 */
export function prefetchEnterprise({ userId }: PrefetchContext = {}): void {
  warm(queryKeys.org, () => getDataSource().getOrg());
  warm(queryKeys.tryouts(true), () => getDataSource().listTryouts(true));
  warm(queryKeys.teams, () => getDataSource().listTeams());
  warm(queryKeys.seasons, () => getDataSource().listSeasons());
  if (userId) warm(queryKeys.orgMembers(userId), () => getDataSource().listOrgMembers(false));
}

export function prefetchPayments(): void {
  warm(queryKeys.enterprisePayments, () => getDataSource().getEnterprisePayments());
  // Carries useConnectAccountStatusQuery's own 5-minute staleTime rather than
  // the default: each run is a live Stripe accounts.retrieve, so warming it at
  // 30s would turn passing the cursor over "Payments" into a round trip the
  // screen would otherwise have skipped entirely.
  warm(
    queryKeys.connectAccountStatus,
    () => getDataSource().getConnectAccountStatus(),
    5 * 60_000,
  );
}

/**
 * The Members screen asks for team managers alongside staff, which is a
 * different cache key from the plain membership list `usePermissions()` keeps
 * warm — so this screen really does start a fresh read on mount.
 */
export function prefetchOrgMembers({ userId }: PrefetchContext = {}): void {
  if (!userId) return;
  warm(queryKeys.orgMembers(userId, true), () => getDataSource().listOrgMembers(true));
}

/**
 * Loyalty Program and Plans & Billing both open on the referral summary — the
 * one read either screen blocks on — so a hover over either warms both.
 */
export function prefetchReferralSummary(): void {
  warm(queryKeys.referralSummary, () => getDataSource().getReferralSummary());
}

/** What a guardian's /dashboard renders from, in place of the coach reads. */
export function prefetchGuardianDashboard({ userId }: PrefetchContext = {}): void {
  if (!userId) return;
  warm(queryKeys.guardianRosters(userId), () => getDataSource().getGuardianRosters());
}

/** Route prefix → the data that route opens with. Unlisted routes are cheap. */
const BY_ROUTE: Record<string, (ctx: PrefetchContext) => void> = {
  // Same href, two entirely different screens — see prefetchGuardianDashboard.
  '/dashboard': (ctx) => (ctx.isGuardian ? prefetchGuardianDashboard(ctx) : prefetchDashboard()),
  '/teams': prefetchTeams,
  '/search': prefetchSearch,
  '/archived-assessments': prefetchArchivedAssessments,
  '/shared-athletes': prefetchSharedAthletes,
  '/enterprise': prefetchEnterprise,
  '/payments': prefetchPayments,
  '/organization/members': prefetchOrgMembers,
  '/loyalty': prefetchReferralSummary,
  '/upgrade': prefetchReferralSummary,
  '/assessment/new': prefetchNewAssessment,
  '/team/new': prefetchNewTeam,
};

/**
 * Called from nav items on hover/focus/touch, keyed by href.
 *
 * Every sidebar destination that blocks on a read is listed above. The ones
 * that aren't — /profile and /feedback — render from the session and local
 * state alone, so there is nothing to warm and Next's own prefetch of the
 * route chunk is the whole of their cost.
 */
export function prefetchRoute(href: string, ctx: PrefetchContext = {}): void {
  BY_ROUTE[href]?.(ctx);
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
    prefetchGuardianDashboard({ userId: user.id });
    return;
  }
  prefetchDashboard();
}
