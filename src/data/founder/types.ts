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
  | 'broadcast_email';

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
