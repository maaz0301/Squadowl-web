import type { AccountAccessStatus } from '@/lib/accountAccess';

/** One row of the founder console's organization list. */
export interface FounderOrganization {
  id: string;
  name: string;
  accountType: 'organization' | 'individual';
  planTier: string;
  subscriptionStatus: string;
  accessStatus: AccountAccessStatus;
  suspendedAt?: number;
  suspendedReason?: string;
  trialEndsAt?: number;
  isComp: boolean;
  ownerEmail?: string;
  memberCount: number;
  teamCount: number;
  createdAt: number;
}

export interface FounderOrganizationPage {
  items: FounderOrganization[];
  total: number;
}

export interface FounderOrganizationFilter {
  search?: string;
  status?: AccountAccessStatus;
  includeIndividual?: boolean;
  limit?: number;
  offset?: number;
}

/** 'active' = normal billing, 'trial' = expires after trialDays, 'comp' = free and never expires. */
export type FounderAccessKind = 'active' | 'trial' | 'comp';

export interface FounderCreateOrganizationInput {
  name: string;
  ownerEmail: string;
  ownerName?: string;
  planTier: string;
  access: FounderAccessKind;
  trialDays?: number;
  /** Email the owner their sign-in details (and a temporary password when their user is new). */
  sendInvite: boolean;
}

export interface FounderCreateOrganizationResult {
  id: string;
  /** A new user had to be created for the owner. */
  ownerCreated: boolean;
  inviteSent: boolean;
  /**
   * The new owner's temporary password, returned only when a user was created
   * and no invite went out — otherwise nobody would ever learn it.
   */
  temporaryPassword?: string;
  /** The owner's empty personal account became the organization. */
  convertedPersonalAccount: boolean;
}

/** Everything the founder console shows for one organization, read without switching into it. */
export interface FounderOrganizationDetail {
  org: FounderOrganization;
  sport?: string;
  members: { userId: string; email?: string; displayName?: string; role: string; joinedAt: number }[];
  teams: { id: string; name: string; archived: boolean; createdAt: number }[];
  tryoutCount: number;
  seasonCount: number;
  auditLog: FounderAuditEntry[];
  /**
   * Delegated team managers (team_managers table) — CLUB-mode delegates who
   * run one team without being a member of the organization at all. Invisible
   * on `members` above, which only ever lists direct `memberships` rows.
   */
  managedTeams: { teamId: string; teamName: string; userId?: string; email?: string; name?: string; role: string }[];
  /**
   * Assessors assigned to an evaluation (tryout_assessors table) — someone
   * invited to score one tryout, same gap as managedTeams: no memberships row
   * either, so they never show up as a "member" of the organization.
   */
  assignedEvaluations: {
    tryoutId: string;
    tryoutName: string;
    userId?: string;
    email?: string;
    name?: string;
    status?: string;
    /** Soft-deleted by the organization — its detail page can't be opened. */
    deletedAt?: number;
  }[];
}

/** One team, as the founder console shows it: everything on it, read-only. */
export interface FounderTeamDetail {
  id: string;
  accountId: string;
  accountName?: string;
  name: string;
  seasonLabel?: string;
  brandColor?: string;
  collectsFees: boolean;
  registrationFeeCents?: number;
  archived: boolean;
  createdAt: number;
  players: {
    id: string;
    athleteId?: string;
    firstName: string;
    lastName: string;
    jersey?: string;
    position?: string;
    yearOfBirth?: number;
    playerEmail?: string;
    guardianName?: string;
    guardianEmail?: string;
    guardianPhone?: string;
    defaultPosition?: string;
    about?: string;
    addedAt: number;
  }[];
  staff: { id: string; name?: string; email?: string; role: string }[];
  seasons: {
    id: string;
    name: string;
    year?: string;
    division?: string;
    coach?: string;
    archived: boolean;
    rosterCount: number;
    events: {
      id: string;
      title?: string;
      kind: string;
      date?: string;
      startTime?: string;
      endTime?: string;
      location?: string;
      notes?: string;
    }[];
  }[];
  evaluations: {
    id: string;
    name: string;
    eventType?: string;
    date?: string;
    location?: string;
    archived: boolean;
    /** Soft-deleted by the organization (tryouts.deleted_at). */
    deletedAt?: number;
    playerCount: number;
    assessors: { name?: string; email?: string; status?: string }[];
  }[];
}

