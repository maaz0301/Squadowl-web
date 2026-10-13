/**
 * Founder console data — founder@tryout.ca only.
 *
 * Kept out of the shared DataSource: none of this acts as the signed-in user's
 * working account, and every RPC re-checks is_founder() server-side, so nothing
 * here is a gate. Organization and team reads go straight to the tables by id;
 * the founder is a platform admin, so RLS lets them through.
 * See supabase/migrations/20260916120000_founder_org_management.sql.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDataSource } from '@/data';
import { getSupabase } from '@/lib/supabase';
import { deriveAccountAccess, type AccountAccessStatus } from '@/lib/accountAccess';
import { isBlockableFeature, type BlockableFeature } from '@/lib/blockableFeatures';
import {
  EVENT_TYPE_FROM_DB,
  TEAM_ROSTER_PAGE,
  extractFunctionErrorMessage,
  fetchAllByIn,
  toMs,
  type Row,
} from '../supabase/SupabaseDataSource';
import { founderError } from './errors';
import type {
  FounderAccessKind,
  FounderDashboardStats,
  FounderMergeResult,
  FounderOrgActivity,
  FounderAuditEntry,
  FounderAuditFilter,
  FounderAuditPage,
  FounderCreateOrganizationInput,
  FounderCreateOrganizationResult,
  FounderOrganizationDetail,
  FounderOrganizationFilter,
  FounderOrganizationPage,
  FounderOrgEvaluation,
  FounderHiddenPlayerEvaluation,
  FounderRemovedParticipant,
  FounderTeamDetail,
  FounderUser,
  FounderUserFilter,
  FounderUserPage,
  AnnouncementSeverity,
  EmailActivityEvent,
  EmailActivityFilter,
  EmailActivityMessage,
  PlatformAnnouncement,
  SupportTicket,
  SupportTicketDetail,
  SupportTicketStatus,
  FeatureAccountUsage,
  FeaturePlatform,
  FeatureUsageRow,
  FounderFunnel,
  FounderReferral,
  FounderReferralBalance,
} from './types';
import type { PlayerProfile, Tryout, PlanTier } from '@/data/types';
import { PLAN_TIERS } from '@/data/types';

const FOUNDER_AUDIT_COLUMNS = 'id, actor_email, action, account_id, account_name, reason, details, created_at';

function rowToFounderAuditEntry(r: Row): FounderAuditEntry {
  return {
    id: r.id,
    actorEmail: r.actor_email ?? undefined,
    action: r.action,
    accountId: r.account_id ?? undefined,
    accountName: r.account_name ?? undefined,
    reason: r.reason ?? undefined,
    details: r.details ?? {},
    createdAt: toMs(r.created_at),
  };
}

export async function isFounder(): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('is_founder');
  // Missing function (migration not applied yet) reads as "no", like the
  // feedback reviewer check.
  if (error) {
    console.warn('Could not check founder access:', error.message);
    return false;
  }
  return data === true;
}

export async function listFounderOrganizations(filter: FounderOrganizationFilter): Promise<FounderOrganizationPage> {
  const { data, error } = await getSupabase().rpc('founder_list_organizations', {
    p_search: filter.search?.trim() || null,
    p_status: filter.status ?? null,
    p_include_individual: !!filter.includeIndividual,
    p_limit: filter.limit ?? 50,
    p_offset: filter.offset ?? 0,
  });
  if (error) throw founderError(error);
  const rows = (data ?? []) as Row[];
  return {
    total: rows.length ? Number(rows[0].total_count) : 0,
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      accountType: r.account_type,
      planTier: r.plan_tier,
      subscriptionStatus: r.subscription_status,
      accessStatus: r.access_status,
      suspendedAt: r.suspended_at ? toMs(r.suspended_at) : undefined,
      suspendedReason: r.suspended_reason ?? undefined,
      trialEndsAt: r.trial_ends_at ? toMs(r.trial_ends_at) : undefined,
      isComp: !!r.is_comp,
      ownerEmail: r.owner_email ?? undefined,
      memberCount: r.member_count ?? 0,
      teamCount: r.team_count ?? 0,
      createdAt: toMs(r.created_at),
    })),
  };
}

export async function setOrganizationSuspended(
  accountId: string,
  suspended: boolean,
  reason?: string,
): Promise<AccountAccessStatus> {
  const { data, error } = await getSupabase().rpc('founder_set_organization_suspended', {
    p_account_id: accountId,
    p_suspended: suspended,
    p_reason: reason?.trim() || null,
  });
  if (error) throw founderError(error);
  return data as AccountAccessStatus;
}

export async function updateOrganizationAccess(
  accountId: string,
  planTier: string,
  access: FounderAccessKind,
  trialDays?: number,
): Promise<AccountAccessStatus> {
  const { data, error } = await getSupabase().rpc('founder_update_organization_access', {
    p_account_id: accountId,
    p_plan_tier: planTier,
    p_access: access,
    p_trial_days: trialDays ?? 30,
  });
  if (error) throw founderError(error);
  return data as AccountAccessStatus;
}

/**
 * Platform-wide kill switch — every organization and every user, no account
 * involved. The read side (getPlatformBlockedFeatures, what every signed-in
 * screen uses to gate its own nav) lives on the shared DataSource instead of
 * here, since — unlike everything else in this file — it isn't founder-only.
 */
export async function setPlatformBlockedFeatures(blockedFeatures: BlockableFeature[]): Promise<BlockableFeature[]> {
  const { data, error } = await getSupabase().rpc('founder_set_platform_blocked_features', {
    p_blocked_features: blockedFeatures,
  });
  if (error) throw founderError(error);
  return ((data as string[] | null) ?? []).filter(isBlockableFeature);
}

/** Hides one plan tier from checkout/upgrade platform-wide — see founder_set_platform_blocked_plan_tiers(). */
export async function setPlatformBlockedPlanTiers(blockedPlanTiers: PlanTier[]): Promise<PlanTier[]> {
  const { data, error } = await getSupabase().rpc('founder_set_platform_blocked_plan_tiers', {
    p_blocked_plan_tiers: blockedPlanTiers,
  });
  if (error) throw founderError(error);
  const tiers: readonly string[] = PLAN_TIERS;
  return ((data as string[] | null) ?? []).filter((t): t is PlanTier => tiers.includes(t));
}

