import { z } from 'zod';
import { END_BEFORE_START_MESSAGE, isEndAfterStart } from './timeRange';

import { LETTER_KINDS } from './letters';

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

/**
 * Validate an optional email. Blank passes — a player email is never required,
 * so an empty field must not block a save the way a malformed one does.
 */
const isValidOptionalEmail = (val?: string) =>
  !val || !val.trim() || z.string().email().safeParse(val.trim()).success;

export const SPORTS = [
  'Hockey',
  'Ringette',
  'Soccer',
  'Football',
  'Basketball',
  'Tennis',
  'Volleyball',
  'Lacrosse',
  'Baseball',
  'Cricket',
  'Skating',
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
  /** `completed`: the assessor hit Complete Assessing — off their hub, data untouched. */
  status: z.enum(['pending', 'accepted', 'declined', 'completed']).optional().default('pending'),
  userId: z.string().optional().nullable(),
});

export type Assessor = z.infer<typeof AssessorSchema>;

export const SCORING_TYPES = [
  'skill',
  'time',
  'distance',
  'speed',
  /** Free 1–100 observation score; `rankingDirection` decides whether 1 or 100 is the best mark. */
  'observation',
  /** Two-state pass/fail — stored as 1 (yes) or 0 (no). */
  'yes_no',
  /** Two-state effectiveness call — stored as 1 (effective) or 0 (not effective). */
  'effectiveness',
] as const;
export type ScoringType = (typeof SCORING_TYPES)[number];

export const RANKING_DIRECTIONS = ['higher_is_better', 'lower_is_better'] as const;
export type RankingDirection = (typeof RANKING_DIRECTIONS)[number];

export const CustomRubricSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** Groups several rubrics under one shared heading (e.g. several drills under "Skating") for the ranked summary and printed reports. Unset rubrics stay ungrouped, each its own category — fully backward compatible. */
  category: z.string().optional(),
  scoringType: z.enum(SCORING_TYPES).default('skill'),
  scale: z.enum(['1-5', '1-10']).optional().default('1-5'),
  unit: z.string().optional(),
  minVal: z.number().optional(),
  maxVal: z.number().optional(),
  rankingDirection: z.enum(RANKING_DIRECTIONS).default('higher_is_better'),
  /** Share of the overall score this rubric carries, 1–100%. Unset rubrics split whatever weight is left over equally, so existing assessments keep their equal-weight behaviour. */
  weight: z.number().min(1).max(100).optional(),
  role: z.enum(['skater', 'goalie', 'all']).optional(),
});

export type CustomRubric = z.infer<typeof CustomRubricSchema>;

/** Renames of a few standard terms (per evaluation) for a few standard terms; see src/lib/terms.ts. */
export const CustomLabelsSchema = z.object({
  player: z.string().max(30).optional(),
  jersey: z.string().max(30).optional(),
  sport: z.string().max(30).optional(),
});
export type CustomLabels = z.infer<typeof CustomLabelsSchema>;

