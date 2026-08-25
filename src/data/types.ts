import { z } from 'zod';

/**
 * Validate a guardian phone number as 10–15 digits.
 * PhoneField stores the value as "+<code> <number>" (e.g. "+1 1234567890"), while
 * plain Input fields store just the national number. In both cases the country code
 * is excluded from the count so the "10–15 digits" rule applies to the number the
 * user actually types, regardless of which country code is selected.
 */
const isValidGuardianPhone = (val?: string) => {
  if (!val) return true;
  const trimmed = val.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const national = trimmed.startsWith('+') && spaceIdx !== -1 ? trimmed.slice(spaceIdx + 1) : trimmed;
  const digits = national.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
};

export const SPORTS = [
  'Hockey',
  'Soccer',
  'Football',
  'Basketball',
  'Tennis',
  'Volleyball',
  'Lacrosse',
  'Baseball',
  'Other',
] as const;

export type Sport = (typeof SPORTS)[number];

export const EVENT_TYPES = ['Tryout', 'Assessment', 'Sort Out', 'Combine'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// Postgres's plan_tier enum still allows 'pro'/'association' historically (enum values
// can't be dropped), but they were retired as sellable tiers and every account that was
// on one got migrated to 'club', which now has equal-or-greater limits and features. This
// list matches that current 4-tier model — not the raw DB enum.
export const PLAN_TIERS = ['free', 'coach', 'coach_plus', 'club'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const RECOMMENDATIONS = ['Make', 'Keep', 'Bubble', 'Release', ''] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const SCORE_SCALES = ['1-5', '1-10', 'speed', 'distance', 'height', 'time'] as const;
export type ScoreScale = (typeof SCORE_SCALES)[number];

export const POSITIONS = ['FWD', 'DEF', 'GTL', 'Other'] as const;
export type Position = (typeof POSITIONS)[number];

export const AssessorSchema = z.object({
  name: z.string(),
  email: z.string().email().optional().or(z.literal('')),
  role: z.enum(['lead', 'assistant', 'assessor']).default('assessor'),
  status: z.enum(['pending', 'accepted', 'declined']).optional().default('pending'),
  userId: z.string().optional().nullable(),
});

export type Assessor = z.infer<typeof AssessorSchema>;

export const SCORING_TYPES = ['skill', 'time', 'distance', 'speed'] as const;
export type ScoringType = (typeof SCORING_TYPES)[number];

export const RANKING_DIRECTIONS = ['higher_is_better', 'lower_is_better'] as const;
export type RankingDirection = (typeof RANKING_DIRECTIONS)[number];

export const CustomRubricSchema = z.object({
  key: z.string(),
  label: z.string(),
  scoringType: z.enum(SCORING_TYPES).default('skill'),
  scale: z.enum(['1-5', '1-10']).optional().default('1-5'),
  unit: z.string().optional(),
  minVal: z.number().optional(),
  maxVal: z.number().optional(),
  rankingDirection: z.enum(RANKING_DIRECTIONS).default('higher_is_better'),
  role: z.enum(['skater', 'goalie', 'all']).optional(),
});

export type CustomRubric = z.infer<typeof CustomRubricSchema>;

export const TryoutSettingsSchema = z.object({
  skaterWeights: z.record(z.string(), z.number()),
  goalieWeights: z.record(z.string(), z.number()),
  customRubrics: z.array(CustomRubricSchema).default([]),
  /** Marks an assessment stood up by the dummy-data generator, so the whole
   *  bundle (team + assessment + players) can be cleared again in one action. */
  isTestData: z.boolean().optional(),
});

export type TryoutSettings = z.infer<typeof TryoutSettingsSchema>;

export const CloudSessionSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  dirty: z.boolean().optional(),
  lastSyncAt: z.number().optional(),
  lastPushAt: z.number().optional(),
  lastError: z.string().optional(),
});

export type CloudSession = z.infer<typeof CloudSessionSchema>;

