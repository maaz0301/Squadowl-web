import type { AccountAccessStatus } from '@/lib/accountAccess';
import type {
  AnnouncementSeverity,
  EmailActivityStatus,
  FounderAccessKind,
  FounderAssignableRole,
  FounderAuditAction,
} from '@/data/founder/types';
import { PLAN_TIERS, type PlanTier } from '@/data/types';
import { getPlanDefinition } from '@/data/plans';

export const STATUS_BADGE: Record<AccountAccessStatus, { label: string; variant: 'success' | 'info' | 'danger' }> = {
  active: { label: 'Active', variant: 'success' },
  trial: { label: 'Trial', variant: 'info' },
  suspended: { label: 'Suspended', variant: 'danger' },
};

/** Sellable tiers only; legacy enum values ('pro', 'association') are shown but not offered. */
export const PLAN_OPTIONS = PLAN_TIERS.map((tier) => ({ value: tier, label: getPlanDefinition(tier).name }));

export function planLabel(tier: string | undefined): string {
  if (!tier) return 'No plan';
  return (PLAN_TIERS as readonly string[]).includes(tier)
    ? getPlanDefinition(tier as PlanTier).name
    : `${tier.charAt(0).toUpperCase()}${tier.slice(1)} (legacy)`;
}

export const ACCESS_OPTIONS: { value: FounderAccessKind; label: string }[] = [
  { value: 'active', label: 'Active — normal billing' },
  { value: 'trial', label: 'Trial — expires after set days' },
  { value: 'comp', label: 'Comp — free, never expires' },
];

export const AUDIT_ACTION_LABEL: Record<FounderAuditAction, string> = {
  suspend: 'Suspended',
  reactivate: 'Reactivated',
  create_org: 'Created organization',
  update_access: 'Changed plan / access',
  impersonate_start: 'Started viewing as',
  impersonate_end: 'Stopped viewing as',
  update_user_role: 'Changed role for',
  reset_password: 'Sent password reset to',
  resend_verification: 'Resent verification to',
  ban_user: 'Banned',
  unban_user: 'Unbanned',
  delete_user: 'Deleted user',
  create_announcement: 'Posted announcement',
  end_announcement: 'Ended announcement',
  broadcast_email: 'Emailed announcement',
  create_discount_code: 'Created discount code',
  update_discount_code: 'Edited discount code',
  refund_payment: 'Refunded payment for',
  change_subscription: 'Changed Stripe subscription for',
  cancel_subscription: 'Cancelled Stripe subscription for',
  resume_subscription: 'Resumed Stripe subscription for',
  delete_support_ticket: 'Deleted support ticket for',
  update_team: 'Edited a team in',
  archive_team: 'Archived a team in',
  unarchive_team: 'Unarchived a team in',
  update_player: 'Edited a player in',
  add_player_to_team: 'Added a player to a team in',
  update_team_roster: 'Edited a roster entry in',
  remove_player_from_team: 'Removed a player from a team in',
  update_season: 'Edited a season in',
  archive_season: 'Archived a season in',
  unarchive_season: 'Unarchived a season in',
  add_season_event: 'Added a season event in',
  update_season_event: 'Edited a season event in',
  delete_season_event: 'Deleted a season event in',
  update_tryout: 'Edited an evaluation in',
  archive_tryout: 'Archived an evaluation in',
  unarchive_tryout: 'Unarchived an evaluation in',
  delete_tryout: 'Deleted an evaluation in',
  restore_tryout: 'Restored an evaluation in',
  add_player_to_tryout: 'Added a player to an evaluation in',
  update_participant: 'Edited a participant in',
  remove_participant: 'Removed a participant in',
  restore_participant: 'Restored a participant in',
  update_assessor: 'Edited an assessor in',
  remove_assessor: 'Removed an assessor in',
  update_evaluation: 'Edited evaluation scores in',
  delete_evaluation: 'Deleted an evaluation record in',
  update_platform_blocked_features: 'Changed platform-wide blocked sections for',
  update_platform_blocked_plan_tiers: 'Changed platform-wide blocked plan tiers for',
  update_dummy_data_blocked_plan_tiers: 'Changed which plans have dummy-data tools for',
};

export const AUDIT_CATEGORIES: { value: string; label: string; actions: FounderAuditAction[] }[] = [
  { value: '', label: 'All activity', actions: [] },
  {
    value: 'organizations',
    label: 'Organizations & access',
    actions: [
      'suspend',
      'reactivate',
      'create_org',
      'update_access',
      'update_platform_blocked_features',
      'update_platform_blocked_plan_tiers',
      'update_dummy_data_blocked_plan_tiers',
    ],
  },
  { value: 'view_as', label: 'View-as sessions', actions: ['impersonate_start', 'impersonate_end'] },
  {
    value: 'users',
    label: 'Users',
    actions: ['update_user_role', 'reset_password', 'resend_verification', 'ban_user', 'unban_user', 'delete_user'],
  },
  {
    value: 'billing',
    label: 'Billing',
    actions: [
      'create_discount_code',
      'update_discount_code',
      'refund_payment',
      'change_subscription',
      'cancel_subscription',
      'resume_subscription',
    ],
  },
  {
    value: 'support',
    label: 'Support & announcements',
    actions: ['create_announcement', 'end_announcement', 'broadcast_email', 'delete_support_ticket'],
  },
  {
    value: 'edits',
    label: 'Team, player & evaluation edits',
    actions: [
      'update_team', 'archive_team', 'unarchive_team',
      'update_player', 'add_player_to_team', 'update_team_roster', 'remove_player_from_team',
      'update_season', 'archive_season', 'unarchive_season',
      'add_season_event', 'update_season_event', 'delete_season_event',
      'update_tryout', 'archive_tryout', 'unarchive_tryout', 'delete_tryout', 'restore_tryout',
      'add_player_to_tryout', 'update_participant', 'remove_participant', 'restore_participant',
      'update_assessor', 'remove_assessor', 'update_evaluation', 'delete_evaluation',
    ],
  },
];

export const SEVERITY_OPTIONS: { value: AnnouncementSeverity; label: string }[] = [
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning — e.g. maintenance tonight' },
  { value: 'critical', label: 'Critical — e.g. outage in progress' },
];

export const SEVERITY_BADGE: Record<AnnouncementSeverity, { label: string; variant: 'info' | 'warning' | 'danger' }> = {
  info: { label: 'Info', variant: 'info' },
  warning: { label: 'Warning', variant: 'warning' },
  critical: { label: 'Critical', variant: 'danger' },
};

export const EMAIL_STATUS_BADGE: Record<EmailActivityStatus, { label: string; variant: 'success' | 'info' | 'danger' }> = {
  delivered: { label: 'Delivered', variant: 'success' },
  processed: { label: 'Processing', variant: 'info' },
  not_delivered: { label: 'Not delivered', variant: 'danger' },
};

export const USER_ROLE_OPTIONS: { value: FounderAssignableRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'coach', label: 'Coach' },
  { value: 'assessor', label: 'Assessor' },
  { value: 'guardian', label: 'Guardian' },
];

export function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export const ROLE_BADGE_VARIANT: Record<string, 'success' | 'info' | 'danger' | 'brand'> = {
  owner: 'brand',
  admin: 'brand',
  coach: 'info',
  assessor: 'info',
  guardian: 'success',
};

/** banned_until reads as a real ban only while it's still in the future — unbanning may clear it or just set it to a past time. */
export function isUserBanned(bannedUntil: number | undefined): boolean {
  return !!bannedUntil && bannedUntil > Date.now();
}

export function formatDate(ms: number, withTime = false): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}