/**
 * Switches the dummy-data testing tools off for the given plan tiers (all four
 * turns them off everywhere) — see founder_set_dummy_data_blocked_plan_tiers().
 * The read side (getDummyDataBlockedPlanTiers) is on the shared DataSource, since
 * every screen that offers the tools needs it, not just the founder.
 */
export async function setDummyDataBlockedPlanTiers(blockedPlanTiers: PlanTier[]): Promise<PlanTier[]> {
  const { data, error } = await getSupabase().rpc('founder_set_dummy_data_blocked_plan_tiers', {
    p_blocked_plan_tiers: blockedPlanTiers,
  });
  if (error) throw founderError(error);
  const tiers: readonly string[] = PLAN_TIERS;
  return ((data as string[] | null) ?? []).filter((t): t is PlanTier => tiers.includes(t));
}

export async function createFounderOrganization(
  input: FounderCreateOrganizationInput,
): Promise<FounderCreateOrganizationResult> {
  const supabase = getSupabase();
  const email = input.ownerEmail.trim().toLowerCase();
  const create = () =>
    supabase.rpc('founder_create_organization', {
      p_name: input.name.trim(),
      p_owner_email: email,
      p_plan_tier: input.planTier,
      p_access: input.access,
      p_trial_days: input.trialDays ?? 30,
    });

  let { data, error } = await create();
  let password: string | undefined;

  // The owner has no user yet. Create one the same way staff invites do,
  // then retry once. The RPC turns the empty personal account the signup
  // trigger gives them into the organization.
  if (error?.message.includes('Owner not found')) {
    password = Math.random().toString(36).slice(-8) + 'Aa1!';
    const { data: created, error: fnError } = await supabase.functions.invoke('create-user', {
      body: {
        email,
        password,
        display_name: input.ownerName?.trim() || email.split('@')[0],
        account_type: 'coach',
      },
    });
    if (fnError) {
      throw new Error(await extractFunctionErrorMessage(fnError, 'Could not create a user for the owner email'));
    }
    if (created?.error) throw new Error(created.error);
    ({ data, error } = await create());
  }
  if (error) throw founderError(error);

  const result = data as Row;
  let inviteSent = false;
  if (input.sendInvite) {
    // Called directly rather than through sendEmail(), which resolves the
    // founder's own working account first for no reason here.
    const { error: mailError } = await supabase.functions.invoke('send-email', {
      body: { type: 'org_invite', to: email, payload: { role: 'owner', password } },
    });
    if (mailError) console.warn('Organization created, but the invite email failed:', mailError.message);
    inviteSent = !mailError;
  }

  return {
    id: result.id,
    ownerCreated: !!password,
    inviteSent,
    convertedPersonalAccount: !!result.convertedPersonalAccount,
    temporaryPassword: password && !inviteSent ? password : undefined,
  };
}

/**
 * Accounts flagged hidden_from_founder (test and internal accounts) and the
 * people in them. Every founder list that does not go through a founder_*
 * function leaves these out, so none of it leaks through a side door.
 */
async function hiddenFounderScope(): Promise<{ accountIds: string[]; emails: Set<string> }> {
  const supabase = getSupabase();
  const { data: accounts } = await supabase.from('accounts').select('id').eq('hidden_from_founder', true);
  const accountIds = ((accounts ?? []) as Row[]).map((a) => a.id as string);
  if (!accountIds.length) return { accountIds, emails: new Set() };
  const { data: members } = await supabase.from('memberships').select('user_id').in('account_id', accountIds);
  const userIds = [...new Set(((members ?? []) as Row[]).map((m) => m.user_id as string))];
  const emails = new Set<string>();
  if (userIds.length) {
    const { data: profiles } = await supabase.from('profiles').select('email').in('id', userIds);
    for (const p of (profiles ?? []) as Row[]) if (p.email) emails.add(String(p.email).toLowerCase());
  }
  return { accountIds, emails };
}

