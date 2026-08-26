/// <reference types="node" />
import { getSupabase } from '@/lib/supabase';
import { APP_CONFIG } from '@/config/app';
import { type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { DataSource } from '../datasource';
import type { FeedbackSubmission } from '../extras';
import {
  categoryAveragesAcrossEvals,
  generateCloudCode,
  generateId,
  getDefaultWeights,
  getPlayerCategories,
  getPlayerSubskills,
  isGoaliePosition,
  weightedOverallAcrossEvals,
} from '../rubrics';
import { computePlayerResults } from '../scoring';
import type { TeamBuilderConfig, TeamBuilderState } from '../teamBuilder';
import { buildTeams, formatExportCsv } from '../teamBuilder';
import {
  POSITIONS_BY_SPORT,
  TEST_DATA_TAG,
  clampScoreToRubric,
  generateDummyPlayers,
  generateDummyRegistration,
  generateDummyRubrics,
  generateDummyTeamNames,
  generateScoresForPlayer,
  mapAIPlayer,
  pickRecommendation,
  type AITestPlayer,
  type DummyDataOptions,
  type DummyDataResult,
  type DummyTeamOptions,
  type DummyTeamResult,
  type GeneratedPlayer,
} from '../testDataGenerator';
import type {
  AddPlayerForm,
  AdminStats,
  AdminUserRow,
  AiCompareSummary,
  AiPlayerSummary,
  Assessor,
  Athlete,
  AthleteHistory,
  AuthSession,
  ConnectAccountStatus,
  CreateAssessmentForm,
  CreateEventForm,
  CreateSeasonForm,
  CustomRubric,
  Database,
  EnterprisePayment,
  Evaluation,
  EventKind,
  EventType,
  ExportFormat,
  FamilyContact,
  Org,
  Player,
  PlayerProfile,
  PlayerProfileAssessment,
  Recommendation,
  Registration,
  RegistrationSubmit,
  ScoreForm,
  Season,
  SeasonEvent,
  SeasonPlayer,
  SeasonSummary,
  Sport,
  Team,
  TeamBuilderResult,
  TeamMessage,
  TeamRosterPlayer,
  Tryout,
  TryoutSummary,
  UserProfile,
} from '../types';

// ─── small helpers ──────────────────────────────────────────────────────────
// The one documented escape hatch for loosely-shaped Supabase row/RPC-response objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function unwrap<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) {
    const err = new Error(res.error.message) as Error & { code?: string };
    err.code = res.error.code;
    throw err;
  }
  return res.data;
}

/**
 * Set by an operation running under withFreshAccount() as soon as its first
 * write lands, so the wrapper knows a retry would duplicate rather than repeat.
 */
type WriteGuard = { wrote: boolean };

/**
 * Does this failure look like the cached account being wrong?
 *
 * That is the *only* thing withFreshAccount() can fix by retrying, so it is the
 * only thing it retries. Postgres reports an RLS rejection as 42501 (and
 * PostgREST spells the INSERT case out in the message); the two thrown here by
 * ctx()/writableAccountId() are the client-side halves of the same condition.
 * Everything else — a statement timeout, a dropped connection, a unique
 * violation, a read that failed after the write already landed — is a genuine
 * failure that must surface, not be silently re-attempted.
 */
function isStaleAccountError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | undefined;
  if (err?.code === '42501') return true;
  const message = err?.message ?? '';
  return (
    /row-level security/i.test(message) ||
    /No account for user/i.test(message) ||
    /lacks write permissions/i.test(message)
  );
}

/**
 * A non-2xx Edge Function invocation surfaces as a generic FunctionsError
 * ("Edge Function returned a non-2xx status code") — the real reason lives in
 * the response body, which has to be read off `error.context` (a `Response`)
 * as JSON. Falls back to `error.message` (or `fallback`) if the body isn't
 * JSON or doesn't carry an `error`/`message` field.
 */
async function extractFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const err = error as { message?: string; context?: { json?: () => Promise<unknown> } } | null | undefined;
  let message = err?.message || fallback;
  try {
    const body = (await err?.context?.json?.()) as { error?: string; message?: string } | null | undefined;
    if (body?.error) message = body.message || body.error;
  } catch {
    // context wasn't JSON (or didn't exist) — keep the original message.
  }
  return message;
}

const FETCH_PAGE_SIZE = 1000;

/**
 * Every row of `table` whose `column` is one of `ids`, paged by **keyset**
 * (`id > last id seen`) rather than by OFFSET.
 *
 * PostgREST caps an unbounded select at a default row limit (1000), silently
 * truncating rather than erroring — so a query spanning several tryouts whose
 * combined rows exceed that cap would return an incomplete result and
 * undercount whichever tryout's rows land past the cutoff. This keeps asking
 * until a short page proves the server had nothing left, and unlike OFFSET
 * paging it does not get more expensive the deeper it goes. OFFSET makes every later page re-scan and re-authorize
 * everything it has already skipped: the row-level policy runs on candidate
 * rows *before* LIMIT applies, so `offset=5000` pays for 5000 rows' worth of
 * `can_access_*` before returning one. On the dashboard's headcount read that
 * showed up as pages costing 617ms, 872ms, 1252ms, 1434ms, 1790ms, 1916ms —
 * nearly eight seconds of climbing, strictly serial. Keyset paging makes every
 * page cost what the first one did. Shrinking the page alone cannot fix that,
 * it only moves the crossover point.
 *
 * `id` is the primary key, so ordering by it is total: pages can neither
 * overlap nor skip rows, and `select` must therefore include `id`.
 *
 * `isNullColumn` applies an `is null` filter server-side (the roster reads use
 * it for `removed_at`), so soft-deleted rows never cross the wire at all.
 *
 * This mirrors the mobile app's fetchAllByIn() — see its "Fix roster read 500s"
 * change, which hit the same wall from the other client.
 */
async function fetchAllByIn(
  supabase: SupabaseClient,
  table: string,
  select: string,
  column: string,
  ids: string[],
  pageSize: number = FETCH_PAGE_SIZE,
  isNullColumn?: string,
): Promise<Row[]> {
  if (ids.length === 0) return [];

  const out: Row[] = [];
  let cursor: string | null = null;
  for (;;) {
    let q = supabase.from(table).select(select).in(column, ids);
    if (isNullColumn) q = q.is(isNullColumn, null);
    if (cursor !== null) q = q.gt('id', cursor);
    const page = ((unwrap(await q.order('id').limit(pageSize)) as Row[] | null) ?? []) as Row[];
    out.push(...page);
    // A short page means the server had nothing left to give.
    if (page.length < pageSize) return out;
    cursor = page[page.length - 1].id as string;
  }
}

function toMs(iso: string | null | undefined): number {
  return iso ? new Date(iso).getTime() : 0;
}

// ─── bulk registration placement ────────────────────────────────────────────
// addRegistrationsToRoster/addRegistrationsToTeam place registrations in
// chunks rather than one full round trip per registration (fetch, create
// athlete, insert participant, update status) — for a large selection that
// per-item chain is the dominant cost of "Add to Roster" being slow.
/**
 * Rows per request when reading a team roster. The embedded `athletes(*)` join
 * makes PostgREST evaluate the athletes_read policy — can_access_athlete(),
 * five OR'd EXISTS subqueries after the assessor/sharing/team-manager
 * migrations widened it — once per row. A large roster read in one statement
 * therefore outruns the statement timeout long before it outruns the row cap,
 * so the read is paged to keep each statement's share of that predicate bounded.
 */
const TEAM_ROSTER_PAGE = 200;

/**
 * Rows per request when reading event RSVPs, and how many events' worth to ask
 * for at a time. Same shape of problem as TEAM_ROSTER_PAGE: the read policy on
 * event_availability is evaluated per row, so one unbounded
 * `in('season_event_id', [...])` over a large team's event covers thousands of
 * rows in a single statement and dies on the statement timeout (57014) — and
 * even when it survived, an unranged select silently stops at PostgREST's
 * 1,000-row default and undercounts every event after the first.
 */
const EVENT_AVAILABILITY_PAGE = 500;
const EVENT_AVAILABILITY_EVENT_CHUNK = 25;

/**
 * Rows per request when reading evaluations for assembleTryouts. Same shape
 * of problem as TEAM_ROSTER_PAGE/EVENT_AVAILABILITY_PAGE: the embedded
 * `evaluation_scores(rubric_key, value)` join makes PostgREST evaluate the
 * evaluations/evaluation_scores read policies per row, so a full-size
 * FETCH_PAGE_SIZE page (1000 evaluations, each pulling in its scores) across
 * several batched tryouts outruns the statement timeout (57014) well before
 * it outruns the row cap.
 */
const EVALUATIONS_PAGE = 300;

/**
 * Rows per request for the roster reads that embed `athletes(*)`. Same reasoning
 * as TEAM_ROSTER_PAGE — the embed makes PostgREST evaluate can_access_athlete()
 * once per row, so a full-size page costs far more than its row count suggests.
 * Keyset paging (see fetchAllByIn) keeps the cost flat *across* pages; this keeps
 * the cost of any *single* page bounded. Mirrors the mobile app's constant of
 * the same name.
 */
const PARTICIPANTS_PAGE = 200;

/**
 * Headcount statements in flight at once for the list screens — see
 * countParticipantsByTryout() and countTeamPlayers(). Bounded rather than
 * "all the tryouts at once"
 * for the same reason as REGISTRATION_CHUNK_CONCURRENCY: one shared Postgres
 * pooler sits behind every one of them, and an account with dozens of tryouts
 * would otherwise open dozens of simultaneous statements the moment its
 * dashboard mounts.
 */
const PARTICIPANT_COUNT_CONCURRENCY = 6;

/**
 * Tryouts per statement when reading evaluations. One, deliberately.
 *
 * Shrinking the *page* is not enough on its own: the row-level policy runs on
 * candidate rows before LIMIT applies, so every page of an
 * `in('tryout_id', [...])` read pays for the whole batch again, and OFFSET
 * makes each later page re-scan what it already skipped. Four tryouts at
 * `offset=1200&limit=300` is what actually hit the 8s timeout. Narrowing the
 * statement to a single tryout bounds that work no matter how many tryouts the
 * dashboard lists; the chunks run concurrently, so it costs round trips, not
 * wall clock. Raise this once `evaluations(tryout_id)` is indexed.
 */
const EVALUATIONS_TRYOUT_CHUNK = 1;

const REGISTRATION_CHUNK = 20;
const REGISTRATION_CHUNK_CONCURRENCY = 6;
const GUARDIAN_EMAIL_CONCURRENCY = 10;
const GUARDIAN_RESOLVE_BATCH = 50;

/** Players per `generate-test-players` call — sized so one Claude response stays
 * within a comfortable output length rather than risking a truncated batch. */
const AI_CHUNK = 20;

/** Extra attempts per AI chunk before it falls back to local generation. */
const AI_CHUNK_RETRIES = 2;

/**
 * Ceilings on how many requests a dummy batch keeps in flight. The actual width
 * is chosen per run by `concurrencyFor` — a 25-player batch has nothing to gain
 * from a wide burst, while the 1000-player ceiling wants everything at once.
 *
 * Writes land on one Postgres pooler, so `insert` is kept below the AI ceiling —
 * that pool has a fixed number of connections to share across the whole app, not
 * just this batch. The AI chunks are independent edge-function invocations that
 * scale out, so `ai` can go wider; 50 is exactly the chunk count of a 1000-player
 * run (1000 ÷ AI_CHUNK), so the largest batch allowed fires as a single wave.
 *
 * Mirrors the mobile app's constant of the same name.
 */
const DUMMY_MAX_CONCURRENCY = { insert: 20, ai: 50 } as const;

/**
 * Row ceilings for the dummy-data bulk inserts, sized per table so one request's
 * JSON body lands around ~500KB. A full 1000-player × 5-session batch is ~37,000
 * rows across four tables; at these sizes that's ~11 requests instead of the ~74
 * that 500-row chunks cost, and the narrow tables (scores are three columns) get
 * the biggest chunks because their rows are the cheapest to ship. Kept bounded
 * rather than "one request per table" so a dropped request doesn't cost the
 * whole batch. Mirrors the mobile app's constant of the same name.
 */
const DUMMY_CHUNK = {
  registrations: 500,
  athletes: 1000,
  participants: 1000,
  evaluations: 2000,
  scores: 5000,
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function concurrencyFor(chunkCount: number, max: number): number {
  return Math.max(1, Math.min(chunkCount, max));
}

/**
 * Run `task` over every item with at most `limit` in flight, returning results
 * **in input order** — never completion order, since callers zip the returned
 * ids against their own arrays. A worker pool rather than fixed-size waves, so
 * one slow request doesn't hold back the rest of its group.
 */
async function mapPool<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrencyFor(items.length, limit) }, async () => {
      for (let i = next++; i < items.length; i = next++) {
        results[i] = await task(items[i], i);
      }
    }),
  );
  return results;
}

/**
 * Insert `items` in chunks of `size`, up to `DUMMY_MAX_CONCURRENCY.insert`
 * requests in flight, returning every chunk's rows concatenated in input order.
 * `task` gets the chunk's offset into `items` so a chunk can index into arrays
 * built by an earlier phase. `onProgress` fires as each chunk lands, with the
 * running item count — which climbs monotonically even though chunks may finish
 * out of order.
 *
 * The serial `for (i += CHUNK)` loops this replaces made every chunk wait out
 * the previous one's full round trip, so a big batch cost the sum of its
 * requests rather than the widest of them.
 */
async function insertChunked<T, R>(
  items: T[],
  size: number,
  task: (chunk: T[], offset: number) => Promise<R[]>,
  onProgress?: (done: number) => void,
): Promise<R[]> {
  const chunks: { rows: T[]; offset: number }[] = [];
  for (let i = 0; i < items.length; i += size) chunks.push({ rows: items.slice(i, i + size), offset: i });

  let done = 0;
  const results = await mapPool(chunks, DUMMY_MAX_CONCURRENCY.insert, async (c) => {
    const rows = await task(c.rows, c.offset);
    done += c.rows.length;
    onProgress?.(done);
    return rows;
  });
  return results.flat();
}

/**
 * A generated dummy player, with the AI's raw per-rubric scores when the batch
 * was AI-generated and without them when it was produced locally.
 */
type ScorableDummyPlayer = GeneratedPlayer & { scores?: Record<string, number> };

/** Coerce a caller-supplied count into a safe range, falling back if unusable. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  return Math.max(min, Math.min(max, isFinite(n) && n > 0 ? n : fallback));
}
function toIso(ms: number | null | undefined): string | null {
  return ms != null ? new Date(ms).toISOString() : null;
}

/**
 * The real origin this tab is being served from, preferred over
 * NEXT_PUBLIC_WEB_URL whenever it's a usable http(s) origin. That env var only
 * exists for the mobile app's embedded webview case (see webOrigin below) —
 * treating it as the *default* instead of a fallback meant a stale or
 * mis-set value (e.g. still pointing at localhost) silently overrode the
 * correct origin for every real web visitor, sending Stripe/email redirects
 * to a URL only the developer's machine could reach.
 */
function actualOrigin(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const { origin } = window.location;
  return /^https?:\/\//.test(origin) ? origin : APP_CONFIG.webUrl || undefined;
}

/**
 * Where Supabase should send the browser after a signup/invite confirmation
 * link is clicked. Left undefined server-side (no window to read an origin
 * from) and during SSR — signup/resend only ever run client-side anyway.
 */
function emailRedirectTo(): string | undefined {
  const origin = actualOrigin();
  return origin ? `${origin}/auth/callback` : undefined;
}

/**
 * This browser tab's own origin, sent to the create-checkout-session /
 * create-portal-session functions so Stripe sends the customer back here
 * instead of to the mobile app's aastryout:// deep link (see webOrigin.ts
 * in the functions repo for why that link alone left web users stranded).
 */
function webOrigin(): string | undefined {
  return actualOrigin();
}

/**
 * For any 5xx response, the Supabase auth-js SDK builds its error message by
 * JSON.stringify-ing the raw, not-yet-parsed fetch Response (see
 * AuthRetryableFetchError in @supabase/auth-js) — which has no enumerable
 * properties, so it serializes to the literal string "{}" instead of
 * anything a user could read. Swap that (or any other JSON-shaped string —
 * the same stringify path applies to other non-Response objects too) for a
 * real fallback instead of surfacing it as-is.
 */
