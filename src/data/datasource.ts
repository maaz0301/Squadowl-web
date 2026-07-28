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
  Database,
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
  Athlete,
  AthleteHistory,
  Team,
  Tryout,
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

  // Database
  getDatabase(): Promise<Database>;
  saveDatabase(db: Database): Promise<void>;

  // Teams
  listTeams(): Promise<Team[]>;
  createTeam(name: string, season?: string): Promise<Team>;
  deleteTeam(id: string): Promise<void>;

  // Tryouts
  listTryouts(includeArchived?: boolean): Promise<Tryout[]>;
  /** Tryouts the current user is invited to as an assessor (not owned by their account). */
  listAssignedTryouts(): Promise<Tryout[]>;
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
  dismissRegistration(tryoutId: string, registrationId: string): Promise<void>;

  // Phase 2: Team Builder, AI, Export
  generateTeamBuilder(tryoutId: string, config: TeamBuilderConfig): Promise<TeamBuilderState>;
  getAiPlayerSummary(tryoutId: string, playerId: string): Promise<AiPlayerSummary>;
  getAiCompare(tryoutId: string, playerIds: string[]): Promise<AiCompareSummary>;
  exportTryout(tryoutId: string, format: ExportFormat): Promise<{ content: string; filename: string }>;
  createShareLink(tryoutId: string, label?: string): Promise<{ token: string; expiresAt: number }>;

  // Phase 3: Seasons
  listSeasons(): Promise<Season[]>;
  getSeason(id: string): Promise<Season | null>;
  createSeason(form: CreateSeasonForm): Promise<Season>;
  updateSeason(id: string, updates: Partial<Season>): Promise<Season>;
  deleteSeason(id: string): Promise<void>;
  addSeasonEvent(seasonId: string, form: CreateEventForm): Promise<SeasonEvent>;
  updateSeasonEvent(seasonId: string, eventId: string, updates: Partial<SeasonEvent>): Promise<SeasonEvent>;
  deleteSeasonEvent(seasonId: string, eventId: string): Promise<void>;
  sendPortalInvite(seasonId: string, playerId: string, email: string): Promise<void>;
  sendTeamAnnouncement(seasonId: string, title: string, message: string): Promise<void>;
  setEventAvailability(seasonId: string, eventId: string, playerId: string, response: 'yes' | 'maybe' | 'no'): Promise<void>;
  getAthleteHistory(athleteId: string): Promise<AthleteHistory>;
  listAthletes(): Promise<Athlete[]>;

  // Phase 4: Enterprise & Admin
  getOrg(): Promise<Org | null>;
  getEnterprisePayments(): Promise<EnterprisePayment[]>;
  getAdminStats(): Promise<AdminStats>;
  listAdminUsers(): Promise<AdminUserRow[]>;
  overrideUserPlan(userId: string, planTier: UserProfile['planTier']): Promise<void>;
  createCheckoutSession(planTier: string): Promise<{ url: string }>;
  createPortalSession(): Promise<{ url: string }>;

  // Org Members & Permissions
  listOrgMembers(): Promise<OrgMember[]>;
  inviteOrgMember(email: string, role: OrgRole): Promise<OrgMember>;
  updateOrgMemberRole(memberId: string, role: OrgRole): Promise<OrgMember>;
  removeOrgMember(memberId: string): Promise<void>;
  linkGuardianToAthlete(guardianId: string, tryoutId: string, playerId: string): Promise<Player>;

  // Extended UI operations
  sendEmail(type: 'org_invite' | 'tryout_invite' | 'schedule_update' | 'reminder' | 'registration_confirmation', to: string, payload: any): Promise<void>;
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
  addTeamRosterPlayers(
    teamId: string,
    entries: { athleteId: string; jersey?: string; pos?: string; sourceTryoutId?: string }[],
  ): Promise<import('./types').TeamRosterPlayer[]>;
  removeTeamRosterPlayer(teamId: string, athleteId: string): Promise<void>;
  importScanScores(tryoutId: string, scores: { playerId: string; rubricKey: string; value: number }[]): Promise<void>;
  getGuardianRosters(): Promise<GuardianRosterAthlete[]>;

  // Testing utilities (association/enterprise): bulk-generate dummy registrations
  // and/or scored roster players, stand up whole dummy teams, and clear either
  // batch again. See `testDataGenerator.ts` for the option shapes.
  generateTestData(
    tryoutId: string,
    options: import('./testDataGenerator').DummyDataOptions,
  ): Promise<import('./testDataGenerator').DummyDataResult>;
  clearTestData(tryoutId: string): Promise<{ removed: number }>;
  generateDummyTeams(
    options: import('./testDataGenerator').DummyTeamOptions,
  ): Promise<import('./testDataGenerator').DummyTeamResult>;
  clearDummyTeams(): Promise<{ teams: number; assessments: number }>;
}