export async function listFounderAuditLog(limit = 100): Promise<FounderAuditEntry[]> {
  const { accountIds } = await hiddenFounderScope();
  let q = getSupabase()
    .from('founder_audit_log')
    .select(FOUNDER_AUDIT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (accountIds.length) q = q.or(`account_id.is.null,account_id.not.in.(${accountIds.join(',')})`);
  const { data, error } = await q;
  if (error) throw founderError(error);
  return ((data ?? []) as Row[]).map(rowToFounderAuditEntry);
}

/** One page of the full audit trail, newest first, filtered server-side. */
export async function listFounderAuditPage(filter: FounderAuditFilter = {}): Promise<FounderAuditPage> {
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  let query = getSupabase()
    .from('founder_audit_log')
    .select(FOUNDER_AUDIT_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1);
  const { accountIds } = await hiddenFounderScope();
  if (accountIds.length) query = query.or(`account_id.is.null,account_id.not.in.(${accountIds.join(',')})`);
  if (filter.actions?.length) query = query.in('action', filter.actions);
  if (filter.days) query = query.gte('created_at', new Date(Date.now() - filter.days * 86_400_000).toISOString());
  // Characters that are syntax in a PostgREST or() filter (or LIKE wildcards) are dropped, not escaped.
  const term = filter.search?.replace(/[,()%*_\\]/g, ' ').trim();
  if (term) {
    query = query.or(`actor_email.ilike.%${term}%,account_name.ilike.%${term}%,reason.ilike.%${term}%`);
  }
  const { data, count, error } = await query;
  if (error) throw founderError(error);
  return { entries: ((data ?? []) as Row[]).map(rowToFounderAuditEntry), total: count ?? 0 };
}

/**
 * Read straight off the tables by account id rather than through ctx(): the
 * founder is a platform admin, so RLS lets these through, and nothing about
 * the founder's own session or working account changes.
 */
export async function getFounderOrganization(accountId: string): Promise<FounderOrganizationDetail> {
  const supabase = getSupabase();
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .maybeSingle();
  if (accountError) throw founderError(accountError);
  if (!account) throw new Error('Organization not found.');

  // A count that fails (say, a column this instance lacks) reads as 0
  // rather than failing the page.
  const count = async (table: string, liveOnly = false) => {
    let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('account_id', accountId);
    if (liveOnly) q = q.is('deleted_at', null);
    const { count: n, error } = await q;
    if (error) console.warn(`Could not count ${table}:`, error.message);
    return n ?? 0;
  };

  const [memberRows, teamRows, tryoutRows, tryoutCount, seasonCount, auditRows] = await Promise.all([
    supabase
      .from('memberships')
      .select('user_id, role, created_at')
      .eq('account_id', accountId)
      .order('created_at')
      .then(({ data, error }) => {
        if (error) throw founderError(error);
        return (data ?? []) as Row[];
      }),
    supabase
      .from('teams')
      .select('id, name, archived, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) throw founderError(error);
        return (data ?? []) as Row[];
      }),
    // Just id/name — listFounderOrgEvaluations() carries the full picture;
    // this only needs enough to label managedTeams/assignedEvaluations below.
    supabase
      .from('tryouts')
      .select('id, name, deleted_at')
      .eq('account_id', accountId)
      .then(({ data, error }) => {
        if (error) throw founderError(error);
        return (data ?? []) as Row[];
      }),
    count('tryouts', true),
    count('seasons'),
    supabase
      .from('founder_audit_log')
      .select(FOUNDER_AUDIT_COLUMNS)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) throw founderError(error);
        return (data ?? []) as Row[];
      }),
  ]);

  // Delegated team managers and invited-only assessors both skip
  // `memberships` entirely (see the comments on FounderOrganizationDetail),
  // so they're read straight off their own tables rather than folded into
  // memberRows above. fetchAllByIn() throws on error, so a failure here is
  // caught and leaves that section empty rather than failing the whole page
  // — same rule the count()s above follow.
  const teamIds = teamRows.map((t) => t.id);
  const tryoutIds = tryoutRows.map((t) => t.id);
  const [managerRows, assessorRows] = await Promise.all([
    fetchAllByIn(supabase, 'team_managers', 'id, team_id, user_id, role, profiles(email, display_name)', 'team_id', teamIds).catch(
      (e) => {
        console.warn('Could not load team managers:', e instanceof Error ? e.message : e);
        return [] as Row[];
      },
    ),
    fetchAllByIn(supabase, 'tryout_assessors', 'id, tryout_id, user_id, name, email, status', 'tryout_id', tryoutIds).catch((e) => {
      console.warn('Could not load assessors:', e instanceof Error ? e.message : e);
      return [] as Row[];
    }),
  ]);
  const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));
  const tryoutNameById = new Map(tryoutRows.map((t) => [t.id, t.name]));
  const tryoutDeletedAtById = new Map(tryoutRows.map((t) => [t.id, t.deleted_at ? toMs(t.deleted_at) : undefined]));

  // Names and emails are a nicety: a profile RLS won't return just shows as
  // an unnamed member rather than failing the page.
  const userIds = memberRows.map((m) => m.user_id);
  const { data: profileRows, error: profileError } = userIds.length
    ? await supabase.from('profiles').select('id, email, display_name').in('id', userIds)
    : { data: [], error: null };
  if (profileError) console.warn('Could not load member profiles:', profileError.message);
  const profiles = new Map(((profileRows ?? []) as Row[]).map((p) => [p.id, p]));

  const members = memberRows.map((m) => ({
    userId: m.user_id,
    email: profiles.get(m.user_id)?.email ?? undefined,
    displayName: profiles.get(m.user_id)?.display_name ?? undefined,
    role: m.role,
    joinedAt: toMs(m.created_at),
  }));
  const owner = members.find((m) => m.role === 'owner');

  return {
    org: {
      id: account.id,
      name: account.name,
      accountType: account.type,
      planTier: account.plan_tier,
      subscriptionStatus: account.subscription_status,
      accessStatus: deriveAccountAccess(account),
      suspendedAt: account.suspended_at ? toMs(account.suspended_at) : undefined,
      suspendedReason: account.suspended_reason ?? undefined,
      trialEndsAt: account.trial_ends_at ? toMs(account.trial_ends_at) : undefined,
      extraTeamLicenses: typeof account.extra_team_licenses === 'number' ? account.extra_team_licenses : 0,
      isComp: !!account.is_comp,
      ownerEmail: owner?.email,
      memberCount: members.length,
      teamCount: teamRows.filter((t) => !t.archived).length,
      createdAt: toMs(account.created_at),
    },
    sport: account.sport ?? undefined,
    members,
    teams: teamRows.map((t) => ({ id: t.id, name: t.name, archived: !!t.archived, createdAt: toMs(t.created_at) })),
    tryoutCount,
    seasonCount,
    auditLog: auditRows.map(rowToFounderAuditEntry),
    managedTeams: managerRows.map((m) => {
      const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as Row | null;
      return {
        teamId: m.team_id,
        teamName: teamNameById.get(m.team_id) ?? 'Untitled team',
        userId: m.user_id ?? undefined,
        email: p?.email ?? undefined,
        name: p?.display_name ?? undefined,
        role: m.role,
      };
    }),
    assignedEvaluations: assessorRows.map((a) => ({
      tryoutId: a.tryout_id,
      tryoutName: tryoutNameById.get(a.tryout_id) ?? 'Untitled evaluation',
      userId: a.user_id ?? undefined,
      email: a.email ?? undefined,
      name: a.name ?? undefined,
      status: a.status ?? undefined,
      deletedAt: tryoutDeletedAtById.get(a.tryout_id),
    })),
  };
}

