import type {
  AddPlayerForm,
  Assessor,
  AdminStats,
  AdminUserRow,
  AiCompareSummary,
  AiPlayerSummary,
  AuthSession,
  CreateAssessmentForm,
  CreateEventForm,
  CreateSeasonForm,
  EnterprisePayment,
  Evaluation,
  ExportFormat,
  GuardianRosterAthlete,
  Org,
  OrgMember,
  OrgRole,
  Player,
  Registration,
  RegistrationSubmit,
  ScoreForm,
  Season,
  SeasonEvent,
  SeasonSummary,
  Athlete,
  AthleteHistory,
  Team,
  TeamBuilderResult,
  Tryout,
  TryoutSummary,
  UserProfile,
} from './types';
import type { TeamBuilderConfig, TeamBuilderState } from './teamBuilder';

export interface DataSource {
  // Auth
  login(email: string, password: string): Promise<AuthSession>;
  signup(displayName: string, email: string, password: string, accountType: string): Promise<AuthSession>;
  logout(): Promise<void>;
  getSession(forceRefresh?: boolean): Promise<AuthSession | null>;
  getProfile(forceRefresh?: boolean): Promise<UserProfile | null>;
  updateProfile(updates: Partial<UserProfile>): Promise<UserProfile>;
  updatePassword(password: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  verifyPasswordResetOtp(email: string, token: string): Promise<void>;
  resetPasswordWithOtp(email: string, token: string, newPassword: string): Promise<void>;
  resendVerificationEmail(email: string): Promise<void>;
  checkUserExistsByEmail(email: string): Promise<boolean>;
  uploadCoachPhoto(userId: string, fileUri: string, fileType: string): Promise<string>;
  uploadTeamLogo(teamId: string, fileUri: string, fileType: string): Promise<string>;

  // Teams
  listTeams(): Promise<Team[]>;
  /** Teams on the caller's own account — what plan team limits are measured against. */
  countTeams(): Promise<number>;
  createTeam(name: string, season?: string): Promise<Team>;
  deleteTeam(id: string): Promise<void>;

  // Tryouts
  listTryouts(includeArchived?: boolean): Promise<Tryout[]>;
  /**
   * Card-shaped tryouts for the list screens — see TryoutSummary. Prefer this
   * over listTryouts() anywhere the screen only draws names, dates and roster
   * counts; it skips the participant, athlete, evaluation, score and
   * registration reads entirely.
   */
  listTryoutSummaries(includeArchived?: boolean): Promise<TryoutSummary[]>;
  /** Assessment count for plan limit checks, without assembling every roster and evaluation. */
  countAssessments(): Promise<number>;
  /** Tryouts the current user is invited to as an assessor (not owned by their account). */
  listAssignedTryouts(): Promise<Tryout[]>;
  /** listAssignedTryouts() in the light shape the dashboard's "Assigned to me" list needs. */
  listAssignedTryoutSummaries(): Promise<TryoutSummary[]>;
  acceptAssignedTryout(tryoutId: string): Promise<void>;
  rejectAssignedTryout(tryoutId: string): Promise<void>;
  getTryout(id: string): Promise<Tryout | null>;
  createTryout(form: CreateAssessmentForm): Promise<Tryout>;
  updateTryout(id: string, updates: Partial<Tryout>): Promise<Tryout>;
  archiveTryout(id: string): Promise<Tryout>;
  deleteTryout(id: string): Promise<void>;

  // Players
  addPlayer(tryoutId: string, form: AddPlayerForm): Promise<Player>;
  updatePlayer(tryoutId: string, playerId: string, updates: Partial<Player>): Promise<Player>;
  deletePlayer(tryoutId: string, playerId: string): Promise<void>;
  uploadPlayerPhoto(athleteId: string, fileUri: string, fileType: string): Promise<string>;

  // Evaluations
  saveEvaluation(
    tryoutId: string,
    playerId: string,
    form: ScoreForm,
    evalId?: string,
    activeAssessor?: Assessor | null,
  ): Promise<Evaluation>;
  deleteEvaluation(tryoutId: string, evalId: string): Promise<void>;

  // Registration (QR mock)
  ensureCloudSession(tryoutId: string): Promise<Tryout>;
  listRegistrations(tryoutId: string): Promise<Registration[]>;
  submitRegistration(tryoutId: string, form: RegistrationSubmit): Promise<Registration>;
  addRegistrationToRoster(tryoutId: string, registrationId: string): Promise<Player>;
  /** Place a registration straight onto a team's own roster, with no assessment involved. */
  addRegistrationToTeam(teamId: string, registrationId: string): Promise<import('./types').TeamRosterPlayer[]>;
  /** Bulk twins of the two single-registration placements above, for a multi-select "Add N to Roster". */
  addRegistrationsToRoster(
    tryoutId: string,
    registrationIds: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number>;
  addRegistrationsToTeam(
    teamId: string,
    registrationIds: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number>;
  dismissRegistration(tryoutId: string, registrationId: string): Promise<void>;

  // Phase 2: Team Builder, AI, Export
  generateTeamBuilder(tryoutId: string, config: TeamBuilderConfig): Promise<TeamBuilderState>;
  listTeamBuilderResults(tryoutId: string): Promise<TeamBuilderResult[]>;
  saveTeamBuilderResult(tryoutId: string, label: string, state: TeamBuilderState): Promise<TeamBuilderResult>;
  deleteTeamBuilderResult(id: string): Promise<void>;
  getAiPlayerSummary(tryoutId: string, playerId: string): Promise<AiPlayerSummary>;
  getAiCompare(tryoutId: string, playerIds: string[]): Promise<AiCompareSummary>;
  exportTryout(tryoutId: string, format: ExportFormat): Promise<{ content: string; filename: string }>;
  createShareLink(tryoutId: string, label?: string): Promise<{ token: string; expiresAt: number }>;

  // Phase 3: Seasons
  listSeasons(): Promise<Season[]>;
  /** The Teams list's read — see SeasonSummary. */
  listSeasonSummaries(): Promise<SeasonSummary[]>;
  getSeason(id: string): Promise<Season | null>;
  createSeason(form: CreateSeasonForm): Promise<Season>;
  updateSeason(id: string, updates: Partial<Season>): Promise<Season>;
  deleteSeason(id: string): Promise<void>;
  /** onProgress reports guardian-email invite fanout: (sent, total). */
  addSeasonEvent(
    seasonId: string,
    form: CreateEventForm,
    onProgress?: (done: number, total: number) => void,
  ): Promise<SeasonEvent>;
  updateSeasonEvent(seasonId: string, eventId: string, updates: Partial<SeasonEvent>): Promise<SeasonEvent>;
  deleteSeasonEvent(seasonId: string, eventId: string): Promise<void>;
  sendPortalInvite(seasonId: string, playerId: string, email: string): Promise<void>;
  sendTeamAnnouncement(seasonId: string, title: string, message: string): Promise<void>;
  setEventAvailability(seasonId: string, eventId: string, playerId: string, response: 'yes' | 'maybe' | 'no'): Promise<void>;
  getAthleteHistory(athleteId: string): Promise<AthleteHistory>;
  listAthletes(): Promise<Athlete[]>;
  getPlayerProfile(athleteId: string): Promise<import('./types').PlayerProfile>;

  // Team chat (season-scoped): staff on the season's account plus the guardian
  // of any athlete on its roster share this conversation.
  listTeamMessages(seasonId: string): Promise<import('./types').TeamMessage[]>;
  sendTeamMessage(seasonId: string, body: string): Promise<import('./types').TeamMessage>;
  deleteTeamMessage(messageId: string): Promise<void>;

  // Guardian -> Coach athlete profile sharing
  getCoachDirectory(): Promise<import('./types').CoachDirectoryEntry[]>;
  shareAthleteWithCoach(athleteId: string, coachUserId: string, coachAccountId: string): Promise<import('./types').AthleteShare>;
  getMyAthleteShares(athleteId: string): Promise<import('./types').AthleteShare[]>;
  getSharedAthletesForCoach(): Promise<import('./types').AthleteShare[]>;
  getAthleteShare(shareId: string): Promise<import('./types').AthleteShare>;
  acceptAthleteShare(shareId: string, tryoutId: string): Promise<import('./types').AthleteShare>;
  rejectAthleteShare(shareId: string): Promise<import('./types').AthleteShare>;
  listShareComments(shareId: string): Promise<import('./types').ShareComment[]>;
  addShareComment(shareId: string, body: string): Promise<import('./types').ShareComment>;

  // Phase 4: Enterprise & Admin
  getOrg(): Promise<Org | null>;
  getEnterprisePayments(): Promise<EnterprisePayment[]>;
  getAdminStats(): Promise<AdminStats>;
  listAdminUsers(): Promise<AdminUserRow[]>;
  overrideUserPlan(userId: string, planTier: UserProfile['planTier']): Promise<void>;
  createCheckoutSession(planTier: string, interval: 'year' | 'month'): Promise<{ url: string }>;
  /** Checkout for add-on team licenses beyond the plan's included teams (Club: CAD$10/team/year). */
  createTeamLicenseCheckoutSession(quantity: number): Promise<{ url: string }>;
  createPortalSession(): Promise<{ url: string }>;
  /** Stripe Connect Standard onboarding for coaches collecting registration fees. */
  createConnectAccountLink(): Promise<{ url: string }>;
  /** Live details on the coach's connected Stripe account, straight from Stripe (not cached DB flags). */
  getConnectAccountStatus(): Promise<import('./types').ConnectAccountStatus>;
  createRegistrationPayment(registrationId: string, successUrl?: string, cancelUrl?: string): Promise<{ url: string }>;
  createTeamFeePayment(seasonRosterId: string, successUrl?: string, cancelUrl?: string): Promise<{ url: string }>;

  // Org Members & Permissions
  listOrgMembers(): Promise<OrgMember[]>;
  inviteOrgMember(email: string, role: OrgRole): Promise<OrgMember>;
  updateOrgMemberRole(memberId: string, role: OrgRole): Promise<OrgMember>;
  removeOrgMember(memberId: string): Promise<void>;
  createAndInviteUser(email: string, password: string, name: string, role: OrgRole): Promise<OrgMember>;
  resendGuardianInvite(userId: string, email: string, role?: OrgRole): Promise<void>;
  linkGuardianToAthlete(guardianId: string, tryoutId: string, playerId: string): Promise<Player>;

  // Team managers (CLUB mode): delegate one team to another coach/manager by email.
  listTeamManagers(teamId: string): Promise<import('./types').TeamManager[]>;
  inviteTeamManager(
    teamId: string,
    email: string,
    role?: import('./types').TeamManagerRole,
    name?: string,
  ): Promise<import('./types').TeamManager>;
  removeTeamManager(managerId: string): Promise<void>;

  // Extended UI operations
  sendEmail(type: 'org_invite' | 'player_invite' | 'team_manager_invite' | 'tryout_invite' | 'schedule_update' | 'reminder' | 'registration_confirmation', to: string, payload: Record<string, unknown>): Promise<void>;
  copyTryout(id: string): Promise<Tryout>;
  restoreTryout(id: string): Promise<Tryout>;
  importLibraryPlayers(tryoutId: string, entries: { first: string; last: string; jersey?: string; pos?: string }[]): Promise<Player[]>;
  submitFeedback(submission: import('./extras').FeedbackSubmission): Promise<void>;
  addSeasonPlayer(seasonId: string, player: Omit<import('./types').SeasonPlayer, 'id'>): Promise<import('./types').SeasonPlayer>;
  deleteSeasonPlayer(seasonId: string, playerId: string): Promise<void>;
  importSeasonPlayersFromTeam(seasonId: string): Promise<import('./types').SeasonPlayer[]>;
  emailScheduleToPlayers(seasonId: string): Promise<void>;
  updateTeam(id: string, updates: Partial<Team>): Promise<Team>;

  // Team roster: a team's own players, selectable from any assessment's roster.
  listTeamRoster(teamId: string): Promise<import('./types').TeamRosterPlayer[]>;
  /** Players per team for the Teams list cards — see countTeamPlayers(). */
  countTeamPlayers(teamIds: string[]): Promise<Record<string, number>>;
  addTeamRosterPlayers(
    teamId: string,
    entries: { athleteId: string; jersey?: string; pos?: string; sourceTryoutId?: string }[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<import('./types').TeamRosterPlayer[]>;
  // Same form as the assessment roster's "Add Player" (AddPlayerForm) — picks
  // from or creates an athlete and places them directly on a team's roster,
  // for a player who never went through an assessment (no tryout to pull
  // them from), rather than only being reachable via "Add Players from
  // Assessments".
  addManualTeamPlayer(teamId: string, form: AddPlayerForm): Promise<{ athleteId: string }>;
  removeTeamRosterPlayer(teamId: string, athleteId: string): Promise<void>;
  /**
   * Invite a team's roster to the player/guardian portal — each player's own
   * email and their guardian's, both when present.
   *
   * `athleteIds` narrows it to specific players; omitted, the whole roster is
   * invited. Never throws for a single bad address: see TeamInviteResult.
   */
  sendTeamRosterInvites(teamId: string, athleteIds?: string[]): Promise<import('./types').TeamInviteResult>;
  importScanScores(tryoutId: string, scores: { playerId: string; rubricKey: string; value: number }[]): Promise<void>;
  getGuardianRosters(): Promise<GuardianRosterAthlete[]>;

  // Extra family contacts a guardian keeps on their own athlete's profile
  // (see athlete_family_contacts migration for the access model).
  listFamilyContacts(athleteId: string): Promise<import('./types').FamilyContact[]>;
  addFamilyContact(
    athleteId: string,
    contact: { name: string; relationship?: string; email?: string; phone?: string },
  ): Promise<import('./types').FamilyContact>;
  removeFamilyContact(id: string): Promise<void>;

  // Testing utilities (association/enterprise): bulk-generate dummy registrations
  // and/or scored roster players, stand up whole dummy teams, and clear either
  // batch again. See `testDataGenerator.ts` for the option shapes.
  generateTestData(
    tryoutId: string,
    options: import('./testDataGenerator').DummyDataOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<import('./testDataGenerator').DummyDataResult>;
  clearTestData(tryoutId: string): Promise<{ removed: number }>;
  generateDummyTeams(
    options: import('./testDataGenerator').DummyTeamOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<import('./testDataGenerator').DummyTeamResult>;
  clearDummyTeams(): Promise<{ teams: number; assessments: number }>;
}
