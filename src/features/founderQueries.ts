'use client';

/**
 * Founder console queries and mutations — kept apart from features/queries.ts
 * so nothing founder-only is mixed into the shared app hooks.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as billingApi from '@/data/founder/billingApi';
import * as founderApi from '@/data/founder/founderApi';
import type { BlockableFeature } from '@/lib/blockableFeatures';
import type { PlanTier } from '@/data/types';
import { queryKeys } from '@/lib/queryClient';
import type {
  FounderAccessKind,
  FounderCreateOrganizationInput,
  FounderOrganizationFilter,
  FounderUserFilter,
  AnnouncementSeverity,
  EmailActivityFilter,
  FeaturePlatform,
  FounderAuditFilter,
  SupportTicketStatus,
  DiscountCodeInput,
  FounderSubscriptionFilter,
  PaymentFilter,
} from '@/data/founder/types';

/** Everything lives under ['founder'], so a sign-out's queryClient.clear() drops it with the rest. */
export const founderKeys = {
  /** founder@tryout.ca check behind the founder console's nav item and route guard. */
  isFounder: ['founder', 'isFounder'] as const,
  organizations: (filter?: FounderOrganizationFilter) =>
    filter ? (['founder', 'organizations', filter] as const) : (['founder', 'organizations'] as const),
  /** Under organizations() so every founder write refreshes it too. */
  organization: (id: string) => ['founder', 'organizations', 'detail', id] as const,
  team: (id: string) => ['founder', 'organizations', 'team', id] as const,
  orgEvaluations: (accountId: string) => ['founder', 'organizations', 'evaluations', accountId] as const,
  player: (athleteId: string) => ['founder', 'player', athleteId] as const,
  evaluation: (tryoutId: string) => ['founder', 'evaluation', tryoutId] as const,
  removedParticipants: (tryoutId: string) => ['founder', 'evaluation', tryoutId, 'removed'] as const,
  hiddenPlayerEvaluations: (athleteId: string) => ['founder', 'player', athleteId, 'hidden'] as const,
  auditLog: ['founder', 'auditLog'] as const,
  auditPage: (filter: FounderAuditFilter) => ['founder', 'auditLog', 'page', filter] as const,
  users: (filter?: FounderUserFilter) => (filter ? (['founder', 'users', filter] as const) : (['founder', 'users'] as const)),
  supportTickets: ['founder', 'support'] as const,
  supportTicketList: (filter: { status?: SupportTicketStatus; search?: string }) =>
    ['founder', 'support', 'list', filter] as const,
  supportTicket: (id: string) => ['founder', 'support', 'detail', id] as const,
  announcements: ['founder', 'announcements'] as const,
  emailActivity: (filter: EmailActivityFilter) => ['founder', 'emailActivity', filter] as const,
  emailActivityEvents: (msgId: string) => ['founder', 'emailActivity', 'events', msgId] as const,
  funnel: (days: number) => ['founder', 'analytics', 'funnel', days] as const,
  featureUsage: (days: number, platform: FeaturePlatform) => ['founder', 'analytics', 'features', days, platform] as const,
  featureAccounts: (feature: string, days: number, platform: FeaturePlatform) =>
    ['founder', 'analytics', 'features', days, platform, feature] as const,
  referrals: ['founder', 'analytics', 'referrals'] as const,
  referralBalances: ['founder', 'analytics', 'referralBalances'] as const,
  dashboard: ['founder', 'dashboard'] as const,
  orgActivity: (accountId: string) => ['founder', 'organizations', 'activity', accountId] as const,
  billing: ['founder', 'billing'] as const,
  discountCodes: ['founder', 'billing', 'discountCodes'] as const,
  discountRedemptions: (codeId: string) => ['founder', 'billing', 'discountCodes', codeId] as const,
  subscriptions: (filter?: FounderSubscriptionFilter) =>
    filter ? (['founder', 'billing', 'subscriptions', filter] as const) : (['founder', 'billing', 'subscriptions'] as const),
  subscriptionCounts: ['founder', 'billing', 'subscriptionCounts'] as const,
  stripeSubscriptions: (accountId: string) => ['founder', 'billing', 'stripeSubscriptions', accountId] as const,
  payments: (filter: PaymentFilter) => ['founder', 'billing', 'payments', filter] as const,
  payment: (chargeId: string) => ['founder', 'billing', 'payment', chargeId] as const,
  revenue: (months: number) => ['founder', 'billing', 'revenue', months] as const,
};