export const TryoutSettingsSchema = z.object({
  skaterWeights: z.record(z.string(), z.number()),
  goalieWeights: z.record(z.string(), z.number()),
  customRubrics: z.array(CustomRubricSchema).default([]),
  /** This evaluation's own renames (Player -> Skater ...); see src/lib/terms.ts. */
  customLabels: CustomLabelsSchema.optional(),
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
  /** Full date of birth, "YYYY-MM-DD", when known; the year above always accompanies it. */
  dateOfBirth: z.string().optional(),
  /** The player's own address, separate from their guardian's — either can be invited. */
  playerEmail: z.string().optional(),
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
  playerEmail: z.string().optional(),
  guardianName: z.string().optional(),
  guardianEmail: z.string().optional(),
  guardianPhone: z.string().optional(),
  linkedGuardianId: z.string().optional(),
  yearOfBirth: z.string().optional(),
  /** Full date of birth, "YYYY-MM-DD", when known; the year above always accompanies it. */
  dateOfBirth: z.string().optional(),
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
  /** The evaluation it was submitted to; empty for a registration made through a team's link. */
  eventId: z.string(),
  /** The team it was submitted to, for a registration made through a team's link. */
  teamId: z.string().optional(),
  firstName: z.string(),
  lastName: z.string(),
  yearOfBirth: z.string().optional(),
  /** Full date of birth, "YYYY-MM-DD", when known; the year above always accompanies it. */
  dateOfBirth: z.string().optional(),
  positionTryingOutFor: z.string().optional(),
  playerEmail: z.string().optional(),
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
  /**
   * Whether the signed-in user owns this assessment: their account created it,
   * or they are its lead assessor. Everyone else who can reach it — an invited
   * assessor, a helper working someone else's tryout — may score players and
   * edit the roster, nothing more: no results, settings, rubrics, export,
   * archive or delete. Computed per read by the datasource from the caller's
   * identity; never stored on the row, so it cannot be edited into being true.
   */
  viewerIsOwner: z.boolean().default(false),
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
  endTime?: string;
  rink?: string;
  sport: Sport;
  sportOther?: string;
  /** Small enough to come along for free, and the assigned list needs it. */
  assessors: Assessor[];
  /** Active roster size — soft-removed participants excluded, as elsewhere. */
  playerCount: number;
  archived: boolean;
  /** `plan_downgrade` when a plan drop archived it rather than the coach. */
  archivedReason?: 'plan_downgrade';
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
  /** Public registration code for the team's sign-up link; absent until the link is first created. */
  registrationCode: z.string().optional(),
  /** Whether the team's registration link currently accepts sign-ups. */
  registrationOpen: z.boolean().optional(),
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
  /**
   * Why an archived team was archived: `plan_downgrade` when a plan drop retired
   * it, `user` when the coach archived it. Both can be restored (once the plan
   * has room). Unset for a team the user deleted, which must stay gone.
   */
  archivedReason: z.enum(['plan_downgrade', 'user']).optional(),
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
  dateOfBirth: z.string().optional(),
  /**
   * Invite addresses, carried on the roster row itself. The team screen used to
   * dig these out of the full assessment read; "Send Invites" needs them for
   * every player at once, and a team's roster can outlive the assessment its
   * players came from.
   */
  playerEmail: z.string().optional(),
  guardianEmail: z.string().optional(),
  /**
   * Guardian contact and link state, also straight off the athlete row.
   * These used to be read only via the athlete's assessment-roster Player
   * record, so a team player who isn't on any assessment — added manually, or
   * whose assessment was archived — rendered every guardian field as "—" and
   * always badged as "Not Linked", regardless of what was actually on file.
   */
  guardianName: z.string().optional(),
  guardianPhone: z.string().optional(),
  linkedGuardianId: z.string().optional(),
  /**
   * Also on the athlete, and read here for the same reason as the guardian
   * fields: it was showing "—" for any team player not on an assessment roster.
   * Deliberately the only sensitive field pulled onto the roster read — see the
   * column list on the team_roster select. Omitted by the server entirely
   * unless `canViewMedical` is true.
   */
  medicalInfo: z.string().optional(),
  /**
   * True when the viewer is the account this athlete actually belongs to, or
   * is the athlete's own linked guardian — computed server-side off the
   * athlete row, same as PlayerProfile.canViewMedical. False for a delegated
   * team manager, even though they can see every other field on this row.
   */
  canViewMedical: z.boolean(),
  /** Assessment the athlete was added from, when known. */
  sourceTryoutId: z.string().optional(),
  sourceTryoutName: z.string().optional(),
});

export type TeamRosterPlayer = z.infer<typeof TeamRosterPlayerSchema>;

/**
 * Outcome of inviting a team's roster to the player/guardian portal.
 *
 * Partial success is the normal case, not an edge case: a roster of thirty
 * routinely has a handful of players with no address on file and the odd
 * address the mail provider rejects. Throwing on the first failure would hide
 * the twenty-seven that did go out, so every address is attempted and reported.
 */
