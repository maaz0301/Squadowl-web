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
};

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