export const AthleteSchema = z.object({
  id: z.string(),
  first: z.string(),
  last: z.string(),
  yearOfBirth: z.string().optional(),
  guardianName: z.string().optional(),
  guardianEmail: z.string().optional(),
  guardianPhone: z.string().optional(),
  medicalInfo: z.string().optional(),
  aboutChild: z.string().optional(),
  currentPosition: z.string().optional(),
  currentTeam: z.string().optional(),
  currentLevel: z.string().optional(),
  jersey: z.string().optional(),
  pastSeasonsCount: z.number().optional(),
  avatarUrl: z.string().optional(),
});

export type Athlete = z.infer<typeof AthleteSchema>;

// Extra family members on an athlete's profile beyond the one primary
// guardian on the athlete row itself — a second parent, a grandparent, an
// emergency contact. Managed by the guardian from their own portal.
export const FamilyContactSchema = z.object({
  id: z.string(),
  athleteId: z.string(),
  name: z.string(),
  relationship: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});

export type FamilyContact = z.infer<typeof FamilyContactSchema>;

export const PlayerSchema = z.object({
  id: z.string(),
  athleteId: z.string().optional(),
  first: z.string(),
  last: z.string(),
  avatarUrl: z.string().optional(),
  anonymous: z.boolean().optional(),
  jersey: z.string().optional(),
  jerseyColour: z.string().optional(),
  pos: z.string().optional(),
  shoots: z.string().optional(),
  assignedAssessor: z.string().optional(),
  guardianName: z.string().optional(),
  guardianEmail: z.string().optional(),
  guardianPhone: z.string().optional(),
  linkedGuardianId: z.string().optional(),
  yearOfBirth: z.string().optional(),
  currentPosition: z.string().optional(),
  currentTeam: z.string().optional(),
  currentLevel: z.string().optional(),
  positionTryingOutFor: z.string().optional(),
  aboutChild: z.string().optional(),
  medicalInfo: z.string().optional(),
  friend1Name: z.string().optional(),
  friend2Name: z.string().optional(),
  sortOut: z.boolean().optional(),
  waiverAcceptedAt: z.number().optional(),
  registrationSource: z.enum(['manual', 'qr', 'import']).optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type Player = z.infer<typeof PlayerSchema>;

export const EvaluationSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  date: z.string(),
  evaluator: z.string(),
  session: z.string().default('Session 1'),
  strengths: z.string().optional(),
  improve: z.string().optional(),
  recommendation: z.enum(RECOMMENDATIONS).default(''),
  scores: z.record(z.string(), z.number()),
  source: z.enum(['manual', 'scan']).optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type Evaluation = z.infer<typeof EvaluationSchema>;

export const RegistrationSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  yearOfBirth: z.string().optional(),
  positionTryingOutFor: z.string().optional(),
  guardianName: z.string(),
  guardianEmail: z.string(),
  guardianPhone: z.string().optional(),
  currentTeam: z.string().optional(),
  currentLevel: z.string().optional(),
  aboutPlayer: z.string().optional(),
  medicalInfo: z.string().optional(),
  friend1Name: z.string().optional(),
  friend2Name: z.string().optional(),
  status: z.enum(['pending', 'added', 'dismissed']).default('pending'),
  paymentStatus: z.enum(['paid', 'partial', 'unpaid']).optional(),
  createdAt: z.number(),
});

export type Registration = z.infer<typeof RegistrationSchema>;