export interface TeamInviteResult {
  /** Addresses an invite actually went to. */
  sent: string[];
  failed: { email: string; message: string }[];
  /** Players skipped for having neither a player nor a guardian email. */
  skipped: string[];
}

/**
 * Outcome of importing a roster out of a spreadsheet.
 *
 * Per-row, and never all-or-nothing: a thirty-row sheet with two bad addresses
 * in it should put twenty-eight players on the roster and say which two it
 * couldn't, not refuse the lot. `line` is the row's own line in the file, so
 * the coach can go and fix it there.
 */
export interface PlayerImportResult {
  added: number;
  failed: { line: number; name: string; message: string }[];
  /**
   * The athletes the import actually landed, when the add path reports them.
   * Lets the caller follow an import with the same automatic portal invite an
   * added player gets anywhere else, without re-reading the whole roster to
   * work out which rows were new.
   */
  athleteIds?: string[];
  /**
   * The roster rows the import landed, for paths keyed to the row rather than
   * the athlete — an evaluation invites by `tryout_participants.id`, since the
   * same athlete can sit in several evaluations at once.
   */
  participantIds?: string[];
}

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
  /** The organization's logo, printed on exported reports. */
  organizationLogoUrl: z.string().optional(),
  /** The account's renamed terms, if any. */
  customLabels: CustomLabelsSchema.optional(),
  avatarUrl: z.string().optional(),
  planTier: z.enum(PLAN_TIERS).default('coach'),
  subscriptionStatus: z.string().optional(),
  /**
   * When a scheduled cancellation takes effect, in ms. Portal cancellations are
   * taken at period end, so the plan stays live — and this is the only thing
   * that says it is ending. Undefined when the subscription renews normally.
   */
  subscriptionCancelAt: z.number().optional(),
  /**
   * A downgrade that has been chosen but not applied yet. Downgrades are
   * deferred to the end of the paid term, so the account keeps its current
   * tier until `pendingPlanChangeAt` and then moves to `pendingPlanTier`.
   * Both undefined when no change is scheduled.
   */
  pendingPlanTier: z.enum(PLAN_TIERS).optional(),
  pendingPlanChangeAt: z.number().optional(),
  /**
   * Access state of the working account — see src/lib/accountAccess.ts. A
   * suspended account's data is already cut off by RLS; this only lets the app
   * say so instead of failing every read.
   */
  accessStatus: z.enum(['active', 'trial', 'suspended']).optional(),
  suspendedReason: z.string().optional(),
  /** End of a founder-granted trial, in ms. */
  trialEndsAt: z.number().optional(),
  /** Suspended because that trial ran out, not by a founder action. */
  trialExpired: z.boolean().optional(),
  /** Set while the founder is viewing the app as this account (read-only). */
  impersonating: z.boolean().optional(),
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
  /** Optional loyalty referral code, entered right at signup. */
  referralCode: z.string().optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

/** Create assessment form */
export const CreateAssessmentFormSchema = z.object({
  name: z.string().min(2, 'Evaluation name required'),
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
}).refine((data) => isEndAfterStart(data.startTime, data.endTime), {
  message: END_BEFORE_START_MESSAGE,
  path: ['endTime'],
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
  /** Full date of birth, "YYYY-MM-DD", when known; the year above always accompanies it. */
  dateOfBirth: z.string().optional(),
  positionTryingOutFor: z.string().optional(),
  playerEmail: z
    .string()
    .optional()
    .refine(isValidOptionalEmail, { message: 'Please enter a valid email address' }),
  guardianName: z.string().optional(),
  guardianEmail: z
    .string()
    .optional()
    .refine(isValidOptionalEmail, { message: 'Please enter a valid email address' }),
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
  /** Full date of birth, "YYYY-MM-DD", when known; the year above always accompanies it. */
  dateOfBirth: z.string().optional(),
  positionTryingOutFor: z.string().optional(),
  playerEmail: z
    .string()
    .optional()
    .refine(isValidOptionalEmail, { message: 'Please enter a valid email address' }),
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
  /**
   * Set while the season's RSVP read is still in flight — getSeason() hands
   * back the events and roster first so the schedule can draw, then replaces
   * them with the same events carrying their RSVPs. An empty `availability`
   * alongside this means "still loading", so a view that shows RSVPs can wait
   * rather than claim nobody was invited.
   */
  availabilityPending: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});