/** Not under ['founder']: every signed-in user reads this for the banner. */
export const activeAnnouncementsKey = ['announcements', 'active'] as const;

/**
 * Whether the signed-in user is founder@tryout.ca. `staleTime: Infinity` for the
 * same reason as the reviewer check: it can't change mid-session and gates a
 * nav item every route renders.
 */
export function useIsFounderQuery(enabled = true) {
  return useQuery({
    queryKey: founderKeys.isFounder,
    queryFn: () => founderApi.isFounder(),
    enabled,
    staleTime: Infinity,
  });
}

export function useFounderOrganizationsQuery(filter: FounderOrganizationFilter, enabled = true) {
  return useQuery({
    queryKey: founderKeys.organizations(filter),
    queryFn: () => founderApi.listFounderOrganizations(filter),
    enabled,
    // Keep the current page on screen while the next search/page loads.
    placeholderData: (previous) => previous,
  });
}

export function useFounderOrganizationQuery(accountId: string, enabled = true) {
  return useQuery({
    queryKey: founderKeys.organization(accountId),
    queryFn: () => founderApi.getFounderOrganization(accountId),
    enabled: enabled && !!accountId,
  });
}

export function useFounderTeamQuery(teamId: string, enabled = true) {
  return useQuery({
    queryKey: founderKeys.team(teamId),
    queryFn: () => founderApi.getFounderTeam(teamId),
    enabled: enabled && !!teamId,
  });
}

export function useFounderAuditLogQuery(enabled = true) {
  return useQuery({
    queryKey: founderKeys.auditLog,
    queryFn: () => founderApi.listFounderAuditLog(),
    enabled,
  });
}

export function useFounderAuditPageQuery(filter: FounderAuditFilter, enabled = true) {
  return useQuery({
    queryKey: founderKeys.auditPage(filter),
    queryFn: () => founderApi.listFounderAuditPage(filter),
    enabled,
    placeholderData: (previous) => previous,
  });
}

/** Every founder write changes the list and adds an audit row. */
function invalidateFounder(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: founderKeys.organizations() });
  void qc.invalidateQueries({ queryKey: founderKeys.auditLog });
}

export function useSetOrganizationSuspendedMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, suspended, reason }: { accountId: string; suspended: boolean; reason?: string }) =>
      founderApi.setOrganizationSuspended(accountId, suspended, reason),
    onSuccess: () => invalidateFounder(qc),
  });
}

export function useUpdateOrganizationAccessMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      accountId,
      planTier,
      access,
      trialDays,
    }: {
      accountId: string;
      planTier: string;
      access: FounderAccessKind;
      trialDays?: number;
    }) => founderApi.updateOrganizationAccess(accountId, planTier, access, trialDays),
    onSuccess: () => invalidateFounder(qc),
  });
}

export function useSetPlatformBlockedFeaturesMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blockedFeatures: BlockableFeature[]) => founderApi.setPlatformBlockedFeatures(blockedFeatures),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.platformBlockedFeatures });
      void qc.invalidateQueries({ queryKey: founderKeys.auditLog });
    },
  });
}

export function useSetPlatformBlockedPlanTiersMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blockedPlanTiers: PlanTier[]) => founderApi.setPlatformBlockedPlanTiers(blockedPlanTiers),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.platformBlockedPlanTiers });
      void qc.invalidateQueries({ queryKey: founderKeys.auditLog });
    },
  });
}

export function useSetDummyDataBlockedPlanTiersMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blockedPlanTiers: PlanTier[]) => founderApi.setDummyDataBlockedPlanTiers(blockedPlanTiers),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.dummyDataBlockedPlanTiers });
      void qc.invalidateQueries({ queryKey: founderKeys.auditLog });
    },
  });
}

export function useCreateFounderOrganizationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FounderCreateOrganizationInput) => founderApi.createFounderOrganization(input),
    onSuccess: () => invalidateFounder(qc),
  });
}

export function useFounderOrgEvaluationsQuery(accountId: string, enabled = true) {
  return useQuery({
    queryKey: founderKeys.orgEvaluations(accountId),
    queryFn: () => founderApi.listFounderOrgEvaluations(accountId),
    enabled: enabled && !!accountId,
  });
}