export const TryoutSchema = z.object({
  id: z.string(),
  name: z.string(),
  teamId: z.string().optional(),
  seasonId: z.string().optional(),
  orgId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  eventType: z.enum(EVENT_TYPES).default('Tryout'),
  tryoutDate: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  rink: z.string().optional(),
  sport: z.enum(SPORTS).default('Hockey'),
  sportOther: z.string().optional(),
  defaultPosition: z.string().optional(),
  headAssessor: z.string().optional(),
  headCoach: z.string().optional(),
  headAssessorEmail: z.string().optional(),
  assessors: z.array(AssessorSchema).default([]),
  roster: z.array(PlayerSchema).default([]),
  evals: z.array(EvaluationSchema).default([]),
  registrations: z.array(RegistrationSchema).optional(),
  settings: TryoutSettingsSchema,
  cloud: CloudSessionSchema.optional(),
  archived: z.boolean().default(false),
  teamBuilder: z.any().optional(),
  friendPackages: z.array(z.object({
    id: z.string(),
    name: z.string(),
    playerIds: z.array(z.string()),
    highlighted: z.boolean().optional(),
  })).optional(),
  aiAssessments: z.record(z.string(), z.any()).optional(),
});

export type Tryout = z.infer<typeof TryoutSchema>;

/**
 * What the list screens actually render for a tryout: the card fields plus a
 * roster headcount.
 *
 * The full `Tryout` carries every participant, athlete, assessor, evaluation,
 * evaluation score and registration attached to it. The dashboard and the
 * archived list only ever show a name, a sport, a date and "N players", so
 * assembling the full object to draw those cards meant the slowest query in
 * the app sat in front of the first screen a coach sees after signing in.
 * `listTryoutSummaries()` fills this shape instead — the tryout rows plus one
 * narrow count query — and the heavy read stays where the data is genuinely
 * needed (a single assessment, search, combine, exports).
 */
export interface TryoutSummary {
  id: string;
  name: string;
  teamId?: string;
  seasonId?: string;
  createdAt: number;
  updatedAt: number;
  eventType: EventType;
  tryoutDate?: string;
  startTime?: string;
  rink?: string;
  sport: Sport;
  sportOther?: string;
  /** Small enough to come along for free, and the assigned list needs it. */
  assessors: Assessor[];
  /** Active roster size — soft-removed participants excluded, as elsewhere. */
  playerCount: number;
  archived: boolean;
}

export const TeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  logoUrl: z.string().optional(),
  season: z.string().optional(),
  /** Whether this team collects a registration fee from guardians via Stripe. */
  collectsFees: z.boolean().optional(),
  /** Fee per player, in cents, charged only when collectsFees is true. */
  registrationFeeCents: z.number().optional(),
  /** Team brand colour as "#RRGGBB", tinting the team banner and printed results. */
  brandColor: z.string().optional(),
  /**
   * True when the caller reaches this team through a delegation rather than
   * through their own account — i.e. a club handed them this one team. Drives
   * the "Managed for <club>" banner treatment and hides account-level actions
   * (delete, billing) the delegate has no rights to anyway.
   */
  managed: z.boolean().optional(),
  /**
   * The owning account's plan tier, set only when `managed` is true. Lets a
   * delegate's screens gate features (exports, AI, Team Builder, custom
   * rubrics, fees) against the club's plan instead of the delegate's own —
   * the club already pays for the team, so the coach it was handed to
   * shouldn't hit an upgrade wall for it.
   */
  ownerPlanTier: z.enum(PLAN_TIERS).optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
  tombstone: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export type Team = z.infer<typeof TeamSchema>;

/** A player on a team's own roster, independent of any assessment. */
export const TeamRosterPlayerSchema = z.object({
  id: z.string(),
  athleteId: z.string(),
  first: z.string(),
  last: z.string(),
  jersey: z.string().optional(),
  pos: z.string().optional(),
  yearOfBirth: z.number().optional(),
  /** Assessment the athlete was added from, when known. */
  sourceTryoutId: z.string().optional(),
  sourceTryoutName: z.string().optional(),
});

export type TeamRosterPlayer = z.infer<typeof TeamRosterPlayerSchema>;

/** A permanently-saved snapshot of a Team Builder generation, so regenerating doesn't lose it. */
export const TeamBuilderResultSchema = z.object({
  id: z.string(),
  tryoutId: z.string(),
  label: z.string(),
  state: z.any(), // TeamBuilderState, see src/data/teamBuilder.ts
  createdAt: z.number(),
});