export type SeasonEvent = z.infer<typeof SeasonEventSchema>;

/**
 * What one emailed RSVP link resolves to.
 *
 * Deliberately narrow: the token in the URL is the only credential the
 * recipient has, so it buys exactly this one event and the one player it was
 * issued for — never the rest of the roster or the rest of the schedule. See
 * `get_event_rsvp_context` in 20260910120000_event_rsvp_tokens.sql.
 */
export const EventRsvpContextSchema = z.object({
  eventId: z.string(),
  type: z.enum(EVENT_KINDS),
  title: z.string(),
  date: z.string(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  seasonName: z.string(),
  teamName: z.string(),
  playerName: z.string(),
  response: z.enum(['yes', 'maybe', 'no', 'pending']),
});

export type EventRsvpContext = z.infer<typeof EventRsvpContextSchema>;

/**
 * One player's RSVP link, as handed back when an event's links are minted.
 * Carries the addresses so the caller can build one email per recipient without
 * a second lookup.
 */
export interface EventRsvpToken {
  rosterId: string;
  playerName: string;
  playerEmail?: string;
  guardianEmail?: string;
  token: string;
}

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
  /**
   * Set on the first pass getSeason() publishes, where only the events have
   * loaded. An empty `roster` alongside this means "still loading", not "no
   * players" — see assembleSeasons.
   */
  rosterPending: z.boolean().optional(),
  scheduleShareToken: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archived: z.boolean().optional(),
});

export type Season = z.infer<typeof SeasonSchema>;

/**
 * What the Teams list actually renders for a season: an event count. The full
 * `Season` carries every roster entry (each joined to its full athlete row),
 * every event, RSVP availability and portal invite in the account —
 * assembling that just to draw "3 events" on a team card was the same
 * anti-pattern `TryoutSummary` fixed for tryouts. `listSeasonSummaries()`
 * fills this shape instead.
 *
 * Deliberately no player count. The card's headcount is team membership, which
 * lives in `team_roster` and is read by `countTeamPlayers()`; a season roster
 * is a different set that only grows, and reading it here is what made the
 * card's number wrong.
 */
/**
 * A place in a team roster's (created_at, id) order — see listTeamRosterPage.
 * Both halves are needed: created_at ties are the norm (a bulk add writes a
 * whole chunk on one timestamp), so the primary key breaks them.
 */
export type TeamRosterCursor = { createdAt: string; id: string };