function authErrorMessage(message: string | null | undefined, fallback: string): string {
  if (!message || /^[{[]/.test(message.trim())) return fallback;
  return message;
}

const EVENT_TYPE_TO_DB: Record<EventType, string> = {
  Tryout: 'tryout',
  Assessment: 'assessment',
  'Sort Out': 'sort_out',
  Combine: 'combine',
};
const EVENT_TYPE_FROM_DB: Record<string, EventType> = {
  tryout: 'Tryout',
  assessment: 'Assessment',
  sort_out: 'Sort Out',
  combine: 'Combine',
};

const REC_TO_DB: Record<Exclude<Recommendation, ''>, string> = {
  Make: 'make',
  Keep: 'keep',
  Bubble: 'bubble',
  Release: 'release',
};
const REC_FROM_DB: Record<string, Recommendation> = {
  make: 'Make',
  keep: 'Keep',
  bubble: 'Bubble',
  release: 'Release',
};

const EVENT_KIND_TO_DB: Record<EventKind, string> = {
  Game: 'game',
  Practice: 'practice',
  Event: 'event',
};
const EVENT_KIND_FROM_DB: Record<string, EventKind> = {
  game: 'Game',
  practice: 'Practice',
  event: 'Event',
};



/**
 * Converts a image URI (file://, ph://, blob:, data:, http) to an ArrayBuffer cross-platform.
 */
async function uriToArrayBuffer(fileUri: string): Promise<ArrayBuffer> {
  // Web, Expo, or React Native Fetch API handles local blob/file URIs seamlessly
  const response = await fetch(fileUri);
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert file to ArrayBuffer'));
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}


export class SupabaseDataSource implements DataSource {
  private userId: string | null = null;
  private accountId: string | null = null;
  /** In-flight ctx() account resolution, shared by concurrent callers. */
  private accountPromise: Promise<void> | null = null;
  private profileCache: Record<string, UserProfile> = {};
  /** Membership role per account, filled in by ctx()'s memberships lookup. */
  private roleByAccountId: Record<string, string> = {};
  /** Onboarding flags already known to be set, so markOnboarding() can no-op. */
  private onboardingSteps: Record<string, boolean> | null = null;
  private authListenerAttached = false;

  private notImplemented(method: string): never {
    throw new Error(`SupabaseDataSource.${method}() not implemented yet.`);
  }

  // Higher-privilege roles win when a user holds more than one membership.
  private getRoleWeight(role: string): number {
    const weights: Record<string, number> = { owner: 4, admin: 3, coach: 2, assessor: 1, guardian: 0 };
    return weights[role] ?? 0;
  }

  // Resolves just the authenticated user id, without requiring an account/
  // membership. Guardians are provisioned with a profile but intentionally no
  // account/membership row, so guardian-only reads must use this instead of
  // ctx().
  private async userCtx(): Promise<{ supabase: SupabaseClient; userId: string }> {
    const supabase = getSupabase();
    return { supabase, userId: await this.resolveUserId() };
  }

  /**
   * The signed-in user's id, read from the locally persisted session.
   *
   * Deliberately `getSession()` and not `getUser()`: `getUser()` makes an HTTP
   * call to the Auth server *every* time, and `ctx()` sits in front of ~90
   * datasource methods, so creating a team used to spend half a dozen network
   * round trips just re-asking who the caller is. `getSession()` reads storage
   * and only goes to the network when the token has actually expired. Nothing
   * is trusted on the strength of this value — it only decides which rows to
   * ask for, and RLS re-verifies the JWT server-side on every query.
   */
  private async resolveUserId(): Promise<string> {
    const supabase = getSupabase();
    this.ensureAuthListener(supabase);
    if (this.userId) return this.userId;
    const { data, error } = await supabase.auth.getSession();
    const uId = data.session?.user?.id;
    if (error || !uId) throw new Error('User not authenticated');
    this.userId = uId;
    return uId;
  }

  /**
   * Keeps the cached identity honest now that resolveUserId() reads it from
   * storage rather than asking the Auth server on every call: the SDK tells us
   * when the session is replaced or dropped, and everything derived from the
   * old one gets thrown away. Attached on first use, not at construction —
   * getSupabase() throws when the app isn't configured, which must not happen
   * at module load.
   */
  private ensureAuthListener(supabase: SupabaseClient): void {
    if (this.authListenerAttached) return;
    this.authListenerAttached = true;
    supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user?.id ?? null;
      // A token refresh for the same person changes nothing worth dropping.
      if (event !== 'SIGNED_OUT' && nextUserId === this.userId) return;
      this.userId = nextUserId;
      this.profileCache = {};
      this.resetAccountCaches();
    });
  }

  private async ctx(): Promise<{
    supabase: SupabaseClient;
    userId: string;
    accountId: string;
  }> {
    const supabase = getSupabase();
    const uId = await this.resolveUserId();

    if (!this.accountId) {
      // Share one lookup between everything that asks while it is in flight.
      // ctx() fronts ~90 datasource methods and the screens above it fire
      // their reads together — the dashboard alone entered here four times in
      // the same tick, so the identical memberships query went out four times
      // and the callers waited on the slowest copy (286ms vs 1110ms) instead
      // of the first. Cleared in `finally` so only a *resolved* account is
      // remembered; a failure leaves the next caller to retry rather than
      // handing it a cached rejection.
      const pending = (this.accountPromise ??= this.resolveAccount(supabase, uId).finally(() => {
        // Only retire *this* lookup. resetAccountCaches() may have dropped it
        // and a newer one may already be in flight; clearing unconditionally
        // would discard that one and send a third caller out for a duplicate.
        if (this.accountPromise === pending) this.accountPromise = null;
      }));
      await pending;
    }

    const accountId = this.accountId;
    if (!accountId) {
      throw new Error('No account for user');
    }

    return {
      supabase,
      userId: uId,
      accountId,
    };
  }

  /**
   * The memberships read behind ctx(), factored out so concurrent callers can
   * share a single in-flight copy of it. Sets the same two caches ctx() used to
   * set inline, and throws the same errors.
   */
  private async resolveAccount(supabase: SupabaseClient, uId: string): Promise<void> {
    const m = await supabase.from('memberships').select('account_id, role').eq('user_id', uId);

    if (m.error) {
      throw m.error;
    }

    const memberships = m.data ?? [];

    if (memberships.length === 0) {
      throw new Error('No account for user');
    }

    const sorted = memberships.sort(
      (a: Row, b: Row) => this.getRoleWeight(b.role) - this.getRoleWeight(a.role),
    );

    this.accountId = sorted[0].account_id;
    // The role came back on the same row, so writableAccountId() never has
    // to go ask for it again.
    this.roleByAccountId = {};
    for (const row of memberships) this.roleByAccountId[row.account_id] = row.role;
  }

  private async writableAccountId(): Promise<string> {
    const { supabase, userId, accountId } = await this.ctx();
    // ctx() already reads `role` alongside `account_id`, so the common path
    // costs nothing. Only re-query when the cache was cleared (or the account
    // was resolved before this cache existed) — this used to be an extra round
    // trip on every single write.
    let role = this.roleByAccountId[accountId];
    if (role === undefined) {
      const { data: m } = await supabase
        .from('memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('account_id', accountId)
        .single();
      role = m?.role;
      if (role !== undefined) this.roleByAccountId[accountId] = role;
    }
    if (!role || !['owner', 'admin', 'coach'].includes(role)) {
      throw new Error('Current account lacks write permissions for this operation.');
    }
    return accountId;
  }

  /**
   * Drops everything derived from "which account is this user acting as" —
   * the account id itself plus the role and onboarding flags cached against it.
   * Called whenever the signed-in identity changes or an operation fails in a
   * way that suggests the cached account is wrong.
   */
  private resetAccountCaches(): void {
    this.accountId = null;
    this.accountPromise = null;
    this.roleByAccountId = {};
    this.onboardingSteps = null;
  }

  /**
   * Runs a write, retrying it once against a freshly-resolved account — but
   * only when the failure is the one this guard exists for, and only when the
   * first attempt wrote nothing.
   *
   * It used to retry on *any* error, which is unsound for every operation it
   * wraps: all of them are multi-step, non-idempotent writes. `_addPlayer()`
   * creates an athlete, inserts a participant, then *reads the row back*; when
   * that trailing read failed — a timeout, a slow embed, any transient — the
   * retry re-ran the whole method from the top and created a second athlete
   * and a second participant. `_createTryout()` did the same with a whole
   * assessment plus an auto-imported copy of the team roster. That is the
   * duplicate every add-player path was producing, and why the duplicate
   * survived `addTeamRosterPlayers()`'s upsert: the retry's athlete has a new
   * id, so `(team_id, athlete_id)` never collides.
   *
   * generateTestData() and generateDummyTeams() already opted out of this
   * wrapper for exactly this reason; the same hazard applied to every other
   * caller.
   *
   * `guard.wrote` is set by each operation the moment its first write lands, so
   * a stale-account rejection that somehow arrives mid-operation isn't retried
   * either. Nothing is retried unless it failed authorization before writing.
   */
  private async withFreshAccount<T>(operation: (guard: WriteGuard) => Promise<T>): Promise<T> {
    const guard: WriteGuard = { wrote: false };
    try {
      return await operation(guard);
    } catch (e) {
      if (guard.wrote || !isStaleAccountError(e)) throw e;
      this.resetAccountCaches();
      return await operation({ wrote: false });
    }
  }

  /**
   * Best-effort onboarding checklist flags.
   *
   * Resolves immediately and does the read-modify-write in the background: the
   * flags are never read back by the caller, and awaiting them was adding three
   * serial round trips (whoami + select + update) to the end of every create.
   * Once a flag is known set, repeat calls cost nothing at all.
   */
  private markOnboarding(patch: Record<string, boolean>): Promise<void> {
    const known = this.onboardingSteps;
    if (known && Object.entries(patch).every(([k, v]) => known[k] === v)) return Promise.resolve();

    void (async () => {
      try {
        const { supabase, userId } = await this.ctx();
        const prof = await supabase
          .from('profiles')
          .select('onboarding_steps')
          .eq('id', userId)
          .single();
        const steps = { ...(prof.data?.onboarding_steps ?? {}), ...patch };
        await supabase.from('profiles').update({ onboarding_steps: steps }).eq('id', userId);
        this.onboardingSteps = steps;
      } catch {
        // onboarding flags are best-effort; never block the primary mutation
      }
    })();
    return Promise.resolve();
  }

  // ─── shape mappers ──────────────────────────────────────────────────────────
  private rowToPlayer(p: Row, assessorNameById: Record<string, string>): Player {
    const rawAthletes = p.athletes;
    const a = Array.isArray(rawAthletes) ? rawAthletes[0] : rawAthletes ?? {};
    return {
      id: p.id,
      athleteId: a.id,
      first: a.first_name ?? '',
      last: a.last_name ?? '',
      avatarUrl: a.avatar_url ?? undefined,
      anonymous: p.anonymous || undefined,
      jersey: p.jersey ?? undefined,
      jerseyColour: p.jersey_colour ?? undefined,
      pos: p.position ?? undefined,
      shoots: p.shoots ?? undefined,
      assignedAssessor: p.assigned_assessor_id ? assessorNameById[p.assigned_assessor_id] : undefined,
      guardianName: a.guardian_name ?? undefined,
      guardianEmail: a.guardian_email ?? undefined,
      guardianPhone: a.guardian_phone ?? undefined,
      linkedGuardianId: a.guardian_user_id ?? undefined,
      yearOfBirth: a.year_of_birth != null ? String(a.year_of_birth) : undefined,
      currentPosition: a.default_position ?? undefined,
      currentTeam: p.current_team ?? undefined,
      currentLevel: p.current_level ?? undefined,
      positionTryingOutFor: p.position_trying_out_for ?? undefined,
      aboutChild: a.about ?? undefined,
      medicalInfo: a.medical_info ?? undefined,
      friend1Name: p.friend1_name ?? undefined,
      friend2Name: p.friend2_name ?? undefined,
      sortOut: p.sort_out || undefined,
      waiverAcceptedAt: p.waiver_accepted_at ? toMs(p.waiver_accepted_at) : undefined,
      registrationSource: p.registration_source ?? undefined,
      createdAt: toMs(p.created_at),
      updatedAt: p.updated_at ? toMs(p.updated_at) : undefined,
    };
  }

  private rowToEval(e: Row): Evaluation {
    const scores: Record<string, number> = {};
    for (const s of e.evaluation_scores ?? []) scores[s.rubric_key] = Number(s.value);
    return {
      id: e.id,
      playerId: e.participant_id,
      date: e.created_at ? new Date(e.created_at).toISOString().split('T')[0] : '',
      evaluator: e.evaluator_name,
      session: e.session ?? 'Session 1',
      strengths: e.strengths ?? undefined,
      improve: e.improve ?? undefined,
      recommendation: e.recommendation ? REC_FROM_DB[e.recommendation] ?? '' : '',
      scores,
      source: e.source ?? undefined,
      createdAt: toMs(e.created_at),
      updatedAt: e.updated_at ? toMs(e.updated_at) : undefined,
    };
  }

  private rowToAssessor(a: Row): Assessor {
    return {
      name: a.name,
      email: a.email ?? '',
      role: a.role ?? 'assessor',
      status: a.status ?? 'accepted',
      userId: a.user_id ?? undefined,
    };
  }

  private rowToRegistration(r: Row): Registration {
    return {
      id: r.id,
      eventId: r.tryout_id,
      firstName: r.first_name,
      lastName: r.last_name,
      yearOfBirth: r.year_of_birth != null ? String(r.year_of_birth) : undefined,
      positionTryingOutFor: r.position_trying_out_for ?? undefined,
      guardianName: r.guardian_name,
      guardianEmail: r.guardian_email,
      guardianPhone: r.guardian_phone ?? undefined,
      currentTeam: r.current_team ?? undefined,
      currentLevel: r.current_level ?? undefined,
      aboutPlayer: r.about_player ?? undefined,
      medicalInfo: r.medical_info ?? undefined,
      friend1Name: r.friend1_name ?? undefined,
      friend2Name: r.friend2_name ?? undefined,
      status: r.status,
      paymentStatus: r.payment_status ?? undefined,
      createdAt: toMs(r.created_at),
    };
  }

  /**
   * Every evaluation (with its scores) for a set of tryouts.
   *
   * Three shapes, in descending order of how well they survive the statement
   * timeout, because a deployment may only have the first one available:
   *
   * 1. `get_evaluations_for_tryouts` — authorizes once per tryout instead of
   *    once per row, same as fetchEventAvailability() prefers
   *    `get_event_availability`.
   * 2. The read as an embed hanging off `tryouts` (see
   *    fetchEvaluationsViaTryouts) — the shape that already rescued the
   *    comparable event_availability read.
   * 3. The direct read, one tryout per statement.
   *
   * Any RPC error falls through, not just a missing function: an RPC that
   * exists but times out should still get the cheaper plans tried before the
   * dashboard gives up on the whole read.
   */
  private async fetchEvaluationsForTryouts(supabase: SupabaseClient, ids: string[]): Promise<Row[]> {
    if (ids.length === 0) return [];

    const { data, error } = await supabase.rpc('get_evaluations_for_tryouts', { p_tryout_ids: ids });
    if (!error) return (data as Row[]) ?? [];

    if (error.code === 'PGRST202' || error.code === '42883') {
      console.warn('get_evaluations_for_tryouts() not deployed — trying the embedded read.');
    } else {
      console.error('get_evaluations_for_tryouts failed — trying the embedded read.', error);
    }

    const embedded = await this.fetchEvaluationsViaTryouts(supabase, ids);
    if (embedded.ok) return embedded.rows;

    // Last resort: the direct read, one tryout per statement. Keyset-paged like
    // every other batched read here, which also makes the page order stable —
    // without an ORDER BY, successive pages are free to come back in different
    // row orders, silently duplicating some evaluations and dropping others.
    const perTryout = await mapPool(ids, REGISTRATION_CHUNK_CONCURRENCY, (tryoutId) =>
      fetchAllByIn(
        supabase,
        'evaluations',
        '*, evaluation_scores(rubric_key, value)',
        'tryout_id',
        [tryoutId],
        EVALUATIONS_PAGE,
      ),
    );
    return perTryout.flat();
  }

  /**
   * Evaluations read as an embed on their parent tryout.
   *
   * Same statement, different plan — the trick that already fixed the
   * event_availability read (see fetchAvailabilityViaEvents). Filtering
   * `evaluations` directly makes `tryout_id` an ordinary user qual, which
   * Postgres evaluates *after* the table's row-level policy, so the policy
   * runs against far more of the table than the four tryouts asked for. As an
   * embed, PostgREST emits a LATERAL keyed on `tryouts.id`, so the FK becomes
   * a join condition that drives the scan and the policy only sees what
   * survives it. It also removes OFFSET from the picture entirely: children of
   * an embed are not paged, so there is no later page that has to re-skip the
   * earlier ones.
   *
   * Returns `ok: false` on any error so the caller falls through to the direct
   * read rather than this becoming a way to silently report zero evaluations —
   * which would read as lost assessments to a coach.
   */
  private async fetchEvaluationsViaTryouts(
    supabase: SupabaseClient,
    ids: string[],
  ): Promise<{ rows: Row[]; ok: boolean }> {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += EVALUATIONS_TRYOUT_CHUNK) {
      chunks.push(ids.slice(i, i + EVALUATIONS_TRYOUT_CHUNK));
    }

    try {
      const parentChunks = await mapPool(chunks, REGISTRATION_CHUNK_CONCURRENCY, async (chunk) => {
        const { data, error } = await supabase
          .from('tryouts')
          .select('id, evaluations(*, evaluation_scores(rubric_key, value))')
          .in('id', chunk);
        if (error) throw error;
        return (data as Row[]) ?? [];
      });

      const rows: Row[] = [];
      for (const parent of parentChunks.flat()) {
        // assembleTryouts groups these by tryout_id. The embed already carries
        // it under `*`, but taking it from the parent keeps the grouping right
        // regardless of what the child select returns.
        for (const e of (parent.evaluations as Row[]) ?? []) rows.push({ ...e, tryout_id: parent.id });
      }
      return { rows, ok: true };
    } catch (error) {
      console.warn('evaluations-via-tryouts read failed — falling back to the direct read.', error);
      return { rows: [], ok: false };
    }
  }

  /** Assemble full Tryout objects for a set of tryout rows (batched relational fetch). */
  private async assembleTryouts(tryoutRows: Row[]): Promise<Tryout[]> {
    if (tryoutRows.length === 0) return [];
    const supabase = getSupabase();
    const ids = tryoutRows.map((t) => t.id);

    const [pRows, aRows, eRows, rRows] = await Promise.all([
      // Soft-removed players (see deletePlayer) stay in the table so their
      // evaluations still count toward the athlete's permanent profile history,
      // but they should no longer appear on this tryout's active roster. Filtering
      // removed_at here (rather than after the fetch) keeps them from eating into
      // Supabase's default row cap when batching many tryouts in one query — with
      // a JS-side filter, soft-deleted rows from *other* tryouts in the batch could
      // push a large roster's real participants past the cap and undercount it.
      fetchAllByIn(
        supabase,
        'tryout_participants',
        '*, athletes(*)',
        'tryout_id',
        ids,
        PARTICIPANTS_PAGE,
        'removed_at',
      ),
      fetchAllByIn(supabase, 'tryout_assessors', '*', 'tryout_id', ids),
      this.fetchEvaluationsForTryouts(supabase, ids),
      fetchAllByIn(supabase, 'registrations', '*', 'tryout_id', ids),
    ]);

    const assessorNameById: Record<string, string> = {};
    for (const a of aRows) assessorNameById[a.id] = a.name;

    const byTryout = (rows: Row[]) => {
      const map: Record<string, Row[]> = {};
      for (const r of rows) (map[r.tryout_id] ??= []).push(r);
      return map;
    };
    const pByT = byTryout(pRows);
    const aByT = byTryout(aRows);
    const eByT = byTryout(eRows);
    const rByT = byTryout(rRows);

    // Deduplicate evals by participant_id, evaluator_user_id, and session to hide existing corrupted duplicates
    for (const tryoutId of Object.keys(eByT)) {
      const uniqueEvals = new Map<string, Row>();
      for (const e of eByT[tryoutId]) {
        const key = `${e.participant_id}-${e.evaluator_user_id}-${e.session}`;
        const existing = uniqueEvals.get(key);

        const currentScoresLen = e.evaluation_scores?.length ?? 0;
        const existingScoresLen = existing?.evaluation_scores?.length ?? 0;

        // Prefer the duplicate that actually has scores; if tied, take the newest one
        if (
          !existing ||
          currentScoresLen > existingScoresLen ||
          (currentScoresLen === existingScoresLen && new Date(e.created_at) > new Date(existing.created_at))
        ) {
          uniqueEvals.set(key, e);
        }
      }
      eByT[tryoutId] = Array.from(uniqueEvals.values());
    }

    return tryoutRows.map((t) => {
      const settings = t.settings ?? { skaterWeights: {}, goalieWeights: {}, customRubrics: [] };
      const ai = t.ai_assessments ?? {};
      const { teamBuilder, ...aiAssessments } = ai;
      const roster = (pByT[t.id] ?? []).map((p) => this.rowToPlayer(p, assessorNameById));
      return {
        id: t.id,
        name: t.name,
        teamId: t.team_id ?? undefined,
        seasonId: t.season_id ?? undefined,
        createdAt: toMs(t.created_at),
        updatedAt: toMs(t.updated_at),
        eventType: EVENT_TYPE_FROM_DB[t.event_type] ?? 'Tryout',
        tryoutDate: t.tryout_date ?? undefined,
        startTime: t.start_time ?? undefined,
        rink: t.location ?? undefined,
        sport: t.sport,
        sportOther: t.sport_other ?? undefined,
        defaultPosition: t.default_position ?? undefined,
        headAssessor: t.head_assessor ?? undefined,
        headCoach: t.head_coach ?? undefined,
        assessors: (aByT[t.id] ?? []).map((a) => this.rowToAssessor(a)),
        roster,
        evals: (eByT[t.id] ?? []).map((e) => this.rowToEval(e)),
        registrations: (rByT[t.id] ?? []).map((r) => this.rowToRegistration(r)),
        settings,
        cloud: t.registration_code
          ? { id: t.registration_code, enabled: t.registration_open }
          : undefined,
        archived: t.archived,
        teamBuilder,
        aiAssessments: Object.keys(aiAssessments).length ? aiAssessments : undefined,
      } as Tryout;
    });
  }

  private async fetchPlayer(participantId: string): Promise<Player> {
    const supabase = getSupabase();
    const data = unwrap(
      await supabase.from('tryout_participants').select('*, athletes(*)').eq('id', participantId).single(),
    ) as Row;
    return this.rowToPlayer(data, {});
  }

  private async fetchEval(evalId: string): Promise<Evaluation> {
    const supabase = getSupabase();
    const data = unwrap(
      await supabase
        .from('evaluations')
        .select('*, evaluation_scores(rubric_key, value)')
        .eq('id', evalId)
        .single(),
    ) as Row;
    return this.rowToEval(data);
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────
  private async loadUserProfile(userId: string): Promise<UserProfile> {
    if (this.profileCache[userId]) {
      return this.profileCache[userId];
    }
    const supabase = getSupabase();
    // Three independent lookups, all keyed on a userId we already hold: the
    // profile row, the membership that carries the account (and therefore the
    // plan), and the Auth server's view of whether the address is confirmed.
    // Nothing here feeds anything else here, so awaiting them one after
    // another just stacked three round trips — measured at 1262ms + 755ms +
    // 384ms, in front of *every* login and every cold boot, since this sits on
    // the path from "signed in" to the first screen having a session at all.
    const [profileRes, membershipRes, userRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase
        .from('memberships')
        .select('role, accounts(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase.auth.getUser(),
    ]);

    // Unwrapped after the wave rather than inside it. A PostgREST call resolves
    // with `{ data, error }` instead of rejecting, so all three still complete
    // and a failing profile read throws from exactly the same place, with the
    // same error, as it did when these ran in series.
    const profile = unwrap(profileRes) as Row;
    // A *failed* membership read must not be read as "this user has no
    // membership". Everything the account carries — plan tier, org name, extra
    // team licenses, Connect flags — is derived from this row, so swallowing
    // the error silently signed the coach in as free-tier and persisted that to
    // storage, where it stuck (and produced a bogus "you've reached your plan's
    // limit" banner) until something refetched the profile. Seen for real
    // against a transient 401. `data: null` with no error still means what it
    // always did: a guardian, provisioned with a profile and no membership row.
    if (membershipRes.error) throw membershipRes.error;
    const membership = membershipRes.data as Row | null;
    const account = Array.isArray(membership?.accounts)
      ? membership.accounts[0]
      : (membership?.accounts as Row | undefined);

    const rawRole = membership?.role;
    const role = rawRole === 'owner' ? 'admin' : rawRole;

    const { data: uData } = userRes;
    const emailVerified = uData?.user?.email_confirmed_at != null || uData?.user?.confirmed_at != null || !uData?.user;

    const result = {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      organization: account?.type === 'organization' ? account.name : undefined,
      avatarUrl: profile.avatar_url ?? undefined,
      planTier: (account?.plan_tier as UserProfile['planTier']) ?? 'free',
      subscriptionStatus: account?.subscription_status,
      extraTeamLicenses: account?.extra_team_licenses ?? 0,
      connectChargesEnabled: !!account?.stripe_connect_charges_enabled,
      connectPayoutsEnabled: !!account?.stripe_connect_payouts_enabled,
      createdAt: toMs(profile.created_at),
      onboardingCompleted: profile.onboarding_completed,
      onboardingSteps: profile.onboarding_steps,
      role: role ?? undefined,
      emailVerified,
    };
    this.profileCache[userId] = result;
    return result;
  }

  private toAuthSession(session: Session, user: UserProfile): AuthSession {
    return { token: session.access_token, user, expiresAt: (session.expires_at ?? 0) * 1000 };
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new Error(authErrorMessage(error?.message, 'Login failed. Please try again.'));
    this.resetAccountCaches();
    this.userId = data.session.user.id;
    const user = await this.loadUserProfile(data.session.user.id);
    return this.toAuthSession(data.session, user);
  }

  async signup(displayName: string, email: string, password: string, accountType: string): Promise<AuthSession> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName, account_type: accountType },
        // Without this, the confirmation link falls back to Supabase's
        // project-level Site URL and lands with an unconsumed token in the
        // URL — this app doesn't auto-parse it (see supabase.ts's
        // detectSessionInUrl: false), so the tab just goes blank. Routing it
        // at /auth/callback instead gives the app a page whose whole job is
        // to read that token and actually start the session.
        emailRedirectTo: emailRedirectTo(),
      },
    });
    if (error) throw new Error(authErrorMessage(error.message, 'Failed to create your account. Please try again.'));
    let session = data.session;
    if (!session) {
      const { data: signIn, error: e2 } = await supabase.auth.signInWithPassword({ email, password });
      if (e2 || !signIn.session) {
        throw new Error('Account created. Please confirm your email, then log in.');
      }
      session = signIn.session;
    }
    this.resetAccountCaches();
    this.userId = session.user.id;
    const user = await this.loadUserProfile(session.user.id);
    return this.toAuthSession(session, user);
  }

  async logout(): Promise<void> {
    this.resetAccountCaches();
    this.userId = null;
    try {
      await getSupabase().auth.signOut();
    } catch (error) {
      console.warn('Supabase signOut failed, force clearing auth storage:', error);
    } finally {
      // Sweep the Supabase SDK's own sb-* auth-token keys directly — this
      // app's storage wrapper namespaces everything it writes under
      // `aas-web:`, so it never sees (or could remove) these keys anyway.
      if (typeof window !== 'undefined' && window.localStorage) {
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
          const key = window.localStorage.key(i);
          if (key && (key.includes('auth-token') || key.startsWith('sb-'))) {
            window.localStorage.removeItem(key);
          }
        }
      }
    }
  }

  async getSession(forceRefresh?: boolean): Promise<AuthSession | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      this.userId = null;
      this.resetAccountCaches();
      return null;
    }
    try {
      this.userId = data.session.user.id;
      if (forceRefresh) {
        delete this.profileCache[data.session.user.id];
      }
      const user = await this.loadUserProfile(data.session.user.id);
      return this.toAuthSession(data.session, user);
    } catch (e) {
      console.warn('Failed to restore session profile, signing out:', e);
      this.userId = null;
      this.resetAccountCaches();
      await supabase.auth.signOut();
      return null;
    }
  }

  async getProfile(forceRefresh?: boolean): Promise<UserProfile | null> {
    // resolveUserId() rather than auth.getUser(): the profile query is
    // refetched after most writes, and it does not need a network hop to the
    // Auth server to find out whose profile to load.
    let userId: string;
    try {
      userId = await this.resolveUserId();
    } catch {
      return null;
    }
    if (forceRefresh) {
      delete this.profileCache[userId];
    }
    return this.loadUserProfile(userId);
  }

  async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    const { supabase, userId, accountId } = await this.ctx();
    const profilePatch: Row = {};
    if (updates.displayName !== undefined) profilePatch.display_name = updates.displayName;
    if (updates.onboardingCompleted !== undefined)
      profilePatch.onboarding_completed = updates.onboardingCompleted;
    if (updates.onboardingSteps !== undefined) profilePatch.onboarding_steps = updates.onboardingSteps;
    if (updates.avatarUrl !== undefined) profilePatch.avatar_url = updates.avatarUrl;
    if (Object.keys(profilePatch).length) {
      unwrap(await supabase.from('profiles').update(profilePatch).eq('id', userId).select().single());
    }
    if (updates.planTier !== undefined || updates.organization !== undefined) {
      const accPatch: Row = {};
      if (updates.planTier !== undefined) accPatch.plan_tier = updates.planTier;
      if (updates.organization !== undefined) {
        accPatch.name = updates.organization;
        accPatch.type = 'organization';
      }
      await supabase.from('accounts').update(accPatch).eq('id', accountId);
    }
    delete this.profileCache[userId];
    return this.loadUserProfile(userId);
  }

  async updatePassword(password: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(authErrorMessage(error.message, 'Failed to update your password. Please try again.'));
  }

  async resendVerificationEmail(email: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: emailRedirectTo() },
    });
    if (error) throw new Error(authErrorMessage(error.message, 'Failed to resend the verification email. Please try again.'));
  }

  async requestPasswordReset(email: string): Promise<void> {
    const supabase = getSupabase();

    // Check if the user email is registered using RLS-safe function
    const exists = await this.checkUserExistsByEmail(email);
    if (!exists) {
      throw new Error('Email address not found');
    }

    // Providing a redirectTo is generally needed for magic link/password reset flows in Supabase,
    // though the actual URL depends on the project setup. For Expo, an app scheme like 'aas://reset-password' is often used.
    // If none is provided, it falls back to the site url configured in Supabase.
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw new Error(authErrorMessage(error.message, 'Failed to send the reset email. Please try again.'));
  }

  async verifyPasswordResetOtp(email: string, token: string): Promise<void> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    if (error) throw new Error(authErrorMessage(error.message, 'Failed to verify the code. Please try again.'));
    if (data.session) {
      this.resetAccountCaches();
      this.userId = null;
    }
  }

  async resetPasswordWithOtp(email: string, token: string, newPassword: string): Promise<void> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    if (error) throw new Error(authErrorMessage(error.message, 'Failed to verify the code. Please try again.'));
    if (!data.session) throw new Error('Failed to start session after OTP verification');
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) throw new Error(authErrorMessage(updateError.message, 'Failed to update your password. Please try again.'));
    this.resetAccountCaches();
    this.userId = null;
  }

  async checkUserExistsByEmail(email: string): Promise<boolean> {
    const supabase = getSupabase();
    // Using the secure RPC function to check without violating RLS
    const { data, error } = await supabase.rpc('check_user_exists', { lookup_email: email });
    if (error) {
      console.warn('checkUserExistsByEmail error:', error);
      return false; // Fail safe
    }
    return !!data;
  }



  async uploadCoachPhoto(userId: string, fileUri: string, fileType: string): Promise<string> {
    const { supabase } = await this.ctx();

    const buffer = await uriToArrayBuffer(fileUri);
    const fileExtension = fileType.split('/')[1] || 'jpg';
    const filePath = `coaches/${userId}.${fileExtension}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, buffer, {
        contentType: fileType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    unwrap(
      await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId)
        .select()
        .single()
    );

    return publicUrl;
  }



  // ─── Database aggregate (used by global search) ──────────────────────────────
  async getDatabase(): Promise<Database> {
    const [profile, tryouts, teams, seasons] = await Promise.all([
      this.getProfile(),
      this.listTryouts(true),
      this.listTeams(),
      this.listSeasons(),
    ]);
    const tryoutMap: Record<string, Tryout> = {};
    for (const t of tryouts) tryoutMap[t.id] = t;
    const seasonMap: Record<string, Season> = {};
    for (const s of seasons) seasonMap[s.id] = s;
    return {
      version: 2,
      tryouts: tryoutMap,
      teams,
      seasons: seasonMap,
      orgs: {},
      orgMembers: {},
      profile: profile ?? undefined,
    };
  }

  saveDatabase(): Promise<void> {
    return this.notImplemented('saveDatabase');
  }

  // ─── Teams ───────────────────────────────────────────────────────────────────
  private rowToTeam(t: Row, managed = false, ownerPlanTier?: string): Team {
    let season = t.season_label ?? undefined;
    let logoUrl = t.logo_url ?? undefined;

    // A stale PostgREST schema cache (or a DB genuinely missing the logo_url
    // column) rejects any write that touches it — updateTeam's fallback below
    // packs the logo into season_label as "season|LOGO|url" instead of losing
    // it, the same trick the mobile app uses. Decode it back out here.
    if (season && season.includes('|LOGO|')) {
      const parts = season.split('|LOGO|');
      season = parts[0] || undefined;
      logoUrl = parts[1];
    }

    return {
      id: t.id,
      name: t.name,
      logoUrl,
      season,
      collectsFees: t.collects_fees ?? undefined,
      registrationFeeCents: t.registration_fee_cents ?? undefined,
      brandColor: t.brand_color ?? undefined,
      managed: managed || undefined,
      ownerPlanTier: managed ? ((ownerPlanTier as Team['ownerPlanTier']) ?? undefined) : undefined,
      createdAt: toMs(t.created_at),
      updatedAt: t.updated_at ? toMs(t.updated_at) : undefined,
      archived: t.archived || undefined,
    };
  }

  async listTeams(): Promise<Team[]> {
    const { supabase, accountId } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('teams')
        .select('*')
        .eq('account_id', accountId)
        .eq('archived', false)
        .order('created_at', { ascending: false }),
    ) as Row[];

    // Teams a club has delegated to this user (CLUB mode) live on someone
    // else's account, so the query above can't see them. They come from a
    // separate RPC rather than by dropping the account_id filter and leaning on
    // RLS: has_account_access() is true for every account when the caller is a
    // platform admin, so an unfiltered select would hand admins every team on
    // the instance instead of their own. Mirrors mobile's listTeams().
    const { data: managedRows, error: managedErr } = await supabase.rpc('list_teams_managed_by_me');
    if (managedErr) {
      // Pre-migration instances have no such function. Own teams are still
      // correct without it, so degrade rather than failing the whole list.
      console.log('list_teams_managed_by_me unavailable:', managedErr.message);
      return rows.map((t) => this.rowToTeam(t));
    }

    const own = rows.map((t) => this.rowToTeam(t));
    const ownIds = new Set(own.map((t) => t.id));

    // Which club plan tier each delegated team should gate features against.
    // Best-effort: if this lookup fails (pre-migration instance), managed
    // teams just fall back to the caller's own tier via ownerPlanTier being
    // undefined — same degrade-gracefully approach as managedRows above.
    const { data: tierRows } = await supabase.rpc('list_managed_team_owner_tiers');
    const tierByTeamId = new Map(((tierRows ?? []) as Row[]).map((r) => [r.team_id, r.plan_tier as string]));

    const managed = ((managedRows ?? []) as Row[])
      // An owner/admin delegating a team to themselves would otherwise show it
      // twice; their own-account row wins, since it carries full rights.
      .filter((t) => !ownIds.has(t.id))
      .map((t) => this.rowToTeam(t, true, tierByTeamId.get(t.id)));

    return [...own, ...managed];
  }

  /**
   * How many teams count against this account's plan.
   *
   * The limit checks only ever needed a number, and listTeams() costs three
   * queries plus a full row mapping to produce one. Teams delegated by another
   * club are excluded here for the same reason every caller filtered out
   * `managed` — the club that pays for them owns them.
   */
  async countTeams(): Promise<number> {
    const { supabase, accountId } = await this.ctx();
    const { count, error } = await supabase
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('archived', false);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async createTeam(name: string, season?: string): Promise<Team> {
    return this.withFreshAccount((guard) => this._createTeam(name, season, guard));
  }

  private async _createTeam(name: string, season: string | undefined, guard: WriteGuard): Promise<Team> {
    const { supabase } = await this.ctx();
    const accountId = await this.writableAccountId();
    const row = unwrap(
      await supabase
        .from('teams')
        .insert({ account_id: accountId, name, season_label: season ?? null })
        .select()
        .single(),
    ) as Row;
    guard.wrote = true;
    await this.markOnboarding({ createTeam: true });
    return this.rowToTeam(row);
  }

  /**
   * A team's own roster. Independent of assessments — an athlete stays on the
   * team even if the assessment they were picked from is archived or deleted.
   */
  async listTeamRoster(teamId: string): Promise<TeamRosterPlayer[]> {
    const { supabase } = await this.ctx();
    const rows: Row[] = [];
    for (let from = 0; ; from += TEAM_ROSTER_PAGE) {
      const page = unwrap(
        await supabase
          .from('team_roster')
          .select('*, athletes(*), tryouts:source_tryout_id(name)')
          .eq('team_id', teamId)
          // created_at ties are the norm here, not the exception — a bulk add
          // writes a whole chunk on the same timestamp — so id breaks them.
          // Without a total order the pages can overlap or skip rows.
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + TEAM_ROSTER_PAGE - 1),
      ) as Row[] | null;
      const batch = page ?? [];
      rows.push(...batch);
      if (batch.length < TEAM_ROSTER_PAGE) break;
    }
    return rows.map((r) => this.rowToTeamRosterPlayer(r));
  }

  private rowToTeamRosterPlayer(r: Row): TeamRosterPlayer {
    const rawAthlete = r.athletes;
    const a = (Array.isArray(rawAthlete) ? rawAthlete[0] : rawAthlete) ?? {};
    const rawSource = r.tryouts;
    const src = (Array.isArray(rawSource) ? rawSource[0] : rawSource) ?? {};
    return {
      id: r.id,
      athleteId: r.athlete_id,
      first: a.first_name ?? '',
      last: a.last_name ?? '',
      jersey: r.jersey ?? undefined,
      pos: r.position ?? undefined,
      yearOfBirth: a.year_of_birth ?? undefined,
      sourceTryoutId: r.source_tryout_id ?? undefined,
      sourceTryoutName: src.name ?? undefined,
    };
  }

  /**
   * Players per team, for the Teams list cards.
   *
   * The headcount has to come off `team_roster` — that table *is* team
   * membership (see the "source of truth for current team" note on the athlete
   * read). The list used to count the linked season's `season_roster` rows
   * instead, which is a different set entirely: a season roster is seeded once
   * when the season is created and topped up by ensureSeasonRoster() when an
   * event is scheduled, and nothing ever deletes from it. So the card read 0
   * for a team that had never scheduled anything, ignored everyone added since
   * the last event, and went on counting players who had been taken off the
   * team.
   *
   * Same shape as countParticipantsByTryout(): one COUNT(*) per team with a
   * bounded number in flight, counting server-side so no rows cross the wire,
   * and falling back to a single paged read if that fails — so the worst case
   * is a wasted round trip rather than a missing or wrong headcount.
   */
  async countTeamPlayers(teamIds: string[]): Promise<Record<string, number>> {
    if (teamIds.length === 0) return {};
    const { supabase } = await this.ctx();
    const byTeam: Record<string, number> = {};
    try {
      const counts = await mapPool(teamIds, PARTICIPANT_COUNT_CONCURRENCY, async (teamId) => {
        // No embed and no soft-delete column here: team_roster carries only
        // roster-scoped fields and removals are hard deletes, so this runs
        // nothing but the table's own read policy.
        const { count, error } = await supabase
          .from('team_roster')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', teamId);
        if (error) throw error;
        return count ?? 0;
      });
      teamIds.forEach((id, i) => {
        byTeam[id] = counts[i];
      });
      return byTeam;
    } catch (error) {
      console.warn('Counting players per team failed — falling back to the paged read.', error);
    }

    // `id` rides along only because keyset paging orders by it; nothing here
    // reads it.
    const rows = await fetchAllByIn(supabase, 'team_roster', 'id, team_id', 'team_id', teamIds);
    for (const r of rows) byTeam[r.team_id] = (byTeam[r.team_id] ?? 0) + 1;
    return byTeam;
  }

  /**
   * Attach athletes to a team. Upserts on (team_id, athlete_id) so re-adding
   * someone already on the roster refreshes their jersey/position instead of
   * failing the whole batch on the unique constraint.
   */
  async addTeamRosterPlayers(
    teamId: string,
    entries: { athleteId: string; jersey?: string; pos?: string; sourceTryoutId?: string }[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<TeamRosterPlayer[]> {
    if (entries.length === 0) return [];
    const { supabase } = await this.ctx();
    // Collapse duplicate athletes within the batch — upsert rejects a payload
    // that hits the same conflict target twice.
    const byAthlete = new Map<string, (typeof entries)[number]>();
    for (const e of entries) if (e.athleteId) byAthlete.set(e.athleteId, e);
    const rows = [...byAthlete.values()].map((e) => ({
      team_id: teamId,
      athlete_id: e.athleteId,
      jersey: e.jersey || null,
      position: e.pos || null,
      source_tryout_id: e.sourceTryoutId || null,
    }));

    // A single upsert with a large enough batch (hundreds+ rows — a real club
    // combine, not just test data) can outrun Postgres's statement timeout and
    // fail the whole write with nothing saved. Chunk it at the same size this
    // codebase already proved safe for a comparable upsert (REGISTRATION_CHUNK,
    // used for the registration bulk-placement path — see TODO.md 1i) rather
    // than guessing a larger number.
    const CHUNK_SIZE = 20;
    onProgress?.(0, rows.length);
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      unwrap(
        await supabase
          .from('team_roster')
          .upsert(rows.slice(i, i + CHUNK_SIZE), { onConflict: 'team_id,athlete_id' })
          .select('id'),
      );
      onProgress?.(Math.min(rows.length, i + CHUNK_SIZE), rows.length);
    }
    return this.listTeamRoster(teamId);
  }

  // Same shape as the assessment roster's "Add Player" (AddPlayerForm) — a
  // manually-added team player picks from or creates an athlete exactly the
  // same way, just attached to the team roster instead of tryout_participants.
  async addManualTeamPlayer(teamId: string, form: AddPlayerForm): Promise<{ athleteId: string }> {
    return this.withFreshAccount((guard) => this._addManualTeamPlayer(teamId, form, guard));
  }

  private async _addManualTeamPlayer(
    teamId: string,
    form: AddPlayerForm,
    guard: WriteGuard,
  ): Promise<{ athleteId: string }> {
    const accountId = await this.writableAccountId();
    let athleteId = form.athleteId;
    if (typeof athleteId === 'object' && athleteId !== null) {
      athleteId = String((athleteId as unknown as { id?: string }).id || athleteId);
    }
    if (!athleteId) {
      athleteId = await this.createAthlete(accountId, {
        first_name: form.first,
        last_name: form.last,
        year_of_birth: form.yearOfBirth ? Number(form.yearOfBirth) : null,
        guardian_name: form.guardianName || null,
        guardian_email: form.guardianEmail || null,
        guardian_phone: form.guardianPhone || null,
        medical_info: form.medicalInfo || null,
        about: form.aboutChild || null,
        avatar_url: form.avatarUrl || null,
      });
    }
    await this.addTeamRosterPlayers(teamId, [{ athleteId, jersey: form.jersey, pos: form.pos }]);
    return { athleteId };
  }

  async removeTeamRosterPlayer(teamId: string, athleteId: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(
      await supabase
        .from('team_roster')
        .delete()
        .eq('team_id', teamId)
        .eq('athlete_id', athleteId)
        .select('id'),
    );
  }

  async deleteTeam(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    // Assessments outlive the team they were grouped under — detach them so they
    // show up as unlinked and can be attached to another team. Goes through an
    // RPC, not a plain update: a tryout created by a delegated manager (or, from
    // a manager's side, one created by the club) can carry an account_id other
    // than the caller's own, and no RLS policy's WITH CHECK can authorize nulling
    // team_id on such a row directly — see migration
    // 20260821100000_fix_team_delete_tryout_detach.sql for the full story.
    const { error: detachError } = await supabase.rpc('detach_team_tryouts', { p_team_id: id });
    if (detachError) throw new Error(detachError.message);
    // The team's schedule goes with it; a new team provisions its own season.
    unwrap(await supabase.from('seasons').update({ archived: true }).eq('team_id', id).select());
    // `.maybeSingle()` on its own hides an RLS-blocked write: an update that
    // matches zero rows comes back as { data: null, error: null }, identical to
    // a genuine "no row with this id" — so a delete silently blocked by teams_rw
    // (caller isn't owner/admin/coach on this team's account) looked like a
    // successful delete. Same silent-no-op trap as the team-chat and
    // assessor-status deletes; check the row actually came back before treating
    // this as done, same as the caller's own confirm-then-navigate assumes.
    const row = unwrap(
      await supabase.from('teams').update({ archived: true }).eq('id', id).select().maybeSingle(),
    );
    if (!row) {
      throw new Error(
        "This team couldn't be deleted. You need to be an owner, admin, or coach on the account that owns it.",
      );
    }
  }

  async updateTeam(id: string, updates: Partial<Team>): Promise<Team> {
    const { supabase } = await this.ctx();
    const patch: Row = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.archived !== undefined) patch.archived = updates.archived;
    if (updates.brandColor !== undefined) patch.brand_color = updates.brandColor || null;
    if (updates.collectsFees !== undefined) patch.collects_fees = updates.collectsFees;
    if (updates.registrationFeeCents !== undefined) {
      patch.registration_fee_cents = updates.registrationFeeCents || null;
    }

    // There is no real logo_url column (a stale/missing PostgREST schema entry
    // rejects any write that touches it), so the logo is packed into
    // season_label as "season|LOGO|url", the same trick the mobile app uses.
    // Any write touching either half has to read back whichever half it isn't
    // changing first — otherwise a plain season edit silently wipes out an
    // already-uploaded logo (and vice versa).
    if (updates.season !== undefined || updates.logoUrl !== undefined) {
      let currentSeason: string | undefined;
      let currentLogoUrl: string | undefined;
      if (updates.season === undefined || updates.logoUrl === undefined) {
        const existing = unwrap(await supabase.from('teams').select().eq('id', id).single()) as Row;
        const currentTeam = this.rowToTeam(existing);
        currentSeason = currentTeam.season;
        currentLogoUrl = currentTeam.logoUrl;
      }
      const newSeason = updates.season !== undefined ? updates.season : currentSeason;
      const newLogoUrl = updates.logoUrl !== undefined ? updates.logoUrl : currentLogoUrl;
      patch.season_label = newLogoUrl ? `${newSeason || ''}|LOGO|${newLogoUrl}` : newSeason || null;
    }

    const { data, error } = await supabase.from('teams').update(patch).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return this.rowToTeam(data as Row);
  }

  // --------------------------------------------------------------------------
  // Team managers (CLUB mode): delegate one team to another coach/manager by email.
  // --------------------------------------------------------------------------

  async listTeamManagers(teamId: string): Promise<import('../types').TeamManager[]> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.rpc('list_team_managers', { team_uuid: teamId });
    if (error) {
      // Nothing in the UI should hard-fail because an instance predates the
      // migration — an empty list reads the same as "nobody delegated yet".
      console.log('list_team_managers unavailable:', error.message);
      return [];
    }
    return ((data ?? []) as Row[]).map((r) => this.rowToTeamManager(r));
  }

  async inviteTeamManager(
    teamId: string,
    email: string,
    role: import('../types').TeamManagerRole = 'manager',
    name?: string,
  ): Promise<import('../types').TeamManager> {
    const { supabase } = await this.ctx();

    // Read server-side rather than trusting a client-supplied team name — this
    // is the only place that name reaches an email, and the RPC below already
    // needs a round trip anyway.
    const teamRow = (await supabase.from('teams').select('name').eq('id', teamId).maybeSingle()).data as
      | Row
      | null;
    const teamName = teamRow?.name || 'a team';

    const invite = async () =>
      await supabase.rpc('invite_team_manager_by_email', {
        team_uuid: teamId,
        lookup_email: email.trim(),
        manager_role: role,
      });

    let { data, error } = await invite();
    let password: string | undefined;

    // The invitee may not have an account yet. Stand one up the same way staff
    // invites do (create-user edge function -> real GoTrue password hash), then
    // retry the delegation once so the club isn't blocked on the coach signing
    // up first.
    if (error && error.message.includes('User not found')) {
      password = Math.random().toString(36).slice(-8) + 'Aa1!';
      const { data: created, error: fnError } = await supabase.functions.invoke('create-user', {
        body: {
          email: email.trim(),
          password,
          display_name: name?.trim() || email.trim().split('@')[0],
          account_type: 'coach',
        },
      });
      if (fnError) {
        throw new Error(await extractFunctionErrorMessage(fnError, 'Could not create an account for that email address'));
      }
      if (created?.error) throw new Error(created.error);

      ({ data, error } = await invite());
      if (error) throw error;
    } else if (error) {
      throw error;
    }

    // Sent either way now: an existing coach getting handed a team is exactly
    // as much "you now have access to this" as one who needed an account
    // created for them — only the credentials block differs (password is
    // undefined on the existing-user path, so the email template omits it).
    try {
      await this.sendEmail('team_manager_invite', email.trim(), { teamName, role, password });
    } catch (e) {
      console.log('Failed to send team manager invite email:', e);
    }

    return this.rowToTeamManager(data);
  }

  async removeTeamManager(managerId: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.rpc('remove_team_manager', { manager_id: managerId });
    if (error) throw error;
  }

  private rowToTeamManager(r: Row): import('../types').TeamManager {
    return {
      id: r.id,
      teamId: r.teamId ?? r.team_id,
      userId: r.userId ?? r.user_id,
      email: r.email,
      name: r.name ?? undefined,
      role: (r.role ?? 'manager') as import('../types').TeamManagerRole,
      createdAt: r.created_at ? toMs(r.created_at) : Date.now(),
    };
  }

  async uploadTeamLogo(teamId: string, fileUri: string, fileType: string): Promise<string> {
    const { supabase } = await this.ctx();

    const buffer = await uriToArrayBuffer(fileUri);
    const fileExtension = fileType.split('/')[1] || 'jpg';
    const filePath = `teams/${teamId}.${fileExtension}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, buffer, {
        contentType: fileType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    return `${publicUrl}?v=${Date.now()}`;
  }

  // ─── Tryouts ──────────────────────────────────────────────────────────────────
  /**
   * Every tryout row the caller can see, from all three sources, de-duplicated.
   *
   * The three reads go out together rather than one after another: they are
   * independent, and awaiting them in series put three full round trips in
   * front of the dashboard before any child data was even requested.
   */
  private async fetchVisibleTryoutRows(includeArchived: boolean): Promise<Row[]> {
    const { supabase, accountId } = await this.ctx();
    let q = supabase
      .from('tryouts')
      .select('*')
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (!includeArchived) q = q.eq('archived', false);

    // Assessments linked to a team delegated to this user (CLUB mode) live on
    // the club's account, so the account_id filter above can't see them — same
    // reasoning as listTeams()'s managed-teams merge. Pre-migration instances
    // have no such function; own tryouts are still correct without it.
    //
    // The second RPC is the mirror image: a manager creating a *new* assessment
    // for a team always inserts it under their own account (createTryout always
    // does), so the club owner needs this to see it too — without it, a team
    // the club owns could have assessments on it the club's own staff never
    // see listed, only the delegate who happened to create them.
    const [ownRes, managedRes, ownedTeamRes] = await Promise.all([
      q,
      supabase.rpc('list_tryouts_for_managed_teams'),
      supabase.rpc('list_tryouts_on_my_owned_teams'),
    ]);

    const rows = unwrap(ownRes) as Row[];
    if (managedRes.error) console.log('list_tryouts_for_managed_teams unavailable:', managedRes.error.message);
    if (ownedTeamRes.error) console.log('list_tryouts_on_my_owned_teams unavailable:', ownedTeamRes.error.message);

    const seen = new Set(rows.map((t) => t.id as string));
    const extra: Row[] = [];
    for (const source of [managedRes.data, ownedTeamRes.data]) {
      for (const t of (source ?? []) as Row[]) {
        if (seen.has(t.id)) continue;
        if (t.deleted_at || (!includeArchived && t.archived)) continue;
        seen.add(t.id);
        extra.push(t);
      }
    }
    return [...rows, ...extra];
  }

  async listTryouts(includeArchived = false): Promise<Tryout[]> {
    return this.assembleTryouts(await this.fetchVisibleTryoutRows(includeArchived));
  }

  /**
   * The list screens' read — see TryoutSummary.
   *
   * assembleTryouts() pulls every participant (joined to its athlete), every
   * evaluation (joined to its scores) and every registration in the account to
   * produce cards that show a name, a sport, a date and a headcount. Here the
   * only child read is a single column off tryout_participants, counted in JS,
   * so the payload stops scaling with how much scoring an account has done.
   */
  async listTryoutSummaries(includeArchived = false): Promise<TryoutSummary[]> {
    return this.summariseTryouts(await this.fetchVisibleTryoutRows(includeArchived));
  }

  /**
   * Active roster size per tryout, for the list cards.
   *
   * Preferred shape: one `COUNT(*)` per tryout, several in flight at once. The
   * cards only ever show these six numbers, and counting server-side transfers
   * no rows at all — the read this replaced pulled every participant id in the
   * account (5,671 of them on the account this was profiled against) across six
   * strictly serial pages, 8.4s end to end, to arrive at the same six numbers.
   * As independent statements they overlap instead of queueing, so the wall
   * clock is roughly the total work divided by the pool width rather than the
   * sum of it: ~1.7s for the same account.
   *
   * `count: 'exact'` is deliberately *not* used the way it once was on the full
   * roster read — that one embedded `athletes(*)`, so counting forced
   * can_access_athlete() over every matching row and overran the statement
   * timeout during login (see "Fix login timeout: stop requesting exact count
   * on tryout roster reads"). This selects a single column off
   * tryout_participants with no embed, so only that table's own policy runs.
   *
   * Any failure — a timeout on an account with one enormous tryout, most
   * likely — falls through to the paged read, which is exactly what this
   * screen did before, so the worst case is one wasted round trip rather than a
   * missing or wrong headcount.
   */
  private async countParticipantsByTryout(
    supabase: SupabaseClient,
    ids: string[],
  ): Promise<Record<string, number>> {
    const byTryout: Record<string, number> = {};
    try {
      const counts = await mapPool(ids, PARTICIPANT_COUNT_CONCURRENCY, async (tryoutId) => {
        const { count, error } = await supabase
          .from('tryout_participants')
          .select('id', { count: 'exact', head: true })
          // Same removed_at filter as assembleTryouts — soft-deleted
          // participants are off the active roster, so they must not be
          // counted on the card.
          .eq('tryout_id', tryoutId)
          .is('removed_at', null);
        if (error) throw error;
        return count ?? 0;
      });
      ids.forEach((id, i) => {
        byTryout[id] = counts[i];
      });
      return byTryout;
    } catch (error) {
      console.warn('Counting participants per tryout failed — falling back to the paged read.', error);
    }

    // `id` rides along only because keyset paging orders by it; nothing here
    // reads it.
    const rows = await fetchAllByIn(
      supabase,
      'tryout_participants',
      'id, tryout_id',
      'tryout_id',
      ids,
      FETCH_PAGE_SIZE,
      'removed_at',
    );
    for (const p of rows) byTryout[p.tryout_id] = (byTryout[p.tryout_id] ?? 0) + 1;
    return byTryout;
  }

  private async summariseTryouts(tryoutRows: Row[]): Promise<TryoutSummary[]> {
    if (tryoutRows.length === 0) return [];
    const supabase = getSupabase();
    const ids = tryoutRows.map((t) => t.id as string);

    const [countByTryout, aRows] = await Promise.all([
      this.countParticipantsByTryout(supabase, ids),
      fetchAllByIn(supabase, 'tryout_assessors', '*', 'tryout_id', ids),
    ]);

    const assessorsByTryout: Record<string, Assessor[]> = {};
    for (const a of aRows) (assessorsByTryout[a.tryout_id] ??= []).push(this.rowToAssessor(a));

    return tryoutRows.map((t) => ({
      id: t.id,
      name: t.name,
      teamId: t.team_id ?? undefined,
      seasonId: t.season_id ?? undefined,
      createdAt: toMs(t.created_at),
      updatedAt: toMs(t.updated_at),
      eventType: EVENT_TYPE_FROM_DB[t.event_type] ?? 'Tryout',
      tryoutDate: t.tryout_date ?? undefined,
      startTime: t.start_time ?? undefined,
      rink: t.location ?? undefined,
      sport: t.sport,
      sportOther: t.sport_other ?? undefined,
      assessors: assessorsByTryout[t.id] ?? [],
      playerCount: countByTryout[t.id] ?? 0,
      archived: !!t.archived,
    }));
  }

  /**
   * How many assessments count against this account's plan.
   *
   * Same three sources as listTryouts(), but it stops at the tryout rows.
   * Going through listTryouts() for a count meant pulling every participant,
   * athlete, assessor, evaluation, score and registration in the account —
   * the heaviest query in the app — before the new-assessment form would
   * render. The three sources also go out together here rather than in series.
   */
  async countAssessments(): Promise<number> {
    const { supabase, accountId } = await this.ctx();
    const [ownRes, managedRes, ownedTeamRes] = await Promise.all([
      supabase.from('tryouts').select('id').eq('account_id', accountId).is('deleted_at', null).eq('archived', false),
      supabase.rpc('list_tryouts_for_managed_teams'),
      supabase.rpc('list_tryouts_on_my_owned_teams'),
    ]);
    const ids = new Set((unwrap(ownRes) as Row[]).map((t) => t.id as string));
    // Pre-migration instances have no such functions; own assessments are
    // still counted correctly without them, same degrade as listTryouts().
    for (const rows of [managedRes.data, ownedTeamRes.data]) {
      for (const t of (rows ?? []) as Row[]) {
        if (!t.deleted_at && !t.archived) ids.add(t.id as string);
      }
    }
    return ids.size;
  }

  async getTryout(id: string): Promise<Tryout | null> {
    const { supabase } = await this.ctx();
    const row = (
      await supabase.from('tryouts').select('*').eq('id', id).is('deleted_at', null).maybeSingle()
    ).data as Row | null;
    if (!row) return null;
    const [assembled] = await this.assembleTryouts([row]);
    return assembled ?? null;
  }

  async listAssignedTryouts(): Promise<Tryout[]> {
    return this.assembleTryouts(await this.fetchAssignedTryoutRows());
  }

  private async fetchAssignedTryoutRows(): Promise<Row[]> {
    const { supabase, userId, accountId } = await this.ctx();
    const links = unwrap(
      await supabase.from('tryout_assessors').select('tryout_id').eq('user_id', userId).neq('status', 'declined'),
    ) as Row[];
    const ids = [...new Set(links.map((l) => l.tryout_id))];
    if (!ids.length) return [];
    const rows = unwrap(
      await supabase.from('tryouts').select('*').in('id', ids).eq('archived', false).is('deleted_at', null),
    ) as Row[];

    // Exclude tryouts already surfaced by listTryouts(): the caller's own
    // account, a team delegated to them, or their own team a delegate
    // created an assessment under (CLUB mode). Comparing account_id to the
    // caller's single resolved ctx().accountId alone isn't enough for the
    // latter two — those two return tryouts under an account_id that isn't
    // the caller's ctx() account, so without this a club owner or coach who
    // (as an assessor) is also staff on a delegated team's account, or a
    // delegate managing a team, would see the same tryout listed twice.
    const [managedRes, ownedTeamRes] = await Promise.all([
      supabase.rpc('list_tryouts_for_managed_teams'),
      supabase.rpc('list_tryouts_on_my_owned_teams'),
    ]);
    const ownIds = new Set<string>([
      ...rows.filter((t) => t.account_id === accountId).map((t) => t.id as string),
      ...((managedRes.data ?? []) as Row[]).map((t) => t.id as string),
      ...((ownedTeamRes.data ?? []) as Row[]).map((t) => t.id as string),
    ]);
    return rows.filter((t) => !ownIds.has(t.id as string));
  }

  /**
   * listAssignedTryouts() in the light shape — see listTryoutSummaries(). The
   * dashboard's "Assigned to me" list only needs the name, sport, headcount and
   * the caller's own assessor row (to know whether the invite is still pending).
   */
  async listAssignedTryoutSummaries(): Promise<TryoutSummary[]> {
    return this.summariseTryouts(await this.fetchAssignedTryoutRows());
  }

  async acceptAssignedTryout(tryoutId: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.rpc('set_assessor_status', { p_tryout_id: tryoutId, p_status: 'accepted' });
    if (error) throw new Error(error.message);
  }

  async rejectAssignedTryout(tryoutId: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.rpc('set_assessor_status', { p_tryout_id: tryoutId, p_status: 'declined' });
    if (error) throw new Error(error.message);
  }

  async createTryout(form: CreateAssessmentForm): Promise<Tryout> {
    return this.withFreshAccount((guard) => this._createTryout(form, guard));
  }

  private async _createTryout(form: CreateAssessmentForm): Promise<Tryout> {
    const { supabase, userId } = await this.ctx();
    const accountId = await this.writableAccountId();
    const profile = await this.loadUserProfile(userId);
    const weights = getDefaultWeights(form.sport);
    const settings = {
      skaterWeights: weights.skater,
      goalieWeights: weights.goalie,
      customRubrics: [],
    };
    const row = unwrap(
      await supabase
        .from('tryouts')
        .insert({
          account_id: accountId,
          team_id: form.teamId ?? null,
          name: form.name,
          event_type: EVENT_TYPE_TO_DB[form.eventType] ?? 'tryout',
          sport: form.sport,
          sport_other: form.sportOther ?? null,
          // `||`, not `??`: an untouched date/time input submits '', which
          // Postgres rejects for a date/time column ("invalid input syntax for
          // type date"). Both are nullable, so an empty one means "not set".
          tryout_date: form.tryoutDate || null,
          start_time: form.startTime || null,
          location: form.rink ?? null,
          head_coach: form.headCoach ?? profile.displayName,
          head_assessor: form.headAssessor ?? profile.displayName,
          settings,
        })
        .select()
        .single(),
    ) as Row;

    // Seed the creator as the lead assessor.
    await supabase.from('tryout_assessors').insert({
      tryout_id: row.id,
      user_id: userId,
      name: profile.displayName,
      email: profile.email,
      role: 'lead',
      joined_at: new Date().toISOString(),
    });

    // When the assessment is created inside a team, auto-import the team's
    // roster so the coach doesn't have to re-add every player manually.
    if (form.teamId) {
      try {
        const teamRosterRows = unwrap(
          await supabase
            .from('team_roster')
            .select('athlete_id, jersey, position')
            .eq('team_id', form.teamId),
        ) as Row[];

        if (teamRosterRows.length > 0) {
          const participants = teamRosterRows.map((r) => ({
            tryout_id: row.id,
            athlete_id: r.athlete_id,
            jersey: r.jersey ?? null,
            position: r.position ?? null,
            registration_source: 'manual' as const,
          }));
          await supabase.from('tryout_participants').insert(participants);
        }
      } catch {
        // Non-fatal: the assessment is created, the coach can add players later.
      }
    }

    await this.markOnboarding({ createAssessment: true });
    const [assembled] = await this.assembleTryouts([row]);
    return assembled;
  }

  async updateTryout(id: string, updates: Partial<Tryout>): Promise<Tryout> {
    const { supabase } = await this.ctx();
    const patch: Row = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.sport !== undefined) patch.sport = updates.sport;
    if (updates.sportOther !== undefined) patch.sport_other = updates.sportOther;
    if (updates.eventType !== undefined) patch.event_type = EVENT_TYPE_TO_DB[updates.eventType];
    if (updates.tryoutDate !== undefined) patch.tryout_date = updates.tryoutDate || null;
    if (updates.startTime !== undefined) patch.start_time = updates.startTime || null;
    if (updates.rink !== undefined) patch.location = updates.rink || null;
    if (updates.defaultPosition !== undefined) patch.default_position = updates.defaultPosition || null;
    if (updates.headAssessor !== undefined) patch.head_assessor = updates.headAssessor || null;
    if (updates.headCoach !== undefined) patch.head_coach = updates.headCoach || null;
    if (updates.teamId !== undefined) patch.team_id = updates.teamId || null;
    if (updates.seasonId !== undefined) patch.season_id = updates.seasonId || null;
    if (updates.settings !== undefined) patch.settings = updates.settings;
    if (updates.archived !== undefined) patch.archived = updates.archived;

    if (updates.teamBuilder !== undefined || updates.aiAssessments !== undefined) {
      const current = (await supabase.from('tryouts').select('ai_assessments').eq('id', id).single())
        .data?.ai_assessments ?? {};
      const next = { ...current };
      if (updates.aiAssessments !== undefined) Object.assign(next, updates.aiAssessments);
      if (updates.teamBuilder !== undefined) next.teamBuilder = updates.teamBuilder;
      patch.ai_assessments = next;
    }

    if (Object.keys(patch).length) {
      unwrap(await supabase.from('tryouts').update(patch).eq('id', id).select().single());
    }
    if (updates.assessors !== undefined) {
      await this.syncAssessors(id, updates.assessors);
    }
    const result = await this.getTryout(id);
    if (!result) throw new Error('Tryout not found');
    return result;
  }

  /** Reconcile the desired assessor list against the tryout_assessors table. */
  private async syncAssessors(tryoutId: string, desired: Assessor[]): Promise<void> {
    const supabase = getSupabase();
    const existing = unwrap(
      await supabase.from('tryout_assessors').select('id, name, email, role').eq('tryout_id', tryoutId),
    ) as Row[];

    const keyOf = (a: { name: string; email?: string | null }): string =>
      a.email && a.email.length ? `e:${a.email.toLowerCase()}` : `n:${a.name.toLowerCase()}`;
    const rowKey = (r: Row) => keyOf({ name: r.name, email: r.email });

    const existingByKey = new Map(existing.map((r) => [rowKey(r), r]));
    const desiredKeys = new Set(desired.map(keyOf));

    const toInsert = desired
      .filter((d) => !existingByKey.has(keyOf(d)))
      .map((d) => ({
        tryout_id: tryoutId,
        name: d.name,
        email: d.email && d.email.length ? d.email : null,
        role: d.role ?? 'assessor',
      }));
    if (toInsert.length) {
      unwrap(await supabase.from('tryout_assessors').insert(toInsert).select());
    }

    const toDelete = existing.filter((r) => !desiredKeys.has(rowKey(r))).map((r) => r.id);
    if (toDelete.length) {
      unwrap(await supabase.from('tryout_assessors').delete().in('id', toDelete).select());
    }

    if (desired.length > 1) await this.markOnboarding({ inviteAssessors: true });
  }

  archiveTryout(id: string): Promise<Tryout> {
    return this.updateTryout(id, { archived: true });
  }

  restoreTryout(id: string): Promise<Tryout> {
    return this.updateTryout(id, { archived: false });
  }

  async deleteTryout(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    // Soft delete — the row (and the evaluations/scores it cascades to) stays
    // in the database so it still counts toward a player's permanent history,
    // it just disappears from every coach-facing view (see the deleted_at
    // filters on listTryouts/listAssignedTryouts/getTryout).
    unwrap(
      await supabase
        .from('tryouts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .maybeSingle(),
    );
  }

  async sendEmail(type: 'org_invite' | 'team_manager_invite' | 'tryout_invite' | 'schedule_update' | 'reminder' | 'registration_confirmation', to: string, payload: Record<string, unknown>): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.functions.invoke('send-email', {
      body: { type, to, payload },
    });
    if (error) {
      let msg = error.message;
      try {
        const body = await error.context.json();
        if (body?.error) msg = body.error;
      } catch { }
      throw new Error(msg);
    }
  }

  async copyTryout(id: string): Promise<Tryout> {
    const { supabase, userId, accountId } = await this.ctx();
    const src = unwrap(await supabase.from('tryouts').select('*').eq('id', id).single()) as Row;
    const copy = unwrap(
      await supabase
        .from('tryouts')
        .insert({
          account_id: accountId,
          team_id: src.team_id,
          season_id: src.season_id,
          name: `${src.name} (Copy)`,
          event_type: src.event_type,
          sport: src.sport,
          sport_other: src.sport_other,
          tryout_date: src.tryout_date,
          start_time: src.start_time,
          location: src.location,
          default_position: src.default_position,
          head_coach: src.head_coach,
          head_assessor: src.head_assessor,
          settings: src.settings,
        })
        .select()
        .single(),
    ) as Row;

    const profile = await this.loadUserProfile(userId);
    await supabase.from('tryout_assessors').insert({
      tryout_id: copy.id,
      user_id: userId,
      name: profile.displayName,
      email: profile.email,
      role: 'lead',
      joined_at: new Date().toISOString(),
    });

    // Copy roster (participants reuse the canonical athletes).
    const participants = unwrap(
      await supabase.from('tryout_participants').select('*').eq('tryout_id', id),
    ) as Row[];
    if (participants.length) {
      await supabase.from('tryout_participants').insert(
        participants.map((p) => ({
          tryout_id: copy.id,
          athlete_id: p.athlete_id,
          jersey: p.jersey,
          jersey_colour: p.jersey_colour,
          position: p.position,
          shoots: p.shoots,
          position_trying_out_for: p.position_trying_out_for,
          current_team: p.current_team,
          current_level: p.current_level,
          registration_source: p.registration_source,
          anonymous: p.anonymous,
          sort_out: p.sort_out,
          friend1_name: p.friend1_name,
          friend2_name: p.friend2_name,
        })),
      );
    }
    const [assembled] = await this.assembleTryouts([copy]);
    return assembled;
  }

  // ─── Players ──────────────────────────────────────────────────────────────────
  private async createAthlete(accountId: string, fields: Row): Promise<string> {
    const supabase = getSupabase();

    if (fields.guardian_email && !fields.guardian_user_id) {
      try {
        const { data: exists } = await supabase.rpc('check_user_exists', { lookup_email: fields.guardian_email });
        if (!exists) {
          const defaultPassword = Math.random().toString(36).slice(-8) + 'Aa1!';
          const name = fields.guardian_name || 'Guardian';
          const { data: newUserId, error } = await supabase.rpc('create_user_with_password', {
            email: fields.guardian_email,
            password: defaultPassword,
            display_name: name,
            account_type: 'guardian'
          });
          if (newUserId && !error) {
            fields.guardian_user_id = typeof newUserId === 'object' && newUserId !== null ? newUserId.id || newUserId : newUserId;
            try {
              await this.sendEmail('org_invite', fields.guardian_email, { role: 'guardian', password: defaultPassword });
            } catch (emailErr) {
              console.warn('Failed to send auto-created guardian invite email:', emailErr);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to auto-create guardian account:', err);
      }
    }

    // Insert via create_athlete_for_caller() rather than a direct table insert:
    // it treats account_id as a hint and resolves the real owning account from
    // auth.uid() server-side, so a stale cached accountId can no longer produce
    // an RLS rejection that survives until the app process restarts. The same
    // owner/admin/coach roles are still required.
    const { data, error } = await supabase.rpc('create_athlete_for_caller', {
      payload: { account_id: accountId, ...fields },
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async addPlayer(tryoutId: string, form: AddPlayerForm): Promise<Player> {
    return this.withFreshAccount((guard) => this._addPlayer(tryoutId, form, guard));
  }

  private async _addPlayer(tryoutId: string, form: AddPlayerForm, guard: WriteGuard): Promise<Player> {
    const { supabase } = await this.ctx();
    const accountId = await this.writableAccountId();
    if (typeof tryoutId === 'object' && tryoutId !== null) {
      tryoutId = String((tryoutId as unknown as { id?: string }).id || tryoutId);
    }

    let athleteId = form.athleteId;
    if (typeof athleteId === 'object' && athleteId !== null) {
      athleteId = String((athleteId as unknown as { id?: string }).id || athleteId);
    }

    if (!athleteId) {
      athleteId = await this.createAthlete(accountId, {
        first_name: form.first,
        last_name: form.last,
        year_of_birth: form.yearOfBirth ? Number(form.yearOfBirth) : null,
        guardian_name: form.guardianName || null,
        guardian_email: form.guardianEmail || null,
        guardian_phone: form.guardianPhone || null,
        medical_info: form.medicalInfo || null,
        about: form.aboutChild || null,
        avatar_url: form.avatarUrl || null,
      });
    }
    const participant = unwrap(
      await supabase
        .from('tryout_participants')
        .insert({
          tryout_id: tryoutId,
          athlete_id: athleteId,
          jersey: form.jersey || null,
          position: form.pos || null,
          shoots: form.shoots || null,
          position_trying_out_for: form.positionTryingOutFor || null,
          current_team: form.currentTeam || null,
          current_level: form.currentLevel || null,
          registration_source: 'manual',
          friend1_name: form.friend1Name || null,
          friend2_name: form.friend2Name || null,
        })
        .select('id')
        .single(),
    ) as Row;
    await this.markOnboarding({ addPlayers: true });
    return this.fetchPlayer(participant.id);
  }

  async updatePlayer(tryoutId: string, playerId: string, updates: Partial<Player>): Promise<Player> {
    const { supabase } = await this.ctx();

    const athletePatch: Row = {};
    if (updates.first !== undefined) athletePatch.first_name = updates.first;
    if (updates.last !== undefined) athletePatch.last_name = updates.last;
    if (updates.yearOfBirth !== undefined)
      athletePatch.year_of_birth = updates.yearOfBirth ? Number(updates.yearOfBirth) : null;
    if (updates.guardianName !== undefined) athletePatch.guardian_name = updates.guardianName || null;
    if (updates.guardianEmail !== undefined) athletePatch.guardian_email = updates.guardianEmail || null;
    if (updates.guardianPhone !== undefined) athletePatch.guardian_phone = updates.guardianPhone || null;
    if (updates.medicalInfo !== undefined) athletePatch.medical_info = updates.medicalInfo || null;
    if (updates.aboutChild !== undefined) athletePatch.about = updates.aboutChild || null;
    if (updates.currentPosition !== undefined)
      athletePatch.default_position = updates.currentPosition || null;
    if (updates.avatarUrl !== undefined) athletePatch.avatar_url = updates.avatarUrl || null;




    const participantPatch: Row = {};
    if (updates.jersey !== undefined) participantPatch.jersey = updates.jersey || null;
    if (updates.jerseyColour !== undefined) participantPatch.jersey_colour = updates.jerseyColour || null;
    if (updates.pos !== undefined) participantPatch.position = updates.pos || null;
    if (updates.shoots !== undefined) participantPatch.shoots = updates.shoots || null;
    if (updates.positionTryingOutFor !== undefined)
      participantPatch.position_trying_out_for = updates.positionTryingOutFor || null;
    if (updates.currentTeam !== undefined) participantPatch.current_team = updates.currentTeam || null;
    if (updates.currentLevel !== undefined) participantPatch.current_level = updates.currentLevel || null;
    if (updates.anonymous !== undefined) participantPatch.anonymous = updates.anonymous;
    if (updates.sortOut !== undefined) participantPatch.sort_out = updates.sortOut;
    if (updates.waiverAcceptedAt !== undefined)
      participantPatch.waiver_accepted_at = toIso(updates.waiverAcceptedAt);
    if (updates.friend1Name !== undefined) participantPatch.friend1_name = updates.friend1Name || null;
    if (updates.friend2Name !== undefined) participantPatch.friend2_name = updates.friend2Name || null;

    if (updates.assignedAssessor !== undefined) {
      let assessorId: string | null = null;
      if (updates.assignedAssessor) {
        const found = (
          await supabase
            .from('tryout_assessors')
            .select('id')
            .eq('tryout_id', tryoutId)
            .eq('name', updates.assignedAssessor)
            .limit(1)
            .maybeSingle()
        ).data as Row | null;
        assessorId = found?.id ?? null;
      }
      participantPatch.assigned_assessor_id = assessorId;
    }

    if (Object.keys(athletePatch).length) {
      const part = unwrap(
        await supabase.from('tryout_participants').select('athlete_id').eq('id', playerId).single(),
      ) as Row;
      await supabase.from('athletes').update(athletePatch).eq('id', part.athlete_id);
    }
    if (Object.keys(participantPatch).length) {
      await supabase.from('tryout_participants').update(participantPatch).eq('id', playerId);
    }
    return this.fetchPlayer(playerId);
  }

  async deletePlayer(_tryoutId: string, playerId: string): Promise<void> {
    const { supabase } = await this.ctx();
    // Soft delete — the participant row (and its evaluations/scores) stays in
    // the database so it still counts toward the player's permanent profile
    // history, it just disappears from this tryout's active roster (see the
    // removed_at filter in assembleTryouts).
    unwrap(
      await supabase
        .from('tryout_participants')
        .update({ removed_at: new Date().toISOString() })
        .eq('id', playerId)
        .select()
        .maybeSingle(),
    );
  }


  async uploadPlayerPhoto(athleteId: string, fileUri: string, fileType: string): Promise<string> {
    const { supabase } = await this.ctx();

    const buffer = await uriToArrayBuffer(fileUri);
    const fileExtension = fileType.split('/')[1] || 'jpg';
    const filePath = `${athleteId}.${fileExtension}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, buffer, {
        contentType: fileType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    const publicUrlWithCacheBuster = `${publicUrl}?v=${Date.now()}`;

    unwrap(
      await supabase
        .from('athletes')
        .update({ avatar_url: publicUrlWithCacheBuster })
        .eq('id', athleteId)
        .select()
        .single()
    );

    return publicUrlWithCacheBuster;
  }


  async importLibraryPlayers(
    tryoutId: string,
    entries: { first: string; last: string; jersey?: string; pos?: string }[],
  ): Promise<Player[]> {
    const players: Player[] = [];
    for (const e of entries) {
      players.push(
        await this.addPlayer(tryoutId, {
          first: e.first,
          last: e.last,
          jersey: e.jersey,
          pos: e.pos,
        } as AddPlayerForm),
      );
    }
    return players;
  }

  // ─── Evaluations ──────────────────────────────────────────────────────────────
  async saveEvaluation(
    tryoutId: string,
    playerId: string,
    form: ScoreForm,
    evalId?: string,
    activeAssessor?: import('@/data/types').Assessor | null,
  ): Promise<Evaluation> {
    const { supabase, userId } = await this.ctx();
    const recDb = form.recommendation ? REC_TO_DB[form.recommendation] : null;

    let evaluatorUserId: string | null = userId;
    let evaluatorName = '';

    if (activeAssessor) {
      evaluatorName = activeAssessor.name;
      // We directly read the userId property mapped in rowToAssessor, bypassing DB lookup
      evaluatorUserId = activeAssessor.userId ?? null;

      if (!evaluatorUserId) {
        const profile = await this.loadUserProfile(userId);
        if (
          profile.email &&
          activeAssessor.email &&
          profile.email.toLowerCase() === activeAssessor.email.toLowerCase()
        ) {
          evaluatorUserId = userId;
        }
      }
    } else {
      const profile = await this.loadUserProfile(userId);
      evaluatorName = profile.displayName;
    }

    let id = evalId;
    if (!id) {
      // Correctly check for existing evaluation including null check for evaluatorUserId
      let query = supabase
        .from('evaluations')
        .select('id')
        .eq('tryout_id', tryoutId)
        .eq('participant_id', playerId)
        .eq('session', form.session);

      if (evaluatorUserId) {
        query = query.eq('evaluator_user_id', evaluatorUserId);
      } else {
        query = query.is('evaluator_user_id', null).eq('evaluator_name', evaluatorName);
      }

      const { data: existingRows } = await query;
      if (existingRows && existingRows.length > 0) {
        id = existingRows[0].id;

        // Clean up duplicate evaluation rows if they exist in the DB (fixes 'two go remove and one remain')
        if (existingRows.length > 1) {
          const extraIds = existingRows.slice(1).map((r) => r.id);
          await supabase.from('evaluations').delete().in('id', extraIds);
        }
      }
    }

    let savedData: Row;

    if (id) {
      const updateResult = await supabase
        .from('evaluations')
        .update({
          session: form.session,
          strengths: form.strengths ?? null,
          improve: form.improve ?? null,
          recommendation: recDb,
          evaluator_user_id: evaluatorUserId,
          evaluator_name: evaluatorName,
        })
        .eq('id', id)
        .select()
        .single();
      savedData = unwrap(updateResult) as Row;
    } else {
      const insertResult = await supabase
        .from('evaluations')
        .insert({
          tryout_id: tryoutId,
          participant_id: playerId,
          evaluator_user_id: evaluatorUserId,
          evaluator_name: evaluatorName,
          session: form.session,
          strengths: form.strengths ?? null,
          improve: form.improve ?? null,
          recommendation: recDb,
          source: 'manual',
        })
        .select()
        .single();
      savedData = unwrap(insertResult) as Row;
      id = savedData.id;
    }

    const scoreRows = Object.entries(form.scores)
      .filter(([, v]) => v != null && !Number.isNaN(v))
      .map(([rubric_key, value]) => ({ evaluation_id: id, rubric_key, value }));

    if (scoreRows.length) {
      const keys = scoreRows.map(r => r.rubric_key);
      // Save scores and clean up old ones in parallel
      await Promise.all([
        supabase.from('evaluation_scores').upsert(scoreRows, { onConflict: 'evaluation_id,rubric_key' }),
        supabase.from('evaluation_scores').delete().eq('evaluation_id', id).not('rubric_key', 'in', `(${keys.join(',')})`),
      ]).then(([upsertRes, deleteRes]) => {
        unwrap(upsertRes);
        unwrap(deleteRes);
      });
    } else {
      unwrap(await supabase.from('evaluation_scores').delete().eq('evaluation_id', id));
    }

    this.markOnboarding({ scorePlayers: true }).catch(() => { });

    savedData.evaluation_scores = scoreRows;
    return this.rowToEval(savedData);
  }

  async deleteEvaluation(_tryoutId: string, evalId: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('evaluations').delete().eq('id', evalId).select().maybeSingle());
  }

  async importScanScores(
    tryoutId: string,
    scores: { playerId: string; rubricKey: string; value: number }[],
  ): Promise<void> {
    const byPlayer: Record<string, Record<string, number>> = {};
    for (const s of scores) (byPlayer[s.playerId] ??= {})[s.rubricKey] = s.value;
    for (const [playerId, scoreMap] of Object.entries(byPlayer)) {
      await this.saveEvaluation(tryoutId, playerId, {
        session: 'Scan Import',
        recommendation: '',
        scores: scoreMap,
      });
    }
  }

  // ─── Testing utilities (association/enterprise) ───────────────────────────────
  async generateTestData(
    tryoutId: string,
    options: DummyDataOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<DummyDataResult> {
    const { supabase, userId } = await this.ctx();
    // Not wrapped in withFreshAccount(): it retries the whole operation on any
    // error, and this one writes incrementally — a failure in the scores phase
    // would re-run generation from the top and duplicate every athlete and
    // participant already inserted. The stale-account failure it guards against
    // can't reach a partial write here anyway, since the first write is
    // create_athletes_for_caller(), which resolves the owning account
    // server-side from auth.uid(). Matches the mobile app.
    const accountId = await this.writableAccountId();
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Assessment not found');

    const target = options?.target ?? 'roster';
    const wantsRoster = target === 'roster' || target === 'both';
    const wantsRegistrations = target === 'registrations' || target === 'both';
    // Scores only exist on rostered players — a registration has nowhere to hang them.
    const withScores = wantsRoster && options?.withScores !== false;

    const rubrics = tryout.settings.customRubrics ?? [];
    if (withScores && rubrics.length === 0) {
      // Surfaced to the UI, which prompts the user to add rubrics first.
      throw new Error('NO_RUBRICS');
    }

    const n = clampInt(options?.count, 1, 1000, 50);
    const currentYear = new Date().getFullYear();

    // Progress is measured in the records the user asked for, so every target —
    // registrations, roster, or both — drives the bar, not just the AI-scored
    // path. The AI generation round trip is the slow half of a scored roster, so
    // it owns half of that phase's share; an unscored batch is generated
    // locally and instantly, leaving the whole share to insertion.
    const regUnits = wantsRegistrations ? n : 0;
    const rosterUnits = wantsRoster ? n : 0;
    const totalUnits = regUnits + rosterUnits;
    const genWeight = withScores ? rosterUnits * 0.5 : 0;
    const insertWeight = rosterUnits - genWeight;
    let doneUnits = 0;
    // Monotonic — a later phase must never walk the bar backwards.
    const report = (units: number) => {
      doneUnits = Math.min(totalUnits, Math.max(doneUnits, units));
      onProgress?.(Math.round(doneUnits), totalUnits);
    };
    report(0);

    // Only pay for the AI round trip when the batch actually needs scores;
    // an unscored batch just needs names, so generate those locally.
    const generated: ScorableDummyPlayer[] = withScores
      ? await this.generateAITestPlayers(supabase, tryout, rubrics, n, currentYear, (done) =>
          report((done / n) * genWeight),
        )
      : generateDummyPlayers(n, tryout.sport, currentYear);
    report(genWeight);

    let registrations = 0;
    if (wantsRegistrations) {
      // `both` creates two distinct cohorts so the pending queue isn't just a
      // duplicate of the roster — generate a second batch of names for it.
      const regPlayers = target === 'both'
        ? generateDummyPlayers(n, tryout.sport, currentYear)
        : generated;
      registrations = await this.insertDummyRegistrations(supabase, tryout, regPlayers, (inserted) =>
        report(genWeight + inserted),
      );
    }

    let players = 0;
    let evaluations = 0;
    if (wantsRoster) {
      const res = await this.insertDummyRoster(
        supabase,
        accountId,
        userId,
        tryout,
        generated,
        {
          withScores,
          sessionsPerPlayer: clampInt(options?.sessionsPerPlayer, 1, 5, 1),
        },
        (fraction) => report(genWeight + regUnits + fraction * insertWeight),
      );
      players = res.players;
      evaluations = res.evaluations;
    }
    report(totalUnits);

    // Only set flags we actually earned — `markOnboarding` spreads the patch, so
    // an `undefined` value would wipe a step the user had already completed.
    const steps: Record<string, boolean> = {};
    if (players > 0) steps.addPlayers = true;
    if (evaluations > 0) steps.scorePlayers = true;
    if (Object.keys(steps).length) await this.markOnboarding(steps);

    return { registrations, players, evaluations };
  }

  /**
   * Insert a batch of pending registrations for `tryout`, inventing the guardian
   * contact block that the roster path deliberately omits. Addresses use a
   * reserved domain, so nothing here can mail a real person.
   */
  private async insertDummyRegistrations(
    supabase: SupabaseClient,
    tryout: Tryout,
    generated: GeneratedPlayer[],
    /** Called with the running inserted-row count after each chunk lands. */
    onProgress?: (inserted: number) => void,
  ): Promise<number> {
    const positions =
      POSITIONS_BY_SPORT[tryout.sport as keyof typeof POSITIONS_BY_SPORT] ?? POSITIONS_BY_SPORT.Other;
    const rows = generated.map((g, i) => {
      const form = generateDummyRegistration(g, i, positions);
      return {
        tryout_id: tryout.id,
        first_name: form.firstName,
        last_name: form.lastName,
        year_of_birth: form.yearOfBirth ? Number(form.yearOfBirth) : null,
        position_trying_out_for: form.positionTryingOutFor || null,
        guardian_name: form.guardianName,
        guardian_email: form.guardianEmail,
        guardian_phone: form.guardianPhone || null,
        current_team: TEST_DATA_TAG,
        current_level: form.currentLevel || null,
        about_player: form.aboutPlayer || null,
        medical_info: form.medicalInfo || null,
        status: 'pending',
      };
    });
    const inserted = await insertChunked(
      rows,
      DUMMY_CHUNK.registrations,
      async (chunk) => unwrap(await supabase.from('registrations').insert(chunk).select('id')) as Row[],
      onProgress,
    );
    return inserted.length;
  }

  /**
   * Insert generated players straight onto the roster, optionally with
   * `sessionsPerPlayer` scored evaluations each. Shared by the in-assessment
   * dummy button and the New Team flow.
   */
  private async insertDummyRoster(
    supabase: SupabaseClient,
    accountId: string,
    userId: string,
    tryout: Tryout,
    generated: ScorableDummyPlayer[],
    opts: { withScores: boolean; sessionsPerPlayer: number },
    /** Called with this phase's completion as a 0–1 fraction, chunk by chunk, so
     * a caller can fold it into a wider progress bar. */
    onProgress?: (fraction: number) => void,
  ): Promise<{ players: number; evaluations: number; athleteIds: string[] }> {
    if (generated.length === 0) {
      onProgress?.(1);
      return { players: 0, evaluations: 0, athleteIds: [] };
    }

    // 1. Bulk-insert canonical athletes (no guardian contact → no side effects).
    // Chunked at DUMMY_CHUNK.athletes, so the 1000-player ceiling is one request.
    //
    // Routed through create_athletes_for_caller() rather than a direct table
    // insert — it takes account_id as a hint and resolves the real owning
    // account from auth.uid() server-side, so a stale or read-only cached
    // accountId can't fail the athletes_insert policy with "new row violates
    // row-level security policy". The RPC returns ids in input order.
    const athleteIds = await insertChunked(
      generated,
      DUMMY_CHUNK.athletes,
      async (chunk) => {
        const { data, error } = await supabase.rpc('create_athletes_for_caller', {
          account_hint: accountId,
          players: chunk.map((g) => ({
            first_name: g.form.first,
            last_name: g.form.last,
            year_of_birth: g.form.yearOfBirth ? Number(g.form.yearOfBirth) : null,
          })),
        });
        if (error) throw new Error(error.message);
        return (data ?? []) as string[];
      },
      // The four inserts below share this phase's slice of the bar, weighted by
      // roughly how long each takes on a large batch.
      (done) => onProgress?.(0.35 * (done / generated.length)),
    );

    // 2. Bulk-insert participants, tagged via current_team so they can be cleared.
    // `offset` is what lets a chunk find its own athlete ids while chunks run
    // concurrently — the ids are in input order, not completion order.
    const participants = await insertChunked(
      generated,
      DUMMY_CHUNK.participants,
      async (chunk, offset) =>
        unwrap(
          await supabase
            .from('tryout_participants')
            .insert(
              chunk.map((g, j) => ({
                tryout_id: tryout.id,
                athlete_id: athleteIds[offset + j],
                jersey: g.form.jersey || null,
                position: g.form.pos || null,
                current_team: TEST_DATA_TAG,
                current_level: g.form.currentLevel || null,
                registration_source: 'import',
              })),
            )
            .select('id'),
        ) as Row[],
      (done) => onProgress?.(0.35 + 0.25 * (done / generated.length)),
    );

    if (!opts.withScores) {
      onProgress?.(1);
      return { players: participants.length, evaluations: 0, athleteIds };
    }

    const rubrics = tryout.settings.customRubrics ?? [];

    // 3. Build evaluations: ~10% are left unscored to exercise the unscored
    //    filter; the rest get exactly `sessionsPerPlayer` sessions, spread
    //    across the assessment's assessors.
    const profile = await this.loadUserProfile(userId);
    const assessorNames = tryout.assessors.length
      ? tryout.assessors.map((a) => a.name)
      : [profile.displayName];

    const evalRows: Row[] = [];
    const evalPlayerIndex: number[] = [];
    generated.forEach((g, i) => {
      if (Math.random() < 0.1) return; // leave unscored
      for (let sIdx = 0; sIdx < opts.sessionsPerPlayer; sIdx++) {
        const evaluatorName = assessorNames[(i + sIdx) % assessorNames.length];
        const isOwner = evaluatorName === profile.displayName;
        evalRows.push({
          tryout_id: tryout.id,
          participant_id: participants[i].id,
          evaluator_user_id: isOwner ? userId : null,
          evaluator_name: evaluatorName,
          session: `Session ${sIdx + 1}`,
          recommendation: REC_TO_DB[pickRecommendation(g.ability) as Exclude<Recommendation, ''>] ?? null,
          source: 'manual',
        });
        evalPlayerIndex.push(i);
      }
    });

    const evals = await insertChunked(
      evalRows,
      DUMMY_CHUNK.evaluations,
      async (chunk) => unwrap(await supabase.from('evaluations').insert(chunk).select('id')) as Row[],
      (done) => onProgress?.(0.6 + 0.25 * (done / Math.max(1, evalRows.length))),
    );

    // 4. Build and chunk-insert scores for every applicable rubric per eval.
    const scoreRows: Row[] = [];
    evals.forEach((e, idx) => {
      const g = generated[evalPlayerIndex[idx]];
      const subskills = getPlayerSubskills(tryout.sport, g.form.pos, rubrics);
      // Prefer the AI-generated raw score per rubric (validated against its
      // benchmarks); fall back to an ability-derived score for any rubric the
      // AI didn't score, so ranking logic always has a full score set.
      const derived = generateScoresForPlayer(subskills, g.ability);
      for (const s of subskills) {
        const aiScore = g.scores ? clampScoreToRubric(g.scores[s.key], s) : null;
        const value = aiScore ?? derived[s.key];
        if (value !== undefined) scoreRows.push({ evaluation_id: e.id, rubric_key: s.key, value });
      }
    });
    await insertChunked(
      scoreRows,
      DUMMY_CHUNK.scores,
      async (chunk) => {
        // No `.select()`: nothing reads these ids, and on a full batch that's
        // ~30,000 rows of response body saved for nothing.
        unwrap(await supabase.from('evaluation_scores').insert(chunk));
        return [];
      },
      (done) => onProgress?.(0.85 + 0.15 * (done / Math.max(1, scoreRows.length))),
    );
    onProgress?.(1);

    return { players: participants.length, evaluations: evals.length, athleteIds };
  }

  /**
   * Stand up whole dummy teams from the New Team screen. Teams hold no roster of
   * their own, so each one gets a linked assessment (seeded with a rubric set
   * spanning every scoring type) and that assessment carries the players. The
   * assessment is flagged `settings.isTestData` so `clearDummyTeams` can undo
   * the entire bundle later.
   */
  async generateDummyTeams(
    options: DummyTeamOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<DummyTeamResult> {
    const { supabase, userId } = await this.ctx();
    // teams/tryouts insert with this id directly, so it must be an account the
    // caller can actually write to — not whatever ctx() cached first. Same
    // reasoning as generateTestData for not retrying via withFreshAccount().
    const accountId = await this.writableAccountId();
    const profile = await this.loadUserProfile(userId);

    const teamCount = clampInt(options?.teams, 1, 10, 1);
    const playersPerTeam = clampInt(options?.playersPerTeam, 1, 1000, 20);
    const sessionsPerPlayer = clampInt(options?.sessionsPerPlayer, 1, 5, 1);
    const withScores = options?.withScores !== false;
    const currentYear = new Date().getFullYear();

    const rubrics = generateDummyRubrics();
    const names = generateDummyTeamNames(teamCount);
    const result: DummyTeamResult = {
      teams: 0,
      assessments: 0,
      registrations: 0,
      players: 0,
      evaluations: 0,
    };

    const totalPlayers = teamCount * playersPerTeam;
    onProgress?.(0, totalPlayers);
    let teamIdx = 0;
    for (const name of names) {
      const teamOffset = teamIdx * playersPerTeam;
      teamIdx++;
      const team = unwrap(
        await supabase
          .from('teams')
          .insert({ account_id: accountId, name, season_label: `${currentYear}-${String((currentYear + 1) % 100).padStart(2, '0')}` })
          .select()
          .single(),
      ) as Row;
      result.teams++;

      const tryoutRow = unwrap(
        await supabase
          .from('tryouts')
          .insert({
            account_id: accountId,
            team_id: team.id,
            name: `${name} Tryout`,
            event_type: 'tryout',
            sport: 'Hockey',
            tryout_date: new Date().toISOString().slice(0, 10),
            head_coach: profile.displayName,
            head_assessor: profile.displayName,
            settings: {
              skaterWeights: {},
              goalieWeights: {},
              customRubrics: rubrics,
              isTestData: true,
            },
          })
          .select()
          .single(),
      ) as Row;
      result.assessments++;

      // Seed the creator as lead assessor, matching `createTryout`.
      await supabase.from('tryout_assessors').insert({
        tryout_id: tryoutRow.id,
        user_id: userId,
        name: profile.displayName,
        email: profile.email,
        role: 'lead',
        joined_at: new Date().toISOString(),
      });

      const [tryout] = await this.assembleTryouts([tryoutRow]);
      // Each team's slice of the bar is split between generating its players and
      // writing them, so the bar advances during both halves rather than
      // standing still through the inserts.
      const genShare = withScores ? playersPerTeam * 0.5 : 0;
      const insertShare = playersPerTeam - genShare;
      const generated = withScores
        ? await this.generateAITestPlayers(supabase, tryout, rubrics, playersPerTeam, currentYear, (done) =>
            onProgress?.(Math.round(teamOffset + (done / playersPerTeam) * genShare), totalPlayers),
          )
        : generateDummyPlayers(playersPerTeam, tryout.sport, currentYear);

      const res = await this.insertDummyRoster(
        supabase,
        accountId,
        userId,
        tryout,
        generated,
        { withScores, sessionsPerPlayer },
        (fraction) => onProgress?.(Math.round(teamOffset + genShare + fraction * insertShare), totalPlayers),
      );
      result.players += res.players;
      result.evaluations += res.evaluations;

      // Put the same athletes on the team's own roster, so a generated team
      // shows players immediately rather than an empty Players list.
      await this.addTeamRosterPlayers(
        team.id,
        res.athleteIds.map((athleteId, i) => ({
          athleteId,
          jersey: generated[i]?.form.jersey,
          pos: generated[i]?.form.pos,
          sourceTryoutId: tryout.id,
        })),
      );

      onProgress?.(teamOffset + playersPerTeam, totalPlayers);
    }

    const steps: Record<string, boolean> = { createTeam: true, createAssessment: true };
    if (result.players > 0) steps.addPlayers = true;
    if (result.evaluations > 0) steps.scorePlayers = true;
    await this.markOnboarding(steps);

    return result;
  }

  /**
   * Delete every team/assessment bundle created by `generateDummyTeams`.
   * Assessments are found by their `settings.isTestData` flag; deleting them
   * cascades to participants, evaluations, and scores. A team is only removed
   * once it has no assessments left, so a team the user has since attached real
   * work to survives.
   */
  async clearDummyTeams(): Promise<{ teams: number; assessments: number }> {
    const { supabase, accountId } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('tryouts')
        .select('id, team_id, settings')
        .eq('account_id', accountId)
        .contains('settings', { isTestData: true }),
    ) as Row[];
    if (rows.length === 0) return { teams: 0, assessments: 0 };

    const ids = rows.map((r) => r.id);
    unwrap(await supabase.from('tryouts').delete().in('id', ids).select('id'));

    const teamIds = [...new Set(rows.map((r) => r.team_id).filter(Boolean))] as string[];
    let teams = 0;
    for (const teamId of teamIds) {
      const remaining = unwrap(
        await supabase.from('tryouts').select('id').eq('team_id', teamId).limit(1),
      ) as Row[];
      if (remaining.length > 0) continue;
      const deleted = unwrap(
        await supabase.from('teams').delete().eq('id', teamId).select('id'),
      ) as Row[];
      teams += deleted.length;
    }
    return { teams, assessments: ids.length };
  }

  /**
   * Generate `count` dummy players (identity + scores) via the AI edge function,
   * in bounded chunks with limited concurrency. Any chunk that fails or returns
   * too few players is topped up with the local deterministic generator, so the
   * feature always yields a full batch even if AI is unavailable.
   */
  private async generateAITestPlayers(
    supabase: SupabaseClient,
    tryout: Tryout,
    rubrics: CustomRubric[],
    count: number,
    currentYear: number,
    /** Called with the running player count as each chunk lands. */
    onProgress?: (done: number) => void,
  ): Promise<Array<{ form: AITestPlayer['form']; ability: number; scores?: Record<string, number> }>> {
    const sport = tryout.sport;
    const positions = POSITIONS_BY_SPORT[sport as keyof typeof POSITIONS_BY_SPORT] ?? POSITIONS_BY_SPORT.Other;
    const rubricDescriptors = rubrics.map((r) => ({
      key: r.key,
      label: r.label,
      scoringType: r.scoringType,
      scale: r.scale,
      minVal: r.minVal,
      maxVal: r.maxVal,
      rankingDirection: r.rankingDirection,
    }));

    // Chunk so each Claude call stays within a comfortable output size.
    const chunkSizes: number[] = [];
    for (let remaining = count; remaining > 0; remaining -= AI_CHUNK) {
      chunkSizes.push(Math.min(AI_CHUNK, remaining));
    }

    // Every chunk at once for a big batch (1000 players = 50 chunks = 50 in
    // flight), scaling down to the chunk count for small ones. These are
    // independent edge-function invocations, so width here is what turns a
    // multi-minute batch into a single round trip's worth of waiting — the
    // fixed-width waves this replaces ran 4 at a time and made every wave wait
    // out its slowest member.
    const width = concurrencyFor(chunkSizes.length, DUMMY_MAX_CONCURRENCY.ai);
    let reported = 0;
    const results = await mapPool(chunkSizes, width, async (chunkCount) => {
      let players: AITestPlayer[] = [];
      // A burst this wide is exactly what trips a rate limit, and a rate-limited
      // chunk would otherwise fall through to local filler — fast, but silently
      // worse data. Retry with backoff so width costs latency, never quality.
      for (let attempt = 0; attempt <= AI_CHUNK_RETRIES; attempt++) {
        try {
          const { data, error } = await supabase.functions.invoke('generate-test-players', {
            body: { sport, count: chunkCount, positions, rubrics: rubricDescriptors },
          });
          if (!error && data && !data.error && Array.isArray(data.players)) {
            players = (data.players as unknown[])
              .map((pl) => mapAIPlayer(pl, sport, currentYear))
              .filter((pl): pl is AITestPlayer => pl !== null);
          }
        } catch {
          // Chunk lost — retried below, then topped up locally if it keeps failing.
        }
        if (players.length > 0 || attempt === AI_CHUNK_RETRIES) break;
        // Jittered so a wave of rate-limited chunks doesn't retry in lockstep.
        await sleep(500 * 2 ** attempt + Math.random() * 400);
      }
      // Counted as each chunk lands rather than once per group, so the bar keeps
      // moving through a long batch.
      reported += players.length;
      onProgress?.(Math.min(reported, count));
      return players;
    });

    const collected: AITestPlayer[] = results.flat();

    // Top up any shortfall (partial or total AI failure) with local generation.
    if (collected.length < count) {
      const filler = generateDummyPlayers(count - collected.length, sport, currentYear);
      for (const f of filler) collected.push({ form: f.form, ability: f.ability, scores: {} });
    }

    return collected.slice(0, count);
  }

  async clearTestData(tryoutId: string): Promise<{ removed: number }> {
    const { supabase } = await this.ctx();
    // Deleting participants cascades to their evaluations and scores.
    const rows = unwrap(
      await supabase
        .from('tryout_participants')
        .delete()
        .eq('tryout_id', tryoutId)
        .eq('current_team', TEST_DATA_TAG)
        .select('id'),
    ) as Row[];
    // Generated registrations carry the same tag, so a pending queue filled by
    // the dummy button is cleared by the same action.
    const regs = unwrap(
      await supabase
        .from('registrations')
        .delete()
        .eq('tryout_id', tryoutId)
        .eq('current_team', TEST_DATA_TAG)
        .select('id'),
    ) as Row[];
    return { removed: rows.length + regs.length };
  }

  // ─── Registration ───────────────────────────────────────────────────────────
  async ensureCloudSession(tryoutId: string): Promise<Tryout> {
    const { supabase } = await this.ctx();
    const row = unwrap(
      await supabase.from('tryouts').select('registration_code').eq('id', tryoutId).single(),
    ) as Row;
    if (!row.registration_code) {
      unwrap(
        await supabase
          .from('tryouts')
          .update({ registration_code: generateCloudCode(), registration_open: true })
          .eq('id', tryoutId)
          .select()
      );
    }
    const result = await this.getTryout(tryoutId);
    if (!result) throw new Error('Tryout not found');
    return result;
  }

  async listRegistrations(tryoutId: string): Promise<Registration[]> {
    const { supabase } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('registrations')
        .select('*')
        .eq('tryout_id', tryoutId)
        .order('created_at', { ascending: false }),
    ) as Row[];
    return rows.map((r) => this.rowToRegistration(r));
  }

  async submitRegistration(tryoutId: string, form: RegistrationSubmit): Promise<Registration> {
    const { supabase } = await this.ctx();
    const row = unwrap(
      await supabase
        .from('registrations')
        .insert({
          tryout_id: tryoutId,
          first_name: form.firstName,
          last_name: form.lastName,
          year_of_birth: form.yearOfBirth ? Number(form.yearOfBirth) : null,
          position_trying_out_for: form.positionTryingOutFor || null,
          guardian_name: form.guardianName,
          guardian_email: form.guardianEmail,
          guardian_phone: form.guardianPhone || null,
          current_team: form.currentTeam || null,
          current_level: form.currentLevel || null,
          about_player: form.aboutPlayer || null,
          medical_info: form.medicalInfo || null,
          friend1_name: form.friend1Name || null,
          friend2_name: form.friend2Name || null,
          status: 'pending',
        })
        .select()
        .single(),
    ) as Row;
    return this.rowToRegistration(row);
  }

  async submitPublicRegistration(eventIdOrCode: string, form: RegistrationSubmit): Promise<Registration> {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('submit_public_registration', {
      code: eventIdOrCode,
      payload: form,
    });

    if (error) {
      throw new Error(error.message);
    }

    return this.rowToRegistration(data as Row);
  }

  async addRegistrationToRoster(tryoutId: string, registrationId: string): Promise<Player> {
    return this.withFreshAccount((guard) => this._addRegistrationToRoster(tryoutId, registrationId, guard));
  }

  private async _addRegistrationToRoster(
    tryoutId: string,
    registrationId: string,
    guard: WriteGuard,
  ): Promise<Player> {
    const { supabase } = await this.ctx();
    const accountId = await this.writableAccountId();
    const reg = unwrap(
      await supabase.from('registrations').select('*').eq('id', registrationId).single(),
    ) as Row;
    const athleteId = await this.createAthlete(accountId, {
      first_name: reg.first_name,
      last_name: reg.last_name,
      year_of_birth: reg.year_of_birth ?? null,
      guardian_name: reg.guardian_name || null,
      guardian_email: reg.guardian_email || null,
      guardian_phone: reg.guardian_phone || null,
      medical_info: reg.medical_info || null,
      about: reg.about_player || null,
    });
    const participant = unwrap(
      await supabase
        .from('tryout_participants')
        .insert({
          tryout_id: tryoutId,
          athlete_id: athleteId,
          position_trying_out_for: reg.position_trying_out_for || null,
          current_team: reg.current_team || null,
          current_level: reg.current_level || null,
          registration_source: 'qr',
          friend1_name: reg.friend1_name || null,
          friend2_name: reg.friend2_name || null,
        })
        .select('id')
        .single(),
    ) as Row;
    await supabase
      .from('registrations')
      .update({ status: 'added', athlete_id: athleteId })
      .eq('id', registrationId);
    await this.markOnboarding({ addPlayers: true });
    return this.fetchPlayer(participant.id);
  }

  async addRegistrationToTeam(teamId: string, registrationId: string): Promise<TeamRosterPlayer[]> {
    return this.withFreshAccount((guard) => this._addRegistrationToTeam(teamId, registrationId, guard));
  }

  private async _addRegistrationToTeam(
    teamId: string,
    registrationId: string,
    guard: WriteGuard,
  ): Promise<TeamRosterPlayer[]> {
    const { supabase } = await this.ctx();
    const accountId = await this.writableAccountId();
    const reg = unwrap(
      await supabase.from('registrations').select('*').eq('id', registrationId).single(),
    ) as Row;
    const athleteId = await this.createAthlete(accountId, {
      first_name: reg.first_name,
      last_name: reg.last_name,
      year_of_birth: reg.year_of_birth ?? null,
      guardian_name: reg.guardian_name || null,
      guardian_email: reg.guardian_email || null,
      guardian_phone: reg.guardian_phone || null,
      medical_info: reg.medical_info || null,
      about: reg.about_player || null,
    });
    const rows = await this.addTeamRosterPlayers(teamId, [
      { athleteId, pos: reg.position_trying_out_for || undefined },
    ]);
    await supabase
      .from('registrations')
      .update({ status: 'added', athlete_id: athleteId })
      .eq('id', registrationId);
    await this.markOnboarding({ addPlayers: true });
    return rows;
  }

  /**
   * Bulk twin of addRegistrationToRoster — a simple sequential loop over the
   * singular placement rather than mobile's chunked-concurrency RPC pipeline
   * (create_athletes_for_caller/resolve_guardians_for_caller): that machinery
   * exists to survive statement timeouts at a scale web hasn't hit, and
   * introducing new unverified RPCs for a perf concern isn't worth the risk.
   */
  /**
   * Resolve (and create, where needed) every distinct guardian email across
   * the *whole* selection in one pass, before any chunk starts creating
   * athletes. Returns a lowercase-email -> guardian_user_id map.
   *
   * Deduplicating up front — rather than per chunk — is what makes it safe to
   * run the resolve calls concurrently: since each email is only ever handed
   * to one batch, two batches can never race to insert the same new
   * auth.users row at once.
   *
   * Invite emails for newly created guardians are dispatched afterwards
   * without being awaited — best-effort, kept off the placement critical path
   * since the caller only needs the returned map before it can create athletes.
   */
  private async resolveGuardiansForRegistrations(supabase: SupabaseClient, regs: Row[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const displayNameByEmail = new Map<string, string>();
    for (const reg of regs) {
      const email = reg.guardian_email;
      if (!email) continue;
      const lc = String(email).toLowerCase();
      if (!displayNameByEmail.has(lc)) displayNameByEmail.set(lc, reg.guardian_name || 'Guardian');
    }
    if (displayNameByEmail.size === 0) return map;

    const entries = [...displayNameByEmail.entries()];
    const batches: { email: string; display_name: string }[][] = [];
    for (let i = 0; i < entries.length; i += GUARDIAN_RESOLVE_BATCH) {
      batches.push(entries.slice(i, i + GUARDIAN_RESOLVE_BATCH).map(([email, display_name]) => ({ email, display_name })));
    }

    const invites: { email: string; password: string }[] = [];
    await mapPool(batches, REGISTRATION_CHUNK_CONCURRENCY, async (batch) => {
      try {
        const { data, error } = await supabase.rpc('resolve_guardians_for_caller', { guardians: batch });
        if (error) throw new Error(error.message);
        const resolved = (data ?? []) as { email: string; user_id: string | null; created: boolean; password: string | null }[];
        for (const r of resolved) {
          if (r.email && r.user_id) map.set(r.email.toLowerCase(), r.user_id);
          if (r.created && r.password) invites.push({ email: r.email, password: r.password });
        }
      } catch (err) {
        console.warn('Failed to bulk-resolve guardian accounts:', err);
      }
    });

    if (invites.length > 0) {
      mapPool(invites, GUARDIAN_EMAIL_CONCURRENCY, (r) =>
        this.sendEmail('org_invite', r.email, { role: 'guardian', password: r.password }).catch((emailErr) =>
          console.warn('Failed to send auto-created guardian invite email:', emailErr),
        ),
      ).catch((err) => console.warn('Guardian invite dispatch failed:', err));
    }

    return map;
  }

  /** Build a `create_athletes_for_caller` payload row from a registration. */
  private athleteFieldsFromRegistration(reg: Row, guardianMap: Map<string, string>): Row {
    const guardianUserId = reg.guardian_email ? guardianMap.get(String(reg.guardian_email).toLowerCase()) : undefined;
    return {
      first_name: reg.first_name,
      last_name: reg.last_name,
      year_of_birth: reg.year_of_birth ?? null,
      guardian_name: reg.guardian_name || null,
      guardian_email: reg.guardian_email || null,
      guardian_phone: reg.guardian_phone || null,
      guardian_user_id: guardianUserId || null,
      medical_info: reg.medical_info || null,
      about: reg.about_player || null,
    };
  }

  /** Mark a placed chunk's registrations as added, one request per chunk. */
  private async markRegistrationsAdded(supabase: SupabaseClient, placed: { reg: Row; athleteId: string }[]): Promise<void> {
    // `athlete_id` differs per row, so this can't be one `update ... in (...)`.
    // Upserting the whole row instead — and it has to be the *whole* row, spread
    // from the `select('*')` these came back on: an upsert is an INSERT with ON
    // CONFLICT DO UPDATE, and Postgres checks NOT NULL on the proposed tuple
    // before it ever looks for the conflict, so a partial payload would fail on
    // registrations' not-null columns rather than falling through to the update.
    unwrap(
      await supabase
        .from('registrations')
        .upsert(
          placed.map(({ reg, athleteId }) => ({ ...reg, status: 'added', athlete_id: athleteId })),
          { onConflict: 'id' },
        )
        .select('id'),
    );
  }

  /**
   * Shared body of both bulk placement paths: split into id chunks, load
   * every chunk's registration rows up front (read-only, so this is fully
   * parallel regardless of the write-side concurrency limit), resolve every
   * distinct guardian in the whole selection exactly once, then create
   * athletes chunk by chunk — with bounded concurrency, since none of this
   * phase touches auth.users and so can't hit the guardian create-race above.
   * `place` does the caller-specific roster/participant insert for a chunk's
   * newly created athletes.
   */
  private async placeRegistrations(
    supabase: SupabaseClient,
    accountId: string,
    registrationIds: string[],
    place: (placed: { reg: Row; athleteId: string }[]) => Promise<void>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    const idChunks: string[][] = [];
    for (let i = 0; i < registrationIds.length; i += REGISTRATION_CHUNK) {
      idChunks.push(registrationIds.slice(i, i + REGISTRATION_CHUNK));
    }
    if (idChunks.length === 0) return 0;

    const regChunks = await mapPool(idChunks, REGISTRATION_CHUNK_CONCURRENCY * 2, async (ids) => {
      // Postgres doesn't promise `.in()` comes back in the order the ids were
      // passed, so everything downstream is keyed off this array's own order
      // rather than the caller's id list.
      return unwrap(await supabase.from('registrations').select('*').in('id', ids)) as Row[];
    });

    const guardianMap = await this.resolveGuardiansForRegistrations(supabase, regChunks.flat());

    let done = 0;
    const total = registrationIds.length;
    await mapPool(regChunks, REGISTRATION_CHUNK_CONCURRENCY, async (regs) => {
      if (regs.length === 0) return;
      const fields = regs.map((reg) => this.athleteFieldsFromRegistration(reg, guardianMap));
      const { data, error } = await supabase.rpc('create_athletes_for_caller', {
        account_hint: accountId,
        players: fields,
      });
      if (error) throw new Error(error.message);
      const athleteIds = (data ?? []) as string[];
      const placed = regs.map((reg, i) => ({ reg, athleteId: athleteIds[i] }));

      await place(placed);
      await this.markRegistrationsAdded(supabase, placed);

      done += placed.length;
      onProgress?.(done, total);
    });

    if (done > 0) await this.markOnboarding({ addPlayers: true });
    return done;
  }

  async addRegistrationsToRoster(
    tryoutId: string,
    registrationIds: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    const { supabase, accountId } = await this.ctx();
    return this.placeRegistrations(
      supabase,
      accountId,
      registrationIds,
      async (placed) => {
        unwrap(
          await supabase
            .from('tryout_participants')
            .insert(
              placed.map(({ reg, athleteId }) => ({
                tryout_id: tryoutId,
                athlete_id: athleteId,
                position_trying_out_for: reg.position_trying_out_for || null,
                current_team: reg.current_team || null,
                current_level: reg.current_level || null,
                registration_source: 'qr',
                friend1_name: reg.friend1_name || null,
                friend2_name: reg.friend2_name || null,
              })),
            )
            .select('id'),
        );
      },
      onProgress,
    );
  }

  /** Bulk twin of addRegistrationToTeam — same chunked pipeline as addRegistrationsToRoster. */
  async addRegistrationsToTeam(
    teamId: string,
    registrationIds: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    const { supabase, accountId } = await this.ctx();
    return this.placeRegistrations(
      supabase,
      accountId,
      registrationIds,
      async (placed) => {
        // addTeamRosterPlayers already upserts the whole batch in one request.
        await this.addTeamRosterPlayers(
          teamId,
          placed.map(({ reg, athleteId }) => ({
            athleteId,
            pos: reg.position_trying_out_for || undefined,
          })),
        );
      },
      onProgress,
    );
  }

  async dismissRegistration(_tryoutId: string, registrationId: string): Promise<void> {
    const { supabase } = await this.ctx();
    await supabase.from('registrations').update({ status: 'dismissed' }).eq('id', registrationId);
  }

  // ─── Phase 2: Team Builder, AI, Export ──────────────────────────────────────────
  async generateTeamBuilder(tryoutId: string, config: TeamBuilderConfig): Promise<TeamBuilderState> {
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Tryout not found');

    let result: TeamBuilderState;
    if (config.prompt) {
      // Map UUIDs to short IDs to drastically reduce token usage and prevent truncation
      const idMap = new Map<string, string>(); // shortId -> realId
      const realToShort = new Map<string, string>(); // realId -> shortId

      // Pool every evaluation down to one weighted overall + per-category average
      // per player (matches the ranking shown in Roster/Export). Sending this instead
      // of raw eval records (strengths/improve text, dates, evaluator names, one row
      // per session) keeps the payload flat as roster size and eval count grow —
      // otherwise a large roster with multiple sessions per player blows past the
      // model's input token limit.
      const results = computePlayerResults(tryout);
      const resultByPlayerId = new Map(results.map((r) => [r.player.id, r]));

      const shortTryout = {
        ...tryout,
        roster: tryout.roster.map((p, i) => {
          const shortId = `p${i}`;
          idMap.set(shortId, p.id);
          realToShort.set(p.id, shortId);
          return { ...p, id: shortId };
        }),
        rankings: tryout.roster.map((p) => {
          const r = resultByPlayerId.get(p.id);
          return {
            id: realToShort.get(p.id) || p.id,
            overall: r?.overall ?? 0,
            categoryScores: r?.categoryScores ?? {},
            recommendation: r?.latestRecommendation || undefined,
          };
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `evals` isn't optional on Tryout; deleting it here (post-spread) needs a loose cast
      delete (shortTryout as any).evals;

      // Call Claude via edge function
      const { supabase } = await this.ctx();
      const { data, error } = await supabase.functions.invoke('generate-ai-insights', {
        body: { action: 'team_builder', tryout: shortTryout, prompt: config.prompt }
      });
      if (error) {
        throw new Error(error.message);
      }
      if (data?.error) {
        throw new Error(data.message || data.error);
      }

      // Restore real UUIDs
      const restoreIds = (arr: string[] = []) => arr.map((short) => idMap.get(short) || short);
      const posById = new Map(tryout.roster.map((p) => [p.id, p.pos]));

      // Merge Claude's response with local state structure
      result = {
        generatedAt: Date.now(),
        sortMethod: config.sortMethod ?? 'balanced',
        config: {
          teamCount: data.teams?.length || config.teamCount,
          teamNames: data.teams?.map((t: Row) => t.name) || [],
          keepFriendPackages: config.keepFriendPackages ?? true,
          splitGoalies: config.splitGoalies ?? true,
        },
        ranks: [], // We can omit full rankings or compute them locally if needed
        warnings: data.warnings || [],
        explanation: data.explanation,
        teams: (data.teams || []).map((t: Row, i: number) => {
          const players = restoreIds(t.players);
          return {
            index: i,
            id: `ai-team-${i}`,
            name: t.name || `Team ${i + 1}`,
            players,
            skaters: players.filter((id) => !isGoaliePosition(posById.get(id))),
            goalies: players.filter((id) => isGoaliePosition(posById.get(id))),
          };
        }),
        unassigned: restoreIds(data.unassigned),
      };
    } else {
      result = buildTeams(tryout, config);
    }

    await this.updateTryout(tryoutId, { teamBuilder: result });
    return result;
  }

  async listTeamBuilderResults(tryoutId: string): Promise<TeamBuilderResult[]> {
    const { supabase } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('team_builder_results')
        .select('*')
        .eq('tryout_id', tryoutId)
        .order('created_at', { ascending: false }),
    ) as Row[];
    return rows.map((r) => this.rowToTeamBuilderResult(r));
  }

  async saveTeamBuilderResult(tryoutId: string, label: string, state: TeamBuilderState): Promise<TeamBuilderResult> {
    const { supabase, userId } = await this.ctx();
    const row = unwrap(
      await supabase
        .from('team_builder_results')
        .insert({ tryout_id: tryoutId, label, state, created_by: userId })
        .select()
        .single(),
    ) as Row;
    return this.rowToTeamBuilderResult(row);
  }

  async deleteTeamBuilderResult(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('team_builder_results').delete().eq('id', id));
  }

  private rowToTeamBuilderResult(r: Row): TeamBuilderResult {
    return {
      id: r.id,
      tryoutId: r.tryout_id,
      label: r.label,
      state: r.state,
      createdAt: new Date(r.created_at).getTime(),
    };
  }

  async getAiPlayerSummary(tryoutId: string, playerId: string): Promise<AiPlayerSummary> {
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Tryout not found');
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('generate-ai-insights', {
      body: { action: 'summary', tryout, playerIds: [playerId] }
    });
    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, error.message));
    }
    // Edge function returns { error, message } for expected errors (status 200)
    if (data?.error) {
      throw new Error(data.message || data.error);
    }
    const summary = data;
    // Best-effort: cache the AI result on the tryout record.
    // If the current user lacks write permission (e.g. assessor role), the DB
    // update will fail with "Cannot coerce the result to a single JSON object"
    // (PostgREST returns 0 rows when RLS blocks the UPDATE). We don't want that
    // to surface as a user-facing error — the summary was generated successfully.
    try {
      await this.updateTryout(tryoutId, { aiAssessments: { [playerId]: summary } });
    } catch (saveErr) {
      console.warn('AI summary generated but could not be saved to tryout:', saveErr);
    }
    return summary;
  }

  async getAiCompare(tryoutId: string, playerIds: string[]): Promise<AiCompareSummary> {
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Tryout not found');
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('generate-ai-insights', {
      body: { action: 'compare', tryout, playerIds }
    });
    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, error.message));
    }
    // Edge function returns { error, message } for expected errors (status 200)
    if (data?.error) {
      throw new Error(data.message || data.error);
    }
    return data;
  }

  async exportTryout(
    tryoutId: string,
    format: ExportFormat,
  ): Promise<{ content: string; filename: string }> {
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Tryout not found');
    const safeName = tryout.name.replace(/\s+/g, '_').toLowerCase();
    if (format === 'pdf') {
      return {
        content: `PDF Export: ${tryout.name}\nPlayers: ${tryout.roster.length}\nEvaluations: ${tryout.evals.length}`,
        filename: `${safeName}_report.pdf`,
      };
    }
    return {
      content: formatExportCsv(tryout),
      filename: `${safeName}_results.${format === 'xlsx' ? 'xlsx' : 'csv'}`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for DataSource interface parity
  async createShareLink(tryoutId: string, _label?: string): Promise<{ token: string; expiresAt: number }> {
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Tryout not found');
    const token = generateId('share').slice(0, 12);
    const expiresAt = Date.now() + 7 * 86400000;

    // Store in settings to avoid needing a schema migration
    const newSettings = { ...tryout.settings, shareToken: token, shareExpiresAt: expiresAt };
    await this.updateTryout(tryoutId, { settings: newSettings });

    return { token, expiresAt };
  }

  // ─── Phase 3: Seasons ───────────────────────────────────────────────────────────
  private rowToSeasonEvent(
    ev: Row,
    availability: Record<string, string>,
    availabilityUnavailable = false,
  ): SeasonEvent {
    return {
      id: ev.id,
      availabilityUnavailable: availabilityUnavailable || undefined,
      type: EVENT_KIND_FROM_DB[ev.kind] ?? 'Game',
      title: ev.title,
      date: ev.event_date,
      startTime: ev.start_time ?? undefined,
      endTime: ev.end_time ?? undefined,
      location: ev.location ?? undefined,
      notes: ev.notes ?? undefined,
      availability: availability as SeasonEvent['availability'],
      createdAt: toMs(ev.created_at),
      updatedAt: ev.updated_at ? toMs(ev.updated_at) : undefined,
    };
  }

  private rowToSeasonPlayer(r: Row, invites: Row[]): SeasonPlayer {
    const rawAthletes = r.athletes;
    const a = Array.isArray(rawAthletes) ? rawAthletes[0] : rawAthletes ?? {};
    const myInvites = invites.filter((i) => i.athlete_id === a.id);
    return {
      id: r.id,
      // Callers dedupe roster entries by athlete (e.g. syncing a team roster
      // into a season), so this has to survive the mapping.
      athleteId: a.id ?? r.athlete_id ?? undefined,
      firstName: a.first_name ?? '',
      lastName: a.last_name ?? '',
      jersey: r.jersey ?? undefined,
      guardianEmail: a.guardian_email ?? undefined,
      guardianPhone: a.guardian_phone ?? undefined,
      playerEmail: r.player_email ?? undefined,
      portalInviteEmails: myInvites.length ? myInvites.map((i) => i.email) : undefined,
      portalInviteSentAt: myInvites.length
        ? Math.max(...myInvites.map((i) => toMs(i.sent_at)))
        : undefined,
    };
  }

  /**
   * Every RSVP row for a set of events.
   *
   * Prefers the `get_event_availability` RPC, for exactly the reason
   * getGuardianRosters() prefers `get_guardian_rosters`: reading this table
   * directly makes Postgres evaluate the row-level policy once per RSVP row,
   * and on a full-roster event that overruns the statement timeout (57014)
   * before any rows come back. Client-side paging does not help — the policy
   * runs on candidate rows *before* the LIMIT applies, so `limit=500` on a
   * single event times out exactly as an unbounded read does. The RPC
   * authorizes once per event instead of once per row.
   *
   * Returns `failed: true` rather than throwing when the read didn't work.
   * Reporting zero RSVPs and "nobody was invited" for what is really a failed
   * read is the worse outcome: it reads as data loss to a coach who just
   * invited a full roster.
   */
  private async fetchEventAvailability(
    supabase: SupabaseClient,
    eventIds: string[],
  ): Promise<{ rows: Row[]; failed: boolean }> {
    if (eventIds.length === 0) return { rows: [], failed: false };

    const { data, error } = await supabase.rpc('get_event_availability', { p_event_ids: eventIds });
    if (!error) return { rows: (data as Row[]) ?? [], failed: false };

    const missingFunction = error.code === 'PGRST202' || error.code === '42883';
    if (!missingFunction) {
      console.error('get_event_availability failed:', error);
      return { rows: [], failed: true };
    }
    console.warn('get_event_availability() not deployed — trying the embedded read.');

    // Attempt 2: read the rows as an embed hanging off season_events instead of
    // filtering event_availability directly.
    //
    // Same statement, different plan. In the direct form the `season_event_id`
    // filter is an ordinary user qual, and Postgres evaluates the table's
    // row-level policy *ahead* of it — which is why narrowing to `limit=25` on a
    // single event still ran the full 8s and got killed. As an embed, PostgREST
    // emits a LATERAL keyed on `season_events.id`, so the FK is a join condition
    // that can drive the scan before the policy is applied to what survives.
    // This is the shape that makes the comparable evaluations +
    // evaluation_scores read return ~900 rows in under a second.
    const embedded = await this.fetchAvailabilityViaEvents(supabase, eventIds);
    if (embedded.ok) return { rows: embedded.rows, failed: false };

    const eventChunks: string[][] = [];
    for (let i = 0; i < eventIds.length; i += EVENT_AVAILABILITY_EVENT_CHUNK) {
      eventChunks.push(eventIds.slice(i, i + EVENT_AVAILABILITY_EVENT_CHUNK));
    }
    let failed = false;
    const chunks = await mapPool(eventChunks, REGISTRATION_CHUNK_CONCURRENCY, async (chunk) => {
      const { rows, complete } = await this.readAvailabilityChunk(supabase, chunk);
      if (!complete) failed = true;
      return rows;
    });
    return { rows: chunks.flat(), failed };
  }

  /**
   * RSVP rows read as an embed on their parent event.
   *
   * Only the three fields the callers actually use are selected — the rest of
   * the row is dead weight through a LATERAL. Returns `ok: false` on any error
   * so the caller can fall through to the direct read rather than this becoming
   * another way to silently report zero RSVPs.
   */
  private async fetchAvailabilityViaEvents(
    supabase: SupabaseClient,
    eventIds: string[],
  ): Promise<{ rows: Row[]; ok: boolean }> {
    const rows: Row[] = [];
    const chunks: string[][] = [];
    for (let i = 0; i < eventIds.length; i += EVENT_AVAILABILITY_EVENT_CHUNK) {
      chunks.push(eventIds.slice(i, i + EVENT_AVAILABILITY_EVENT_CHUNK));
    }

    try {
      const parentChunks = await mapPool(chunks, REGISTRATION_CHUNK_CONCURRENCY, (chunk) =>
        fetchAllByIn(supabase, 'season_events', 'id, event_availability(roster_id, response)', 'id', chunk),
      );
      for (const parent of parentChunks.flat()) {
        for (const a of (parent.event_availability ?? []) as Row[]) {
          // Flattened back into the row shape the direct read returns, so the
          // caller can't tell which path produced it.
          rows.push({ season_event_id: parent.id, roster_id: a.roster_id, response: a.response });
        }
      }
      return { rows, ok: true };
    } catch (e) {
      console.warn('Embedded event_availability read failed; falling back to the direct read.', e);
      return { rows: [], ok: false };
    }
  }

  /**
   * One chunk of events' RSVP rows, paged.
   *
   * Deliberately does *not* retry a statement timeout (57014) at a smaller page
   * size. That was tried and measured: on a full-roster event `limit=25` for a
   * single event times out at the full 8s exactly as an unbounded read does,
   * because the row-level policy on this table is evaluated across the table
   * before the caller's filter and LIMIT are applied. Narrowing the window buys
   * nothing and only multiplies the time spent failing, so this fails on the
   * first timeout and lets the UI say so. The real fix is get_event_availability
   * (see supabase/migrations) or an index that lets the filter run first.
   *
   * Whatever pages did land are kept. A partial RSVP list is more use to a coach
   * than an empty one, so `complete` reports the shortfall instead of the rows
   * being thrown away.
   */
  private async readAvailabilityChunk(
    supabase: SupabaseClient,
    eventIds: string[],
  ): Promise<{ rows: Row[]; complete: boolean }> {
    const rows: Row[] = [];
    let from = 0;

    for (;;) {
      try {
        const page = (unwrap(
          await supabase
            .from('event_availability')
            .select('*')
            .in('season_event_id', eventIds)
            // Offset paging needs a total order or pages silently overlap and
            // skip — the same trap documented on the team_roster read. This
            // pair is the table's unique key, so it orders rows completely.
            .order('season_event_id', { ascending: true })
            .order('roster_id', { ascending: true })
            .range(from, from + EVENT_AVAILABILITY_PAGE - 1),
        ) ?? []) as Row[];

        rows.push(...page);
        if (page.length < EVENT_AVAILABILITY_PAGE) return { rows, complete: true };
        from += EVENT_AVAILABILITY_PAGE;
      } catch (e) {
        if ((e as { code?: string } | undefined)?.code === '57014') {
          console.error(
            'event_availability read hit the statement timeout. This is a database-side problem — ' +
              'the row-level policy runs before the season_event_id filter. Apply ' +
              'supabase/migrations/20260821000000_event_availability_indexes.sql.',
          );
        } else {
          console.error('Failed to read event_availability', e);
        }
        return { rows, complete: false };
      }
    }
  }

  private async assembleSeasons(seasonRows: Row[], withDetail: boolean): Promise<Season[]> {
    if (seasonRows.length === 0) return [];
    const supabase = getSupabase();
    const ids = seasonRows.map((s) => s.id);

    const [eventsRes, rosterRes] = await Promise.all([
      supabase.from('season_events').select('*').in('season_id', ids).order('event_date'),
      supabase.from('season_roster').select('*, athletes(*)').in('season_id', ids),
    ]);
    const eventRows = unwrap(eventsRes) as Row[];
    const rosterRows = unwrap(rosterRes) as Row[];

    let availabilityRows: Row[] = [];
    let availabilityFailed = false;
    let inviteRows: Row[] = [];
    if (withDetail) {
      const eventIds = eventRows.map((e) => e.id as string);
      const [avail, invRes] = await Promise.all([
        this.fetchEventAvailability(supabase, eventIds),
        supabase.from('portal_invites').select('*').in('season_id', ids),
      ]);
      availabilityRows = avail.rows;
      availabilityFailed = avail.failed;
      inviteRows = unwrap(invRes) as Row[];
    }

    const eventsBySeason: Record<string, Row[]> = {};
    for (const e of eventRows) (eventsBySeason[e.season_id] ??= []).push(e);
    const rosterBySeason: Record<string, Row[]> = {};
    for (const r of rosterRows) (rosterBySeason[r.season_id] ??= []).push(r);
    const availByEvent: Record<string, Record<string, string>> = {};
    // Indexed once rather than a .find() per availability row — that scan was
    // O(roster × RSVPs), which for a full-roster event on a large team is a
    // million comparisons on the main thread before anything renders.
    const rosterById = new Map(rosterRows.map((r) => [r.id, r]));
    for (const a of availabilityRows) {
      const rosterItem = rosterById.get(a.roster_id);
      if (rosterItem) {
        if (rosterItem.athlete_id) {
          (availByEvent[a.season_event_id] ??= {})[rosterItem.athlete_id] = a.response;
        }
        (availByEvent[a.season_event_id] ??= {})[rosterItem.id] = a.response;
      } else {
        (availByEvent[a.season_event_id] ??= {})[a.roster_id] = a.response;
      }
    }

    return seasonRows.map((s) => ({
      id: s.id,
      name: s.name,
      teamName: s.team_name,
      sport: s.sport,
      year: s.year ?? undefined,
      division: s.division ?? undefined,
      coach: s.coach ?? undefined,
      teamId: s.team_id ?? undefined,
      events: (eventsBySeason[s.id] ?? []).map((ev) =>
        this.rowToSeasonEvent(ev, availByEvent[ev.id] ?? {}, availabilityFailed),
      ),
      roster: (rosterBySeason[s.id] ?? []).map((r) => this.rowToSeasonPlayer(r, inviteRows)),
      scheduleShareToken: s.schedule_share_token ?? undefined,
      createdAt: toMs(s.created_at),
      updatedAt: toMs(s.updated_at),
      archived: s.archived || undefined,
    })) as Season[];
  }

  async listSeasons(): Promise<Season[]> {
    const { supabase, accountId } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('seasons')
        .select('*')
        .eq('account_id', accountId)
        .eq('archived', false)
        .order('created_at', { ascending: false }),
    ) as Row[];

    // Mirrors listTryouts()'s managed/owned-team merge (CLUB mode): a season
    // for a delegated team can live under either side's account_id depending
    // on who created it, so the plain account-scoped query above can't see
    // it alone.
    const { data: managedRows, error: managedErr } = await supabase.rpc('list_seasons_for_managed_teams');
    if (managedErr) {
      console.log('list_seasons_for_managed_teams unavailable:', managedErr.message);
      return this.assembleSeasons(rows, true);
    }
    const { data: ownedTeamRows, error: ownedErr } = await supabase.rpc('list_seasons_on_my_owned_teams');
    if (ownedErr) {
      console.log('list_seasons_on_my_owned_teams unavailable:', ownedErr.message);
    }

    const ownIds = new Set(rows.map((s) => s.id));
    const managed = ((managedRows ?? []) as Row[]).filter((s) => !ownIds.has(s.id));
    const onOwnedTeams = ((ownedTeamRows ?? []) as Row[]).filter(
      (s) => !ownIds.has(s.id) && !managed.some((m) => m.id === s.id),
    );

    return this.assembleSeasons([...rows, ...managed, ...onOwnedTeams], true);
  }

  /**
   * The Teams list's read — see SeasonSummary. Same three row sources as
   * listSeasons(), but instead of assembleSeasons() pulling every event, every
   * roster entry (each joined to its full athlete row), RSVP availability and
   * portal invite in the account, this counts rows off one single-column
   * query. The card only shows an event count from here; its headcount comes
   * from countTeamPlayers(), off the team roster.
   */
  async listSeasonSummaries(): Promise<SeasonSummary[]> {
    const { supabase, accountId } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('seasons')
        .select('id, team_id')
        .eq('account_id', accountId)
        .eq('archived', false)
        // Newest first, same as listSeasons(). The Teams page picks a team's
        // season with `.find()`, so without an order a team with more than one
        // season showed whichever row Postgres happened to return first.
        .order('created_at', { ascending: false }),
    ) as Row[];

    const [managedRes, ownedTeamRes] = await Promise.all([
      supabase.rpc('list_seasons_for_managed_teams'),
      supabase.rpc('list_seasons_on_my_owned_teams'),
    ]);
    if (managedRes.error) console.log('list_seasons_for_managed_teams unavailable:', managedRes.error.message);
    if (ownedTeamRes.error) console.log('list_seasons_on_my_owned_teams unavailable:', ownedTeamRes.error.message);

    const ownIds = new Set(rows.map((s) => s.id as string));
    const extra: Row[] = [];
    for (const source of [managedRes.data, ownedTeamRes.data]) {
      for (const s of (source ?? []) as Row[]) {
        if (ownIds.has(s.id) || extra.some((e) => e.id === s.id)) continue;
        extra.push(s);
      }
    }
    const allRows = [...rows, ...extra];
    if (allRows.length === 0) return [];

    const ids = allRows.map((s) => s.id as string);
    // `id` rides along only because keyset paging orders by it; the count
    // below reads nothing but season_id.
    const eventRows = await fetchAllByIn(supabase, 'season_events', 'id, season_id', 'season_id', ids);

    const eventCountBySeason: Record<string, number> = {};
    for (const e of eventRows) eventCountBySeason[e.season_id] = (eventCountBySeason[e.season_id] ?? 0) + 1;

    return allRows.map((s) => ({
      id: s.id as string,
      teamId: (s.team_id as string | null) ?? undefined,
      eventCount: eventCountBySeason[s.id as string] ?? 0,
    }));
  }

  async getSeason(id: string): Promise<Season | null> {
    await this.ctx();
    const supabase = getSupabase();
    const row = (await supabase.from('seasons').select('*').eq('id', id).maybeSingle()).data as Row | null;
    if (!row) return null;
    const [assembled] = await this.assembleSeasons([row], true);
    return assembled ?? null;
  }

  async createSeason(form: CreateSeasonForm): Promise<Season> {
    const { supabase, accountId } = await this.ctx();
    const row = unwrap(
      await supabase
        .from('seasons')
        .insert({
          account_id: accountId,
          team_id: form.teamId ?? null,
          name: form.name,
          team_name: form.teamName,
          sport: form.sport,
          year: form.year ?? null,
          division: form.division ?? null,
          coach: form.coach ?? null,
          schedule_share_token: generateId('sched').slice(0, 16),
        })
        .select()
        .single(),
    ) as Row;

    const seasonId = row.id;

    if (form.teamId) {
      // Find all tryouts linked to this team
      const { data: tryouts } = await supabase
        .from('tryouts')
        .select('id')
        .eq('team_id', form.teamId);

      if (tryouts && tryouts.length > 0) {
        const tryoutIds = tryouts.map((t) => t.id);
        // Find all unique participants in these tryouts
        const { data: participants } = await supabase
          .from('tryout_participants')
          .select('athlete_id, jersey')
          .in('tryout_id', tryoutIds)
          .is('removed_at', null);

        if (participants && participants.length > 0) {
          // De-duplicate by athlete_id
          const uniqueAthletes = new Map<string, string | null>();
          for (const p of participants) {
            if (p.athlete_id) {
              // Prefer keeping a jersey number if one exists
              if (!uniqueAthletes.has(p.athlete_id) || p.jersey) {
                uniqueAthletes.set(p.athlete_id, p.jersey);
              }
            }
          }

          const rosterInserts = Array.from(uniqueAthletes.entries()).map(([athleteId, jersey]) => ({
            season_id: seasonId,
            athlete_id: athleteId,
            jersey: jersey || null,
          }));

          if (rosterInserts.length > 0) {
            unwrap(await supabase.from('season_roster').insert(rosterInserts).select());
          }
        }
      }
    }

    const [assembled] = await this.assembleSeasons([row], true);
    return assembled;
  }

  async updateSeason(id: string, updates: Partial<Season>): Promise<Season> {
    const { supabase } = await this.ctx();
    const patch: Row = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.teamName !== undefined) patch.team_name = updates.teamName;
    if (updates.sport !== undefined) patch.sport = updates.sport;
    if (updates.year !== undefined) patch.year = updates.year || null;
    if (updates.division !== undefined) patch.division = updates.division || null;
    if (updates.coach !== undefined) patch.coach = updates.coach || null;
    if (updates.teamId !== undefined) patch.team_id = updates.teamId || null;
    if (updates.archived !== undefined) patch.archived = updates.archived;
    if (Object.keys(patch).length) {
      unwrap(await supabase.from('seasons').update(patch).eq('id', id).select().single());
    }
    const result = await this.getSeason(id);
    if (!result) throw new Error('Season not found');
    return result;
  }

  async deleteSeason(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('seasons').delete().eq('id', id).select().maybeSingle());
  }

  async addSeasonEvent(
    seasonId: string,
    form: CreateEventForm,
    onProgress?: (done: number, total: number) => void,
  ): Promise<SeasonEvent> {
    const { supabase } = await this.ctx();
    const row = unwrap(
      await supabase
        .from('season_events')
        .insert({
          season_id: seasonId,
          kind: EVENT_KIND_TO_DB[form.type] ?? 'game',
          title: form.title,
          event_date: form.date,
          // Same empty-string guard as _createTryout — the schema requires
          // `date`, but both times are optional and submit as ''.
          start_time: form.startTime || null,
          end_time: form.endTime || null,
          location: form.location ?? null,
          notes: form.notes ?? null,
        })
        .select()
        .single(),
    ) as Row;

    const eventId = row.id;

    const season = await this.getSeason(seasonId);
    if (season) {
      // Which players are invited. An *absent* `playerIds` means "no selection
      // was made" and falls back to the whole season roster; an empty array is
      // a selection of nobody and is honoured as one. The two were conflated,
      // which meant a caller that correctly resolved to zero invitees — a team
      // whose roster is empty, or a coach who deselected everyone — silently
      // invited the entire season roster instead, including athletes who only
      // ever tried out and players since removed from the team.
      const selectedPlayerIds = form.playerIds ?? season.roster.map(p => p.id);

      // Pre-populate event_availability for these players. This is what later
      // gates who receives schedule/reminder emails, so a failure here must
      // surface — don't swallow it, or the event silently ends up with no
      // recipients even though players are attached.
      //
      // Chunked and pooled rather than one INSERT for the whole roster: this
      // hit the exact same wall as the team-roster read (TEAM_ROSTER_PAGE) and
      // registration placement (REGISTRATION_CHUNK) — PostgREST evaluates the
      // insert policy per row, so a single statement for a large team's roster
      // outran the statement timeout, threw, and aborted everything after it
      // (including the invite emails below) before a single row landed. That's
      // what produced an event with nobody invited and no visible explanation
      // beyond a generic "Could not save the event" alert. Only surface an
      // error now if every chunk failed — a slow chunk for 20 of 1,000 players
      // must not cost the other 980 their invites.
      const availInserts = season.roster
        .filter(p => selectedPlayerIds.includes(p.id))
        .map(p => ({
          season_event_id: eventId,
          roster_id: p.id,
          response: 'pending' as const,
        }));

      if (availInserts.length > 0) {
        const chunks: (typeof availInserts)[] = [];
        for (let i = 0; i < availInserts.length; i += REGISTRATION_CHUNK) {
          chunks.push(availInserts.slice(i, i + REGISTRATION_CHUNK));
        }
        let failedRows = 0;
        await mapPool(chunks, REGISTRATION_CHUNK_CONCURRENCY, async (chunk) => {
          try {
            unwrap(await supabase.from('event_availability').insert(chunk));
          } catch (e) {
            failedRows += chunk.length;
            console.error('Failed to insert an event_availability chunk', e);
          }
        });
        if (failedRows === availInserts.length) {
          throw new Error('Could not invite any players to this event. Please try again.');
        }
      }

      // Find all guardians related to the selected players and send them emails.
      // Fanned out through the same bounded pool as the other guardian-email
      // sends (GUARDIAN_EMAIL_CONCURRENCY): each is a network call to the
      // send-email edge function, so a large roster sent one at a time was the
      // dominant cost of creating an event — a 1,000-player team spent minutes
      // here alone. Emailing is best-effort per guardian, not for the batch as
      // a whole — one bounce or transient function error must not cost every
      // other guardian their invite.
      const emails = Array.from(new Set(
        season.roster
          .filter(p => selectedPlayerIds.includes(p.id))
          .map(p => p.guardianEmail)
          .filter((e): e is string => !!e)
      ));

      onProgress?.(0, emails.length);
      let sent = 0;
      await mapPool(emails, GUARDIAN_EMAIL_CONCURRENCY, async (email) => {
        try {
          await this.sendEmail('schedule_update', email, {
            eventName: form.title,
            date: form.date,
            time: form.startTime,
            location: form.location,
          });
        } catch (e) {
          console.error('Failed to send schedule email to', email, e);
        } finally {
          onProgress?.(++sent, emails.length);
        }
      });
    }

    return this.rowToSeasonEvent(row, {});
  }

  async updateSeasonEvent(
    seasonId: string,
    eventId: string,
    updates: Partial<SeasonEvent>,
  ): Promise<SeasonEvent> {
    const { supabase } = await this.ctx();
    const patch: Row = {};
    if (updates.type !== undefined) patch.kind = EVENT_KIND_TO_DB[updates.type];
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.date !== undefined) patch.event_date = updates.date;
    if (updates.startTime !== undefined) patch.start_time = updates.startTime || null;
    if (updates.endTime !== undefined) patch.end_time = updates.endTime || null;
    if (updates.location !== undefined) patch.location = updates.location || null;
    if (updates.notes !== undefined) patch.notes = updates.notes || null;
    const row = unwrap(
      await supabase.from('season_events').update(patch).eq('id', eventId).select().single(),
    ) as Row;

    try {
      const { data: availPlayers } = await supabase
        .from('event_availability')
        .select(`
          roster_id,
          season_roster(
            player_email,
            athletes(
              guardian_email
            )
          )
        `)
        .eq('season_event_id', eventId);

      const playerEmails = new Set<string>();
      const guardianEmails = new Set<string>();

      if (availPlayers) {
        for (const item of availPlayers) {
          const sr = Array.isArray(item.season_roster) ? item.season_roster[0] : item.season_roster;
          if (sr) {
            if (sr.player_email) playerEmails.add(sr.player_email);
            const athlete = Array.isArray(sr.athletes) ? sr.athletes[0] : sr.athletes;
            if (athlete?.guardian_email) guardianEmails.add(athlete.guardian_email);
          }
        }
      }

      const allEmails = new Set([...playerEmails, ...guardianEmails]);

      if (playerEmails.size > 0) {
        supabase.functions.invoke('send-push-notification', {
          body: { target_user_ids: Array.from(playerEmails), heading: `Schedule Update: ${row.title}`, content: `Event updated to ${row.event_date}.` }
        }).catch(console.error);
      }

      for (const email of allEmails) {
        supabase.functions.invoke('send-email', {
          body: { type: 'schedule_update', to: email, payload: { eventName: row.title, date: row.event_date, time: row.start_time, location: row.location } }
        }).catch(console.error);
      }
    } catch (e) {
      console.error('Failed to send update emails', e);
    }

    return this.rowToSeasonEvent(row, {});
  }

  async deleteSeasonEvent(_seasonId: string, eventId: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('season_events').delete().eq('id', eventId).select().maybeSingle());
  }

  async addSeasonPlayer(seasonId: string, player: Omit<SeasonPlayer, 'id'>): Promise<SeasonPlayer> {
    const { supabase, accountId } = await this.ctx();
    const athleteId = player.athleteId || await this.createAthlete(accountId, {
      first_name: player.firstName,
      last_name: player.lastName,
      guardian_email: player.guardianEmail || null,
      guardian_phone: player.guardianPhone || null,
    });
    const row = unwrap(
      await supabase
        .from('season_roster')
        .insert({
          season_id: seasonId,
          athlete_id: athleteId,
          jersey: player.jersey || null,
          player_email: player.playerEmail || null,
        })
        .select('*, athletes(*)')
        .single(),
    ) as Row;
    return this.rowToSeasonPlayer(row, []);
  }

  async deleteSeasonPlayer(_seasonId: string, playerId: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(
      await supabase.from('season_roster').delete().eq('id', playerId).select().maybeSingle(),
    );
  }

  async importSeasonPlayersFromTeam(seasonId: string): Promise<SeasonPlayer[]> {
    const { supabase } = await this.ctx();
    const seasonRow = unwrap(
      await supabase.from('seasons').select('team_id').eq('id', seasonId).single()
    ) as Row;

    const teamId = seasonRow.team_id;
    if (!teamId) {
      throw new Error('No team linked to this season');
    }

    const { data: tryouts } = await supabase
      .from('tryouts')
      .select('id')
      .eq('team_id', teamId);

    if (!tryouts || tryouts.length === 0) {
      return [];
    }

    const tryoutIds = tryouts.map((t) => t.id);

    const { data: participants } = await supabase
      .from('tryout_participants')
      .select('athlete_id, jersey')
      .in('tryout_id', tryoutIds)
      .is('removed_at', null);

    if (!participants || participants.length === 0) {
      return [];
    }

    const { data: existingRoster } = await supabase
      .from('season_roster')
      .select('athlete_id')
      .eq('season_id', seasonId);

    const existingAthleteIds = new Set(existingRoster?.map((r) => r.athlete_id) || []);

    const uniqueAthletes = new Map<string, string | null>();
    for (const p of participants) {
      if (p.athlete_id && !existingAthleteIds.has(p.athlete_id)) {
        if (!uniqueAthletes.has(p.athlete_id) || p.jersey) {
          uniqueAthletes.set(p.athlete_id, p.jersey);
        }
      }
    }

    const rosterInserts = Array.from(uniqueAthletes.entries()).map(([athleteId, jersey]) => ({
      season_id: seasonId,
      athlete_id: athleteId,
      jersey: jersey || null,
    }));

    if (rosterInserts.length > 0) {
      unwrap(await supabase.from('season_roster').insert(rosterInserts).select());
    }

    const updatedSeason = await this.getSeason(seasonId);
    return updatedSeason?.roster || [];
  }

  async emailScheduleToPlayers(seasonId: string): Promise<void> {
    const { supabase } = await this.ctx();
    const season = await this.getSeason(seasonId);
    if (!season) throw new Error('Season not found');

    // Get all roster IDs that are assigned to at least one event in this season
    const eventIds = season.events.map(e => e.id);
    // Shares the RPC-then-shrinking-pages reader, so a season whose RSVPs only
    // come back in small windows still resolves its recipients here.
    const { rows: availRows } = await this.fetchEventAvailability(supabase, eventIds);
    const availData = availRows as { roster_id: string }[];

    const assignedRosterIds = new Set(availData.map((a) => a.roster_id));

    // Restrict to players assigned to an event. If no availability rows exist at
    // all (e.g. events created before availability was pre-populated, or a failed
    // pre-population), fall back to the full roster so players who have emails
    // still receive the schedule instead of silently getting nothing.
    const restrictToAssigned = assignedRosterIds.size > 0;

    const emails = new Set<string>();
    for (const p of season.roster) {
      if (!restrictToAssigned || assignedRosterIds.has(p.id)) {
        if (p.playerEmail) emails.add(p.playerEmail);
        if (p.guardianEmail) emails.add(p.guardianEmail);
        if (p.portalInviteEmails) {
          for (const e of p.portalInviteEmails) if (e) emails.add(e);
        }
      }
    }

    if (emails.size === 0) {
      throw new Error('No player or guardian emails found for players added to scheduled events.');
    }

    const scheduleUrl = `https://aas-tryout.app/?schedule=${season.scheduleShareToken}`;

    for (const email of emails) {
      await supabase.functions.invoke('send-email', {
        body: {
          type: 'schedule_update',
          to: email,
          payload: {
            eventName: `Public Schedule for ${season.teamName}`,
            date: 'View online',
            time: scheduleUrl,
            location: 'Online Portal'
          }
        }
      });
    }
  }



  async sendPortalInvite(seasonId: string, playerId: string, email: string): Promise<void> {
    const { supabase, accountId } = await this.ctx();
    const roster = unwrap(
      await supabase.from('season_roster').select('athlete_id').eq('id', playerId).single(),
    ) as Row;
    const token = generateId('invite').slice(0, 20);
    await supabase.from('portal_invites').insert({
      account_id: accountId,
      athlete_id: roster.athlete_id,
      season_id: seasonId,
      email,
      token,
    });
    const { error } = await supabase.functions.invoke('send-email', {
      body: { type: 'org_invite', to: email, payload: { role: 'Guardian/Player' } }
    });
    if (error) {
      let msg = error.message;
      try {
        const body = await error.context.json();
        if (body?.error) msg = body.error;
      } catch { }
      throw new Error(msg);
    }
  }

  async sendTeamAnnouncement(seasonId: string, title: string, message: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { data } = await supabase.from('season_roster').select('player_email').eq('season_id', seasonId);
    const emails = data?.map((r) => r.player_email).filter(Boolean) || [];
    if (emails.length > 0) {
      supabase.functions.invoke('send-push-notification', {
        body: { target_user_ids: emails, heading: `Announcement: ${title}`, content: message }
      }).catch(console.error);

      for (const email of emails) {
        supabase.functions.invoke('send-email', {
          body: { type: 'reminder', to: email, payload: { title, message } }
        }).catch(console.error);
      }
    }
  }

  private mapTeamMessage(row: Row): TeamMessage {
    return {
      id: row.id,
      seasonId: row.season_id,
      authorUserId: row.author_user_id,
      authorName: row.author_name,
      authorRole: row.author_role,
      body: row.body,
      createdAt: toMs(row.created_at),
    };
  }

  // userCtx() rather than ctx(): a guardian has no staff account of their own,
  // and RLS here keys off can_access_season(), not the caller's account.
  async listTeamMessages(seasonId: string): Promise<TeamMessage[]> {
    const { supabase } = await this.userCtx();
    // Newest-first with a cap so a long-running team's history doesn't grow
    // unbounded on the wire; reversed to chronological for display.
    const rows = unwrap(
      await supabase
        .from('season_messages')
        .select('*')
        .eq('season_id', seasonId)
        .order('created_at', { ascending: false })
        .limit(200),
    ) as Row[] | null;
    return (rows ?? []).reverse().map((row) => this.mapTeamMessage(row));
  }

  async sendTeamMessage(seasonId: string, body: string): Promise<TeamMessage> {
    const { supabase } = await this.userCtx();
    // author_name/author_role are derived inside the function — see the
    // season_messages migration for why clients can't insert directly.
    const data = unwrap(
      await supabase.rpc('send_season_message', { p_season_id: seasonId, p_body: body }),
    );
    const row = Array.isArray(data) ? data[0] : data;
    return this.mapTeamMessage(row as Row);
  }

  async deleteTeamMessage(messageId: string): Promise<void> {
    const { supabase } = await this.userCtx();
    // `.select()` is load-bearing: a DELETE that RLS filters down to zero rows
    // comes back with no error and no data, so without it a blocked delete is
    // indistinguishable from a successful one — the caller invalidates, refetches,
    // and the message is simply still there with nothing shown to the user. Same
    // silent-no-op trap as the assessor `.delete()` documented in TODO.md 1a.
    const rows = unwrap(
      await supabase.from('season_messages').delete().eq('id', messageId).select('id'),
    ) as Row[] | null;
    if (!rows || rows.length === 0) {
      throw new Error(
        'That message could not be removed. season_messages_delete only allows the message author, ' +
          'or an owner/admin/coach on the account that owns this season.',
      );
    }
  }

  async listAthletes(): Promise<Athlete[]> {
    const { supabase, accountId } = await this.ctx();
    const { data: athletes } = await supabase
      .from('athletes')
      .select('*, tryout_participants(current_team, current_level, jersey, created_at)')
      .eq('account_id', accountId)
      .order('first_name', { ascending: true });

    if (!athletes) return [];

    return athletes.map(a => {
      const parts = (a.tryout_participants as Row[])?.sort((p1, p2) =>
        new Date(p1.created_at).getTime() - new Date(p2.created_at).getTime()
      ) || [];
      const recentPart = parts.length > 0 ? parts[parts.length - 1] : null;

      return {
        id: a.id,
        first: a.first_name ?? '',
        last: a.last_name ?? '',
        yearOfBirth: a.year_of_birth != null ? String(a.year_of_birth) : undefined,
        guardianName: a.guardian_name ?? undefined,
        guardianEmail: a.guardian_email ?? undefined,
        guardianPhone: a.guardian_phone ?? undefined,
        medicalInfo: a.medical_info ?? undefined,
        aboutChild: a.about ?? undefined,
        currentPosition: a.default_position ?? undefined,
        currentTeam: recentPart?.current_team ?? undefined,
        currentLevel: recentPart?.current_level ?? undefined,
        jersey: recentPart?.jersey ?? undefined,
        pastSeasonsCount: parts.length,
      };
    });
  }

  async getAthleteHistory(athleteId: string): Promise<AthleteHistory> {
    const { supabase } = await this.ctx();

    // 1. Fetch past seasons
    const { data: rosterRows } = await supabase
      .from('season_roster')
      .select('season_id, seasons(name, team_name)')
      .eq('athlete_id', athleteId);

    let pastSeasons = (rosterRows || []).map((r) => {
      const season = Array.isArray(r.seasons) ? r.seasons[0] : r.seasons;
      return {
        seasonId: r.season_id,
        seasonName: season?.name || 'Unknown Season',
        teamName: season?.team_name || 'Unknown Team',
      };
    });

    if (pastSeasons.length > 0) {
      const seasonIds = pastSeasons.map((s) => s.seasonId);
      const { data: eventsData } = await supabase
        .from('season_events')
        .select('season_id')
        .in('season_id', seasonIds);

      const seasonsWithEvents = new Set((eventsData || []).map((e) => e.season_id));
      pastSeasons = pastSeasons.filter((s) => seasonsWithEvents.has(s.seasonId));
    }

    // 2. Fetch past evaluations across tryouts
    const { data: tryoutRosterRows } = await supabase
      .from('tryout_participants')
      .select('id')
      .eq('athlete_id', athleteId);

    let pastEvaluations: Evaluation[] = [];
    if (tryoutRosterRows && tryoutRosterRows.length > 0) {
      const rosterIds = tryoutRosterRows.map(r => r.id);
      const { data: evals } = await supabase
        .from('evaluations')
        .select('*, evaluation_scores(rubric_key, value)')
        .in('participant_id', rosterIds);
      if (evals) {
        pastEvaluations = evals.map(e => this.rowToEval(e));
      }
    }

    return {
      athleteId,
      pastSeasons,
      pastEvaluations,
    };
  }

  /**
   * Everything getPlayerProfile needs to describe an athlete's assessment
   * history — pulled out on its own so other callers (e.g. a future share
   * snapshot) can reuse the exact same aggregation instead of duplicating it.
   */
  private async fetchAthleteAssessmentContext(
    supabase: SupabaseClient,
    athleteId: string,
  ): Promise<{
    participants: Row[];
    tryoutById: Map<string, Row>;
    teams: { teamId: string; teamName: string }[];
    assessments: PlayerProfileAssessment[];
  }> {
    const { data: participantRows } = await supabase
      .from('tryout_participants')
      .select('id, tryout_id, jersey, position, current_team, current_level, created_at')
      .eq('athlete_id', athleteId)
      .is('removed_at', null);
    const participants = participantRows ?? [];

    const tryoutIds = [...new Set(participants.map((p) => p.tryout_id))];
    const { data: tryoutRows } = tryoutIds.length
      ? await supabase
          .from('tryouts')
          .select('id, name, sport, settings, tryout_date, created_at, event_type, season_id, team_id, teams(name)')
          .in('id', tryoutIds)
          .is('deleted_at', null)
      : { data: [] as Row[] };
    const tryoutById = new Map((tryoutRows ?? []).map((t) => [t.id, t]));

    // A tryout's `season_id` column is only ever set when it's created from
    // inside a Season Hub screen. What every team-linked assessment DOES have
    // is the Season Hub entry auto-created alongside its team (see
    // createTeam/team/new), which is what actually carries season identity here.
    const tryoutTeamIds = [...new Set((tryoutRows ?? []).map((t) => t.team_id).filter(Boolean))];
    const tryoutSeasonIds = [...new Set((tryoutRows ?? []).map((t) => t.season_id).filter(Boolean))];

    const allSeasons: Row[] = [];
    if (tryoutTeamIds.length > 0) {
      const { data } = await supabase
        .from('seasons')
        .select('id, name, team_id, created_at')
        .in('team_id', tryoutTeamIds)
        .order('created_at', { ascending: false });
      if (data) allSeasons.push(...data);
    }
    if (tryoutSeasonIds.length > 0) {
      const alreadyFetchedIds = new Set(allSeasons.map((s) => s.id));
      const remainingSeasonIds = tryoutSeasonIds.filter((id) => !alreadyFetchedIds.has(id));
      if (remainingSeasonIds.length > 0) {
        const { data } = await supabase.from('seasons').select('id, name, team_id, created_at').in('id', remainingSeasonIds);
        if (data) allSeasons.push(...data);
      }
    }
    allSeasons.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const seasonsByTeamId = new Map<string, Row[]>();
    const seasonById = new Map<string, { id: string; name: string }>();
    for (const s of allSeasons) {
      if (s.team_id) {
        const arr = seasonsByTeamId.get(s.team_id) || [];
        arr.push(s);
        seasonsByTeamId.set(s.team_id, arr);
      }
      if (!seasonById.has(s.id)) seasonById.set(s.id, { id: s.id, name: s.name });
    }

    // Actual team membership (Teams feature) — the source of truth for "current
    // team", since tryout_participants.current_team is a free-text field that's
    // usually left blank.
    const { data: teamRosterRows } = await supabase
      .from('team_roster')
      .select('team_id, created_at, teams(name)')
      .eq('athlete_id', athleteId)
      .order('created_at', { ascending: false });
    const teamRoster = teamRosterRows ?? [];
    const teams = [
      ...new Map(
        teamRoster.map((r) => {
          const t = Array.isArray(r.teams) ? r.teams[0] : r.teams;
          return [r.team_id, { teamId: r.team_id, teamName: t?.name ?? 'Unknown Team' }];
        }),
      ).values(),
    ];

    const participantIds = participants.map((p) => p.id);
    const { data: evalRows } = participantIds.length
      ? await supabase
          .from('evaluations')
          .select('*, evaluation_scores(rubric_key, value)')
          .in('participant_id', participantIds)
      : { data: [] as Row[] };
    const evalsByParticipant = new Map<string, Evaluation[]>();
    for (const row of evalRows ?? []) {
      const ev = this.rowToEval(row);
      const arr = evalsByParticipant.get(ev.playerId) ?? [];
      arr.push(ev);
      evalsByParticipant.set(ev.playerId, arr);
    }

    const assessments: PlayerProfileAssessment[] = participants
      .map((p): PlayerProfileAssessment | null => {
        const tryout = tryoutById.get(p.tryout_id);
        if (!tryout) return null;
        const evals = evalsByParticipant.get(p.id) ?? [];
        const categories = getPlayerCategories(tryout.sport, p.position, tryout.settings?.customRubrics ?? []);
        const weights = isGoaliePosition(p.position)
          ? tryout.settings?.goalieWeights ?? {}
          : tryout.settings?.skaterWeights ?? {};
        const overall = evals.length ? weightedOverallAcrossEvals(evals, categories, weights) : 0;
        const categoryScores = categoryAveragesAcrossEvals(evals, categories);
        const latest = [...evals].sort((a, b) => b.createdAt - a.createdAt)[0];
        const explicitSeason = tryout.season_id ? seasonById.get(tryout.season_id) : undefined;
        let teamSeason: { id: string; name: string } | undefined;
        if (!explicitSeason && tryout.team_id) {
          const teamSeasons = seasonsByTeamId.get(tryout.team_id);
          if (teamSeasons && teamSeasons.length > 0) {
            const tryoutTime = new Date(tryout.tryout_date ?? tryout.created_at ?? Date.now()).getTime();
            let closestSeason = teamSeasons[0];
            let minDiff = Math.abs(new Date(closestSeason.created_at).getTime() - tryoutTime);
            for (const s of teamSeasons) {
              const diff = Math.abs(new Date(s.created_at).getTime() - tryoutTime);
              if (diff < minDiff) {
                minDiff = diff;
                closestSeason = s;
              }
            }
            teamSeason = { id: closestSeason.id, name: closestSeason.name };
          }
        }
        const resolvedSeason = explicitSeason ?? teamSeason;
        return {
          tryoutId: tryout.id,
          tryoutName: tryout.name,
          seasonId: resolvedSeason?.id ?? tryout.season_id ?? undefined,
          seasonName: resolvedSeason?.name ?? undefined,
          eventType: EVENT_TYPE_FROM_DB[tryout.event_type] ?? 'Tryout',
          sport: tryout.sport,
          date: tryout.tryout_date ?? undefined,
          position: p.position ?? undefined,
          teamName: tryout.teams?.name ?? undefined,
          overall,
          categoryScores,
          evalCount: evals.length,
          latestRecommendation: (latest?.recommendation ?? '') as Recommendation,
          participantId: p.id,
          evaluations: evals.map((ev) => ({
            ...ev,
            overall: weightedOverallAcrossEvals([ev], categories, weights),
          })),
        };
      })
      .filter((a): a is PlayerProfileAssessment => a !== null)
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

    return { participants, tryoutById, teams, assessments };
  }

  async getPlayerProfile(athleteId: string): Promise<PlayerProfile> {
    const { supabase } = await this.ctx();

    const { data: athleteRow } = await supabase
      .from('athletes')
      .select(
        'id, first_name, last_name, avatar_url, guardian_name, guardian_email, guardian_phone, default_position, year_of_birth, about, medical_info',
      )
      .eq('id', athleteId)
      .maybeSingle();
    if (!athleteRow) throw new Error('Athlete not found');

    const { participants, tryoutById, teams, assessments } = await this.fetchAthleteAssessmentContext(supabase, athleteId);

    const { data: rosterRows } = await supabase
      .from('season_roster')
      .select('season_id, seasons(name, team_name)')
      .eq('athlete_id', athleteId);
    const pastSeasons = (rosterRows || []).map((r) => {
      const s = Array.isArray(r.seasons) ? r.seasons[0] : r.seasons;
      return {
        seasonId: r.season_id,
        seasonName: s?.name || 'Unknown Season',
        teamName: s?.team_name || 'Unknown Team',
      };
    });

    const mostRecent = [...participants].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ).pop();
    const mostRecentTryout = mostRecent ? tryoutById.get(mostRecent.tryout_id) : undefined;

    // "Current team" priority: actual Teams roster membership (most authoritative)
    // > the free-text field on their latest assessment > the team that
    // assessment was run for.
    const currentTeam = teams[0]?.teamName ?? mostRecent?.current_team ?? mostRecentTryout?.teams?.name ?? undefined;

    return {
      athleteId,
      first: athleteRow.first_name ?? '',
      last: athleteRow.last_name ?? '',
      avatarUrl: athleteRow.avatar_url ?? undefined,
      currentPosition: mostRecent?.position ?? athleteRow.default_position ?? undefined,
      currentTeam,
      currentLevel: mostRecent?.current_level ?? undefined,
      jersey: mostRecent?.jersey ?? undefined,
      yearOfBirth: athleteRow.year_of_birth != null ? String(athleteRow.year_of_birth) : undefined,
      aboutChild: athleteRow.about ?? undefined,
      medicalInfo: athleteRow.medical_info ?? undefined,
      guardianName: athleteRow.guardian_name ?? undefined,
      guardianEmail: athleteRow.guardian_email ?? undefined,
      guardianPhone: athleteRow.guardian_phone ?? undefined,
      pastSeasons,
      teams,
      assessments,
    };
  }

  async setEventAvailability(
    seasonId: string,
    eventId: string,
    playerId: string,
    response: 'yes' | 'maybe' | 'no',
  ): Promise<void> {
    const { supabase } = await this.ctx();
    const rosterRow = unwrap(
      await supabase
        .from('season_roster')
        .select('id')
        .eq('season_id', seasonId)
        .or(`athlete_id.eq.${playerId},id.eq.${playerId}`)
        .maybeSingle()
    ) as Row | null;

    if (!rosterRow) {
      console.warn('Cannot set availability: player is not in roster');
      return;
    }

    unwrap(
      await supabase
        .from('event_availability')
        .upsert(
          { season_event_id: eventId, roster_id: rosterRow.id, response },
          { onConflict: 'season_event_id,roster_id' },
        )
    );
  }

  // ─── Phase 4: Enterprise & Admin ─────────────────────────────────────────────────
  async getOrg(): Promise<Org | null> {
    const { supabase, accountId } = await this.ctx();
    const account = unwrap(
      await supabase.from('accounts').select('*').eq('id', accountId).single(),
    ) as Row;
    if (account.type !== 'organization') return null;

    const [members, tryouts, athletes] = await Promise.all([
      supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      supabase.from('tryouts').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      supabase.from('athletes').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    ]);
    return {
      id: account.id,
      orgSlug: account.slug ?? account.id,
      orgName: account.name,
      sport: account.sport ?? undefined,
      memberCount: members.count ?? 0,
      assessmentCount: tryouts.count ?? 0,
      playerCount: athletes.count ?? 0,
      planTier: account.plan_tier,
      createdAt: toMs(account.created_at),
    };
  }

  async getEnterprisePayments(): Promise<EnterprisePayment[]> {
    const { supabase, accountId } = await this.ctx();
    // Only fees collected through the connected Stripe account carry a
    // registration_id (tryout fees) or season_roster_id (team/season fees) —
    // TryoutHQ's own subscription invoices (billed on the platform's Stripe
    // account) never do, so this filter is what excludes them from the
    // coach's payout ledger.
    const rows = (
      await supabase
        .from('payments')
        .select(
          '*, registrations(first_name, last_name), tryouts(name, teams(name)), ' +
            'season_roster(athletes(first_name, last_name), seasons(name, team_name))',
        )
        .eq('account_id', accountId)
        .or('registration_id.not.is.null,season_roster_id.not.is.null')
        .order('created_at', { ascending: false })
    ).data as Row[] | null;
    return (rows ?? []).map((p) => {
      const athlete = (p.season_roster as Row | null)?.athletes as Row | undefined;
      const registration = p.registrations as Row | undefined;
      const tryout = p.tryouts as Row | undefined;
      const seasonRoster = p.season_roster as Row | undefined;
      const season = seasonRoster?.seasons as Row | undefined;
      return {
        id: p.id,
        playerName: registration
          ? `${registration.first_name} ${registration.last_name}`.trim()
          : athlete
            ? `${athlete.first_name} ${athlete.last_name}`.trim()
            : 'Unknown Player',
        teamName: (tryout?.teams as Row | undefined)?.name ?? season?.team_name ?? '',
        assessmentName: tryout?.name ?? (seasonRoster ? 'Team Fee' : ''),
        amount: (p.amount_cents ?? 0) / 100,
        status: p.status,
        receivedAt: p.received_at ? toMs(p.received_at) : toMs(p.created_at),
      };
    });
  }

  async getAdminStats(): Promise<AdminStats> {
    const { supabase, accountId } = await this.ctx();
    const [tryouts, regs] = await Promise.all([
      supabase.from('tryouts').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      supabase.from('registrations').select('id', { count: 'exact', head: true }),
    ]);
    return {
      totalUsers: 1,
      activeUsers: 1,
      totalAssessments: tryouts.count ?? 0,
      totalRegistrations: regs.count ?? 0,
      planDistribution: { free: 0, coach: 0, coach_plus: 0, club: 0 },
      revenueMtd: 0,
    };
  }

  async listAdminUsers(): Promise<AdminUserRow[]> {
    const { userId } = await this.ctx();
    const profile = await this.loadUserProfile(userId);
    const [teams, tryouts] = await Promise.all([this.listTeams(), this.listTryouts(true)]);
    return [
      {
        id: profile.id,
        email: profile.email,
        displayName: profile.displayName,
        planTier: profile.planTier,
        teamCount: teams.length,
        assessmentCount: tryouts.length,
        lastActiveAt: Date.now(),
      },
    ];
  }

  async overrideUserPlan(userId: string, planTier: UserProfile['planTier']): Promise<void> {
    const ctx = await this.ctx();
    if (userId === ctx.userId) {
      await ctx.supabase.from('accounts').update({ plan_tier: planTier }).eq('id', ctx.accountId);
    }
  }

  async createCheckoutSession(planTier: string, interval: 'year' | 'month'): Promise<{ url: string }> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: { planTier, interval, origin: webOrigin() }
    });
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch { }
      throw new Error(detail || error.message || 'Failed to create checkout session');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async createPortalSession(): Promise<{ url: string }> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('create-portal-session', {
      body: { origin: webOrigin() },
    });
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch { }
      throw new Error(detail || error.message || 'Failed to open portal session');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async createTeamLicenseCheckoutSession(quantity: number): Promise<{ url: string }> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: { addOn: 'team_licenses', quantity: Math.max(1, Math.round(quantity)), interval: 'year', origin: webOrigin() },
    });
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch { }
      throw new Error(detail || error.message || 'Failed to create checkout session');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async createConnectAccountLink(): Promise<{ url: string }> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('create-connect-account');
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch { }
      throw new Error(detail || error.message || 'Failed to start payout onboarding');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async getConnectAccountStatus(): Promise<ConnectAccountStatus> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('connect-account-status');
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch { }
      throw new Error(detail || error.message || 'Failed to load connected account status');
    }
    if (data?.error) throw new Error(data.error);
    return data as ConnectAccountStatus;
  }

  async createRegistrationPayment(
    registrationId: string,
    successUrl?: string,
    cancelUrl?: string,
  ): Promise<{ url: string }> {
    // Guardians call this from the public registration page before they have an
    // account, so it must not depend on an authenticated ctx().
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('create-registration-payment', {
      body: { registrationId, successUrl, cancelUrl },
    });
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch { }
      throw new Error(detail || error.message || 'Failed to start registration payment');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async createTeamFeePayment(
    seasonRosterId: string,
    successUrl?: string,
    cancelUrl?: string,
  ): Promise<{ url: string }> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase.functions.invoke('create-team-fee-payment', {
      body: { seasonRosterId, successUrl, cancelUrl },
    });
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch { }
      throw new Error(detail || error.message || 'Failed to start team fee payment');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  // ─── Misc ──────────────────────────────────────────────────────────────────────
  async submitFeedback(submission: FeedbackSubmission): Promise<void> {
    // No feedback table yet; log + accept so the UI flow completes.
    console.log('[feedback]', JSON.stringify(submission));
  }

  // ─── Org Members ─────────────────────────────────────────────────────────────
  async listOrgMembers(): Promise<import('../types').OrgMember[]> {
    const { supabase, accountId } = await this.ctx();

    // Memberships, the account's tryouts (needed only to scope the assessor
    // read) and the guardian-bearing athletes are three independent reads —
    // only the assessors depend on anything here. Running all four in series
    // put ~2.1s in front of every screen in the app, since AppShell's
    // usePermissions() subscribes to this query on every route.
    const [memRes, tryoutRes, athleteRes] = await Promise.all([
      supabase
        .from('memberships')
        .select('id, user_id, role, created_at, profiles(email, display_name)')
        .eq('account_id', accountId),
      // Fetch tryouts for the account to get assessors
      supabase.from('tryouts').select('id').eq('account_id', accountId),
      supabase
        .from('athletes')
        .select('id, guardian_name, guardian_email, guardian_user_id, created_at')
        .eq('account_id', accountId)
        .eq('archived', false),
    ]);

    const memData = memRes.data;
    const tryouts = tryoutRes.data;
    const athletesData = athleteRes.data;

    let assData: Row[] = [];
    if (tryouts && tryouts.length > 0) {
      const tryoutIds = tryouts.map(t => t.id);
      const { data } = await supabase
        .from('tryout_assessors')
        .select('id, user_id, role, joined_at, email, name')
        .in('tryout_id', tryoutIds);
      assData = data || [];
    }
    const members: Map<string, import('../types').OrgMember> = new Map();

    // Add memberships
    for (const r of memData || []) {
      const profiles = r.profiles;
      const profile = Array.isArray(profiles) ? profiles[0] : profiles;
      const email = profile?.email ?? '';
      const name = profile?.display_name ?? undefined;
      if (!email) continue;
      members.set(email.toLowerCase(), {
        id: r.id,
        orgId: accountId,
        userId: r.user_id,
        email: email,
        name,
        role: r.role === 'owner' ? 'admin' : r.role,
        status: 'active',
        createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
      });
    }

    // Add assessors
    for (const a of assData) {
      const email = a.email;
      if (!email || members.has(email.toLowerCase())) continue;
      members.set(email.toLowerCase(), {
        id: a.id,
        orgId: accountId,
        userId: a.user_id,
        email: email,
        name: a.name ?? undefined,
        role: 'assessor',
        status: 'active',
        createdAt: a.joined_at ? new Date(a.joined_at).getTime() : Date.now(),
      });
    }

    // Guardians, off the athletes read issued in the wave above.
    for (const a of athletesData || []) {
      const email = a.guardian_email;
      if (!email) continue;
      const emailKey = email.toLowerCase();

      if (!members.has(emailKey)) {
        members.set(emailKey, {
          id: a.id,
          orgId: accountId,
          userId: a.guardian_user_id ?? undefined,
          email: email,
          name: a.guardian_name ?? undefined,
          role: 'guardian',
          status: a.guardian_user_id ? 'active' : 'pending',
          createdAt: a.created_at ? new Date(a.created_at).getTime() : Date.now(),
        });
      } else {
        const existing = members.get(emailKey)!;
        if (!existing.name && a.guardian_name) {
          existing.name = a.guardian_name;
        }
        if (!existing.userId && a.guardian_user_id) {
          existing.userId = a.guardian_user_id;
          existing.status = 'active';
        }
        if (!existing.role) existing.role = 'guardian';
      }
    }

    return Array.from(members.values());
  }

  async createAndInviteUser(email: string, password: string, name: string, role: import('../types').OrgRole): Promise<import('../types').OrgMember> {
    const { supabase } = await this.ctx();

    // Create or update user via the Edge Function which uses the official Supabase Admin API.
    // This guarantees the password hash is compatible with GoTrue authentication.
    // Pass account_type so the handle_new_user trigger knows whether to create a personal account.
    const accountType = role === 'guardian' ? 'guardian' : 'coach';
    const { data, error: fnError } = await supabase.functions.invoke('create-user', {
      body: { email, password, display_name: name, account_type: accountType },
    });

    if (fnError) {
      throw new Error(await extractFunctionErrorMessage(fnError, 'Failed to create user account'));
    }

    // If the Edge Function returned an error in the response body
    if (data?.error) {
      throw new Error(data.error);
    }

    return this.inviteOrgMember(email, role, password);
  }

  async inviteOrgMember(email: string, role: import('../types').OrgRole, password?: string): Promise<import('../types').OrgMember> {
    const { supabase, accountId } = await this.ctx();

    const { data, error } = await supabase.rpc('invite_org_member_by_email', {
      account_uuid: accountId,
      lookup_email: email,
      org_role: role,
    });

    if (error) {
      if (error.message.includes('User not found')) {
        throw new Error('User not found. They must create an account first.');
      }
      throw error;
    }

    try {
      await this.sendEmail('org_invite', email, { role, password });
    } catch (e) {
      console.log('Failed to send org invite email (usually due to testing limits):', e);
    }

    return data as import('../types').OrgMember;
  }

  async resendGuardianInvite(userId: string, email: string, role: import('../types').OrgRole = 'guardian'): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.functions.invoke('resend-invite', {
      body: { userId, email, role },
    });
    if (error) {
      let msg = error.message;
      try {
        const body = await error.context.json();
        if (body?.error) msg = body.error;
      } catch { }
      throw new Error(msg);
    }
  }

  async updateOrgMemberRole(memberId: string, role: import('../types').OrgRole): Promise<import('../types').OrgMember> {
    const { supabase } = await this.ctx();

    // Route through a SECURITY DEFINER RPC. A direct `memberships` update is
    // subject to RLS and silently affects zero rows (no error) when the policy
    // filters it out, which made the UI report success while the role never
    // changed. The RPC authorizes the caller, updates the row, and raises a
    // real exception on failure or a no-op.
    const { data, error } = await supabase.rpc('update_org_member_role', {
      member_id: memberId,
      new_role: role,
    });

    if (error) throw new Error(error.message);

    return (data ?? {}) as import('../types').OrgMember;
  }

  async removeOrgMember(memberId: string): Promise<void> {
    const { supabase } = await this.ctx();

    // 1. Try to find and delete from memberships
    const { data: membership } = await supabase
      .from('memberships')
      .select('id')
      .eq('id', memberId)
      .maybeSingle();

    if (membership) {
      const { error } = await supabase.from('memberships').delete().eq('id', memberId);
      if (error) throw new Error(error.message);
      return;
    }

    // 2. Try to find and delete from tryout_assessors
    const { data: assessor } = await supabase
      .from('tryout_assessors')
      .select('id')
      .eq('id', memberId)
      .maybeSingle();

    if (assessor) {
      const { error } = await supabase.from('tryout_assessors').delete().eq('id', memberId);
      if (error) throw new Error(error.message);
      return;
    }

    // 3. Try to find and clear guardian info from athletes
    const { data: athlete } = await supabase
      .from('athletes')
      .select('id, guardian_email, account_id')
      .eq('id', memberId)
      .maybeSingle();

    if (athlete && athlete.guardian_email) {
      const { error } = await supabase
        .from('athletes')
        .update({
          guardian_name: null,
          guardian_email: null,
          guardian_phone: null,
          guardian_user_id: null,
        })
        .eq('account_id', athlete.account_id)
        .eq('guardian_email', athlete.guardian_email);
      if (error) throw new Error(error.message);
      return;
    }
  }

  async linkGuardianToAthlete(guardianId: string, tryoutId: string, playerId: string): Promise<import('../types').Player> {
    const { supabase } = await this.ctx();

    // Resolve actual athlete_id (playerId could be tryout_participant.id or athlete.id)
    let athleteId = playerId;
    const { data: tpCheck } = await supabase
      .from('tryout_participants')
      .select('id, athlete_id')
      .or(`id.eq.${playerId},athlete_id.eq.${playerId}`)
      .limit(1)
      .maybeSingle();

    if (tpCheck?.athlete_id) {
      athleteId = tpCheck.athlete_id;
    }

    const { error } = await supabase
      .from('athletes')
      .update({ guardian_user_id: guardianId })
      .eq('id', athleteId)
      .select(`
        id,
        first_name,
        last_name,
        year_of_birth,
        default_position,
        guardian_name,
        guardian_email,
        guardian_phone,
        guardian_user_id
      `)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    // Fetch the updated player from the tryout view to return the expected Player type
    const { data: updatedPlayer, error: fetchError } = await supabase
      .from('tryout_participants')
      .select(`
        id,
        jersey,
        position,
        athletes(
          id,
          first_name,
          last_name,
          year_of_birth,
          guardian_name,
          guardian_email,
          guardian_user_id
        )
      `)
      .eq('athlete_id', athleteId)
      .eq('tryout_id', tryoutId)
      .limit(1)
      .maybeSingle();

    if (fetchError) throw fetchError;

    const tp = (updatedPlayer || {}) as Row;
    const ath = Array.isArray(tp.athletes) ? tp.athletes[0] : tp.athletes;

    return {
      id: ath.id,
      first: ath.first_name,
      last: ath.last_name,
      pos: tp.position,
      jersey: tp.jersey,
      guardianName: ath.guardian_name,
      guardianEmail: ath.guardian_email,
      linkedGuardianId: ath.guardian_user_id,
      athleteId: ath.id,
    } as import('../types').Player;
  }

  private mapGuardianRosterRow(row: Row): import('../types').GuardianRosterAthlete {
    const tryoutsList = ((row.tryout_participants ?? []) as Row[])
      .map((tp) => {
        if (!tp.tryouts) return null;

        const evals = (tp.evaluations ?? []) as Row[];
        const sessionMap = new Map<string, { result: string; date: number; scores: Record<string, number> }>();

        for (const e of evals) {
          if (e.recommendation) {
            const sessionName = e.session || 'Session 1';
            const t = e.created_at ? new Date(e.created_at).getTime() : 0;
            const existing = sessionMap.get(sessionName);

            if (!existing || t > existing.date) {
              const scoresRecord: Record<string, number> = {};
              if (e.evaluation_scores && Array.isArray(e.evaluation_scores)) {
                for (const score of e.evaluation_scores as Row[]) {
                  if (score.rubric_key && typeof score.value === 'number') {
                    scoresRecord[score.rubric_key] = score.value;
                  }
                }
              }

              sessionMap.set(sessionName, {
                result: REC_FROM_DB[e.recommendation] || e.recommendation,
                date: t,
                scores: scoresRecord,
              });
            }
          }
        }

        const sessions = Array.from(sessionMap.entries())
          .map(([name, data]) => ({
            name,
            result: data.result,
            date: data.date,
            scores: Object.keys(data.scores).length > 0 ? data.scores : undefined,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        return {
          ...tp.tryouts,
          participantId: tp.id,
          sessions,
        };
      })
      .filter(Boolean);

    const seasonsList = ((row.season_roster ?? []) as Row[])
      .map((sr) => {
        if (!sr.seasons) return null;

        const availability = (sr.event_availability ?? []) as Row[];
        const assignedEventIds = new Set<string>(availability.map((ea) => ea.season_event_id));

        const formattedEvents = ((sr.seasons.season_events ?? []) as Row[])
          .filter((ev) => assignedEventIds.has(ev.id))
          .map((ev) => {
            const ea = availability.find((a) => a.season_event_id === ev.id);
            const availabilityRecord: Record<string, string> = {};
            if (ea) availabilityRecord[row.id] = ea.response;
            return {
              id: ev.id,
              type: EVENT_KIND_FROM_DB[ev.kind] ?? 'Game',
              title: ev.title,
              date: ev.event_date,
              startTime: ev.start_time ?? undefined,
              endTime: ev.end_time ?? undefined,
              location: ev.location ?? undefined,
              notes: ev.notes ?? undefined,
              availability: availabilityRecord,
            };
          });

        const team = Array.isArray(sr.seasons.teams) ? sr.seasons.teams[0] : sr.seasons.teams;

        return {
          id: sr.seasons.id,
          name: sr.seasons.name,
          teamName: sr.seasons.team_name,
          sport: sr.seasons.sport,
          jersey: sr.jersey ?? undefined,
          events: formattedEvents,
          seasonRosterId: sr.id,
          collectsFees: !!team?.collects_fees,
          registrationFeeCents: team?.registration_fee_cents ?? undefined,
          feeStatus: (sr.fee_status ?? 'unpaid') as 'unpaid' | 'paid' | 'waived',
        };
      })
      .filter(Boolean);

    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      avatarUrl: row.avatar_url,
      tryouts: tryoutsList,
      seasons: seasonsList,
    } as import('../types').GuardianRosterAthlete;
  }

  private rowToFamilyContact(r: Row): FamilyContact {
    return {
      id: r.id,
      athleteId: r.athlete_id,
      name: r.name,
      relationship: r.relationship ?? undefined,
      email: r.email ?? undefined,
      phone: r.phone ?? undefined,
    };
  }

  async listFamilyContacts(athleteId: string): Promise<FamilyContact[]> {
    const { supabase } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('athlete_family_contacts')
        .select()
        .eq('athlete_id', athleteId)
        .order('created_at', { ascending: true }),
    ) as Row[] | null;
    return (rows ?? []).map((r) => this.rowToFamilyContact(r));
  }

  async addFamilyContact(
    athleteId: string,
    contact: { name: string; relationship?: string; email?: string; phone?: string },
  ): Promise<FamilyContact> {
    const { supabase, userId } = await this.ctx();
    const row = unwrap(
      await supabase
        .from('athlete_family_contacts')
        .insert({
          athlete_id: athleteId,
          name: contact.name,
          relationship: contact.relationship || null,
          email: contact.email || null,
          phone: contact.phone || null,
          created_by: userId,
        })
        .select()
        .single(),
    ) as Row;
    return this.rowToFamilyContact(row);
  }

  async removeFamilyContact(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('athlete_family_contacts').delete().eq('id', id));
  }

  // One statement, authorized per tryout/season instead of per leaf row — the nested
  // PostgREST embed this replaces made RLS run on every evaluation score and every
  // RSVP row, which blew the statement timeout (57014) for coaches and guardians
  // alike. See the shared backend's supabase/migrations/20260817130000_guardian_rosters_rpc.sql.
  async getGuardianRosters(): Promise<import('../types').GuardianRosterAthlete[]> {
    const { supabase, userId } = await this.userCtx();
    if (!userId) return [];

    const { data: rpcData, error: rpcError } = await supabase.rpc('get_guardian_rosters');

    if (!rpcError) {
      return ((rpcData as Row[]) ?? []).map((row) => this.mapGuardianRosterRow(row));
    }

    // Environments that haven't run the migration yet fall back to the old embed.
    // Anything other than "function not found" is a real failure worth surfacing.
    const missingFunction = rpcError.code === 'PGRST202' || rpcError.code === '42883';
    if (!missingFunction) {
      console.error('Failed to fetch guardian rosters:', rpcError);
      return [];
    }
    console.warn('get_guardian_rosters() not deployed — falling back to the nested query.');

    const { data: userData } = await supabase.auth.getUser();
    const userEmail = userData?.user?.email?.toLowerCase();

    // guardian_email is citext, so eq() is already case-insensitive — using eq
    // (not ilike) lets this hit the plain btree index on guardian_email instead
    // of forcing a sequential scan, which is what was timing out (57014).
    let query = supabase
      .from('athletes')
      .select(`
        id,
        first_name,
        last_name,
        avatar_url,
        tryout_participants(
          id,
          tryout_id,
          tryouts(id, name, sport),
          evaluations(
            id,
            session,
            recommendation,
            created_at,
            evaluation_scores(rubric_key, value)
          )
        ),
        season_roster(
          id,
          jersey,
          fee_status,
          event_availability(season_event_id, response),
          seasons(
            id,
            name,
            team_name,
            sport,
            team_id,
            teams(collects_fees, registration_fee_cents),
            season_events(id, kind, title, event_date, start_time, end_time, location, notes)
          )
        )
      `);

    query = userEmail
      ? query.or(`guardian_user_id.eq.${userId},guardian_email.eq.${userEmail}`)
      : query.eq('guardian_user_id', userId);

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch guardian rosters:', error);
      return [];
    }

    return ((data as Row[]) ?? []).map((row) => this.mapGuardianRosterRow(row));
  }

  // ─── Guardian -> Coach athlete profile sharing ──────────────────────────

  private mapAthleteShareRow(row: Row): import('../types').AthleteShare {
    return {
      id: row.id,
      athleteId: row.athlete_id,
      status: row.status,
      athlete: {
        firstName: row.athlete_first_name,
        lastName: row.athlete_last_name,
        avatarUrl: row.athlete_avatar_url ?? undefined,
        yearOfBirth: row.athlete_year_of_birth ?? undefined,
        position: row.athlete_position ?? undefined,
        guardianName: row.athlete_guardian_name ?? undefined,
        guardianEmail: row.athlete_guardian_email ?? undefined,
        guardianPhone: row.athlete_guardian_phone ?? undefined,
        medicalInfo: row.athlete_medical_info ?? undefined,
        about: row.athlete_about ?? undefined,
      },
      assessments: Array.isArray(row.athlete_assessments) ? (row.athlete_assessments as PlayerProfileAssessment[]) : [],
      coach: {
        userId: row.coach_user_id,
        displayName: row.coach_display_name,
        avatarUrl: row.coach_avatar_url ?? undefined,
        accountId: row.coach_account_id,
        accountName: row.coach_account_name,
        sport: row.coach_sport ?? undefined,
      },
      guardianUserId: row.guardian_user_id,
      assignedTryoutId: row.assigned_tryout_id ?? undefined,
      assignedAthleteId: row.assigned_athlete_id ?? undefined,
      assignedParticipantId: row.assigned_participant_id ?? undefined,
      createdAt: toMs(row.created_at),
      updatedAt: toMs(row.updated_at),
    };
  }

  /**
   * Replaces a share's frozen assessment snapshot with live data via
   * get_athlete_share_live_scores() — every tryout this one athlete has ever
   * participated in, including ones added after the share, but never any
   * other athlete on the guardian's roster (that boundary is enforced in the
   * SQL function itself). Falls back to the frozen snapshot passed in if the
   * RPC errors or the caller isn't authorized for this share.
   */
  private async liveAthleteShareAssessments(
    supabase: SupabaseClient,
    shareId: string,
    fallback: PlayerProfileAssessment[],
  ): Promise<PlayerProfileAssessment[]> {
    const { data, error } = await supabase.rpc('get_athlete_share_live_scores', { p_share_id: shareId });
    if (error || !Array.isArray(data)) return fallback;

    return (data as Row[])
      .map((live): PlayerProfileAssessment => {
        const position = live.position ?? undefined;
        const sport = live.sport as Sport;
        const settings = (live.settings ?? {}) as Row;
        const categories = getPlayerCategories(sport, position, settings.customRubrics ?? []);
        const weights = isGoaliePosition(position) ? settings.goalieWeights ?? {} : settings.skaterWeights ?? {};
        const evals = ((live.evaluations ?? []) as Row[]).map((row) => this.rowToEval(row));
        const overall = evals.length ? weightedOverallAcrossEvals(evals, categories, weights) : 0;
        const categoryScores = categoryAveragesAcrossEvals(evals, categories);
        const latest = [...evals].sort((x, y) => y.createdAt - x.createdAt)[0];

        return {
          tryoutId: live.tryout_id,
          tryoutName: live.tryout_name,
          seasonId: live.season_id ?? undefined,
          eventType: live.event_type as EventType,
          sport,
          date: live.tryout_date ?? undefined,
          position,
          teamName: live.team_name ?? undefined,
          overall,
          categoryScores,
          evalCount: evals.length,
          latestRecommendation: (latest?.recommendation ?? '') as Recommendation,
          participantId: live.participant_id,
          evaluations: evals.map((ev) => ({ ...ev, overall: weightedOverallAcrossEvals([ev], categories, weights) })),
        };
      })
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }

  async getCoachDirectory(): Promise<import('../types').CoachDirectoryEntry[]> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase.rpc('list_coach_directory');
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
      accountId: row.account_id,
      accountName: row.account_name,
      sport: row.sport ?? undefined,
    }));
  }

  async shareAthleteWithCoach(athleteId: string, coachUserId: string, coachAccountId: string): Promise<import('../types').AthleteShare> {
    const { supabase, userId } = await this.userCtx();

    const { data: athleteRow, error: athleteError } = await supabase
      .from('athletes')
      .select(
        'id, first_name, last_name, avatar_url, year_of_birth, default_position, guardian_name, guardian_email, guardian_phone, medical_info, about',
      )
      .eq('id', athleteId)
      .maybeSingle();
    if (athleteError) throw new Error(athleteError.message);
    if (!athleteRow) throw new Error('Athlete not found');

    // Full assessment history, frozen at share time — see the athlete_assessments
    // column comment in the migration for why this is a snapshot, not a live join.
    const { assessments } = await this.fetchAthleteAssessmentContext(supabase, athleteId);

    const { data: directory, error: directoryError } = await supabase.rpc('list_coach_directory');
    if (directoryError) throw new Error(directoryError.message);
    const coachRow = ((directory ?? []) as Row[]).find(
      (c) => c.user_id === coachUserId && c.account_id === coachAccountId,
    );
    if (!coachRow) throw new Error('Coach not found');

    const { data, error } = await supabase
      .from('athlete_shares')
      .insert({
        athlete_id: athleteId,
        guardian_user_id: userId,
        coach_user_id: coachUserId,
        coach_account_id: coachAccountId,
        athlete_first_name: athleteRow.first_name,
        athlete_last_name: athleteRow.last_name,
        athlete_avatar_url: athleteRow.avatar_url,
        athlete_year_of_birth: athleteRow.year_of_birth,
        athlete_position: athleteRow.default_position,
        athlete_guardian_name: athleteRow.guardian_name,
        athlete_guardian_email: athleteRow.guardian_email,
        athlete_guardian_phone: athleteRow.guardian_phone,
        athlete_medical_info: athleteRow.medical_info,
        athlete_about: athleteRow.about,
        athlete_assessments: assessments,
        coach_display_name: coachRow.display_name,
        coach_avatar_url: coachRow.avatar_url,
        coach_account_name: coachRow.account_name,
        coach_sport: coachRow.sport,
      })
      .select('*')
      .single();

    if (error) {
      if ((error as { code?: string }).code === '23505') throw new Error('Already shared with this coach.');
      throw new Error(error.message);
    }
    return this.mapAthleteShareRow(data as Row);
  }

  async getMyAthleteShares(athleteId: string): Promise<import('../types').AthleteShare[]> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase
      .from('athlete_shares')
      .select('*')
      .eq('athlete_id', athleteId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((row) => this.mapAthleteShareRow(row));
  }

  async getSharedAthletesForCoach(): Promise<import('../types').AthleteShare[]> {
    const { supabase, accountId } = await this.ctx();
    const { data, error } = await supabase
      .from('athlete_shares')
      .select('*')
      .eq('coach_account_id', accountId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((row) => this.mapAthleteShareRow(row));
  }

  async getAthleteShare(shareId: string): Promise<import('../types').AthleteShare> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase
      .from('athlete_shares')
      .select('*')
      .eq('id', shareId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Share not found');
    const share = this.mapAthleteShareRow(data as Row);
    share.assessments = await this.liveAthleteShareAssessments(supabase, shareId, share.assessments);
    return share;
  }

  async acceptAthleteShare(shareId: string, tryoutId: string): Promise<import('../types').AthleteShare> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase.rpc('accept_athlete_share', {
      p_share_id: shareId,
      p_tryout_id: tryoutId,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return this.mapAthleteShareRow(row as Row);
  }

  async rejectAthleteShare(shareId: string): Promise<import('../types').AthleteShare> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase.rpc('reject_athlete_share', { p_share_id: shareId });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return this.mapAthleteShareRow(row as Row);
  }

  async listShareComments(shareId: string): Promise<import('../types').ShareComment[]> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase
      .from('athlete_share_comments')
      .select('*')
      .eq('share_id', shareId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((row) => ({
      id: row.id,
      shareId: row.share_id,
      authorUserId: row.author_user_id,
      authorName: row.author_name,
      authorRole: row.author_role,
      body: row.body,
      createdAt: toMs(row.created_at),
    }));
  }

  async addShareComment(shareId: string, body: string): Promise<import('../types').ShareComment> {
    const { supabase, userId } = await this.userCtx();

    const { data: shareRow, error: shareError } = await supabase
      .from('athlete_shares')
      .select('guardian_user_id')
      .eq('id', shareId)
      .maybeSingle();
    if (shareError) throw new Error(shareError.message);
    if (!shareRow) throw new Error('Share not found');

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();

    const authorRole: 'guardian' | 'coach' = shareRow.guardian_user_id === userId ? 'guardian' : 'coach';

    const { data, error } = await supabase
      .from('athlete_share_comments')
      .insert({
        share_id: shareId,
        author_user_id: userId,
        author_name: profileRow?.display_name || 'Unknown',
        author_role: authorRole,
        body,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    return {
      id: data.id,
      shareId: data.share_id,
      authorUserId: data.author_user_id,
      authorName: data.author_name,
      authorRole: data.author_role,
      body: data.body,
      createdAt: toMs(data.created_at),
    };
  }

}

export const supabaseDataSource = new SupabaseDataSource();