/** One evaluation (tryout / assessment / combine) an organization ran, with or without a team. */
export interface FounderOrgEvaluation {
  id: string;
  name: string;
  eventType?: string;
  date?: string;
  location?: string;
  teamId?: string;
  teamName?: string;
  archived: boolean;
  /** Soft-deleted by the organization (tryouts.deleted_at). */
  deletedAt?: number;
  playerCount: number;
  createdAt: number;
}

/** A player taken off an evaluation's roster (tryout_participants.removed_at); their evaluations are kept. */
export interface FounderRemovedParticipant {
  participantId: string;
  athleteId?: string;
  firstName: string;
  lastName: string;
  jersey?: string;
  position?: string;
  removedAt: number;
  evalCount: number;
}

/**
 * An evaluation missing from a player's normal history: they were removed from
 * its roster, or the whole evaluation was deleted.
 */
export interface FounderHiddenPlayerEvaluation {
  participantId: string;
  tryoutId: string;
  tryoutName: string;
  eventType?: string;
  date?: string;
  teamName?: string;
  removedAt?: number;
  deletedAt?: number;
  evalCount: number;
}

export type FounderAuditAction =
  | 'suspend'
  | 'reactivate'
  | 'create_org'
  | 'update_access'
  | 'impersonate_start'
  | 'impersonate_end'
  | 'update_user_role'
  | 'reset_password'
  | 'resend_verification'
  | 'ban_user'
  | 'unban_user'
  | 'delete_user'
  | 'create_announcement'
  | 'end_announcement'
  | 'broadcast_email'
  | 'create_discount_code'
  | 'update_discount_code'
  | 'refund_payment'
  | 'change_subscription'
  | 'cancel_subscription'
  | 'resume_subscription'
  | 'delete_support_ticket'
  | 'update_team'
  | 'archive_team'
  | 'unarchive_team'
  | 'update_player'
  | 'add_player_to_team'
  | 'update_team_roster'
  | 'remove_player_from_team'
  | 'update_season'
  | 'archive_season'
  | 'unarchive_season'
  | 'add_season_event'
  | 'update_season_event'
  | 'delete_season_event'
  | 'update_tryout'
  | 'archive_tryout'
  | 'unarchive_tryout'
  | 'delete_tryout'
  | 'restore_tryout'
  | 'add_player_to_tryout'
  | 'update_participant'
  | 'remove_participant'
  | 'restore_participant'
  | 'update_assessor'
  | 'remove_assessor'
  | 'update_evaluation'
  | 'delete_evaluation'
  | 'update_platform_blocked_features'
  | 'update_platform_blocked_plan_tiers'
  | 'update_dummy_data_blocked_plan_tiers';

// ─── Support & Content ───────────────────────────────────────────────────────

export type SupportTicketStatus = 'open' | 'resolved';

export interface SupportMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  authorEmail?: string;
  /** SendGrid refused this outbound reply. */
  deliveryError?: string;
  createdAt: number;
}