/** Same direct, by-id reads as getFounderOrganization(), for one team. */
export async function getFounderTeam(teamId: string): Promise<FounderTeamDetail> {
  const supabase = getSupabase();
  const rowsOrThrow = ({ data, error }: { data: unknown; error: { message: string; code?: string } | null }) => {
    if (error) throw founderError(error);
    return (data ?? []) as Row[];
  };

  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select(
      'id, account_id, name, season_label, brand_color, collects_fees, registration_fee_cents, archived, created_at, accounts(name)',
    )
    .eq('id', teamId)
    .maybeSingle();
  if (teamError) throw founderError(teamError);
  if (!team) throw new Error('Team not found.');

  const rosterRows: Row[] = [];
  for (let from = 0; ; from += TEAM_ROSTER_PAGE) {
    const batch = rowsOrThrow(
      await supabase
        .from('team_roster')
        .select(
          'id, athlete_id, jersey, position, created_at, athletes(first_name, last_name, year_of_birth, default_position, about, player_email, guardian_name, guardian_email, guardian_phone)',
        )
        .eq('team_id', teamId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + TEAM_ROSTER_PAGE - 1),
    );
    rosterRows.push(...batch);
    if (batch.length < TEAM_ROSTER_PAGE) break;
  }

  const [seasonRows, tryoutRows, managers] = await Promise.all([
    supabase
      .from('seasons')
      .select('id, name, year, division, coach, archived, created_at')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .then(rowsOrThrow),
    supabase
      .from('tryouts')
      // Deleted ones too: the page decides whether to show them.
      .select('id, name, event_type, tryout_date, location, archived, deleted_at, created_at')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .then(rowsOrThrow),
    // Delegated coaches are only reachable through this RPC; an instance or
    // policy that refuses it just shows no staff.
    supabase.rpc('list_team_managers', { team_uuid: teamId }).then(({ data, error }) => {
      if (error) console.warn('Could not load team staff:', error.message);
      return (data ?? []) as Row[];
    }),
  ]);

  const seasonIds = seasonRows.map((s) => s.id);
  const tryoutIds = tryoutRows.map((t) => t.id);
  const [eventRows, seasonRosterRows, assessorRows, participantCounts] = await Promise.all([
    fetchAllByIn(
      supabase,
      'season_events',
      'id, season_id, title, kind, event_date, start_time, end_time, location, notes',
      'season_id',
      seasonIds,
    ),
    fetchAllByIn(supabase, 'season_roster', 'id, season_id', 'season_id', seasonIds),
    fetchAllByIn(supabase, 'tryout_assessors', 'id, tryout_id, name, email, status', 'tryout_id', tryoutIds),
    countParticipants(supabase, tryoutIds),
  ]);

  const group = <T extends Row>(rows: T[], key: string) => {
    const by: Record<string, T[]> = {};
    for (const r of rows) (by[r[key]] ??= []).push(r);
    return by;
  };
  const eventsBySeason = group(eventRows as Row[], 'season_id');
  const rosterBySeason = group(seasonRosterRows as Row[], 'season_id');
  const assessorsByTryout = group(assessorRows as Row[], 'tryout_id');

  return {
    id: team.id,
    accountId: team.account_id,
    accountName: (team.accounts as Row | null)?.name ?? undefined,
    name: team.name,
    seasonLabel: team.season_label?.split('|LOGO|')[0] || undefined,
    brandColor: team.brand_color ?? undefined,
    collectsFees: !!team.collects_fees,
    registrationFeeCents: team.registration_fee_cents ?? undefined,
    archived: !!team.archived,
    createdAt: toMs(team.created_at),
    players: rosterRows.map((r) => {
      const a = (r.athletes ?? {}) as Row;
      return {
        id: r.id,
        athleteId: r.athlete_id ?? undefined,
        firstName: a.first_name ?? '',
        lastName: a.last_name ?? '',
        jersey: r.jersey ?? undefined,
        position: r.position ?? undefined,
        yearOfBirth: a.year_of_birth ?? undefined,
        playerEmail: a.player_email ?? undefined,
        guardianName: a.guardian_name ?? undefined,
        guardianEmail: a.guardian_email ?? undefined,
        guardianPhone: a.guardian_phone ?? undefined,
        defaultPosition: a.default_position ?? undefined,
        about: a.about ?? undefined,
        addedAt: toMs(r.created_at),
      };
    }),
    // Saved invites (pending) have no account yet, so they are not staff.
    staff: managers.filter((m) => m.pending !== true).map((m) => ({
      id: m.id,
      name: m.name ?? m.user?.display_name ?? undefined,
      email: m.email ?? m.user?.email ?? undefined,
      role: m.role ?? 'manager',
    })),
    seasons: seasonRows.map((s) => ({
      id: s.id,
      name: s.name,
      year: s.year ?? undefined,
      division: s.division ?? undefined,
      coach: s.coach ?? undefined,
      archived: !!s.archived,
      rosterCount: rosterBySeason[s.id]?.length ?? 0,
      events: (eventsBySeason[s.id] ?? [])
        .sort((x, y) => String(x.event_date ?? '').localeCompare(String(y.event_date ?? '')))
        .map((e) => ({
          id: e.id,
          title: e.title ?? undefined,
          kind: e.kind,
          date: e.event_date ?? undefined,
          startTime: e.start_time ?? undefined,
          endTime: e.end_time ?? undefined,
          location: e.location ?? undefined,
          notes: e.notes ?? undefined,
        })),
    })),
    evaluations: tryoutRows.map((t) => ({
      id: t.id,
      name: t.name,
      eventType: EVENT_TYPE_FROM_DB[t.event_type] ?? undefined,
      date: t.tryout_date ?? undefined,
      location: t.location ?? undefined,
      archived: !!t.archived,
      deletedAt: t.deleted_at ? toMs(t.deleted_at) : undefined,
      playerCount: participantCounts[t.id] ?? 0,
      assessors: (assessorsByTryout[t.id] ?? []).map((a) => ({
        name: a.name ?? undefined,
        email: a.email ?? undefined,
        status: a.status ?? undefined,
      })),
    })),
  };
}