export function useFounderPlayerQuery(athleteId: string, enabled = true) {
  return useQuery({
    queryKey: founderKeys.player(athleteId),
    queryFn: () => founderApi.getFounderPlayer(athleteId),
    enabled: enabled && !!athleteId,
  });
}

export function useFounderEvaluationQuery(tryoutId: string, enabled = true) {
  return useQuery({
    queryKey: founderKeys.evaluation(tryoutId),
    queryFn: () => founderApi.getFounderEvaluation(tryoutId),
    enabled: enabled && !!tryoutId,
  });
}

export function useFounderRemovedParticipantsQuery(tryoutId: string, enabled = true) {
  return useQuery({
    queryKey: founderKeys.removedParticipants(tryoutId),
    queryFn: () => founderApi.listFounderRemovedParticipants(tryoutId),
    enabled: enabled && !!tryoutId,
  });
}

export function useFounderHiddenPlayerEvaluationsQuery(athleteId: string, enabled = true) {
  return useQuery({
    queryKey: founderKeys.hiddenPlayerEvaluations(athleteId),
    queryFn: () => founderApi.listFounderHiddenPlayerEvaluations(athleteId),
    enabled: enabled && !!athleteId,
  });
}

export function useFounderUsersQuery(filter: FounderUserFilter, enabled = true) {
  return useQuery({
    queryKey: founderKeys.users(filter),
    queryFn: () => founderApi.listFounderUsers(filter),
    enabled,
    // Keep the current page on screen while the next search/page loads.
    placeholderData: (previous) => previous,
  });
}

function invalidateFounderUsers(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: founderKeys.users() });
  void qc.invalidateQueries({ queryKey: founderKeys.auditLog });
}

export function useSetFounderUserRoleMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, accountId, role }: { userId: string; accountId: string; role: string }) =>
      founderApi.setFounderUserRole(userId, accountId, role),
    onSuccess: () => invalidateFounderUsers(qc),
  });
}

export function useResetFounderUserPasswordMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, email }: { userId: string; email: string }) =>
      founderApi.resetFounderUserPassword(userId, email),
    onSuccess: () => void qc.invalidateQueries({ queryKey: founderKeys.auditLog }),
  });
}

export function useResendFounderUserVerificationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, email }: { userId: string; email: string }) =>
      founderApi.resendFounderUserVerification(userId, email),
    onSuccess: () => void qc.invalidateQueries({ queryKey: founderKeys.auditLog }),
  });
}

export function useSetFounderUserBannedMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, banned, reason }: { userId: string; banned: boolean; reason?: string }) =>
      founderApi.setFounderUserBanned(userId, banned, reason),
    onSuccess: () => invalidateFounderUsers(qc),
  });
}

export function useDeleteFounderUserMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string }) =>
      founderApi.deleteFounderUser(userId, reason),
    onSuccess: () => invalidateFounderUsers(qc),
  });
}

/**
 * Runs one founder edit (see data/founder/founderWrites.ts) and refreshes every
 * founder read, since a single change — a renamed team, a restored evaluation —
 * shows up on several founder pages at once.
 */
export function useFounderSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (write: () => Promise<unknown>) => write(),
    // Returned, so mutateAsync resolves only once the open founder pages have
    // re-read: the form closes onto the new values, never the old ones. The
    // founder check itself can't change, so it isn't asked again.
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['founder'],
        predicate: (q) => q.queryKey[1] !== 'isFounder',
      }),
  });
}

// ─── Support & Content ──────────────────────────────────────────────────────

export function useSupportTicketsQuery(filter: { status?: SupportTicketStatus; search?: string }, enabled = true) {
  return useQuery({
    queryKey: founderKeys.supportTicketList(filter),
    queryFn: () => founderApi.listSupportTickets(filter),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useSupportTicketQuery(ticketId: string, enabled = true) {
  return useQuery({
    queryKey: founderKeys.supportTicket(ticketId),
    queryFn: () => founderApi.getSupportTicket(ticketId),
    enabled: enabled && !!ticketId,
  });
}

/** Every support write touches both the list and the open ticket. */
function useSupportMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // Refreshed on failure too: a reply SendGrid refused is still saved, with its error.
    onSettled: () => qc.invalidateQueries({ queryKey: founderKeys.supportTickets }),
  });
}