export type TeamBuilderResult = z.infer<typeof TeamBuilderResultSchema>;

export const UserProfileSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  organization: z.string().optional(),
  avatarUrl: z.string().optional(),
  planTier: z.enum(PLAN_TIERS).default('coach'),
  subscriptionStatus: z.string().optional(),
  /** Add-on team licenses purchased beyond the plan's included teams (Club: CAD$10/team/year). */
  extraTeamLicenses: z.number().int().min(0).default(0),
  /** Whether the account's Stripe Connect account can accept registration-fee charges/payouts. */
  connectChargesEnabled: z.boolean().default(false),
  connectPayoutsEnabled: z.boolean().default(false),
  createdAt: z.number(),
  onboardingCompleted: z.boolean().default(false),
  onboardingSteps: z
    .object({
      createTeam: z.boolean(),
      createAssessment: z.boolean(),
      inviteAssessors: z.boolean(),
      addPlayers: z.boolean(),
      scorePlayers: z.boolean(),
      changePassword: z.boolean().optional(),
    })
    .default({
      createTeam: false,
      createAssessment: false,
      inviteAssessors: false,
      addPlayers: false,
      scorePlayers: false,
      changePassword: false,
    }),
  role: z.string().optional(),
  emailVerified: z.boolean().default(true),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

export const AuthSessionSchema = z.object({
  token: z.string(),
  user: UserProfileSchema,
  expiresAt: z.number(),
});

export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const PasswordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