export interface SupportTicket {
  id: string;
  email: string;
  userId?: string;
  subject: string;
  status: SupportTicketStatus;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface SupportTicketDetail extends SupportTicket {
  messages: SupportMessage[];
}

export type AnnouncementSeverity = 'info' | 'warning' | 'critical';

export interface PlatformAnnouncement {
  id: string;
  title: string;
  message: string;
  severity: AnnouncementSeverity;
  startsAt: number;
  endsAt?: number;
  createdAt: number;
  emailedAt?: number;
  emailRecipientCount?: number;
}

export type EmailActivityStatus = 'processed' | 'delivered' | 'not_delivered';

/** One row of SendGrid's Email Activity feed. */
export interface EmailActivityMessage {
  msgId: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  status: EmailActivityStatus;
  opensCount: number;
  clicksCount: number;
  lastEventTime: number;
}

export interface EmailActivityEvent {
  name: string;
  time: number;
  reason?: string;
}

export interface EmailActivityFilter {
  toEmail?: string;
  status?: EmailActivityStatus;
  days: number;
}

/** Roles the founder can assign; ownership is changed on the organization's own Members page instead. */
export type FounderAssignableRole = 'admin' | 'coach' | 'assessor' | 'guardian';

export interface FounderUserMembership {
  accountId: string;
  accountName: string;
  /** 'owner' | 'admin' | 'coach' | 'assessor' | 'guardian' */
  role: string;
}

/** One row of the founder console's user list — one person, every organization they belong to. */
export interface FounderUser {
  id: string;
  email?: string;
  displayName?: string;
  createdAt: number;
  lastSignInAt?: number;
  emailConfirmedAt?: number;
  /** Set (usually far in the future) while banned; absent or past otherwise. */
  bannedUntil?: number;
  memberships: FounderUserMembership[];
}

export interface FounderUserPage {
  items: FounderUser[];
  total: number;
}

export interface FounderUserFilter {
  /** Matches name, email, or the name of any organization they belong to. */
  search?: string;
  accountId?: string;
  role?: string;
  limit?: number;
  offset?: number;
}

export interface FounderAuditFilter {
  /** Matches the organization/target, the admin's email, or the reason. */
  search?: string;
  /** Restrict to these actions (one category of the Audit Log page). */
  actions?: FounderAuditAction[];
  /** Only entries from the last N days. */
  days?: number;
  limit?: number;
  offset?: number;
}

export interface FounderAuditPage {
  entries: FounderAuditEntry[];
  total: number;
}

export interface FounderAuditEntry {
  id: number;
  actorEmail?: string;
  action: FounderAuditAction;
  accountId?: string;
  accountName?: string;
  reason?: string;
  details: Record<string, unknown>;
  createdAt: number;
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface FunnelTotals {
  /** Distinct visitors to the sign-in / sign-up screens. */
  visitors: number;
  /** Of those, distinct visitors who reached /signup. */
  signupVisitors: number;
  /** New accounts created in the period. */
  signups: number;
  /** Of those new accounts, how many have started a trial so far. */
  trials: number;
  /** Of those new accounts, how many have paid so far. */
  paid: number;
  /** Trials started in the period, by accounts of any age. */
  trialsStarted: number;
  /** First payments in the period, by accounts of any age. */
  paidStarted: number;
  /** First day any visit was recorded — earlier periods have no visit data. */
  firstVisitDay?: string;
}

export interface FunnelDay {
  day: string;
  visitors: number;
  signups: number;
  trials: number;
  paid: number;
}

export interface FounderFunnel {
  days: number;
  totals: FunnelTotals;
  series: FunnelDay[];
  sources: { source: string; visitors: number }[];
}

/** Which app a feature use came from; 'all' = both. */
export type FeaturePlatform = 'all' | 'web' | 'mobile';

export interface FeatureUsageRow {
  feature: string;
  users: number;
  accounts: number;
  /** Person-days the feature was opened on. */
  activeDays: number;
  uses: number;
  webUses: number;
  mobileUses: number;
  lastUsedAt?: number;
}

export interface FeatureAccountUsage {
  accountId?: string;
  accountName?: string;
  ownerEmail?: string;
  users: { id: string; email: string; name?: string }[];
  activeDays: number;
  uses: number;
  lastUsedAt?: number;
}

export interface FounderReferral {
  referredAccountId: string;
  referredName: string;
  referredOwnerEmail?: string;
  referredCreatedAt: number;
  attributedAt?: number;
  subscriptionStatus?: string;
  firstPaidAt?: number;
  referrerAccountId: string;
  referrerName: string;
  referrerOwnerEmail?: string;
  referrerCode?: string;
  /** Credit this referral earned the referrer; absent if unpaid or over the annual cap. */
  creditCents?: number;
  creditedAt?: number;
}

export interface FounderReferralBalance {
  accountId: string;
  accountName: string;
  ownerEmail?: string;
  referralCode?: string;
  referredCount: number;
  paidCount: number;
  earnedCents: number;
  redeemedCents: number;
  adjustedCents: number;
  /** Credit still owed to this account. */
  balanceCents: number;
  earnedLastYearCents: number;
}

// ─── Billing & Revenue ───────────────────────────────────────────────────────
// See supabase/migrations/20260917130000_founder_billing.sql and
// supabase/functions/founder-billing.

export type DiscountKind = 'percent' | 'amount';
export type DiscountDuration = 'once' | 'forever' | 'repeating';
/** 'video_storage' ties a code to the video storage add-on instead of a plan. */
export type PaidPlanTier = 'coach' | 'coach_plus' | 'club' | 'video_storage';

export interface DiscountCodeInput {
  code: string;
  description?: string;
  kind: DiscountKind;
  percentOff?: number;
  amountOffCents?: number;
  duration: DiscountDuration;
  durationMonths?: number;
  maxUses?: number;
  maxUsesPerAccount?: number;
  /** Empty = every paid tier. */
  planTiers: PaidPlanTier[];
  expiresAt?: number;
  active: boolean;
}

export interface DiscountCode extends DiscountCodeInput {
  id: string;
  createdAt: number;
  uses: number;
  accountsUsed: number;
  discountTotalCents: number;
  lastUsedAt?: number;
}

export interface DiscountRedemption {
  id: string;
  accountId?: string;
  accountName?: string;
  ownerEmail?: string;
  checkoutSessionId: string;
  planTier?: string;
  discountCents: number;
  createdAt: number;
}

export type BillingFilter = 'paying' | 'comp' | 'trial' | 'free' | 'past_due' | 'canceling';

export interface FounderSubscriptionFilter {
  search?: string;
  tier?: string;
  billing?: BillingFilter;
  limit: number;
  offset: number;
}

export interface FounderSubscriptionAccount {
  id: string;
  name: string;
  accountType: string;
  planTier: string;
  subscriptionStatus: string;
  accessStatus: 'active' | 'trial' | 'suspended';
  isComp: boolean;
  trialEndsAt?: number;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionCancelAt?: number;
  pendingPlanTier?: string;
  pendingPlanChangeAt?: number;
  extraTeamLicenses: number;
  firstPaidAt?: number;
  ownerEmail?: string;
  createdAt: number;
}

export interface FounderSubscriptionPage {
  items: FounderSubscriptionAccount[];
  total: number;
}

export interface SubscriptionTierCount {
  planTier: string;
  accounts: number;
  paying: number;
  comp: number;
  trial: number;
  pastDue: number;
  canceling: number;
}

export interface StripeSubscriptionItem {
  id: string;
  priceId: string | null;
  tier: string | null;
  amountCents: number;
  quantity: number;
  interval: string | null;
  currency: string | null;
}

export interface StripeSubscription {
  id: string;
  status: string;
  tier: string | null;
  kind: 'plan' | 'addon';
  items: StripeSubscriptionItem[];
  created: number;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  canceledAt: number | null;
  endedAt: number | null;
  discount: {
    name: string;
    percentOff: number | null;
    amountOffCents: number | null;
    duration: string;
    endsAt: number | null;
  } | null;
}

export type PaymentStatusFilter = 'succeeded' | 'failed' | 'refunded' | 'disputed';

export interface PaymentFilter {
  search?: string;
  status?: PaymentStatusFilter;
  accountId?: string;
}

export interface BillingPayment {
  id: string;
  amountCents: number;
  amountRefundedCents: number;
  currency: string;
  status: string;
  refunded: boolean;
  disputed: boolean;
  created: number;
  description: string | null;
  customerId: string | null;
  email: string | null;
  accountId: string | null;
  accountName: string | null;
  invoiceId: string | null;
  paymentIntentId: string | null;
  receiptUrl: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  failureMessage: string | null;
}

export interface BillingPaymentPage {
  items: BillingPayment[];
  nextCursor: string | null;
  note?: string;
}

export type RefundReason = 'requested_by_customer' | 'duplicate' | 'fraudulent';

export interface BillingPaymentDetail extends BillingPayment {
  refunds: {
    id: string;
    amountCents: number;
    status: string;
    reason: string | null;
    note: string | null;
    refundedBy: string | null;
    created: number;
  }[];
  invoice: {
    id: string;
    number: string | null;
    hostedUrl: string | null;
    pdfUrl: string | null;
    subtotalCents: number;
    discountCents: number;
    lines: { description: string | null; amountCents: number; periodStart: number | null; periodEnd: number | null }[];
  } | null;
}