export const useCreateInboundSupportTicketMutation = () =>
  useSupportMutation(founderApi.createInboundSupportTicket);

export const useAddInboundSupportMessageMutation = () =>
  useSupportMutation(({ ticketId, body }: { ticketId: string; body: string }) =>
    founderApi.addInboundSupportMessage(ticketId, body),
  );

export const useSetSupportTicketStatusMutation = () =>
  useSupportMutation(({ ticketId, status }: { ticketId: string; status: SupportTicketStatus }) =>
    founderApi.setSupportTicketStatus(ticketId, status),
  );

export const useDeleteSupportTicketMutation = () =>
  useSupportMutation((ticketId: string) => founderApi.deleteSupportTicket(ticketId));

export const useSendSupportEmailMutation = () => useSupportMutation(founderApi.sendSupportEmail);

export function useAnnouncementsQuery(enabled = true) {
  return useQuery({
    queryKey: founderKeys.announcements,
    queryFn: () => founderApi.listAnnouncements(),
    enabled,
  });
}

/** The live banner for every signed-in user. Rechecked every few minutes so a new one shows without a reload. */
export function useActiveAnnouncementsQuery(enabled = true) {
  return useQuery({
    queryKey: activeAnnouncementsKey,
    queryFn: () => founderApi.listActiveAnnouncements(),
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

function useAnnouncementMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: founderKeys.announcements });
      void qc.invalidateQueries({ queryKey: activeAnnouncementsKey });
      void qc.invalidateQueries({ queryKey: founderKeys.auditLog });
    },
  });
}

export const useCreateAnnouncementMutation = () =>
  useAnnouncementMutation(
    (input: { title: string; message: string; severity: AnnouncementSeverity; endsAt?: string }) =>
      founderApi.createAnnouncement(input),
  );

export const useEndAnnouncementMutation = () => useAnnouncementMutation(founderApi.endAnnouncement);

export const useEmailAnnouncementMutation = () => useAnnouncementMutation(founderApi.emailAnnouncement);

export function useEmailActivityQuery(filter: EmailActivityFilter, enabled = true) {
  return useQuery({
    queryKey: founderKeys.emailActivity(filter),
    queryFn: () => founderApi.listEmailActivity(filter),
    enabled,
    // SendGrid rate-limits this API hard; don't refetch on every focus.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useEmailActivityEventsQuery(msgId: string | null) {
  return useQuery({
    queryKey: founderKeys.emailActivityEvents(msgId ?? ''),
    queryFn: () => founderApi.getEmailActivityEvents(msgId!),
    enabled: !!msgId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useFounderFunnelQuery(days: number) {
  return useQuery({
    queryKey: founderKeys.funnel(days),
    queryFn: () => founderApi.getFounderFunnel(days),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  });
}

export function useFeatureUsageQuery(days: number, platform: FeaturePlatform) {
  return useQuery({
    queryKey: founderKeys.featureUsage(days, platform),
    queryFn: () => founderApi.getFeatureUsage(days, platform),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
  });
}

export function useFeatureAccountsQuery(feature: string | null, days: number, platform: FeaturePlatform) {
  return useQuery({
    queryKey: founderKeys.featureAccounts(feature ?? '', days, platform),
    queryFn: () => founderApi.getFeatureAccounts(feature!, days, platform),
    enabled: !!feature,
    staleTime: 60_000,
  });
}

export function useFounderReferralsQuery() {
  return useQuery({
    queryKey: founderKeys.referrals,
    queryFn: () => founderApi.listFounderReferrals(),
    staleTime: 60_000,
  });
}

export function useFounderReferralBalancesQuery() {
  return useQuery({
    queryKey: founderKeys.referralBalances,
    queryFn: () => founderApi.listFounderReferralBalances(),
    staleTime: 60_000,
  });
}

// ─── Billing & Revenue ──────────────────────────────────────────────────────

export function useDiscountCodesQuery() {
  return useQuery({ queryKey: founderKeys.discountCodes, queryFn: () => billingApi.listDiscountCodes() });
}

export function useDiscountRedemptionsQuery(codeId: string | null) {
  return useQuery({
    queryKey: founderKeys.discountRedemptions(codeId ?? ''),
    queryFn: () => billingApi.listDiscountRedemptions(codeId!),
    enabled: !!codeId,
  });
}

export function useSaveDiscountCodeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: DiscountCodeInput }) => billingApi.saveDiscountCode(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: founderKeys.discountCodes });
      void qc.invalidateQueries({ queryKey: founderKeys.auditLog });
    },
  });
}