export interface SeasonSummary {
  id: string;
  teamId?: string;
  eventCount: number;
}

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
  /** Minutes, from the Duration picker; the form turns it into endDate/endTime on save. */
  duration: z.number().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  playerIds: z.array(z.string()).optional(),
  /** Days of the week (0 = Sunday) to repeat on, from the Repeat picker. Empty or absent means one event. */
  repeatWeekdays: z.array(z.number()).optional(),
  /** Last date (YYYY-MM-DD) a repeating event may fall on. */
  repeatUntil: z.string().optional(),
}).refine((data) => !data.endDate || data.endDate >= data.date, {
  message: 'End date must be on or after the start date',
  path: ['endDate'],
}).refine((data) => (!!data.endDate && data.endDate > data.date) || isEndAfterStart(data.startTime, data.endTime), {
  message: END_BEFORE_START_MESSAGE,
  path: ['endTime'],
})
.refine((data) => !data.repeatWeekdays?.length || !!data.repeatUntil, {
  message: 'Pick the last date to repeat until',
  path: ['repeatUntil'],
})
.refine((data) => !data.repeatWeekdays?.length || !data.repeatUntil || data.repeatUntil >= data.date, {
  message: 'Repeat until must be on or after the start date',
  path: ['repeatUntil'],
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
  /** Full date of birth, "YYYY-MM-DD", when known. */
  dateOfBirth?: string;
  aboutChild?: string;
  /** Omitted by the server entirely unless `canViewMedical` is true — never sent to a viewer who shouldn't have it. */
  medicalInfo?: string;
  playerEmail?: string;
  guardianName?: string;
  guardianEmail?: string;
  guardianPhone?: string;
  /** The guardian's linked login, when the athlete has one. */
  linkedGuardianId?: string;
  pastSeasons: { seasonId: string; seasonName: string; teamName: string }[];
  /** Every team this athlete is currently rostered on (from Teams, not just self-reported text). */
  teams: { teamId: string; teamName: string }[];
  /** Newest first. */
  assessments: PlayerProfileAssessment[];
  /**
   * True when the viewer is the account this athlete actually belongs to
   * (`athletes.account_id`), or is the athlete's own linked guardian —
   * computed server-side off the same row, not guessed from role or a
   * separate teams query. False for a delegated team manager or an assessor
   * who merely has evaluation access.
   */
  canViewMedical: boolean;
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

export const ORG_MEMBER_SOURCES = ['membership', 'assessor', 'guardian', 'teamManager'] as const;
export type OrgMemberSource = (typeof ORG_MEMBER_SOURCES)[number];

export const OrgMemberSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  userId: z.string().optional(),
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(ORG_ROLES),
  status: z.enum(['pending', 'active', 'declined']).default('pending'),
  createdAt: z.number(),
  /**
   * Which grant put this person on the list. `id` is a row id from whichever
   * table that was, so it decides what a write against the row can do — a
   * delegated manager has no membership row, and the role change would have
   * nothing to update.
   */
  source: z.enum(ORG_MEMBER_SOURCES).optional(),
  /** Names of the teams delegated to them, for the teamManager rows. */
  teams: z.array(z.string()).optional(),
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
  /** Absent while the invitation is waiting for the invitee to create an account. */
  userId: z.string().optional(),
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(TEAM_MANAGER_ROLES),
  /** Saved invite with no account behind it yet; access is granted at sign-up. */
  pending: z.boolean().optional(),
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
  /** e.g. 0.005 for 0.5% — SquadOwl's cut of every registration fee collected via Connect. */
  platformFeeRate: number;
}

/** One line of an account's loyalty ledger — money earned or spent. */
export interface ReferralLedgerEntry {
  id: string;
  kind: 'earned' | 'redeemed' | 'adjustment';
  /** Positive credits the account, negative debits it. */
  amountCents: number;
  note?: string | null;
  created_at: string;
}

/** Everything the Loyalty Program screen renders, from get_referral_summary(). */
/** What the Upgrade page learns about a discount code before checkout (see preview_discount_code). */
export type DiscountCodePreview =
  | { valid: false; message: string }
  | {
      valid: true;
      code: string;
      kind: 'percent' | 'amount';
      percentOff?: number;
      amountOffCents?: number;
      duration: 'once' | 'forever' | 'repeating';
      durationMonths?: number;
      /** Empty = every paid plan. */
      planTiers: string[];
    };

export interface ReferralSummary {
  /** The account's own 9-character code, minted on first visit to the screen. */
  code: string | null;
  balanceCents: number;
  /** Earned in the trailing 365 days — what the annual cap is measured against. */
  earnedLastYearCents: number;
  annualCapCents: number;
  /** Signed up with this code, whether or not they've subscribed yet. */
  referredCount: number;
  /** Of those, how many converted to paid and actually paid out. */
  convertedCount: number;
  /** The code this account itself signed up with, if any. */
  redeemedByCode: string | null;
  entries: ReferralLedgerEntry[];
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

/** A person the signed-in user has blocked in team chat. */
export interface BlockedChatUser {
  userId: string;
  name: string;
  blockedAt: number;
}

export type ChatReportReason = 'spam' | 'harassment' | 'inappropriate' | 'other';

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
  /**
   * Deliberately the event's tombstone only — name, sport, when and where.
   * Scores, session results and recommendations belong to the coach who ran
   * the assessment, so they are never assembled into a guardian's payload;
   * see mapGuardianRosterRow().
   */
  tryouts: {
    id: string;
    name: string;
    sport: string;
    participantId: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    location?: string;
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
// ---- Player selection letters ----

/**
 * A letter a coach authored, ready to be sent to players.
 *
 * Templates hang off the *account*, not one assessment: a club sends the same
 * offer letter every tryout, and re-typing it each September is exactly what
 * this feature exists to stop. `tryoutId` records where it was first written,
 * for nothing more than ordering the coach's own templates sensibly.
 */
export const LetterTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(LETTER_KINDS),
  subject: z.string(),
  body: z.string(),
  tryoutId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type LetterTemplate = z.infer<typeof LetterTemplateSchema>;

/**
 * The copy of a letter attached to a player's card.
 *
 * `subject` and `body` are the *rendered* text as it was sent, not a reference
 * back to the template: editing a template afterwards must not rewrite history
 * on letters already in someone's inbox. Editing a sent letter here and
 * re-sending it does update this row — that is the coach correcting a letter
 * they already sent, which is the flow the request asks for.
 */
export const PlayerLetterSchema = z.object({
  id: z.string(),
  tryoutId: z.string(),
  /** tryout_participants row — the player as they exist in this assessment. */
  playerId: z.string(),
  athleteId: z.string().optional(),
  /** Null once the template it came from is deleted; the copy outlives it. */
  templateId: z.string().optional(),
  kind: z.enum(LETTER_KINDS),
  subject: z.string(),
  body: z.string(),
  recipientEmail: z.string().optional(),
  status: z.enum(['draft', 'sent', 'failed']),
  /** Why the last send failed, shown on the player card beside a Retry. */
  error: z.string().optional(),
  sentAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type PlayerLetter = z.infer<typeof PlayerLetterSchema>;

/** One player's outcome from a bulk send — see sendPlayerLetters(). */
export interface PlayerLetterSendResult {
  playerId: string;
  playerName: string;
  letter?: PlayerLetter;
  error?: string;
}

/** A comment on a season event, from staff or a guardian. */
export interface EventComment {
  id: string;
  eventId: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: number;
}

/** A file a coach attached to a season event. `url` is a short-lived signed link. */
export interface EventFile {
  id: string;
  eventId: string;
  name: string;
  path: string;
  size: number;
  contentType: string;
  createdAt: number;
  url?: string;
}

/** A file a coach attached to a feed post or an organization info item. `url` is a short-lived signed link. */
export interface FeedFile {
  id: string;
  parentId: string;
  name: string;
  path: string;
  size: number;
  contentType: string;
  createdAt: number;
  url?: string;
}

/** A coach's update on a team's news feed. */
export interface SeasonPost {
  id: string;
  seasonId: string;
  authorUserId: string;
  authorName: string;
  title: string;
  body: string;
  createdAt: number;
  files: FeedFile[];
  commentCount: number;
}

/** A comment on a feed post, from staff or a guardian. */
export interface PostComment {
  id: string;
  postId: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: number;
}

export const ORG_INFO_CATEGORIES = ['announcement', 'testing', 'competition', 'links', 'documents'] as const;
export type OrgInfoCategory = (typeof ORG_INFO_CATEGORIES)[number];
export const ORG_INFO_CATEGORY_LABELS: Record<OrgInfoCategory, string> = {
  announcement: 'Announcement',
  testing: 'Testing Info',
  competition: 'Competition Info',
  links: 'Important Links',
  documents: 'Documents',
};

/** Information an organization shares with every one of its teams. */
export interface OrgInfoItem {
  id: string;
  accountId: string;
  category: OrgInfoCategory;
  title: string;
  body: string;
  url: string;
  authorName: string;
  createdAt: number;
  files: FeedFile[];
}

export interface OrgInfoInput {
  category: OrgInfoCategory;
  title: string;
  body: string;
  url: string;
}

// --- Library ------------------------------------------------------------------
// Files, notes, videos and links an account stores once and shares with chosen
// audiences. Owners and admins manage it and always see everything; everyone
// else sees an item only when the toggle for a role they hold is on.

export const LIBRARY_KINDS = ['note', 'file', 'video', 'link'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export const LIBRARY_AUDIENCES = ['coaches', 'managers', 'assessors', 'players', 'guardians'] as const;
export type LibraryAudience = (typeof LIBRARY_AUDIENCES)[number];
export type LibraryAudienceFlags = Record<LibraryAudience, boolean>;

export const LIBRARY_AUDIENCE_LABELS: Record<LibraryAudience, string> = {
  coaches: 'Coaches',
  managers: 'Managers',
  assessors: 'Assessors',
  players: 'Players',
  guardians: 'Guardians',
};

/** Who can see a brand-new item: coaches only, until the owner turns more on. */
export const DEFAULT_LIBRARY_AUDIENCE: LibraryAudienceFlags = {
  coaches: true,
  managers: false,
  assessors: false,
  players: false,
  guardians: false,
};

export interface LibraryItem {
  id: string;
  accountId: string;
  /** The account's name, when the viewer is allowed to read it (guardians may not be). */
  accountName?: string;
  kind: LibraryKind;
  title: string;
  /** The note's text, or a description of a file, video or link. */
  body: string;
  /** External address for a link or a video hosted elsewhere. */
  url?: string;
  fileName?: string;
  filePath?: string;
  fileSize: number;
  contentType?: string;
  /** Short-lived signed address for an uploaded file. */
  fileUrl?: string;
  /** A video stored through the Video Storage Add-On (compressed, counted against the quota). */
  video?: import('./videoStorage').AccountVideo;
  audience: LibraryAudienceFlags;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryItemInput {
  kind: LibraryKind;
  title: string;
  body: string;
  url?: string;
  /** The video was uploaded to account storage and is attached after the item exists. */
  uploadedVideo?: boolean;
  audience: LibraryAudienceFlags;
}

// --- Player report cards ---------------------------------------------------------
// What a coach goes through with a family: the evaluations they chose to include,
// their own comments, optional AI comments, and files, videos or links. Scores
// are worked out from the chosen evaluations when a card is opened, not stored.

export interface ReportCardAttachment {
  kind: 'file' | 'video' | 'link';
  name: string;
  /** Storage key, for an uploaded file or video. */
  path?: string;
  /** External address, for a link or a video hosted elsewhere. */
  url?: string;
  size?: number;
  contentType?: string;
  /** Short-lived signed address for an uploaded file. */
  signedUrl?: string;
}

export interface PlayerReportCard {
  id: string;
  accountId: string;
  athleteId: string;
  tryoutId?: string;
  title: string;
  /** Ids of the evaluations (Evaluation.id) the card includes. */
  evalIds: string[];
  coachComments: string;
  aiComments: string;
  attachments: ReportCardAttachment[];
  createdAt: number;
  updatedAt: number;
}

export interface PlayerReportCardInput {
  /** Present when editing a saved card. */
  id?: string;
  athleteId: string;
  tryoutId: string;
  title: string;
  evalIds: string[];
  coachComments: string;
  aiComments: string;
  /** Attachments already on the card that should stay (uploads are added separately). */
  attachments: ReportCardAttachment[];
}