/** Login form */
export const LoginFormSchema = z.object({
  email: z.string().email('Valid email required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

/** Signup form */
export const SignupFormSchema = z.object({
  displayName: z.string().min(2, 'Name required'),
  email: z.string().email('Valid email required'),
  password: PasswordSchema,
  confirmPassword: z.string().min(1, 'Please confirm your password'),
  accountType: z.enum(['coach', 'guardian']).default('coach'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

/** Create assessment form */
export const CreateAssessmentFormSchema = z.object({
  name: z.string().min(2, 'Assessment name required'),
  sport: z.enum(SPORTS),
  sportOther: z.string().optional(),
  eventType: z.enum(EVENT_TYPES),
  tryoutDate: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  rink: z.string().optional(),
  teamId: z.string().optional(),
  headAssessor: z.string().optional(),
  headCoach: z.string().optional(),
});

export type CreateAssessmentForm = z.infer<typeof CreateAssessmentFormSchema>;

/** Add player form */
export const AddPlayerFormSchema = z.object({
  athleteId: z.string().optional(),
  first: z.string({ message: 'First name required' }).min(1, 'First name required'),
  last: z.string({ message: 'Last name required' }).min(1, 'Last name required'),
  jersey: z.string().optional(),
  pos: z.string().optional(),
  shoots: z.string().optional(),
  yearOfBirth: z.string().optional(),
  positionTryingOutFor: z.string().optional(),
  guardianName: z.string().optional(),
  guardianEmail: z
    .string({ message: 'Guardian email is required' })
    .min(1, 'Guardian email is required')
    .email('Please enter a valid email address'),
  guardianPhone: z.string().optional().refine(isValidGuardianPhone, { message: 'Phone number must be between 10 and 15 digits' }),
  currentTeam: z.string().optional(),
  currentLevel: z.string().optional(),
  aboutChild: z.string().optional(),
  medicalInfo: z.string().optional(),
  friend1Name: z.string().optional(),
  friend2Name: z.string().optional(),
  avatarUrl: z.string().optional(),
});

export type AddPlayerForm = z.infer<typeof AddPlayerFormSchema>;

/** Registration submit (simulated QR form) */
export const RegistrationSubmitSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  yearOfBirth: z.string().optional(),
  positionTryingOutFor: z.string().optional(),
  guardianName: z.string().min(1, 'Guardian name is required'),
  guardianEmail: z.string().email(),
  guardianPhone: z.string().optional().refine(isValidGuardianPhone, { message: 'Phone number must be between 10 and 15 digits' }),
  currentTeam: z.string().optional(),
  currentLevel: z.string().optional(),
  aboutPlayer: z.string().optional(),
  medicalInfo: z.string().optional(),
  friend1Name: z.string().optional(),
  friend2Name: z.string().optional(),
});

export type RegistrationSubmit = z.infer<typeof RegistrationSubmitSchema>;

/** Score form */
export const ScoreFormSchema = z.object({
  session: z.string(),
  strengths: z.string().optional(),
  improve: z.string().optional(),
  recommendation: z.enum(RECOMMENDATIONS).optional(),
  scores: z.record(z.string(), z.number()),
});

export type ScoreForm = z.infer<typeof ScoreFormSchema>;

export interface PlayerResult {
  player: Player;
  overall: number;
  evalCount: number;
  latestRecommendation: Recommendation;
  categoryScores: Record<string, number>;
}

export interface AssessorProgress {
  name: string;
  scored: number;
  total: number;
}

// ---- Phase 2: Team Builder & AI ----
export interface AiPlayerSummary {
  summary: string;
  key_strengths: string[];
  key_growth: string[];
  role_fit: string;
  confidence: number;
  trend: 'improving' | 'steady' | 'inconsistent' | 'insufficient_data';
}

export interface AiCompareSummary {
  summary: string;
  edge: string;
  best_fit: string;
  watch_list: string[];
  recommendation: string;
}

export type ExportFormat = 'csv' | 'pdf' | 'xlsx';

// ---- Phase 3: Seasons / Team Hub ----
export const EVENT_KINDS = ['Game', 'Practice', 'Event'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const AVAILABILITY_OPTIONS = ['yes', 'maybe', 'no', 'pending'] as const;
export type AvailabilityOption = (typeof AVAILABILITY_OPTIONS)[number];

export const SeasonPlayerSchema = z.object({
  id: z.string(),
  athleteId: z.string().optional(),
  firstName: z.string(),
  lastName: z.string(),
  jersey: z.string().optional(),
  guardianEmail: z.string().optional(),
  guardianPhone: z.string().optional(),
  playerEmail: z.string().optional(),
  portalInviteEmails: z.array(z.string()).optional(),
  portalInviteSentAt: z.number().optional(),
});

export type SeasonPlayer = z.infer<typeof SeasonPlayerSchema>;

export const SeasonEventSchema = z.object({
  id: z.string(),
  type: z.enum(EVENT_KINDS),
  title: z.string(),
  date: z.string(),
  endDate: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  availability: z.record(z.string(), z.enum(['yes', 'maybe', 'no', 'pending'])).optional(),
  /**
   * True when the RSVP read failed rather than genuinely coming back empty.
   * Without this the two are indistinguishable, and a coach who just invited a
   * full roster is told nobody was invited.
   */
  availabilityUnavailable: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type SeasonEvent = z.infer<typeof SeasonEventSchema>;

export const SeasonSchema = z.object({
  id: z.string(),
  name: z.string(),
  teamName: z.string(),
  sport: z.enum(SPORTS).default('Hockey'),
  year: z.string().optional(),
  division: z.string().optional(),
  coach: z.string().optional(),
  teamId: z.string().optional(),
  orgId: z.string().optional(),
  events: z.array(SeasonEventSchema).default([]),
  roster: z.array(SeasonPlayerSchema).default([]),
  scheduleShareToken: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archived: z.boolean().optional(),
});

export type Season = z.infer<typeof SeasonSchema>;

export const CreateSeasonFormSchema = z.object({
  name: z.string().min(2, 'Season name must be at least 2 characters'),
  teamName: z.string().min(2, 'Team name must be at least 2 characters'),
  sport: z.enum(SPORTS),
  year: z.string().optional(),
  division: z.string().optional(),
  coach: z.string().optional(),
  teamId: z.string().optional(),
});

export type CreateSeasonForm = z.infer<typeof CreateSeasonFormSchema>;

export const CreateEventFormSchema = z.object({
  type: z.enum(EVENT_KINDS),
  title: z.string().min(1, 'Title is required'),
  date: z.string().min(1, 'Date is required').regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format')
    .optional()
    .or(z.literal('')),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  playerIds: z.array(z.string()).optional(),
}).refine((data) => !data.endDate || data.endDate >= data.date, {
  message: 'End date must be on or after the start date',
  path: ['endDate'],
});

export type CreateEventForm = z.infer<typeof CreateEventFormSchema>;

export interface AthleteHistory {
  athleteId: string;
  pastSeasons: { seasonId: string; seasonName: string; teamName: string }[];
  pastEvaluations: Evaluation[];
}

export interface PlayerProfileAssessment {
  tryoutId: string;
  tryoutName: string;
  seasonId?: string;
  /** Name of the season this assessment belongs to (via its team's Season Hub entry), if any. */
  seasonName?: string;
  eventType: string;
  sport: Sport;
  date?: string;
  position?: string;
  /** Name of the team this assessment/tryout was run for, if any. */
  teamName?: string;
  /** Weighted overall score for this assessment (0 if no evaluations recorded yet). */
  overall: number;
  categoryScores: Record<string, number>;
  evalCount: number;
  latestRecommendation: Recommendation;
  /** tryout_participants.id — needed to deep-link back into that assessment's player screen. */
  participantId: string;
  /** The individual evaluations (sessions) that make up this assessment. */
  evaluations?: (Evaluation & { overall: number })[];
}

/** Cross-team/cross-season summary of one athlete's whole assessment history. */
export interface PlayerProfile {
  athleteId: string;
  first: string;
  last: string;
  avatarUrl?: string;
  currentPosition?: string;
  currentTeam?: string;
  currentLevel?: string;
  jersey?: string;
  yearOfBirth?: string;
  aboutChild?: string;
  medicalInfo?: string;
  guardianName?: string;
  guardianEmail?: string;
  guardianPhone?: string;
  pastSeasons: { seasonId: string; seasonName: string; teamName: string }[];
  /** Every team this athlete is currently rostered on (from Teams, not just self-reported text). */
  teams: { teamId: string; teamName: string }[];
  /** Newest first. */
  assessments: PlayerProfileAssessment[];
}

// ---- Phase 4: Enterprise & Admin ----
export const OrgSchema = z.object({
  id: z.string(),
  orgSlug: z.string(),
  orgName: z.string(),
  sport: z.string().optional(),
  memberCount: z.number().default(0),
  assessmentCount: z.number().default(0),
  playerCount: z.number().default(0),
  planTier: z.enum(PLAN_TIERS).default('club'),
  createdAt: z.number(),
});

export type Org = z.infer<typeof OrgSchema>;

export const ORG_ROLES = ['admin', 'coach', 'assessor', 'guardian'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const OrgMemberSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  userId: z.string().optional(),
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(ORG_ROLES),
  status: z.enum(['pending', 'active', 'declined']).default('pending'),
  createdAt: z.number(),
});

export type OrgMember = z.infer<typeof OrgMemberSchema>;

/**
 * Someone a club has handed a single team to (CLUB mode). Distinct from
 * OrgMember: a membership is account-wide, a team manager reaches exactly one
 * team. The club's own staff keep their access either way.
 */
export const TEAM_MANAGER_ROLES = ['manager', 'coach'] as const;
export type TeamManagerRole = (typeof TEAM_MANAGER_ROLES)[number];

export const TeamManagerSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  userId: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(TEAM_MANAGER_ROLES),
  createdAt: z.number(),
});

export type TeamManager = z.infer<typeof TeamManagerSchema>;

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalAssessments: number;
  totalRegistrations: number;
  planDistribution: Record<PlanTier, number>;
  revenueMtd: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  planTier: PlanTier;
  teamCount: number;
  assessmentCount: number;
  lastActiveAt: number;
}

export interface EnterprisePayment {
  id: string;
  playerName: string;
  teamName: string;
  assessmentName: string;
  amount: number;
  status: 'paid' | 'pending' | 'refunded';
  receivedAt: number;
}

export interface ConnectAccountStatus {
  connected: boolean;
  accountId?: string;
  email?: string | null;
  businessName?: string | null;
  country?: string | null;
  defaultCurrency?: string | null;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  /** e.g. 0.005 for 0.5% — TryoutHQ's cut of every registration fee collected via Connect. */
  platformFeeRate: number;
}

export const DatabaseSchema = z.object({
  version: z.number().default(2),
  tryouts: z.record(z.string(), TryoutSchema),
  teams: z.array(TeamSchema).default([]),
  seasons: z.record(z.string(), SeasonSchema).default({}),
  orgs: z.record(z.string(), OrgSchema).default({}),
  orgMembers: z.record(z.string(), OrgMemberSchema).default({}),
  profile: UserProfileSchema.optional(),
});

export type Database = z.infer<typeof DatabaseSchema>;

export interface TeamMessage {
  id: string;
  seasonId: string;
  authorUserId: string;
  authorName: string;
  authorRole: 'coach' | 'guardian';
  body: string;
  createdAt: number;
}

export interface CoachDirectoryEntry {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  accountId: string;
  accountName: string;
  sport?: string;
}

/**
 * shared    = pending coach response
 * assigned  = this coach accepted + placed the athlete into one of their assessments
 * declined  = this coach explicitly rejected
 * withdrawn = auto-closed because another coach accepted the same athlete first
 * released  = the coach later removed the athlete from their roster
 */
export type AthleteShareStatus = 'shared' | 'assigned' | 'declined' | 'withdrawn' | 'released';

export interface AthleteShare {
  id: string;
  athleteId: string;
  status: AthleteShareStatus;
  /** Snapshot of the athlete's profile at share time. */
  athlete: {
    firstName: string;
    lastName: string;
    avatarUrl?: string;
    yearOfBirth?: number;
    position?: string;
    guardianName?: string;
    guardianEmail?: string;
    guardianPhone?: string;
    medicalInfo?: string;
    about?: string;
  };
  /**
   * Frozen assessment history at share time — the receiving coach has no RLS
   * access to the guardian's original club's tryouts/evaluations (by design,
   * so a share can't leak that account's whole roster), so this is a snapshot
   * rather than a live query. Same shape PlayerProfile.assessments uses, so
   * it renders with the same <AssessmentHistory> component.
   */
  assessments: PlayerProfileAssessment[];
  /** Snapshot of the coach at share time. */
  coach: {
    userId: string;
    displayName: string;
    avatarUrl?: string;
    accountId: string;
    accountName: string;
    sport?: string;
  };
  guardianUserId: string;
  assignedTryoutId?: string;
  assignedAthleteId?: string;
  assignedParticipantId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ShareComment {
  id: string;
  shareId: string;
  authorUserId: string;
  authorName: string;
  authorRole: 'guardian' | 'coach';
  body: string;
  createdAt: number;
}

export interface GuardianRosterAthlete {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  tryouts: {
    id: string;
    name: string;
    sport: string;
    participantId: string; // <-- ADD THIS LINE HERE
    sessions: {
      name: string;
      result?: string;
      date?: number;
      scores?: Record<string, number>;
    }[];
  }[];
  seasons: {
    id: string;
    name: string;
    teamName: string;
    sport: string;
    jersey?: string;
    events?: SeasonEvent[];
    /** season_roster row id — what payment/fee actions key off, not the season id. */
    seasonRosterId: string;
    collectsFees: boolean;
    registrationFeeCents?: number;
    feeStatus: 'unpaid' | 'paid' | 'waived';
  }[];
}