/** Every evaluation an organization has run, including those not tied to a team. */
export async function listFounderOrgEvaluations(accountId: string): Promise<FounderOrgEvaluation[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tryouts')
    // Deleted ones too: the page decides whether to show them.
    .select('id, name, event_type, tryout_date, location, archived, deleted_at, created_at, team_id, teams(name)')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });
  if (error) throw founderError(error);
  const rows = (data ?? []) as Row[];
  const counts = await countParticipants(
    supabase,
    rows.map((r) => r.id),
  );

  return rows.map((t) => {
    const team = (Array.isArray(t.teams) ? t.teams[0] : t.teams) as Row | null;
    return {
      id: t.id,
      name: t.name,
      eventType: EVENT_TYPE_FROM_DB[t.event_type] ?? undefined,
      date: t.tryout_date ?? undefined,
      location: t.location ?? undefined,
      teamId: t.team_id ?? undefined,
      teamName: team?.name ?? undefined,
      archived: !!t.archived,
      deletedAt: t.deleted_at ? toMs(t.deleted_at) : undefined,
      playerCount: counts[t.id] ?? 0,
      createdAt: toMs(t.created_at),
    };
  });
}

/**
 * A player's whole record — details, teams, seasons, and every assessment with
 * its evaluations and scores. Borrows the coach app's own read so the numbers
 * match what the organization sees; the founder gets through RLS as a platform
 * admin. Medical notes stay limited to the athlete's own organization and
 * guardian, as they are everywhere else.
 */
export async function getFounderPlayer(athleteId: string): Promise<PlayerProfile> {
  return getDataSource().getPlayerProfile(athleteId);
}

/** One evaluation in full — roster, assessors, every evaluation and score — via the coach app's own read. */
export async function getFounderEvaluation(tryoutId: string): Promise<Tryout> {
  const tryout = await getDataSource().getTryout(tryoutId);
  if (!tryout) throw new Error('Evaluation not found.');
  return tryout;
}

/** Evaluations per participant, for rows the coach reads never return. */
async function countEvaluationsByParticipant(
  supabase: SupabaseClient,
  participantIds: string[],
): Promise<Record<string, number>> {
  const rows = await fetchAllByIn(supabase, 'evaluations', 'id, participant_id', 'participant_id', participantIds);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.participant_id] = (counts[r.participant_id] ?? 0) + 1;
  return counts;
}

/** Players taken off an evaluation's roster. getTryout() leaves them out; their evaluations still exist. */
export async function listFounderRemovedParticipants(tryoutId: string): Promise<FounderRemovedParticipant[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tryout_participants')
    .select('id, athlete_id, jersey, position, removed_at, athletes(first_name, last_name)')
    .eq('tryout_id', tryoutId)
    .not('removed_at', 'is', null)
    .order('removed_at', { ascending: false });
  if (error) throw founderError(error);
  const rows = (data ?? []) as Row[];
  const evalCounts = await countEvaluationsByParticipant(
    supabase,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const a = (Array.isArray(r.athletes) ? r.athletes[0] : r.athletes) as Row | null;
    return {
      participantId: r.id,
      athleteId: r.athlete_id ?? undefined,
      firstName: a?.first_name ?? '',
      lastName: a?.last_name ?? '',
      jersey: r.jersey ?? undefined,
      position: r.position ?? undefined,
      removedAt: toMs(r.removed_at),
      evalCount: evalCounts[r.id] ?? 0,
    };
  });
}

/**
 * The evaluations getPlayerProfile() leaves out of a player's history: ones
 * they were removed from, and ones the organization deleted.
 */
export async function listFounderHiddenPlayerEvaluations(athleteId: string): Promise<FounderHiddenPlayerEvaluation[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tryout_participants')
    .select('id, tryout_id, removed_at, tryouts(name, event_type, tryout_date, deleted_at, teams(name))')
    .eq('athlete_id', athleteId);
  if (error) throw founderError(error);
  const hidden = ((data ?? []) as Row[]).filter((r) => {
    const t = (Array.isArray(r.tryouts) ? r.tryouts[0] : r.tryouts) as Row | null;
    return !!r.removed_at || !!t?.deleted_at;
  });
  const evalCounts = await countEvaluationsByParticipant(
    supabase,
    hidden.map((r) => r.id),
  );
  return hidden.map((r) => {
    const t = ((Array.isArray(r.tryouts) ? r.tryouts[0] : r.tryouts) ?? {}) as Row;
    const team = (Array.isArray(t.teams) ? t.teams[0] : t.teams) as Row | null;
    return {
      participantId: r.id,
      tryoutId: r.tryout_id,
      tryoutName: t.name ?? 'Untitled evaluation',
      eventType: EVENT_TYPE_FROM_DB[t.event_type] ?? undefined,
      date: t.tryout_date ?? undefined,
      teamName: team?.name ?? undefined,
      removedAt: r.removed_at ? toMs(r.removed_at) : undefined,
      deletedAt: t.deleted_at ? toMs(t.deleted_at) : undefined,
      evalCount: evalCounts[r.id] ?? 0,
    };
  });
}