export function useFounderSubscriptionsQuery(filter: FounderSubscriptionFilter) {
  return useQuery({
    queryKey: founderKeys.subscriptions(filter),
    queryFn: () => billingApi.listSubscriptions(filter),
    placeholderData: (previous) => previous,
  });
}

export function useSubscriptionCountsQuery() {
  return useQuery({ queryKey: founderKeys.subscriptionCounts, queryFn: () => billingApi.getSubscriptionCounts() });
}

export function useStripeSubscriptionsQuery(accountId: string | null) {
  return useQuery({
    queryKey: founderKeys.stripeSubscriptions(accountId ?? ''),
    queryFn: () => billingApi.getAccountStripeSubscriptions(accountId!),
    enabled: !!accountId,
    retry: false,
  });
}

/**
 * Stripe subscription changes land in `accounts` only once stripe-webhook has
 * processed the event, so the list is refreshed now and again shortly after.
 */
function invalidateBilling(qc: QueryClient) {
  const run = () => {
    void qc.invalidateQueries({ queryKey: founderKeys.billing });
    void qc.invalidateQueries({ queryKey: founderKeys.organizations() });
    void qc.invalidateQueries({ queryKey: founderKeys.auditLog });
  };
  run();
  setTimeout(run, 4000);
}

export function useChangeStripePlanMutation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: billingApi.changeStripePlan, onSuccess: () => invalidateBilling(qc) });
}

export function useCancelStripeSubscriptionMutation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: billingApi.cancelStripeSubscription, onSuccess: () => invalidateBilling(qc) });
}

export function useResumeStripeSubscriptionMutation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: billingApi.resumeStripeSubscription, onSuccess: () => invalidateBilling(qc) });
}

export function useAddAccountCreditMutation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: billingApi.addAccountCredit, onSuccess: () => invalidateBilling(qc) });
}

export function useSetBillingDateMutation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: billingApi.setSubscriptionBillingDate, onSuccess: () => invalidateBilling(qc) });
}

/** Refreshes the billing tab's lists after a manual plan/access change. */
export function useInvalidateBilling() {
  const qc = useQueryClient();
  return () => invalidateBilling(qc);
}

export function usePaymentsQuery(filter: PaymentFilter) {
  return useInfiniteQuery({
    queryKey: founderKeys.payments(filter),
    queryFn: ({ pageParam }) => billingApi.listPayments(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function usePaymentQuery(chargeId: string | null) {
  return useQuery({
    queryKey: founderKeys.payment(chargeId ?? ''),
    queryFn: () => billingApi.getPayment(chargeId!),
    enabled: !!chargeId,
    retry: false,
  });
}

export function useRefundPaymentMutation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: billingApi.refundPayment, onSuccess: () => invalidateBilling(qc) });
}

export function useRevenueQuery(months: number) {
  return useQuery({
    queryKey: founderKeys.revenue(months),
    queryFn: () => billingApi.getRevenueData(months),
    placeholderData: (previous) => previous,
    // Pages through every Stripe subscription and charge; don't redo it on focus.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useFounderDashboardQuery() {
  return useQuery({
    queryKey: founderKeys.dashboard,
    queryFn: () => founderApi.getFounderDashboardStats(),
    refetchInterval: 60_000,
  });
}

export function useFounderOrgActivityQuery(accountId: string) {
  return useQuery({
    queryKey: founderKeys.orgActivity(accountId),
    queryFn: () => founderApi.getFounderOrgActivity(accountId),
    enabled: !!accountId,
  });
}

export function useSetOrganizationLimitsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, extraTeamLicenses }: { accountId: string; extraTeamLicenses: number }) =>
      founderApi.setOrganizationLimits(accountId, extraTeamLicenses),
    onSuccess: () => invalidateFounder(qc),
  });
}

export function useMergeFounderUsersMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fromUserId, intoUserId, reason }: { fromUserId: string; intoUserId: string; reason?: string }) =>
      founderApi.mergeFounderUsers(fromUserId, intoUserId, reason),
    onSuccess: () => {
      invalidateFounder(qc);
      invalidateFounderUsers(qc);
    },
  });
}
