import type {
  PlayerUpdate,
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
  ReferralSummary,
  Player,
  Registration,
  RegistrationSubmit,
  ScoreForm,
  Season,
  SeasonEvent,
  EventRsvpContext,
  EventRsvpToken,
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
  deleteAccount(): Promise<void>;
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
  uploadOrganizationLogo(fileUri: string, fileType: string): Promise<string>;

  // Teams
  listTeams(): Promise<Team[]>;
  /** Teams on the caller's own account — what plan team limits are measured against. */
  countTeams(): Promise<number>;
  createTeam(name: string, season?: string, sport?: string): Promise<Team>;
  deleteTeam(id: string): Promise<void>;
  /** Archived teams — ones the coach archived or a plan downgrade did. Deleted teams are not listed. */
  listArchivedTeams(): Promise<Team[]>;
  /** Hides a team (and its schedule) without deleting it, so it can be restored. */
  archiveTeam(id: string): Promise<void>;
  /** Brings an archived team back, along with the seasons archived with it. */
  restoreTeam(id: string): Promise<Team>;

  // Tryouts
  listTryouts(includeArchived?: boolean): Promise<Tryout[]>;
  /**
   * listTryouts() without the registrations. The Reports page draws scores and
   * rosters only, and registrations are the one child read it never looks at,
   * so leaving them out cuts a whole table scan from its load.
   */
  listTryoutsForReports(includeArchived?: boolean): Promise<Tryout[]>;
  /**
   * Card-shaped tryouts for the list screens — see TryoutSummary. Prefer this
   * over listTryouts() anywhere the screen only draws names, dates and roster
   * counts; it skips the participant, athlete, evaluation, score and
   * registration reads entirely.
   */
  listTryoutSummaries(includeArchived?: boolean): Promise<TryoutSummary[]>;
  /**
   * Every active player across the visible, non-archived evaluations — just the
   * columns search draws, with no evaluations or scores.
   */
  listSearchPlayers(): Promise<import('./search').SearchPlayer[]>;
  /** Assessment count for plan limit checks, without assembling every roster and evaluation. */
  countAssessments(): Promise<number>;
  /** Tryouts the current user is invited to as an assessor (not owned by their account). */
  listAssignedTryouts(): Promise<Tryout[]>;
  /** listAssignedTryouts() in the light shape the dashboard's "Assigned to me" list needs. */
  listAssignedTryoutSummaries(): Promise<TryoutSummary[]>;
  acceptAssignedTryout(tryoutId: string): Promise<void>;
  rejectAssignedTryout(tryoutId: string): Promise<void>;
  /** An invited assessor ends their session: drops off their hub, the evaluation's data is untouched. */
  completeAssignedTryout(tryoutId: string): Promise<void>;
  /** `registrations: false` leaves the registrations out: the assessment screens never show them, and a QR link can bring thousands. */
  getTryout(id: string, opts?: { registrations?: boolean }): Promise<Tryout | null>;
  createTryout(form: CreateAssessmentForm): Promise<Tryout>;
  updateTryout(id: string, updates: Partial<Tryout>): Promise<Tryout>;
  /**
   * Link an assessment to a team, or unlink it with null.
   *
   * updateTryout() would do the same write, but its Tryout return forces a full
   * re-read of the assessment afterwards — every participant joined to its
   * athlete, every evaluation, score and registration. On a large roster that
   * read alone outruns the client's request timeout, so the coach sees a network
   * error for a link that actually saved. This is the write on its own.
   */
  setTryoutTeam(id: string, teamId: string | null): Promise<void>;
  /**
   * The friendPackages write on its own, for the same reason setTryoutTeam exists:
   * avoiding a full assessment re-read that could outrun the client timeout.
   */
  setFriendPackages(id: string, packages: import('./teamBuilder').FriendPackage[]): Promise<void>;
  archiveTryout(id: string): Promise<Tryout>;
  deleteTryout(id: string): Promise<void>;

  // Players
  addPlayer(tryoutId: string, form: AddPlayerForm): Promise<Player>;
  /**
   * Add many players at once, from a spreadsheet the club already keeps.
   *
   * Each row goes through the same path a hand-typed player does, so an
   * imported player is indistinguishable from a typed one — including the
   * guardian account that gets created behind them. Rows are independent: one
   * bad row is reported, not thrown. See PlayerImportResult.
   */
  importTryoutPlayers(
    tryoutId: string,
    rows: { line: number; form: AddPlayerForm }[],
    onProgress?: (done: number) => void,
  ): Promise<import('./types').PlayerImportResult>;
  updatePlayer(tryoutId: string, playerId: string, updates: PlayerUpdate): Promise<Player>;
  deletePlayer(tryoutId: string, playerId: string): Promise<void>;
  /**
   * Delete several players from an assessment roster with bounded concurrency.
   * Never throws for an individual player: the ones that could not be removed
   * come back in `failed` so a partial run can say exactly what is left.
   */
  deletePlayers(
    tryoutId: string,
    playerIds: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ deleted: string[]; failed: { id: string; message: string }[] }>;
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
  /** Just the number of pending registrations: a head-only count, no rows. Backs the tab badge. */
  countPendingRegistrations(tryoutId: string): Promise<number>;
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
  /** The team's public registration code, created the first time it is asked for. Anyone with the link can sign a player up to the team. */
  ensureTeamRegistrationLink(teamId: string): Promise<string>;
  /** Turn the team's link on or off without losing its code. */
  setTeamRegistrationOpen(teamId: string, open: boolean): Promise<void>;
  listTeamRegistrations(teamId: string): Promise<Registration[]>;
  /** Just the number of pending team registrations: a head-only count, no rows. */
  countPendingTeamRegistrations(teamId: string): Promise<number>;

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
  /**
   * A season with its events, roster, RSVPs and portal invites.
   *
   * `onPartial` is called with the season's events and roster the moment they
   * land, ahead of the RSVP/invite reads that dominate the wait on a big
   * roster — so a schedule can render off the first callback while the rest
   * fills in. Events from that first call carry `availabilityPending`.
   */
  getSeason(id: string, onPartial?: (season: Season) => void): Promise<Season | null>;
  createSeason(form: CreateSeasonForm): Promise<Season>;
  updateSeason(id: string, updates: Partial<Season>): Promise<Season>;
  deleteSeason(id: string): Promise<void>;
  /** onProgress reports guardian-email invite fanout: (sent, total). */
  addSeasonEvent(
    seasonId: string,
    form: CreateEventForm,
    onProgress?: (done: number, total: number) => void,
  ): Promise<SeasonEvent>;
  /**
   * The subscribable calendar feed for the season an event belongs to (null if
   * the caller cannot see it). Subscribing keeps the whole season in a personal
   * calendar and picks up events added, changed or deleted later.
   */
  getSeasonCalendarFeed(eventId: string): Promise<{ url: string; name: string } | null>;
  /**
   * Several events at once (a repeating practice, a full season of games).
   * Everyone invited gets ONE digest email listing all of them, not one email
   * per event. `onProgress` counts events created.
   */
  addSeasonEvents(
    seasonId: string,
    forms: CreateEventForm[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<SeasonEvent[]>;
  updateSeasonEvent(seasonId: string, eventId: string, updates: Partial<SeasonEvent>): Promise<SeasonEvent>;
  deleteSeasonEvent(seasonId: string, eventId: string): Promise<void>;
  /**
   * Invites athletes onto events that already existed when they joined the
   * roster — addTeamRosterPlayers/addManualTeamPlayer/importTeamRosterPlayers
   * only ever write team_roster/season_roster, so a player added after an
   * event was created gets no event_availability row for it and stays
   * invisible on that event's RSVP list and invite emails until this runs.
   * Already-invited (event, athlete) pairs are left untouched, not reset to
   * 'pending' — see event_availability's unique (season_event_id, roster_id).
   */
  addAthletesToEvents(
    seasonId: string,
    eventIds: string[],
    athleteIds: string[],
  ): Promise<{ added: number; failed: number }>;
  sendPortalInvite(seasonId: string, playerId: string, email: string): Promise<void>;
  /**
   * Invite season-roster players to the portal on every address each has on
   * file — the automatic counterpart to sendPortalInvite's one chosen address,
   * and the season twin of sendTeamRosterInvites.
   */
  sendSeasonRosterInvites(
    seasonId: string,
    playerIds?: string[],
    emails?: string[],
  ): Promise<import('./types').TeamInviteResult>;
  /**
   * Invite tryout participants to the portal on every address each has on
   * file — the assessment-roster twin of sendSeasonRosterInvites /
   * sendTeamRosterInvites. No RLS or RPC change backs this: `can_access_tryout`
   * already lets a guardian read a tryout once their athlete is on its roster
   * and their account is linked; this is what actually gets them that link.
   */
  sendTryoutRosterInvites(
    tryoutId: string,
    participantIds?: string[],
    emails?: string[],
  ): Promise<import('./types').TeamInviteResult>;
  sendTeamAnnouncement(seasonId: string, title: string, message: string): Promise<void>;
  setEventAvailability(seasonId: string, eventId: string, playerId: string, response: 'yes' | 'maybe' | 'no'): Promise<void>;
  /**
   * RSVP straight from the schedule email. `issueEventRsvpTokens` mints one
   * unguessable link per invited player for the coach's client to embed;
   * `getEventRsvpContext`/`submitEventRsvp` are what the /rsvp/<token> landing
   * page calls, and both work unauthenticated — the recipient usually has no
   * account. The answer lands in the same `event_availability` row the in-app
   * portal buttons write, so there is one source of truth for attendance.
   */
  issueEventRsvpTokens(eventId: string): Promise<EventRsvpToken[]>;
  /** Event discussion: anyone who can open the season comments; coaches attach files. */
  listEventComments(eventId: string): Promise<import('./types').EventComment[]>;
  addEventComment(eventId: string, body: string): Promise<import('./types').EventComment>;
  deleteEventComment(commentId: string): Promise<void>;
  listEventFiles(eventId: string): Promise<import('./types').EventFile[]>;
  uploadEventFile(seasonId: string, eventId: string, file: File): Promise<import('./types').EventFile>;
  deleteEventFile(file: import('./types').EventFile): Promise<void>;
  /** Report cards a coach has built for a player. Staff only. */
  listPlayerReportCards(athleteId: string): Promise<import('./types').PlayerReportCard[]>;
  /** Saves a card, uploading any new files first. Returns the saved card. */
  savePlayerReportCard(
    input: import('./types').PlayerReportCardInput,
    newFiles?: File[],
  ): Promise<import('./types').PlayerReportCard>;
  deletePlayerReportCard(card: import('./types').PlayerReportCard): Promise<void>;
  /**
   * Long-lived addresses for uploaded report card files, so a PDF export can link to
   * them and the family can open them from the document. Keyed by storage path.
   */
  getReportCardFileLinks(paths: string[]): Promise<Record<string, string>>;
  /** AI comments for one player drawn only from the chosen evaluations. */
  generateReportCardComments(
    tryoutId: string,
    playerId: string,
    evalIds: string[],
  ): Promise<import('./types').AiPlayerSummary>;
  /**
   * Library: files, notes, videos and links shared with chosen audiences. Reads
   * return only what the caller may see (the database enforces each item's
   * audience toggles); writes need an owner or admin.
   */
  listLibraryItems(): Promise<import('./types').LibraryItem[]>;
  createLibraryItem(input: import('./types').LibraryItemInput, file?: File): Promise<import('./types').LibraryItem>;
  updateLibraryItem(id: string, updates: Partial<import('./types').LibraryItemInput>): Promise<import('./types').LibraryItem>;
  deleteLibraryItem(item: import('./types').LibraryItem): Promise<void>;

  /**
   * Video Storage Add-On. One quota per account covers videos in the Library, on
   * player report cards, on evaluation score rows and in the team feed. The
   * server enforces it (reserve_account_video / confirm_account_video); these
   * only call it. The browser compresses a video to 720p MP4 first, so
   * `uploadAccountVideo` expects an MP4 and rejects anything else.
   */
  getVideoStorage(accountId?: string): Promise<import('./videoStorage').VideoStorageInfo>;
  listAccountVideos(accountId?: string): Promise<import('./videoStorage').AccountVideo[]>;
  /** Videos attached to the given parents, each with a short-lived playback address. */
  listVideosForContext(
    context: import('./videoStorage').VideoContext,
    contextIds: string[],
  ): Promise<import('./videoStorage').AccountVideo[]>;
  uploadAccountVideo(args: {
    file: File;
    context: import('./videoStorage').VideoContext;
    title?: string;
    accountId?: string;
    durationSeconds?: number;
    onProgress?: (fraction: number) => void;
  }): Promise<import('./videoStorage').AccountVideo>;
  attachAccountVideo(videoId: string, context: import('./videoStorage').VideoContext, contextId: string): Promise<void>;
  deleteAccountVideo(videoId: string): Promise<void>;
  getAccountVideoUrl(storagePath: string): Promise<string>;
  getVideoContextAccount(context: import('./videoStorage').VideoContext, contextId: string): Promise<string | null>;
  setVideoPermissions(accountId: string, perms: { managersCanUpload?: boolean; viewersCanDownload?: boolean }): Promise<void>;
  /** Records that the coach typed DELETE before cancelling or downgrading a plan that holds videos. */
  acknowledgeVideoDeletion(accountId: string): Promise<void>;
  createVideoStorageCheckoutSession(gb: number, options?: { applyCredits?: boolean; discountCode?: string }): Promise<{ url: string }>;
  /** Stripe-billed storage only. Cancelling needs `confirm: 'DELETE'`. */
  manageVideoStorage(
    action: 'change' | 'cancel' | 'resume',
    args?: { storageGb?: number; confirm?: string },
  ): Promise<{ cancelAt?: string | null; url?: string }>;
  /** Team news feed: coaches post and attach files; anyone who can open the season reads and comments. */
  listSeasonPosts(seasonId: string): Promise<import('./types').SeasonPost[]>;
  addSeasonPost(seasonId: string, input: { title: string; body: string }): Promise<import('./types').SeasonPost>;
  deleteSeasonPost(post: import('./types').SeasonPost): Promise<void>;
  uploadPostFile(seasonId: string, postId: string, file: File): Promise<import('./types').FeedFile>;
  deletePostFile(file: import('./types').FeedFile): Promise<void>;
  listPostComments(postId: string): Promise<import('./types').PostComment[]>;
  addPostComment(postId: string, body: string): Promise<import('./types').PostComment>;
  deletePostComment(commentId: string): Promise<void>;
  /** Organization info: shared by every team of the season's account; staff write, members read. */
  listOrgInfo(seasonId: string): Promise<import('./types').OrgInfoItem[]>;
  addOrgInfo(seasonId: string, input: import('./types').OrgInfoInput): Promise<import('./types').OrgInfoItem>;
  deleteOrgInfo(item: import('./types').OrgInfoItem): Promise<void>;
  uploadOrgInfoFile(accountId: string, infoId: string, file: File): Promise<import('./types').FeedFile>;
  deleteOrgInfoFile(file: import('./types').FeedFile): Promise<void>;
  getEventRsvpContext(token: string): Promise<EventRsvpContext | null>;
  submitEventRsvp(token: string, response: 'yes' | 'maybe' | 'no'): Promise<EventRsvpContext>;
  getAthleteHistory(athleteId: string): Promise<AthleteHistory>;
  /**
   * Highest session number each player in an assessment has already been
   * scored under, keyed by player id. For assessors, whose read of the
   * assessment's evaluations comes back empty — it carries the numbering they
   * need to continue at the right session without exposing anyone's scores.
   */
  getSessionProgress(tryoutId: string): Promise<Record<string, number>>;
  listAthletes(): Promise<Athlete[]>;
  /** Players whose name starts with the search words, a few at a time (for pickers; never loads the full list). */
  searchAthletes(term: string, limit?: number): Promise<Athlete[]>;
  /** Lean list for the Athlete Hub: names, photo, position and contacts only. */
  listAthleteHub(
    search: string,
    offset: number,
    limit: number,
  ): Promise<{ rows: Athlete[]; next: number | null }>;
  /**
   * How many different players are on the account's evaluation rosters and
   * team rosters together (removed players excluded). A player on both counts
   * once. The Free plan's player cap is measured against this.
   */
  countActiveAthletes(): Promise<number>;
  getPlayerProfile(athleteId: string, alsoAthleteIds?: string[]): Promise<import('./types').PlayerProfile>;

  // Team chat (season-scoped): staff on the season's account plus the guardian
  // of any athlete on its roster share this conversation.
  listTeamMessages(seasonId: string): Promise<import('./types').TeamMessage[]>;
  /**
   * How many messages other people have posted to this season's chat since
   * `sinceMs` — what the Chat tab's unread badge counts. A count, not the rows:
   * every screen with a Chat tab on it would otherwise pull the conversation
   * down just to find out whether there is anything new in it.
   */
  countUnreadTeamMessages(seasonId: string, sinceMs: number): Promise<number>;
  sendTeamMessage(seasonId: string, body: string): Promise<import('./types').TeamMessage>;
  deleteTeamMessage(messageId: string): Promise<void>;
  /** People the signed-in user has blocked in chat. Empty (never an error) if blocking is unavailable. */
  listBlockedChatUsers(): Promise<import('./types').BlockedChatUser[]>;
  /** Hides this person's chat messages from the signed-in user. */
  blockChatUser(userId: string): Promise<void>;
  unblockChatUser(userId: string): Promise<void>;
  /** Flags a message for the platform operators to review. */
  reportTeamMessage(messageId: string, reason: import('./types').ChatReportReason, details?: string): Promise<void>;

  // Guardian -> Coach athlete profile sharing
  getCoachDirectory(): Promise<import('./types').CoachDirectoryEntry[]>;
  /**
   * Looks up coach-capable accounts (owner/admin/coach) by the coach's own
   * email — what "Share with a Coach" actually searches by, instead of
   * browsing getCoachDirectory()'s full platform-wide list. Empty array means
   * no match; more than one means that email holds a coach-capable role on
   * more than one account.
   */
  findCoachByEmail(email: string): Promise<import('./types').CoachDirectoryEntry[]>;
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
  createCheckoutSession(
    planTier: string,
    interval: 'year' | 'month',
    options?: { applyCredits?: boolean; origin?: string; discountCode?: string },
  ): Promise<{ url: string }>;
  /** Whether a founder-issued discount code can be used by this account right now (preview only — checkout re-checks). */
  previewDiscountCode(code: string, planTier?: string): Promise<import('./types').DiscountCodePreview>;
  /** Checkout for add-on team licenses beyond the plan's included teams (Club: CAD$10/team/year). */
  createTeamLicenseCheckoutSession(
    quantity: number,
    options?: { applyCredits?: boolean },
  ): Promise<{ url: string }>;

  // Loyalty program
  /** Code, balance and ledger for the loyalty screen. Mints the code on first read. */
  getReferralSummary(): Promise<ReferralSummary>;
  /** Attach this account to a referrer. One-time, and only before the first paid plan. */
  applyReferralCode(code: string): Promise<void>;
  createPortalSession(): Promise<{ url: string }>;
  /** Stripe Connect Standard onboarding for coaches collecting registration fees. */
  createConnectAccountLink(): Promise<{ url: string }>;
  /** Live details on the coach's connected Stripe account, straight from Stripe (not cached DB flags). */
  getConnectAccountStatus(): Promise<import('./types').ConnectAccountStatus>;
  createRegistrationPayment(registrationId: string, successUrl?: string, cancelUrl?: string): Promise<{ url: string }>;
  createTeamFeePayment(seasonRosterId: string, successUrl?: string, cancelUrl?: string): Promise<{ url: string }>;

  // Org Members & Permissions
  /** `includeTeamManagers` also lists the coaches a club has delegated a team to. */
  listOrgMembers(includeTeamManagers?: boolean): Promise<OrgMember[]>;
  inviteOrgMember(email: string, role: OrgRole): Promise<OrgMember>;
  updateOrgMemberRole(memberId: string, role: OrgRole): Promise<OrgMember>;
  removeOrgMember(memberId: string): Promise<void>;
  createAndInviteUser(email: string, password: string, name: string, role: OrgRole): Promise<OrgMember>;
  resendGuardianInvite(userId: string, email: string, role?: OrgRole): Promise<void>;
  linkGuardianToAthlete(guardianId: string, tryoutId: string, playerId: string): Promise<Player>;
  unlinkGuardianFromAthlete(tryoutId: string, playerId: string): Promise<Player>;

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
  sendEmail(type: 'org_invite' | 'player_invite' | 'team_manager_invite' | 'tryout_invite' | 'schedule_update' | 'schedule_digest' | 'schedule_cancel' | 'reminder' | 'registration_confirmation' | 'tryout_letter', to: string, payload: Record<string, unknown>): Promise<void>;
  copyTryout(id: string): Promise<Tryout>;
  restoreTryout(id: string): Promise<Tryout>;
  importLibraryPlayers(tryoutId: string, entries: { first: string; last: string; jersey?: string; pos?: string }[]): Promise<Player[]>;
  submitFeedback(submission: import('./extras').FeedbackSubmission): Promise<void>;
  /**
   * Uploads one screenshot into the private feedback bucket and returns the
   * stored file, to be handed back in `submitFeedback`'s `attachments`.
   *
   * Uploading before the submission exists means an abandoned form can leave a
   * file behind; that is the trade for letting the coach see their screenshot
   * attached, and removed again, before they commit to sending anything.
   */
  uploadFeedbackAttachment(file: File): Promise<import('./extras').FeedbackAttachment>;
  /** Removes an attachment the user uploaded but then took off the form. */
  deleteFeedbackAttachment(path: string): Promise<void>;
  /** Whether the signed-in user may read everyone's feedback — see the `feedback_reviewers` allowlist. */
  isFeedbackReviewer(): Promise<boolean>;
  /**
   * Hub sections the founder has turned off for the whole platform (every
   * organization, every user) — see `platform_settings.blocked_features`.
   * Every signed-in screen reads this to gate its own nav, not just the
   * founder console.
   */
  getPlatformBlockedFeatures(): Promise<import('@/lib/blockableFeatures').BlockableFeature[]>;
  /**
   * Plan tiers the founder has hidden from checkout/upgrade for the whole
   * platform — see `platform_settings.blocked_plan_tiers`. Doesn't affect
   * anyone already subscribed to a blocked tier.
   */
  getPlatformBlockedPlanTiers(): Promise<import('./types').PlanTier[]>;
  /**
   * Plan tiers the founder has switched the dummy-data testing tools off for —
   * see `platform_settings.dummy_data_blocked_plan_tiers`. Empty means
   * available on every plan; a failed read also reads as empty.
   */
  getDummyDataBlockedPlanTiers(): Promise<import('./types').PlanTier[]>;
  /** Every submission, newest first. RLS narrows this to the caller's own unless they are a reviewer. */
  listFeedbackSubmissions(): Promise<import('./extras').FeedbackReport[]>;
  /** A short-lived signed URL for one attachment in the private bucket. */
  getFeedbackAttachmentUrl(path: string): Promise<string>;
  /**
   * Removes a submission from the portal, and any attachments it carried.
   * RLS restricts the delete to reviewers — see `feedback_submissions_delete_reviewer`.
   */
  deleteFeedbackSubmission(id: string, attachments: import('./extras').FeedbackAttachment[]): Promise<void>;
  /** Drop the cached account/profile so the next read resolves them again (e.g. entering or leaving "view as"). */
  resetAccountContext(): void;
  addSeasonPlayer(seasonId: string, player: Omit<import('./types').SeasonPlayer, 'id'>): Promise<import('./types').SeasonPlayer>;
  deleteSeasonPlayer(seasonId: string, playerId: string): Promise<void>;
  importSeasonPlayersFromTeam(seasonId: string): Promise<import('./types').SeasonPlayer[]>;
  /**
   * One page of a season's roster, for the views that only display it.
   *
   * `after` is the previous page's last id; `nextCursor` comes back undefined
   * on the last page. Lets a roster list paint off one statement instead of
   * every enrolled player — see the implementation for why the whole-roster
   * read still exists alongside it.
   */
  listSeasonRosterPage(
    seasonId: string,
    opts?: { after?: string; limit?: number },
  ): Promise<{ players: import('./types').SeasonPlayer[]; nextCursor?: string }>;
  emailScheduleToPlayers(seasonId: string): Promise<void>;
  updateTeam(id: string, updates: Partial<Team>): Promise<Team>;

  // Team roster: a team's own players, selectable from any assessment's roster.
  listTeamRoster(teamId: string): Promise<import('./types').TeamRosterPlayer[]>;
  /**
   * One page of a team's roster for the Players tab — see listTeamRosterPage.
   * `after` is the previous page's cursor; `nextCursor` is undefined once there
   * is nothing left. `search` is matched server-side, over the whole roster.
   */
  listTeamRosterPage(
    teamId: string,
    opts?: { after?: import('./types').TeamRosterCursor; limit?: number; search?: string },
  ): Promise<{
    players: import('./types').TeamRosterPlayer[];
    nextCursor?: import('./types').TeamRosterCursor;
  }>;
  /** Just the athlete ids on a team's roster — see listTeamRosterAthleteIds(). */
  listTeamRosterAthleteIds(teamId: string): Promise<string[]>;
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
  /** Edits an existing team-roster player's details — the athlete's own fields plus this team's jersey/position. */
  updateTeamRosterPlayer(teamId: string, athleteId: string, form: AddPlayerForm): Promise<void>;
  /** The team-roster counterpart of importTryoutPlayers. */
  importTeamRosterPlayers(
    teamId: string,
    rows: { line: number; form: AddPlayerForm }[],
    onProgress?: (done: number) => void,
  ): Promise<import('./types').PlayerImportResult>;
  removeTeamRosterPlayer(teamId: string, athleteId: string): Promise<void>;
  /**
   * Remove many players from a team roster in a few chunked statements rather
   * than one request each. Throws if any of them is still on the roster
   * afterwards (RLS filtering a delete reports success while removing nothing).
   */
  removeTeamRosterPlayers(
    teamId: string,
    athleteIds: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void>;
  /**
   * Invite a team's roster to the player/guardian portal — each player's own
   * email and their guardian's, both when present.
   *
   * `athleteIds` narrows it to specific players; omitted, the whole roster is
   * invited. `emails` narrows it further to specific addresses, for the
   * "Invite" button that sits beside a single email field. Never throws for a
   * single bad address: see TeamInviteResult.
   */
  sendTeamRosterInvites(
    teamId: string,
    athleteIds?: string[],
    emails?: string[],
  ): Promise<import('./types').TeamInviteResult>;
  importScanScores(
    tryoutId: string,
    scores: { playerId: string; rubricKey: string; value: number }[],
    session?: string,
  ): Promise<void>;
  getGuardianRosters(): Promise<GuardianRosterAthlete[]>;
  /**
   * The guardian leaves a team: their athlete's season roster entries go, so
   * the schedule, RSVPs and team chat stop, and the opt-out is recorded so
   * nothing re-enrols them (guardian_leave_season RPC). The coach's team roster
   * is not touched: only a coach can remove a player from it.
   */
  leaveSeason(seasonRosterId: string): Promise<void>;
  /**
   * Deletes an athlete from the guardian's "My Athletes" list (guardian_remove_athlete
   * RPC). Only the guardian's link is cleared; the coach's roster and records stay.
   */
  removeGuardianAthlete(athleteId: string): Promise<void>;
  /** The athlete's own details for the guardian's Info tab (no scores, no staff tenant needed). */
  getGuardianAthleteInfo(athleteId: string): Promise<import('./types').Athlete>;
  updateGuardianAthlete(
    athleteId: string,
    patch: {
      first?: string;
      last?: string;
      yearOfBirth?: string;
      dateOfBirth?: string;
      playerEmail?: string;
      guardianName?: string;
      guardianPhone?: string;
      medicalInfo?: string;
      aboutChild?: string;
    },
  ): Promise<void>;

  // Extra family contacts a guardian keeps on their own athlete's profile
  // (see athlete_family_contacts migration for the access model).
  listFamilyContacts(athleteId: string): Promise<import('./types').FamilyContact[]>;
  addFamilyContact(
    athleteId: string,
    contact: { name: string; relationship?: string; email?: string; phone?: string },
  ): Promise<import('./types').FamilyContact>;
  removeFamilyContact(id: string): Promise<void>;
  /**
   * Connect the login behind a family contact to the athlete, so the contact
   * sees them in the guardian portal. Resolves false when the database update
   * that supports several guardians per athlete is not deployed yet.
   */
  linkFamilyContactGuardian(contactId: string, userId: string): Promise<boolean>;
  /** Ids of the family contacts already connected to the athlete's guardian portal. */
  listConnectedFamilyContactIds(athleteId: string): Promise<string[]>;
  /** Which team calendars are attached to which: `viewerTeamId`'s calendar also shows `sourceTeamId`'s events. */
  listTeamCalendarLinks(): Promise<{ viewerTeamId: string; sourceTeamId: string }[]>;
  /** Attach (or disconnect) `sourceTeamId`'s calendar on `viewerTeamId`. Display only; no events are copied. */
  setTeamCalendarLink(viewerTeamId: string, sourceTeamId: string, attached: boolean): Promise<void>;

  // Player selection letters — the offer / roster-decision letters a coach
  // sends when a tryout is decided. Templates are account-wide and reusable;
  // a sent letter is snapshotted onto the player it went to. See letters.ts
  // for the placeholder model and the tryout_letters migration for access.
  listLetterTemplates(): Promise<import('./types').LetterTemplate[]>;
  createLetterTemplate(input: {
    name: string;
    kind: import('./letters').LetterKind;
    subject: string;
    body: string;
    tryoutId?: string;
  }): Promise<import('./types').LetterTemplate>;
  updateLetterTemplate(
    id: string,
    updates: Partial<{ name: string; kind: import('./letters').LetterKind; subject: string; body: string }>,
  ): Promise<import('./types').LetterTemplate>;
  deleteLetterTemplate(id: string): Promise<void>;

  /** Every letter sent from this assessment, newest first — the send screen's history. */
  listPlayerLetters(tryoutId: string): Promise<import('./types').PlayerLetter[]>;
  /**
   * Render a template for each selected player, email it, and attach the copy
   * to their card.
   *
   * Players are independent, like importTryoutPlayers(): one player with no
   * address on file (or a bounced send) is reported in the result, not thrown,
   * so a 40-player send doesn't abort on the first bad row. The copy is stored
   * either way — a failed letter is a draft the coach can fix and retry.
   */
  sendPlayerLetters(
    tryoutId: string,
    letters: {
      playerId: string;
      /** Echoed back on the result, so a partial-failure report can name people. */
      playerName: string;
      athleteId?: string;
      templateId?: string;
      kind: import('./letters').LetterKind;
      subject: string;
      body: string;
      recipientEmail?: string;
    }[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<import('./types').PlayerLetterSendResult[]>;
  /** Edit a stored copy without sending it — the coach fixing a typo before a re-send. */
  updatePlayerLetter(
    id: string,
    updates: Partial<{ subject: string; body: string; recipientEmail: string }>,
  ): Promise<import('./types').PlayerLetter>;
  /** Re-send a stored letter as it currently reads, updating its copy in place. */
  resendPlayerLetter(id: string): Promise<import('./types').PlayerLetter>;
  deletePlayerLetter(id: string): Promise<void>;

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