/** Active players per evaluation, same removed_at rule as the coach screens. */
async function countParticipants(supabase: SupabaseClient, tryoutIds: string[]): Promise<Record<string, number>> {
  const counts = await Promise.all(
    tryoutIds.map(async (id) => {
      const { count, error } = await supabase
        .from('tryout_participants')
        .select('id', { count: 'exact', head: true })
        .eq('tryout_id', id)
        .is('removed_at', null);
      if (error) console.warn('Could not count evaluation players:', error.message);
      return [id, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts);
}

/**
 * The organization's owner and every member, for "view as organization": the
 * teams delegated to any of them and evaluations any of them is assigned to
 * assess are listed, and the owner's profile and guardian athletes are shown —
 * see ImpersonationTarget.owner / memberIds.
 */
export async function getOrganizationPeople(accountId: string): Promise<{
  owner?: { id: string; email?: string; name?: string };
  memberIds: string[];
}> {
  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from('memberships')
    .select('user_id, role, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true });
  if (error) throw founderError(error);
  // Staff only. A guardian holds a membership row here too, but they belong to
  // this organization as a parent, not as someone it assigns work to — and
  // their own assessor rows and delegated teams live on entirely different
  // accounts (a coach elsewhere, say). Counting them pulled their evaluations
  // into the org's "Assigned to me" and no one on this org ever saw them.
  const memberIds = [
    ...new Set(
      ((rows ?? []) as Row[])
        .filter((r) => r.role !== 'guardian')
        .map((r) => r.user_id as string)
        .filter(Boolean),
    ),
  ];
  const data = ((rows ?? []) as Row[]).find((r) => r.role === 'owner');
  if (!data?.user_id) return { memberIds };
  // The email matters: guardian athletes are also matched on guardian_email.
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, display_name')
    .eq('id', data.user_id)
    .maybeSingle();
  return {
    owner: { id: data.user_id, email: profile?.email ?? undefined, name: profile?.display_name ?? undefined },
    memberIds,
  };
}

/**
 * Record entering or leaving "view as" for one organization. Entering is logged
 * (and founder-checked by the RPC) before anything switches, so a refused or
 * unlogged view never takes effect.
 */
export async function logImpersonation(accountId: string, started: boolean): Promise<void> {
  const { error } = await getSupabase().rpc('founder_log_impersonation', {
    p_account_id: accountId,
    p_started: started,
  });
  if (error) throw founderError(error);
}

// ─── User management ────────────────────────────────────────────────────────
// See supabase/migrations/20260916130000_founder_user_management.sql. Ban and
// delete are the only two actions here that don't fit an RPC — Postgres has no
// access to auth.users beyond what founder_list_users already reads, so those
// two go through the founder-user-admin edge function (service role) instead.

function rowToFounderUser(r: Row): FounderUser {
  return {
    id: r.id,
    email: r.email ?? undefined,
    displayName: r.display_name ?? undefined,
    createdAt: toMs(r.created_at),
    lastSignInAt: r.last_sign_in_at ? toMs(r.last_sign_in_at) : undefined,
    emailConfirmedAt: r.email_confirmed_at ? toMs(r.email_confirmed_at) : undefined,
    bannedUntil: r.banned_until ? toMs(r.banned_until) : undefined,
    memberships: ((r.memberships ?? []) as Row[]).map((m) => ({
      accountId: m.accountId,
      accountName: m.accountName,
      role: m.role,
    })),
  };
}

export async function listFounderUsers(filter: FounderUserFilter): Promise<FounderUserPage> {
  const { data, error } = await getSupabase().rpc('founder_list_users', {
    p_search: filter.search?.trim() || null,
    p_account_id: filter.accountId ?? null,
    p_role: filter.role ?? null,
    p_limit: filter.limit ?? 50,
    p_offset: filter.offset ?? 0,
  });
  if (error) throw founderError(error);
  const rows = (data ?? []) as Row[];
  return {
    total: rows.length ? Number(rows[0].total_count) : 0,
    items: rows.map(rowToFounderUser),
  };
}

export async function setFounderUserRole(userId: string, accountId: string, role: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('founder_set_user_role', {
    p_user_id: userId,
    p_account_id: accountId,
    p_role: role,
  });
  if (error) throw founderError(error);
  return data as string;
}

/** Best-effort: the email already went out by the time this runs, so a logging failure isn't shown to the founder. */
async function logFounderUserAction(action: 'reset_password' | 'resend_verification', userId: string): Promise<void> {
  const { error } = await getSupabase().rpc('founder_log_user_action', { p_action: action, p_user_id: userId });
  if (error) console.warn('Could not record audit entry:', error.message);
}

/** Same "Forgot password" email the sign-in screen sends, triggered on the user's behalf. */
export async function resetFounderUserPassword(userId: string, email: string): Promise<void> {
  await getDataSource().requestPasswordReset(email);
  await logFounderUserAction('reset_password', userId);
}

/** Same verification email a new signup gets, resent on the user's behalf. */
export async function resendFounderUserVerification(userId: string, email: string): Promise<void> {
  await getDataSource().resendVerificationEmail(email);
  await logFounderUserAction('resend_verification', userId);
}

export async function setFounderUserBanned(userId: string, banned: boolean, reason?: string): Promise<void> {
  const { data, error } = await getSupabase().functions.invoke('founder-user-admin', {
    body: { action: banned ? 'ban' : 'unban', userId, reason },
  });
  if (error) {
    throw new Error(
      await extractFunctionErrorMessage(error, banned ? 'Could not ban this user' : 'Could not unban this user'),
    );
  }
  if (data?.error) throw new Error(data.error);
}

export async function deleteFounderUser(userId: string, reason?: string): Promise<void> {
  const { data, error } = await getSupabase().functions.invoke('founder-user-admin', {
    body: { action: 'delete', userId, reason },
  });
  if (error) throw new Error(await extractFunctionErrorMessage(error, 'Could not delete this user'));
  if (data?.error) throw new Error(data.error);
}

// ─── Support & Content ──────────────────────────────────────────────────────
// See supabase/migrations/20260916140000_founder_support_content.sql. Anything
// that needs the SendGrid key goes through the founder-support edge function.

async function invokeFounderSupport<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke('founder-support', { body });
  if (error) throw new Error(await extractFunctionErrorMessage(error, fallback));
  if (data?.error) throw new Error(data.error);
  return data as T;
}

function rowToSupportTicket(r: Row): SupportTicket {
  const counted = Array.isArray(r.support_messages) ? (r.support_messages[0] as Row | undefined) : undefined;
  return {
    id: r.id,
    email: r.email,
    userId: r.user_id ?? undefined,
    subject: r.subject,
    status: r.status,
    messageCount: counted?.count ?? 0,
    createdAt: toMs(r.created_at),
    updatedAt: toMs(r.updated_at),
  };
}

export async function listSupportTickets(filter: { status?: SupportTicketStatus; search?: string }): Promise<SupportTicket[]> {
  let q = getSupabase()
    .from('support_tickets')
    .select('id, email, user_id, subject, status, created_at, updated_at, support_messages(count)')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (filter.status) q = q.eq('status', filter.status);
  // PostgREST's or() filter is comma/paren-delimited, so those can't be in the term.
  const term = filter.search?.replace(/[,()\\%_*]/g, ' ').trim();
  if (term) q = q.or(`email.ilike.%${term}%,subject.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw founderError(error);
  const { emails } = await hiddenFounderScope();
  return ((data ?? []) as Row[])
    .filter((r) => !emails.has(String(r.email ?? '').toLowerCase()))
    .map(rowToSupportTicket);
}

export async function getSupportTicket(ticketId: string): Promise<SupportTicketDetail> {
  const { data, error } = await getSupabase()
    .from('support_tickets')
    .select(
      'id, email, user_id, subject, status, created_at, updated_at, support_messages(id, direction, body, author_email, delivery_error, created_at)',
    )
    .eq('id', ticketId)
    .maybeSingle();
  if (error) throw founderError(error);
  if (!data) throw new Error('Ticket not found.');
  const r = data as Row;
  const messages = ((r.support_messages ?? []) as Row[])
    .map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      authorEmail: m.author_email ?? undefined,
      deliveryError: m.delivery_error ?? undefined,
      createdAt: toMs(m.created_at),
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
  return { ...rowToSupportTicket({ ...r, support_messages: [{ count: messages.length }] }), messages };
}

/** Logs an email the customer sent to support@ as a new ticket. */
export async function createInboundSupportTicket(input: { email: string; subject: string; body: string }): Promise<string> {
  const { data, error } = await getSupabase().rpc('founder_create_support_ticket', {
    p_email: input.email,
    p_subject: input.subject,
    p_body: input.body,
  });
  if (error) throw founderError(error);
  return data as string;
}

/** Logs the customer's reply on an existing ticket (reopens it). */
export async function addInboundSupportMessage(ticketId: string, body: string): Promise<void> {
  const { error } = await getSupabase().rpc('founder_add_support_message', { p_ticket_id: ticketId, p_body: body });
  if (error) throw founderError(error);
}

export async function setSupportTicketStatus(ticketId: string, status: SupportTicketStatus): Promise<void> {
  const { error } = await getSupabase().rpc('founder_set_support_ticket_status', {
    p_ticket_id: ticketId,
    p_status: status,
  });
  if (error) throw founderError(error);
}

/** Removes a ticket and its whole conversation. Cannot be undone. */
export async function deleteSupportTicket(ticketId: string): Promise<void> {
  const { error } = await getSupabase().rpc('founder_delete_support_ticket', { p_ticket_id: ticketId });
  if (error) throw founderError(error);
}

/** Emails from support@tryouthq.ca — a reply when ticketId is given, otherwise a new ticket. */
export async function sendSupportEmail(
  input: { ticketId: string; body: string } | { email: string; subject: string; body: string },
): Promise<string> {
  const result = await invokeFounderSupport<{ ticketId: string }>(
    { action: 'send_support_email', ...input },
    'Could not send the email',
  );
  return result.ticketId;
}

function rowToAnnouncement(r: Row): PlatformAnnouncement {
  return {
    id: r.id,
    title: r.title,
    message: r.message,
    severity: r.severity,
    startsAt: toMs(r.starts_at),
    endsAt: r.ends_at ? toMs(r.ends_at) : undefined,
    createdAt: toMs(r.created_at),
    emailedAt: r.emailed_at ? toMs(r.emailed_at) : undefined,
    emailRecipientCount: r.email_recipient_count ?? undefined,
  };
}

const ANNOUNCEMENT_COLUMNS = 'id, title, message, severity, starts_at, ends_at, created_at, emailed_at, email_recipient_count';

/** Every announcement, newest first — the founder's RLS read sees ended ones too. */
export async function listAnnouncements(): Promise<PlatformAnnouncement[]> {
  const { data, error } = await getSupabase()
    .from('platform_announcements')
    .select(ANNOUNCEMENT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw founderError(error);
  return ((data ?? []) as Row[]).map(rowToAnnouncement);
}

/** What's live right now. Readable by every signed-in user; a missing table just means none. */
export async function listActiveAnnouncements(): Promise<PlatformAnnouncement[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from('platform_announcements')
    .select(ANNOUNCEMENT_COLUMNS)
    .lte('starts_at', nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('Could not load announcements:', error.message);
    return [];
  }
  return ((data ?? []) as Row[]).map(rowToAnnouncement);
}

export async function createAnnouncement(input: {
  title: string;
  message: string;
  severity: AnnouncementSeverity;
  endsAt?: string;
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('founder_create_announcement', {
    p_title: input.title,
    p_message: input.message,
    p_severity: input.severity,
    p_ends_at: input.endsAt ?? null,
  });
  if (error) throw founderError(error);
  return data as string;
}

export async function endAnnouncement(id: string): Promise<void> {
  const { error } = await getSupabase().rpc('founder_end_announcement', { p_id: id });
  if (error) throw founderError(error);
}

export async function emailAnnouncement(id: string): Promise<number> {
  const result = await invokeFounderSupport<{ sent: number }>(
    { action: 'broadcast_announcement', announcementId: id },
    'Could not email the announcement',
  );
  return result.sent;
}

export async function listEmailActivity(filter: EmailActivityFilter): Promise<EmailActivityMessage[]> {
  const result = await invokeFounderSupport<{ messages: Row[] }>(
    { action: 'email_activity', toEmail: filter.toEmail, status: filter.status, days: filter.days, limit: 200 },
    'Could not load the email log',
  );
  const { emails } = await hiddenFounderScope();
  return result.messages
    .filter((m) => !emails.has(String(m.to_email ?? '').toLowerCase()))
    .map((m) => ({
      msgId: m.msg_id,
      fromEmail: m.from_email,
      toEmail: m.to_email,
      subject: m.subject ?? '',
      status: m.status,
      opensCount: m.opens_count ?? 0,
      clicksCount: m.clicks_count ?? 0,
      lastEventTime: Date.parse(m.last_event_time),
    }));
}

export async function getEmailActivityEvents(msgId: string): Promise<EmailActivityEvent[]> {
  const result = await invokeFounderSupport<{ events?: Row[] }>(
    { action: 'email_activity_detail', msgId },
    'Could not load this message',
  );
  return (result.events ?? []).map((e) => ({
    name: e.event_name,
    time: Date.parse(e.processed),
    reason: e.reason || e.bounce_type || undefined,
  }));
}

// ─── Analytics ───────────────────────────────────────────────────────────────
// See supabase/migrations/20260917120000_founder_analytics.sql.

const num = (v: unknown) => Number(v ?? 0);

export async function getFounderFunnel(days: number): Promise<FounderFunnel> {
  const { data, error } = await getSupabase().rpc('founder_analytics_funnel', { p_days: days });
  if (error) throw analyticsError(error);
  const d = (data ?? {}) as Row;
  const t = (d.totals ?? {}) as Row;
  return {
    days: num(d.days),
    totals: {
      visitors: num(t.visitors),
      signupVisitors: num(t.signupVisitors),
      signups: num(t.signups),
      trials: num(t.trials),
      paid: num(t.paid),
      trialsStarted: num(t.trialsStarted),
      paidStarted: num(t.paidStarted),
      firstVisitDay: t.firstVisitDay ?? undefined,
    },
    series: ((d.series ?? []) as Row[]).map((r) => ({
      day: r.day,
      visitors: num(r.visitors),
      signups: num(r.signups),
      trials: num(r.trials),
      paid: num(r.paid),
    })),
    sources: ((d.sources ?? []) as Row[]).map((r) => ({ source: r.source, visitors: num(r.visitors) })),
  };
}

export async function getFeatureUsage(days: number, platform: FeaturePlatform = 'all'): Promise<FeatureUsageRow[]> {
  const { data, error } = await getSupabase().rpc('founder_analytics_feature_usage', {
    p_days: days,
    p_platform: platform === 'all' ? null : platform,
  });
  if (error) throw analyticsError(error);
  return ((data ?? []) as Row[]).map((r) => ({
    feature: r.feature,
    users: num(r.users),
    accounts: num(r.accounts),
    activeDays: num(r.active_days),
    uses: num(r.uses),
    webUses: num(r.web_uses),
    mobileUses: num(r.mobile_uses),
    lastUsedAt: r.last_used_at ? toMs(r.last_used_at) : undefined,
  }));
}

export async function getFeatureAccounts(
  feature: string,
  days: number,
  platform: FeaturePlatform = 'all',
): Promise<FeatureAccountUsage[]> {
  const { data, error } = await getSupabase().rpc('founder_analytics_feature_accounts', {
    p_feature: feature,
    p_days: days,
    p_platform: platform === 'all' ? null : platform,
  });
  if (error) throw analyticsError(error);
  return ((data ?? []) as Row[]).map((r) => ({
    accountId: r.account_id ?? undefined,
    accountName: r.account_name ?? undefined,
    ownerEmail: r.owner_email ?? undefined,
    users: ((r.users ?? []) as Row[]).map((u) => ({ id: u.id, email: u.email, name: u.name ?? undefined })),
    activeDays: num(r.active_days),
    uses: num(r.uses),
    lastUsedAt: r.last_used_at ? toMs(r.last_used_at) : undefined,
  }));
}

export async function listFounderReferrals(): Promise<FounderReferral[]> {
  const { data, error } = await getSupabase().rpc('founder_list_referrals');
  if (error) throw analyticsError(error);
  return ((data ?? []) as Row[]).map((r) => ({
    referredAccountId: r.referred_account_id,
    referredName: r.referred_name,
    referredOwnerEmail: r.referred_owner_email ?? undefined,
    referredCreatedAt: toMs(r.referred_created_at),
    attributedAt: r.attributed_at ? toMs(r.attributed_at) : undefined,
    subscriptionStatus: r.subscription_status ?? undefined,
    firstPaidAt: r.first_paid_at ? toMs(r.first_paid_at) : undefined,
    referrerAccountId: r.referrer_account_id,
    referrerName: r.referrer_name,
    referrerOwnerEmail: r.referrer_owner_email ?? undefined,
    referrerCode: r.referrer_code ?? undefined,
    creditCents: r.credit_cents ?? undefined,
    creditedAt: r.credited_at ? toMs(r.credited_at) : undefined,
  }));
}

export async function listFounderReferralBalances(): Promise<FounderReferralBalance[]> {
  const { data, error } = await getSupabase().rpc('founder_referral_balances');
  if (error) throw analyticsError(error);
  return ((data ?? []) as Row[]).map((r) => ({
    accountId: r.account_id,
    accountName: r.account_name,
    ownerEmail: r.owner_email ?? undefined,
    referralCode: r.referral_code ?? undefined,
    referredCount: num(r.referred_count),
    paidCount: num(r.paid_count),
    earnedCents: num(r.earned_cents),
    redeemedCents: num(r.redeemed_cents),
    adjustedCents: num(r.adjusted_cents),
    balanceCents: num(r.balance_cents),
    earnedLastYearCents: num(r.earned_last_year_cents),
  }));
}

/** Same as founderError(), naming the analytics migration when it isn't applied. */
function analyticsError(error: { message: string; code?: string }) {
  if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01') {
    return founderError({
      ...error,
      code: undefined,
      message: 'Analytics is not deployed yet — apply 20260917120000_founder_analytics.sql.',
    });
  }
  return founderError(error);
}

// ─── Dashboard, activity, limits and merge ──────────────────────────────────

export async function getFounderDashboardStats(): Promise<FounderDashboardStats> {
  const { data, error } = await getSupabase().rpc('founder_dashboard_stats');
  if (error) throw founderError(error);
  return data as FounderDashboardStats;
}

export async function getFounderOrgActivity(accountId: string): Promise<FounderOrgActivity> {
  const { data, error } = await getSupabase().rpc('founder_org_activity', { p_account_id: accountId });
  if (error) throw founderError(error);
  return data as FounderOrgActivity;
}

export async function setOrganizationLimits(accountId: string, extraTeamLicenses: number): Promise<number> {
  const { data, error } = await getSupabase().rpc('founder_set_org_limits', {
    p_account_id: accountId,
    p_extra_team_licenses: extraTeamLicenses,
  });
  if (error) throw founderError(error);
  return data as number;
}

export async function mergeFounderUsers(fromUserId: string, intoUserId: string, reason?: string): Promise<FounderMergeResult> {
  const { data, error } = await getSupabase().rpc('founder_merge_users', {
    p_from: fromUserId,
    p_into: intoUserId,
    p_reason: reason?.trim() || null,
  });
  if (error) throw founderError(error);
  return data as FounderMergeResult;
}
