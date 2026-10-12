/// <reference types="node" />
import { getSupabase } from '@/lib/supabase';
import { APP_CONFIG } from '@/config/app';
import { type Session, type SupabaseClient, isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { DataSource } from '../datasource';
import type { SearchPlayer } from '../search';
import { PLAN_TIERS, SPORTS } from '../types';
import { friendlyVideoError } from '../videoStorage';
import { bulkImportPlayers, IMPORT_CREATE_CHUNK } from '../bulkTeamImport';
import type { FeedbackAttachment, FeedbackReport, FeedbackSubmission } from '../extras';
import { deriveAccountAccess, isExpiredTrial } from '@/lib/accountAccess';
import { isBlockableFeature } from '@/lib/blockableFeatures';
import {
  VIEW_AS_READ_ONLY_MESSAGE,
  getImpersonatedUser,
  getImpersonationTarget,
  getViewedPerson,
  getViewedPersonIds,
  useImpersonationStore,
  type ImpersonationTarget,
} from '@/state/impersonationStore';

/**
 * For the writes that don't go through a React Query mutation (so the query
 * client's view-as guard never sees them) and don't resolve their account via
 * writableAccountId(): checkout and billing portals, Stripe Connect, outgoing
 * email, and a few direct inserts. The founder's "view as" is read-only.
 */
function assertNotViewingAs(): void {
  if (getImpersonationTarget()) throw new Error(VIEW_AS_READ_ONLY_MESSAGE);
}

/**
 * The read RPCs that answer "for the caller" off auth.uid() — delegated
 * (managed) teams and the assessments/seasons on them, and the mirror image for
 * the teams the caller's own account owns. Under view-as, auth.uid() is still
 * the founder, so SupabaseDataSource.viewerRpc() answers these for the person
 * or organization being viewed instead.
 */
type ViewerScopedRpc =
  | 'list_teams_managed_by_me'
  | 'list_managed_team_owner_tiers'
  | 'list_tryouts_for_managed_teams'
  | 'list_tryouts_on_my_owned_teams'
  | 'list_seasons_for_managed_teams'
  | 'list_seasons_on_my_owned_teams';
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
import type { LetterKind } from '../letters';
import type { TeamBuilderConfig, TeamBuilderState, FriendPackage } from '../teamBuilder';
import {
  buildTeams,
  formatExportCsv,
  parseTeamCountFromPrompt,
  parseTiersFromPrompt,
} from '../teamBuilder';
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
  DiscountCodePreview,
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
  PlanTier,
  Player,
  LetterTemplate,
  PlayerLetter,
  PlayerLetterSendResult,
  PlayerProfile,
  PlayerProfileAssessment,
  Recommendation,
  ReferralSummary,
  Registration,
  RegistrationSubmit,
  ScoreForm,
  Season,
  SeasonEvent,
  EventRsvpContext,
  EventRsvpToken,
  SeasonPlayer,
  SeasonSummary,
  Sport,
  Team,
  TeamBuilderResult,
  TeamInviteResult,
  PlayerImportResult,
  TeamMessage,
  BlockedChatUser,
  ChatReportReason,
  TeamRosterCursor,
  TeamRosterPlayer,
  Tryout,
  TryoutSummary,
  UserProfile,
} from '../types';

// ─── small helpers ──────────────────────────────────────────────────────────
// The one documented escape hatch for loosely-shaped Supabase row/RPC-response objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

function unwrap<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw unwrapError(res.error);
  return res.data;
}

/**
 * The Error `unwrap` throws, on its own — for the `supabase.rpc()` call sites
 * that destructure `{ data, error }` instead of going through `unwrap`. Keeping
 * `code` on the thrown Error is what lets callers distinguish a Postgres
 * SQLSTATE (a statement timeout, an RLS rejection) from a generic failure.
 */
export function unwrapError(error: { message: string; code?: string }): Error & { code?: string } {
  const err = new Error(error.message) as Error & { code?: string };
  err.code = error.code;
  return err;
}

/**
 * Runs a write that must have changed a row, and says whether it did.
 *
 * An UPDATE that RLS rejects is not an error in Postgres — it matches zero
 * rows and reports success, which is how an assessor's Edit Player came to
 * report a save it had not made. Chaining `.select().single()` turns that into
 * PostgREST's PGRST116, which this reads as "refused" rather than throwing, so
 * the caller can retry down a path that is authorized server-side. Any other
 * error is a real failure and still throws.
 */
async function wroteRow(
  query: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
): Promise<boolean> {
  const res = await query;
  if (!res.error) return true;
  if (res.error.code === 'PGRST116') return false;
  throw unwrapError(res.error);
}

/**
 * Set by an operation running under withFreshAccount() as soon as its first
 * write lands, so the wrapper knows a retry would duplicate rather than repeat.
 */
type WriteGuard = { wrote: boolean };

/**
 * Which table a Manage Organization row came out of, and who it belongs to.
 * listOrgMembers() folds memberships, tryout_assessors and athlete guardian
 * contacts into one list, so a row id alone doesn't say what removing it means.
 */
type OrgMemberIdentity = {
  kind: 'membership' | 'assessor' | 'guardian' | 'teamManager';
  accountId: string | null;
  userId?: string;
  email?: string;
  /** memberships.role, so an owner/admin can be refused before the delete. */
  role?: string;
  /** The one assessor row the deduped list surfaced. */
  tryoutId?: string;
};

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
export async function extractFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
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

/** Error code of an enrolment the database skipped because the guardian left the team. */
export const GUARDIAN_OPTED_OUT = 'GUARDIAN_OPTED_OUT';

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
export async function fetchAllByIn(
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

export function toMs(iso: string | null | undefined): number {
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
export const TEAM_ROSTER_PAGE = 200;

/**
 * Rows per page for the Players tab's own read — see listTeamRosterPage. One
 * statement, one screenful: the list paints off the first round trip however
 * many players are on the team, and the rest are read only when the coach asks
 * for them. Same size as SEASON_ROSTER_SCREEN_PAGE.
 */
const TEAM_ROSTER_SCREEN_PAGE = 50;

/** The columns both team-roster reads select. */
function teamRosterSelect(): string {
  return `*, athletes(*), tryouts:source_tryout_id(name)`;
}

/**
 * Strips the characters PostgREST's filter grammar gives meaning to before a
 * search term goes into an `or(...)`. A stray comma or paren would otherwise be
 * read as filter syntax and the request would come back as a 400 mid-typing.
 */
function likeTerm(raw: string): string {
  return raw.replace(/[,()."\\*%]/g, ' ').trim();
}

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
 * Rows per `get_event_availability()` call. Much larger than
 * EVENT_AVAILABILITY_PAGE because the RPC authorizes once per event rather than
 * once per row, so a page costs roughly what its row count suggests — the whole
 * reason the function exists. It is bounded at all only because a set-returning
 * RPC is still subject to PostgREST's db-max-rows cap, so the client has to page
 * to know it has everything; keep this at or below that server-side limit (and
 * at or below the function's own `p_limit` default) or the short-page check that
 * ends the loop can never fire. Mirrors the mobile app's constant of the same
 * name.
 */
const AVAILABILITY_RPC_PAGE = 1000;

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
 * Rows per request when reading a season roster. Same embed, same reasoning as
 * PARTICIPANTS_PAGE. Mirrors the mobile app's constant of the same name.
 */
const SEASON_ROSTER_PAGE = 200;

/**
 * Rows per page for the roster *screen* — smaller than SEASON_ROSTER_PAGE
 * because nothing is waiting on the whole roster here. A page only has to
 * outrun the scroll, and a shorter one is a cheaper statement: the `athletes`
 * embed runs can_access_athlete() once per row either way, so 50 rows is a
 * quarter of the work before the first name appears.
 */
const SEASON_ROSTER_SCREEN_PAGE = 50;

/**
 * Exactly the columns rowToSeasonPlayer reads. `*, athletes(*)` shipped every
 * column of every athlete — medical notes, avatars, timestamps, guardian
 * bookkeeping — to render a name, a jersey and two contact addresses, over a
 * read whose `athletes` embed already costs a per-row can_access_athlete()
 * (five OR'd EXISTS branches). Keep it in sync with the mapper: a column
 * dropped here silently becomes `undefined` there. `season_id` rides along
 * because assembleSeasons groups on it. Mirrors the mobile app's constant of
 * the same name.
 */
/** The two reads assembleSeasons() always starts from — see seasonBaseReads(). */
type SeasonBaseReads = { events: Promise<Row[]>; roster: Promise<Row[]> };

/**
 * Issues the two reads every season assembly starts from.
 *
 * Separate from assembleSeasons() so getSeason() can start them *before* it
 * knows the season row exists: nothing about reading a season's events or
 * roster depends on that row's own columns, only on its id, which the caller
 * already has. Waiting for the `seasons` select first cost a full round trip of
 * pure latency — with can_access_season() evaluated on it — before the schedule
 * read was even issued.
 *
 * The rejection handlers keep an abandoned read (no such season, or a caller
 * that throws before awaiting) from surfacing as an unhandled rejection; the
 * promises still reject for whoever awaits them.
 */
function seasonBaseReads(supabase: SupabaseClient, ids: string[]): SeasonBaseReads {
  const events = fetchAllByIn(supabase, 'season_events', '*', 'season_id', ids);
  const roster = fetchAllByIn(
    supabase,
    'season_roster',
    SEASON_ROSTER_SELECT,
    'season_id',
    ids,
    SEASON_ROSTER_PAGE,
  );
  events.catch(() => {});
  roster.catch(() => {});
  return { events, roster };
}

const SEASON_ROSTER_SELECT =
  'id, season_id, athlete_id, jersey, player_email, ' +
  'athletes(id, first_name, last_name, guardian_email, guardian_phone, player_email)';

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
/** Athlete ids per request when removing players from a team roster in bulk. */
const TEAM_ROSTER_REMOVE_CHUNK = 50;
/** Removal requests in flight at once. */
const TEAM_ROSTER_REMOVE_CONCURRENCY = 4;
/**
 * Players deleted from an assessment roster at once. Each delete is its own
 * round trip, so an unbounded fan-out over a whole roster is what a bulk delete
 * used to do.
 */
const PLAYER_DELETE_CONCURRENCY = 4;
/** Participants soft-deleted per request in a bulk delete. */
const PLAYER_DELETE_CHUNK = 25;
/** Batches in flight at once. */
const PLAYER_DELETE_BATCH_CONCURRENCY = 2;
/** release_athlete_share_for_participant RPCs in flight at once during a bulk delete. */
const PLAYER_RELEASE_CONCURRENCY = 4;
/** Athlete ids checked per request when clearing guardian contacts off a bulk delete. */
const GUARDIAN_CLEAR_CHUNK = 20;
const REGISTRATION_CHUNK_CONCURRENCY = 6;
const GUARDIAN_EMAIL_CONCURRENCY = 20;
const GUARDIAN_RESOLVE_BATCH = 50;

/**
 * Marks a tryout row the caller reached as a coach of its *team* rather than
 * through their own account — CLUB-mode delegation, or a club owner seeing an
 * assessment a delegate created on their team. Both come back from RPCs, not
 * from the account_id filter, so the flag is set where they are merged in and
 * read again in assembleTryouts(); it never touches the database.
 */
const VIEWER_MANAGES_TEAM = '__viewerManagesTeam';

/** Private bucket holding feedback screenshots — reachable only via signed URLs. */
const FEEDBACK_BUCKET = 'feedback-attachments';
const EVENT_FILES_BUCKET = 'event-files';
const FEED_FILES_BUCKET = 'feed-files';
const ORG_INFO_FILES_BUCKET = 'org-info-files';
const LIBRARY_FILES_BUCKET = 'library-files';
const ACCOUNT_VIDEOS_BUCKET = 'account-videos';
const REPORT_CARD_FILES_BUCKET = 'report-card-files';

/** Long enough to open an attachment and look at it; short enough that a copied link goes stale. */
const FEEDBACK_SIGNED_URL_TTL_SECONDS = 60 * 10;

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
 * `insert` is also kept well under what the pooler would physically allow: each
 * of these statements pays a per-row row-level-security check, so twenty of them
 * at once contend for the same CPU and every one of them gets slower. That is
 * how a batch whose statements would each have fit inside the 8s statement
 * timeout ends up overrunning it anyway. Eight concurrent writers keeps the pipe
 * full without the batch throttling itself.
 *
 * Mirrors the mobile app's constant of the same name.
 */
const DUMMY_MAX_CONCURRENCY = { insert: 20, ai: 50 } as const;

/**
 * Row ceilings for the dummy-data bulk inserts.
 *
 * These were previously sized so one request's JSON body landed around ~500KB,
 * which optimizes the wrong constraint. Body size is not what kills a bulk
 * insert here — Postgres's 8s statement timeout is, and an INSERT's cost against
 * it is its per-row `WITH CHECK` policy (plus, where the insert is followed by
 * `.select()`, the read policy on every row it hands back), not its byte count.
 * Sent as 1000-, 2000- and 5000-row statements, a full 1000-player × 5-session
 * batch is exactly how "canceling statement due to statement timeout" (57014)
 * reaches the user — with a half-written roster left behind it, since the phases
 * commit incrementally.
 *
 * The values below keep any single statement's share of that predicate well
 * inside the timeout. They are a starting point, not a promise: `insertChunked`
 * shrinks them at run time if a deployment's policies turn out to be more
 * expensive still. The narrow tables still get the larger chunks — an
 * `evaluation_scores` row is three columns and its check is the cheapest of the
 * four — but they are now ordered by policy cost rather than by row width.
 */
const DUMMY_CHUNK = {
  registrations: 1000,
  athletes: 1000,
  participants: 1000,
  evaluations: 25000,
  scores: 50000,
} as const;

/**
 * Floor for `insertChunked`'s adaptive shrinking. A statement that still times
 * out with this few rows is not a chunking problem — it's a missing index or a
 * pathological policy — so the error surfaces instead of the batch dissolving
 * into thousands of single-row requests that would never finish either.
 */
const DUMMY_MIN_CHUNK = 25;

/**
 * Most ids to put in a single PostgREST filter (`.in('id', [...])`).
 *
 * This is a separate ceiling from DUMMY_CHUNK, and it binds in the opposite
 * direction. An insert carries its rows in the request *body*, so its only
 * limit is what the statement can do inside the timeout. A filter is spent in
 * the *query string*: every UUID costs 36 characters plus a 3-character encoded
 * comma, so a 1000-id delete builds a ~39 KB URL and Supabase's gateway rejects
 * it with a bare `400` — before it reaches PostgREST, so nothing is deleted and
 * the error says nothing about length. 100 ids keeps the filter near 4 KB, well
 * under any proxy's URI limit, and has the side benefit of bounding a cascading
 * delete's statement to ~100 participants' worth of evaluations and scores.
 */
export const IN_FILTER_CHUNK = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Extra attempts resolveAccount() gives a just-created membership row to show up. */
const RESOLVE_ACCOUNT_RETRIES = 2;

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
 * Did Postgres kill this statement for running past `statement_timeout`?
 *
 * Exported (with `insertChunked`) only so the chunking tests can drive it.
 *
 * PostgREST forwards the SQLSTATE, which `unwrap` preserves as `code`; the RPC
 * paths in this file throw a bare Error, so the message is matched too.
 */
export function isStatementTimeout(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | undefined;
  if (err?.code === '57014') return true;
  return /canceling statement due to statement timeout/i.test(err?.message ?? '');
}

/** Teams checked and deleted per request in clearDummyTeams (keeps the `in (...)` URL short). */
const CLEAR_TEAMS_CHUNK = 100;
/** PostgREST's usual max rows per response; a result this long may have been cut off. */
const PG_ROW_CAP = 1000;

/**
 * Run `task` over `items` a few at a time: much faster than awaiting each in
 * turn, without firing every request at once. Rejects on the first failure,
 * like the sequential loops it replaces.
 */
async function inBatches<T>(items: T[], size: number, task: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(task));
  }
}

/** Concurrent send-email calls when mailing a whole roster. */
const EMAIL_SEND_CONCURRENCY = 5;

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
 *
 * A chunk that Postgres kills on the statement timeout (57014) is halved and
 * retried rather than failing the whole batch, down to `DUMMY_MIN_CHUNK`. Two
 * things make that safe and cheap:
 *
 *  - **Safe**, because the failure is atomic. PostgREST runs one INSERT
 *    statement per request, and a statement killed by the timeout is rolled
 *    back whole — not one row of the killed chunk was committed, so re-sending
 *    it cannot duplicate anything. (This is the same reason the batch as a
 *    whole is *not* retried anywhere: only the individual statement is atomic,
 *    the four-phase pipeline around it is not.)
 *  - **Cheap**, because the smaller size is written back into the run's shared
 *    `state`. Every chunk that hasn't started yet is then split before it is
 *    sent, so the batch pays for one timeout total instead of rediscovering the
 *    same ceiling — at 8s a go — once per chunk.
 */
export async function insertChunked<T, R>(
  items: T[],
  size: number,
  task: (chunk: T[], offset: number) => Promise<R[]>,
  onProgress?: (done: number) => void,
): Promise<R[]> {
  const chunks: { rows: T[]; offset: number }[] = [];
  for (let i = 0; i < items.length; i += size) chunks.push({ rows: items.slice(i, i + size), offset: i });

  // Shared across the pool, so one chunk's discovery spares all the others.
  const state = { size };
  let done = 0;

  const send = async (rows: T[], offset: number): Promise<R[]> => {
    if (rows.length > state.size) {
      // Some chunk has already proved this many rows is too many. Split before
      // sending rather than spending another timeout to learn the same thing.
      const out: R[] = [];
      // `width` is read once per slice, never re-read after the await: another
      // worker can shrink `state.size` while this send is in flight, and an
      // `i += state.size` that picked up the new, smaller value would advance
      // past fewer rows than the slice consumed — re-sending the overlap and
      // duplicating real athletes and participants.
      for (let i = 0; i < rows.length; ) {
        const width = state.size;
        out.push(...(await send(rows.slice(i, i + width), offset + i)));
        i += width;
      }
      return out;
    }
    try {
      const inserted = await task(rows, offset);
      done += rows.length;
      onProgress?.(done);
      return inserted;
    } catch (e) {
      if (!isStatementTimeout(e) || rows.length <= DUMMY_MIN_CHUNK) throw e;
      state.size = Math.min(state.size, Math.max(DUMMY_MIN_CHUNK, Math.ceil(rows.length / 2)));
      return send(rows, offset);
    }
  };

  const results = await mapPool(chunks, DUMMY_MAX_CONCURRENCY.insert, (c) => send(c.rows, c.offset));
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
function authErrorMessage(
  error: { message?: string | null } | null | undefined,
  fallback: string,
): string {
  if (error && isNetworkFetchError(error)) return NETWORK_ERROR_MESSAGE;
  const message = error?.message;
  if (!message || /^[{[]/.test(message.trim())) return fallback;
  return message;
}

/**
 * A request that never got an HTTP response at all — the browser's fetch()
 * itself threw (offline, DNS hiccup, a VPN/ad-blocker/content-blocker
 * dropping the request, a transient TLS failure). auth-js wraps these as
 * AuthRetryableFetchError and, tellingly, passes the raw browser Error
 * message straight through as `.message` — which on Safari is the single
 * word "Load failed" and on Chrome "Failed to fetch", neither of which means
 * anything to someone looking at a signup form. Worth a name because the SDK
 * itself considers this class retryable (see withAuthRetry below) rather
 * than a real rejection from the server.
 */
function isNetworkFetchError(error: unknown): boolean {
  return isAuthRetryableFetchError(error) && (error as { status?: number }).status === 0;
}

/**
 * One retry, only for the network-level failure above — not for a real
 * rejection from the server (bad password, rate limit, etc.), which the
 * first attempt already reports correctly. A dropped connection is often a
 * one-off blip (Safari Private Relay hiccups are the common local case), so
 * silently trying again once beats surfacing "Load failed" for something
 * that would have worked a second later.
 *
 * auth-js resolves signUp/signInWithPassword/etc. with `{ data, error }`
 * rather than throwing even for a network failure, so the retry has to
 * inspect the returned `error`, not a caught exception.
 */
async function withAuthRetry<T extends { error: { message?: string } | null }>(
  run: () => Promise<T>,
): Promise<T> {
  const result = await run();
  if (result.error && isNetworkFetchError(result.error)) return run();
  return result;
}

/** Message shown when withAuthRetry's second attempt also fails at the network level. */
const NETWORK_ERROR_MESSAGE =
  "Couldn't reach the server. Check your internet connection — browser privacy/ad-blocking extension can also cause this — and try again.";

const EVENT_TYPE_TO_DB: Record<EventType, string> = {
  Tryout: 'tryout',
  Assessment: 'assessment',
  'Sort Out': 'sort_out',
  Combine: 'combine',
};
export const EVENT_TYPE_FROM_DB: Record<string, EventType> = {
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
  private accountPromise: Promise<string> | null = null;
  private profileCache: Record<string, UserProfile> = {};
  /** Membership role per account, filled in by ctx()'s memberships lookup. */
  private roleByAccountId: Record<string, string> = {};
  /** Onboarding flags already known to be set, so markOnboarding() can no-op. */
  private onboardingSteps: Record<string, boolean> | null = null;
  /**
   * Owning account per `tryouts`/`teams` row, keyed "table:id". A row never
   * changes hands, so this needs no invalidation — and a spreadsheet import
   * asks the same question once per player, which without this cost thirty
   * extra round trips to re-learn the same answer.
   */
  private ownerAccountByRow: Record<string, string> = {};
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
    // View as user only: every "whose rows" question is asked about that
    // person. Never cached into this.userId — that field tracks the real
    // session. Deliberately getImpersonatedUser(), not getViewedPerson():
    // this drives the FOUNDER'S OWN identity resolution (ctx()'s uId,
    // getSession()/loadUserProfile()'s subject) — org view must keep running
    // as the founder here, or refreshProfile()'s `current.user.id !==
    // profile.id` check (authStore.ts) sees a mismatch and silently drops
    // the impersonated profile, bouncing the founder straight back out.
    // getViewedPerson() (the union with the org's owner) is for the
    // person-scoped *list* reads only — managed teams, assessor assignments,
    // guardian rosters — never for whose identity the app runs as.
    const viewAsUser = getImpersonatedUser();
    if (viewAsUser) return viewAsUser.id;
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
      const previousUserId = this.userId;
      this.userId = nextUserId;
      this.profileCache = {};
      this.resetAccountCaches();
      // "View as" belongs to the founder's own session; it must not survive
      // signing out or someone else signing in on this tab. The first sign-in event after a
      // page load (no previous user in memory) is the same founder coming back, so a reload
      // keeps the view and its audit trail intact instead of silently ending it unlogged.
      const founderId = getImpersonationTarget()?.founderId;
      const userChanged =
        event === 'SIGNED_OUT' ||
        (previousUserId !== null && previousUserId !== nextUserId) ||
        (founderId !== undefined && nextUserId !== null && founderId !== nextUserId);
      if (userChanged && getImpersonationTarget()) useImpersonationStore.getState().setTarget(null);
    });
  }

  private async ctx(): Promise<{
    supabase: SupabaseClient;
    userId: string;
    accountId: string;
  }> {
    const supabase = getSupabase();
    const uId = await this.resolveUserId();

    const cached = this.accountId;
    if (cached) {
      return { supabase, userId: uId, accountId: cached };
    }

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

    // Deliberately the resolved value, not a re-read of `this.accountId`:
    // resetAccountCaches() nulls that field, and it can land while this await
    // is outstanding — the auth listener fires it on any identity change and
    // isStaleAccountError() fires it on a 42501 (which the web-only
    // get_evaluations_for_tryouts / get_event_availability RPCs raise when
    // they're missing their grants). Re-reading the field turned an unrelated
    // reset into a spurious "No account for user" on a perfectly valid
    // account. resolveAccount() still throws when there genuinely is none.
    const accountId = await pending;

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
   *
   * Also *returns* the id it resolved. Populating `this.accountId` alone isn't
   * enough for the caller: resetAccountCaches() can null that field between
   * this resolving and ctx() reading it back (the auth listener fires it on
   * any identity change, and isStaleAccountError() fires it on a 42501),
   * which surfaced as "No account for user" for a user who has one. ctx()
   * uses the returned value so an unrelated reset can't race its answer away.
   */
  private async resolveAccount(supabase: SupabaseClient, uId: string): Promise<string> {
    // The founder viewing the app as an organization. Only swaps which account
    // is asked for: every read still runs as the founder, and RLS lets a
    // platform admin read any account. Anyone else setting this just gets
    // nothing back, and writableAccountId() refuses writes while it is set.
    const impersonated = getImpersonationTarget();
    if (impersonated && !impersonated.user) {
      this.accountId = impersonated.accountId;
      this.roleByAccountId = {};
      return impersonated.accountId;
    }
    // View as user falls through to the ordinary lookup below with uId already
    // swapped for that person (resolveUserId()), so they land on exactly the
    // account they would. Their memberships exist already — no signup lag to
    // wait out.
    const retries = impersonated?.user ? 0 : RESOLVE_ACCOUNT_RETRIES;

    // Right after signup the membership row can lag a beat behind the session
    // the client already has — the account/membership insert happens
    // server-side, async from auth.signUp() resolving. A brand-new user's
    // first screen used to land in exactly that gap and see a permanent "No
    // account for user", even though the row shows up moments later. This
    // only ever fires for account-holding roles (guardians never reach ctx()
    // — see userCtx()), so retrying empty results briefly costs nothing on
    // the normal path and only adds latency to the rare genuine failure.
    let memberships: Row[] = [];
    for (let attempt = 0; attempt <= retries; attempt++) {
      const m = await supabase.from('memberships').select('account_id, role').eq('user_id', uId);
      if (m.error) throw m.error;
      memberships = m.data ?? [];
      if (memberships.length > 0 || attempt === retries) break;
      await sleep(400 * 2 ** attempt);
    }

    if (memberships.length === 0) {
      throw new Error('No account for user');
    }

    const sorted = memberships.sort(
      (a: Row, b: Row) => this.getRoleWeight(b.role) - this.getRoleWeight(a.role),
    );

    const accountId = sorted[0].account_id as string;
    this.accountId = accountId;
    // The role came back on the same row, so writableAccountId() never has
    // to go ask for it again.
    this.roleByAccountId = {};
    for (const row of memberships) this.roleByAccountId[row.account_id] = row.role;
    return accountId;
  }

  private async writableAccountId(): Promise<string> {
    if (getImpersonationTarget()) throw new Error(VIEW_AS_READ_ONLY_MESSAGE);
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
  /**
   * Forget the cached account and profile so the next read resolves them
   * again — for when the account being acted as changes without the signed-in
   * user changing (the founder entering or leaving "view as").
   */
  resetAccountContext(): void {
    this.profileCache = {};
    this.resetAccountCaches();
  }

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
      playerEmail: a.player_email ?? undefined,
      guardianName: a.guardian_name ?? undefined,
      guardianEmail: a.guardian_email ?? undefined,
      guardianPhone: a.guardian_phone ?? undefined,
      linkedGuardianId: a.guardian_user_id ?? undefined,
      yearOfBirth: a.year_of_birth != null ? String(a.year_of_birth) : undefined,
      dateOfBirth: a.date_of_birth ?? undefined,
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
      eventId: r.tryout_id ?? '',
      teamId: r.team_id ?? undefined,
      firstName: r.first_name,
      lastName: r.last_name,
      yearOfBirth: r.year_of_birth != null ? String(r.year_of_birth) : undefined,
      dateOfBirth: r.date_of_birth ?? undefined,
      positionTryingOutFor: r.position_trying_out_for ?? undefined,
      playerEmail: r.player_email ?? undefined,
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

    // Keyset-paged like every other batched read here (see fetchAllByIn):
    // `setof jsonb` from an RPC is still capped by PostgREST's db-max-rows,
    // same as a plain table read, so taking a single call's result as complete
    // silently truncated any tryout with more evaluations than that cap —
    // no error, no short-page signal, just a quietly undercounted roster.
    const rpcRows: Row[] = [];
    let cursor: string | null = null;
    for (;;) {
      const { data, error } = await supabase.rpc('get_evaluations_for_tryouts', {
        p_tryout_ids: ids,
        p_after_id: cursor,
        p_limit: EVALUATIONS_PAGE,
      });
      if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') {
          console.warn('get_evaluations_for_tryouts() not deployed — trying the embedded read.');
        } else {
          // A later page failing mid-read is not "not deployed" — returning what
          // was collected so far would silently undercount, same failure this
          // whole thing exists to avoid, so fall through for the true total.
          console.error('get_evaluations_for_tryouts failed — trying the embedded read.', error);
        }
        break;
      }
      const page = (data as Row[]) ?? [];
      rpcRows.push(...page);
      if (page.length < EVALUATIONS_PAGE) return rpcRows;
      cursor = page[page.length - 1].id as string;
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
    // Who is asking — every assembled tryout carries `viewerIsOwner`, and the
    // screens read it to decide whether this caller gets results, settings and
    // the danger zone or only the scoring flow.
    const { userId, accountId } = await this.ctx();
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
      // `friendPackages` shares the ai_assessments JSON blob with `teamBuilder`
      // rather than getting a column of its own — same reason: both are
      // assessment-scoped documents the app owns end to end, and neither is
      // ever queried by the database.
      const { teamBuilder, friendPackages, ...aiAssessments } = ai;
      const roster = (pByT[t.id] ?? []).map((p) => this.rowToPlayer(p, assessorNameById));
      // The lead assessor is the coach who ran the assessment (createTryout
      // seeds their own row as 'lead'), so they count as an owner even when
      // the row sits on another account — a club's, say.
      const myAssessorRole = (aByT[t.id] ?? []).find((a) => a.user_id === userId)?.role;
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
        endTime: t.end_time ?? undefined,
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
        viewerIsOwner:
          t.account_id === accountId || t[VIEWER_MANAGES_TEAM] === true || myAssessorRole === 'lead',
        teamBuilder,
        friendPackages,
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

  /**
   * supabase.rpc() for the auth.uid()-scoped list RPCs, answered for whoever
   * is being viewed as. The founder is a platform admin, so the tables behind
   * them are readable directly; these reads just apply the RPCs' own
   * predicates with the viewed identity in place of auth.uid():
   *
   * - view as user: the teams delegated to that person (team_managers), and the
   *   teams owned by the accounts they are owner/admin/coach on.
   * - view as organization: no delegations (an admin *of* the org), and the
   *   org's own teams. Calling the real RPCs here was wrong the other way —
   *   has_account_role() is true for a platform admin on every account, so
   *   list_*_on_my_owned_teams returned every cross-account assessment and
   *   season on the instance.
   *
   * Same `{ data, error }` shape as supabase.rpc(), so call sites keep their
   * degrade-on-error handling.
   */
  private async viewerRpc(
    supabase: SupabaseClient,
    name: ViewerScopedRpc,
  ): Promise<{ data: Row[] | null; error: { message: string } | null }> {
    const target = getImpersonationTarget();
    if (!target) {
      const { data, error } = await supabase.rpc(name);
      return { data: (data as Row[] | null) ?? null, error };
    }
    try {
      return { data: await this.emulateViewerRpc(supabase, name, target), error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  /**
   * An org view entered before the member list was recorded on the target
   * (sessionStorage outlives a deploy) would otherwise list no member's
   * managed teams or assessor assignments until the founder re-entered it.
   */
  private async ensureViewedMembers(supabase: SupabaseClient): Promise<void> {
    const target = getImpersonationTarget();
    if (!target || target.user || target.memberIds) return;
    const { data, error } = await supabase
      .from('memberships')
      .select('user_id, role')
      .eq('account_id', target.accountId);
    if (error) return;
    // Staff only — same rule as getOrganizationPeople(): a guardian's assignments
    // and delegated teams belong to whatever account they coach on, not this one.
    const memberIds = [
      ...new Set(
        ((data ?? []) as Row[])
          .filter((r) => r.role !== 'guardian')
          .map((r) => r.user_id as string)
          .filter(Boolean),
      ),
    ];
    // Only if the view hasn't changed while this was in flight.
    if (getImpersonationTarget() === target) useImpersonationStore.getState().setTarget({ ...target, memberIds });
  }

  private async emulateViewerRpc(
    supabase: SupabaseClient,
    name: ViewerScopedRpc,
    target: ImpersonationTarget,
  ): Promise<Row[]> {
    const newestFirst = (rows: Row[]) =>
      rows.sort((a, b) => toMs(b.created_at as string) - toMs(a.created_at as string));

    if (name === 'list_tryouts_on_my_owned_teams' || name === 'list_seasons_on_my_owned_teams') {
      let accountIds = [target.accountId];
      if (target.user) {
        const m = unwrap(
          await supabase
            .from('memberships')
            .select('account_id')
            .eq('user_id', target.user.id)
            .in('role', ['owner', 'admin', 'coach']),
        ) as Row[];
        accountIds = [...new Set(m.map((r) => r.account_id as string))];
      }
      const teams = await fetchAllByIn(supabase, 'teams', 'id, account_id', 'account_id', accountIds);
      const teamAccount = new Map(teams.map((t) => [t.id as string, t.account_id as string]));
      const table = name === 'list_tryouts_on_my_owned_teams' ? 'tryouts' : 'seasons';
      const rows = await fetchAllByIn(supabase, table, '*', 'team_id', [...teamAccount.keys()]);
      return newestFirst(
        rows.filter(
          (r) =>
            r.account_id !== teamAccount.get(r.team_id as string) &&
            (table === 'tryouts' ? !r.deleted_at : !r.archived),
        ),
      );
    }

    // Delegations belong to a person: the chosen user, or in org view every
    // member of the organization.
    await this.ensureViewedMembers(supabase);
    const personIds = getViewedPersonIds();
    if (!personIds.length) return [];
    const links = await fetchAllByIn(supabase, 'team_managers', 'id, team_id', 'user_id', personIds);
    const teamIds = [...new Set(links.map((l) => l.team_id as string))];

    switch (name) {
      case 'list_teams_managed_by_me':
        return newestFirst((await fetchAllByIn(supabase, 'teams', '*', 'id', teamIds)).filter((t) => !t.archived));
      case 'list_managed_team_owner_tiers':
        return (await fetchAllByIn(supabase, 'teams', 'id, accounts(plan_tier)', 'id', teamIds)).map((t) => {
          const account = (Array.isArray(t.accounts) ? t.accounts[0] : t.accounts) as Row | null;
          return { team_id: t.id, plan_tier: account?.plan_tier ?? null };
        });
      case 'list_tryouts_for_managed_teams':
        return newestFirst((await fetchAllByIn(supabase, 'tryouts', '*', 'team_id', teamIds)).filter((t) => !t.deleted_at));
      case 'list_seasons_for_managed_teams':
        return newestFirst((await fetchAllByIn(supabase, 'seasons', '*', 'team_id', teamIds)).filter((t) => !t.archived));
    }
    return [];
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────
  private async loadUserProfile(sessionUserId: string): Promise<UserProfile> {
    // View as user only (not getViewedPerson()/the org's owner) — see
    // resolveUserId()'s comment. Org view's profile/role/account stay the
    // founder's own identity with the org's account substituted in below.
    const viewAsUser = getImpersonatedUser();
    const userId = viewAsUser?.id ?? sessionUserId;
    if (this.profileCache[userId]) {
      return this.profileCache[userId];
    }
    const supabase = getSupabase();
    // Viewing as an organization overrides role and account below, so the
    // founder's own memberships and guardian-link never get read on this
    // path — no point paying for either query while impersonating.
    const impersonated = viewAsUser ? null : getImpersonationTarget();
    // Independent lookups, all keyed on a userId we already hold: the
    // profile row, the memberships that carry the account (and therefore the
    // plan), the Auth server's view of whether the address is confirmed, and
    // — while impersonating — the target org's own account row. Nothing here
    // feeds anything else here, so awaiting them one after another just
    // stacked round trips — measured at 1262ms + 755ms + 384ms, in front of
    // *every* login and every cold boot, since this sits on the path from
    // "signed in" to the first screen having a session at all. The account
    // row used to be fetched in a second await *after* this batch, which
    // added a full extra round trip to every "view as" switch.
    const [profileRes, membershipsRes, userRes, guardianRes, impersonatedAccountRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      // Every membership, not just the oldest one. A user can hold more than
      // one — a guardian row on a club's account and their own coaching
      // account, say — and taking whichever was created first handed the
      // profile the wrong account: role, plan tier, subscription status and
      // team licences all came off it. A coach who had first been added as a
      // guardian somewhere therefore signed in on the web as a free-tier
      // guardian, with no Upgrade or Plans & Billing anywhere, while ctx()
      // (which ranks by role) kept writing to their real account.
      impersonated
        ? Promise.resolve({ data: [], error: null })
        : supabase.from('memberships').select('role, accounts(*)').eq('user_id', userId),
      supabase.auth.getUser(),
      // Guardians never get a membership row (see below), so the only way to
      // tell "a guardian we haven't heard from yet" apart from "genuinely
      // nobody" is to check whether any athlete is actually linked to them.
      impersonated
        ? Promise.resolve({ data: null, error: null })
        : supabase.from('athletes').select('id').eq('guardian_user_id', userId).limit(1).maybeSingle(),
      impersonated
        ? supabase.from('accounts').select('*').eq('id', impersonated.accountId).single()
        : Promise.resolve({ data: null, error: null }),
    ]);

    // Unwrapped after the wave rather than inside it. A PostgREST call resolves
    // with `{ data, error }` instead of rejecting, so all three still complete
    // and a failing profile read throws from exactly the same place, with the
    // same error, as it did when these ran in series.
    // A profile read failing here would sign the founder out (getSession()'s
    // catch), so view as user settles for the name and email it was opened with.
    const profile = (
      viewAsUser && !profileRes.data
        ? { id: viewAsUser.id, email: viewAsUser.email ?? '', display_name: viewAsUser.name, created_at: null, onboarding_completed: true }
        : unwrap(profileRes)
    ) as Row;
    // A *failed* membership read must not be read as "this user has no
    // membership". Everything the account carries — plan tier, org name, extra
    // team licenses, Connect flags — is derived from this row, so swallowing
    // the error silently signed the coach in as free-tier and persisted that to
    // storage, where it stuck (and produced a bogus "you've reached your plan's
    // limit" banner) until something refetched the profile. Seen for real
    // against a transient 401. An empty list with no error still means what it
    // always did: a guardian, provisioned with a profile and no membership row.
    if (membershipsRes.error) throw membershipsRes.error;
    const memberships = (membershipsRes.data ?? []) as Row[];
    // Same ordering ctx() resolves the working account with, so the plan and
    // limits shown match the account writes actually go through.
    const membership = memberships
      .slice()
      .sort((a, b) => this.getRoleWeight(b.role as string) - this.getRoleWeight(a.role as string))[0] as
      | Row
      | undefined;
    // Viewing as an organization: its account stands in for the founder's own,
    // seen as its admin would see it. Fetched above, alongside everything else.
    const account = impersonated
      ? (unwrap(impersonatedAccountRes) as Row)
      : Array.isArray(membership?.accounts)
        ? membership.accounts[0]
        : (membership?.accounts as Row | undefined);

    const rawRole = impersonated ? 'admin' : (membership?.role ?? (guardianRes.data ? 'guardian' : undefined));
    const role = rawRole === 'owner' ? 'admin' : rawRole;

    const { data: uData } = userRes;
    const emailVerified = uData?.user?.email_confirmed_at != null || uData?.user?.confirmed_at != null || !uData?.user;

    const result = {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      organization: account?.type === 'organization' ? account.name : undefined,
      organizationLogoUrl: account?.logo_url ?? undefined,
      customLabels: (account?.custom_labels as UserProfile['customLabels']) ?? undefined,
      avatarUrl: profile.avatar_url ?? undefined,
      planTier: (account?.plan_tier as UserProfile['planTier']) ?? 'free',
      subscriptionStatus: account?.subscription_status,
      subscriptionCancelAt: account?.subscription_cancel_at
        ? toMs(account.subscription_cancel_at as string)
        : undefined,
      pendingPlanTier: (account?.pending_plan_tier as UserProfile['planTier']) ?? undefined,
      pendingPlanChangeAt: account?.pending_plan_change_at
        ? toMs(account.pending_plan_change_at as string)
        : undefined,
      extraTeamLicenses: account?.extra_team_licenses ?? 0,
      connectChargesEnabled: !!account?.stripe_connect_charges_enabled,
      connectPayoutsEnabled: !!account?.stripe_connect_payouts_enabled,
      // Guardians have no account, and nothing to suspend.
      accessStatus: account ? deriveAccountAccess(account) : undefined,
      suspendedReason: account?.suspended_reason ?? undefined,
      trialEndsAt: account?.trial_ends_at ? toMs(account.trial_ends_at as string) : undefined,
      trialExpired: account && isExpiredTrial(account) ? true : undefined,
      impersonating: impersonated || viewAsUser ? true : undefined,
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
    const { data, error } = await withAuthRetry(() => supabase.auth.signInWithPassword({ email, password }));
    if (error || !data.session) {
      // GoTrue returns this same generic message whether the password was
      // wrong or the account is simply gone — deleteUser() leaves nothing in
      // auth.users to tell those apart. deleted_accounts is the one record
      // left, so a failed login is worth the extra round trip to check it.
      if (error?.message === 'Invalid login credentials') {
        const { data: wasDeleted } = await supabase.rpc('email_was_deleted', { p_email: email });
        if (wasDeleted) throw new Error('This account no longer exists.');
      }
      throw new Error(authErrorMessage(error, 'Login failed. Please try again.'));
    }
    this.resetAccountCaches();
    this.userId = data.session.user.id;
    const user = await this.loadUserProfile(data.session.user.id);
    return this.toAuthSession(data.session, user);
  }

  async signup(displayName: string, email: string, password: string, accountType: string): Promise<AuthSession> {
    const supabase = getSupabase();
    const { data, error } = await withAuthRetry(() =>
      supabase.auth.signUp({
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
      }),
    );
    if (error) throw new Error(authErrorMessage(error, 'Failed to create your account. Please try again.'));

    // Signing up an address that already has an account is not an error as far
    // as Supabase is concerned: rather than confirm the address is taken, it
    // returns a success carrying an obfuscated user with an EMPTY `identities`
    // array, and sends no email whatsoever. Without this check that lands the
    // person on "Account created. Please confirm your email" and then a silent
    // wait for a message that was never dispatched — the exact dead end that
    // made the confirmation mail look broken while it was working fine.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      throw new Error(
        'An account already exists for this email. Try logging in, or use "Forgot password" to get back in.',
      );
    }

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

  async deleteAccount(): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase.functions.invoke('delete-account', {});
    if (error) throw new Error(authErrorMessage(error, 'Failed to delete your account. Please try again.'));
    await this.logout();
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
    if (updates.customLabels !== undefined) {
      // Unwrapped, unlike the account patch below: a non-admin's update matches
      // no row under RLS, and this one must say so rather than look saved.
      const res = await supabase
        .from('accounts')
        .update({ custom_labels: updates.customLabels })
        .eq('id', accountId)
        .select('id');
      if (res.error) throw new Error(res.error.message);
      if (!res.data?.length) throw new Error('Only an account owner or admin can rename these terms.');
    }
    if (updates.planTier !== undefined || updates.organization !== undefined || updates.organizationLogoUrl !== undefined) {
      const accPatch: Row = {};
      if (updates.organizationLogoUrl !== undefined) accPatch.logo_url = updates.organizationLogoUrl || null;
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
    if (error) throw new Error(authErrorMessage(error, 'Failed to update your password. Please try again.'));
  }

  async resendVerificationEmail(email: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await withAuthRetry(() =>
      supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: emailRedirectTo() },
      }),
    );
    if (error) throw new Error(authErrorMessage(error, 'Failed to resend the verification email. Please try again.'));
  }

  async requestPasswordReset(email: string): Promise<void> {
    const supabase = getSupabase();

    // Check if the user email is registered using RLS-safe function
    const exists = await this.checkUserExistsByEmail(email);
    if (!exists) {
      throw new Error('Email address not found');
    }

    // Goes through the request-password-reset function rather than
    // resetPasswordForEmail: that mints the same 8-digit recovery OTP
    // verifyPasswordResetOtp expects, but via the admin API, so the mail is
    // dispatched by our own SendGrid sender instead of Supabase's auth mailer.
    // Auth's mailer caps sends per hour per project, and a club resetting a few
    // accounts in a row was hitting "email rate limit exceeded"; this path has
    // no such cap. It is also what the mobile app already calls.
    const { error } = await supabase.functions.invoke('request-password-reset', {
      body: { email },
    });
    if (error) throw new Error(authErrorMessage(error, 'Failed to send the reset email. Please try again.'));
  }

  async verifyPasswordResetOtp(email: string, token: string): Promise<void> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    if (error) throw new Error(authErrorMessage(error, 'Failed to verify the code. Please try again.'));
    if (data.session) {
      this.resetAccountCaches();
      this.userId = null;
    }
  }

  async resetPasswordWithOtp(email: string, token: string, newPassword: string): Promise<void> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    if (error) throw new Error(authErrorMessage(error, 'Failed to verify the code. Please try again.'));
    if (!data.session) throw new Error('Failed to start session after OTP verification');
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) throw new Error(authErrorMessage(updateError, 'Failed to update your password. Please try again.'));
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
      sport: t.sport ?? undefined,
      logoUrl,
      season,
      collectsFees: t.collects_fees ?? undefined,
      registrationFeeCents: t.registration_fee_cents ?? undefined,
      brandColor: t.brand_color ?? undefined,
      registrationCode: t.registration_code ?? undefined,
      registrationOpen: t.registration_code ? (t.registration_open ?? false) : undefined,
      managed: managed || undefined,
      ownerPlanTier: managed ? ((ownerPlanTier as Team['ownerPlanTier']) ?? undefined) : undefined,
      createdAt: toMs(t.created_at),
      updatedAt: t.updated_at ? toMs(t.updated_at) : undefined,
      archived: t.archived || undefined,
      archivedReason:
        t.archived_reason === 'plan_downgrade' || t.archived_reason === 'user' ? t.archived_reason : undefined,
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
    const { data: managedRows, error: managedErr } = await this.viewerRpc(supabase, 'list_teams_managed_by_me');
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
    const { data: tierRows } = await this.viewerRpc(supabase, 'list_managed_team_owner_tiers');
    const tierByTeamId = new Map(((tierRows ?? []) as Row[]).map((r) => [r.team_id, r.plan_tier as string]));

    const managed = ((managedRows ?? []) as Row[])
      // An owner/admin delegating a team to themselves would otherwise show it
      // twice; their own-account row wins, since it carries full rights.
      .filter((t) => !ownIds.has(t.id))
      .map((t) => this.rowToTeam(t, true, tierByTeamId.get(t.id)));

    return [...own, ...managed];
  }

  async listArchivedTeams(): Promise<Team[]> {
    const { supabase, accountId } = await this.ctx();
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .eq('account_id', accountId)
      .eq('archived', true)
      // Deleting a team also sets archived, with no reason — only the ones the
      // coach archived or a plan downgrade retired are offered back.
      .in('archived_reason', ['plan_downgrade', 'user'])
      .order('created_at', { ascending: true });
    if (error) {
      // Pre-migration instances have no archived_reason column, so nothing can
      // have been archived in a restorable way there: the list is simply empty.
      console.log('archived_reason unavailable:', error.message);
      return [];
    }
    return ((data ?? []) as Row[]).map((t) => this.rowToTeam(t));
  }

  async restoreTeam(id: string): Promise<Team> {
    const { supabase } = await this.ctx();
    const row = unwrap(
      await supabase
        .from('teams')
        .update({ archived: false, archived_reason: null })
        .eq('id', id)
        .in('archived_reason', ['plan_downgrade', 'user'])
        .select()
        .maybeSingle(),
    ) as Row | null;
    if (!row) {
      throw new Error("This team couldn't be restored. It may already be back, or you may not have access to it.");
    }
    // Its schedule comes back with it — only the seasons archived along with
    // the team, not one the coach had archived on its own.
    unwrap(
      await supabase
        .from('seasons')
        .update({ archived: false, archived_reason: null })
        .eq('team_id', id)
        .in('archived_reason', ['plan_downgrade', 'user'])
        .select(),
    );
    return this.rowToTeam(row);
  }

  async archiveTeam(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    // Unlike deleteTeam, the team's evaluations stay attached: the team comes
    // back with everything it had. `archived_reason = 'user'` is what tells this
    // apart from a delete, which leaves the reason empty and stays gone.
    const { data, error } = await supabase
      .from('teams')
      .update({ archived: true, archived_reason: 'user' })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) {
      if (/archived_reason/.test(error.message)) {
        throw new Error('Archiving teams needs a database update that has not been applied yet.');
      }
      throw new Error(error.message);
    }
    // Same silent-no-op trap as deleteTeam: an RLS-blocked update matches no rows.
    if (!data) {
      throw new Error(
        "This team couldn't be archived. You need to be an owner, admin, or coach on the account that owns it.",
      );
    }
    // Its schedule goes with it; only seasons still live are touched, so one the
    // coach had already archived is not brought back with the team.
    unwrap(
      await supabase
        .from('seasons')
        .update({ archived: true, archived_reason: 'user' })
        .eq('team_id', id)
        .eq('archived', false)
        .select(),
    );
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

  async createTeam(name: string, season?: string, sport?: string): Promise<Team> {
    return this.withFreshAccount((guard) => this._createTeam(name, season, guard, sport));
  }

  private async _createTeam(name: string, season: string | undefined, guard: WriteGuard, sport?: string): Promise<Team> {
    const { supabase } = await this.ctx();
    const accountId = await this.writableAccountId();
    const base = { account_id: accountId, name, season_label: season ?? null };
    let created = await supabase
      .from('teams')
      .insert({ ...base, ...(sport ? { sport } : {}) })
      .select()
      .single();
    // A database without the team sport column yet: make the team without it.
    if (created.error && sport && /sport/i.test(created.error.message)) {
      created = await supabase.from('teams').insert(base).select().single();
    }
    const row = unwrap(created) as Row;
    guard.wrote = true;
    await this.markOnboarding({ createTeam: true });
    return this.rowToTeam(row);
  }

  /**
   * A team's own roster. Independent of assessments — an athlete stays on the
   * team even if the assessment they were picked from is archived or deleted.
   */
  async listTeamRoster(teamId: string): Promise<TeamRosterPlayer[]> {
    const { supabase, accountId, userId } = await this.ctx();
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
    return rows.map((r) => this.rowToTeamRosterPlayer(r, { accountId, userId }));
  }

  /**
   * One page of a team's roster, in the same (created_at, id) order
   * listTeamRoster returns.
   *
   * The screen-facing counterpart to listTeamRoster(), which reads every player
   * on the team before the Players tab can draw a row — on a club-sized team
   * that's several 200-row pages, each paying can_access_athlete() per row
   * through the `athletes` embed, to fill a list the coach scrolls a screenful
   * of. Here the first page is one statement and the rest are read only if the
   * coach asks for them.
   *
   * Keyset rather than offset, for the reason fetchAllByIn gives: an OFFSET
   * re-authorizes every row it skips, so the last page of a big roster would
   * cost the whole roster again. `nextCursor` is undefined once a short page
   * says the server had nothing left to give.
   *
   * `search` is applied server-side, so it searches the whole roster rather
   * than only the pages already pulled down.
   *
   * The flows that genuinely need everyone — the "already on this team" flags
   * in the player picker, plan-limit checks — still read the whole roster.
   */
  async listTeamRosterPage(
    teamId: string,
    opts?: { after?: TeamRosterCursor; limit?: number; search?: string },
  ): Promise<{ players: TeamRosterPlayer[]; nextCursor?: TeamRosterCursor }> {
    const { supabase, accountId, userId } = await this.ctx();
    const limit = opts?.limit ?? TEAM_ROSTER_SCREEN_PAGE;
    const search = opts?.search?.trim() ?? '';

    if (search) {
      const allPlayers = await this.listTeamRoster(teamId);
      const searchLower = search.toLowerCase();
      const parts = searchLower.split(/\s+/).filter(Boolean);
      const filtered = allPlayers.filter((p) => {
        const fullName = `${p.first} ${p.last}`.toLowerCase();
        const jersey = p.jersey?.toLowerCase() ?? '';
        const pos = p.pos?.toLowerCase() ?? '';
        return (
          parts.every((part) => fullName.includes(part) || jersey.includes(part) || pos.includes(part)) ||
          fullName.includes(searchLower) ||
          jersey.includes(searchLower)
        );
      });

      let startIndex = 0;
      if (opts?.after) {
        const { id } = opts.after;
        const afterIdx = filtered.findIndex((p) => p.id === id);
        if (afterIdx !== -1) {
          startIndex = afterIdx + 1;
        }
      }
      const pagePlayers = filtered.slice(startIndex, startIndex + limit);
      const last = pagePlayers[pagePlayers.length - 1];
      const hasMore = startIndex + limit < filtered.length;
      return {
        players: pagePlayers,
        nextCursor: hasMore && last ? { createdAt: '', id: last.id } : undefined,
      };
    }

    let q = supabase
      .from('team_roster')
      .select(teamRosterSelect())
      .eq('team_id', teamId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);

    if (opts?.after) {
      const { createdAt, id } = opts.after;
      q = q.or(`created_at.gt."${createdAt}",and(created_at.eq."${createdAt}",id.gt.${id})`);
    }

    const rows = ((unwrap(await q) ?? []) as unknown) as Row[];
    const last = rows[rows.length - 1];
    return {
      players: rows.map((r) => this.rowToTeamRosterPlayer(r, { accountId, userId })),
      // A short page means there is nothing after it.
      nextCursor:
        rows.length === limit && last
          ? { createdAt: last.created_at as string, id: last.id as string }
          : undefined,
    };
  }

  /**
   * Just the athlete ids on a team's roster.
   *
   * What "is this athlete already on the team?" and "how many players are on
   * it?" actually need — the picker's flags, the tab badge, the plan's per-team
   * limit and the RSVP list's narrowing to current team members — without the
   * `athletes` embed that makes the full roster read expensive (one
   * can_access_athlete() per row). One column, and the answer stays correct for
   * a player on a page of the list nobody has scrolled to.
   */
  async listTeamRosterAthleteIds(teamId: string): Promise<string[]> {
    const { supabase } = await this.ctx();
    // `id` rides along only because keyset paging orders by it.
    const rows = await fetchAllByIn(supabase, 'team_roster', 'id, athlete_id', 'team_id', [teamId]);
    return rows.map((r) => r.athlete_id as string).filter(Boolean);
  }

  private rowToTeamRosterPlayer(r: Row, viewer: { accountId: string; userId: string }): TeamRosterPlayer {
    const rawAthlete = r.athletes;
    const a = (Array.isArray(rawAthlete) ? rawAthlete[0] : rawAthlete) ?? {};
    const rawSource = r.tryouts;
    const src = (Array.isArray(rawSource) ? rawSource[0] : rawSource) ?? {};
    // Same rule as getPlayerProfile: medical is visible only to the account
    // this athlete actually belongs to, or to their own linked guardian — not
    // to a delegated team manager, who legitimately gets every other field on
    // this row.
    const canViewMedical = a.account_id === viewer.accountId || a.guardian_user_id === viewer.userId;
    return {
      id: r.id,
      athleteId: r.athlete_id,
      first: a.first_name ?? '',
      last: a.last_name ?? '',
      jersey: r.jersey ?? undefined,
      pos: r.position ?? undefined,
      yearOfBirth: a.year_of_birth ?? undefined,
      dateOfBirth: a.date_of_birth ?? undefined,
      playerEmail: a.player_email ?? undefined,
      guardianEmail: a.guardian_email ?? undefined,
      guardianName: a.guardian_name ?? undefined,
      guardianPhone: a.guardian_phone ?? undefined,
      linkedGuardianId: a.guardian_user_id ?? undefined,
      medicalInfo: canViewMedical ? (a.medical_info ?? undefined) : undefined,
      canViewMedical,
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

    // A season's roster is normally seeded from tryout_participants when the
    // season is *created* (createSeason) — a player added to the team roster
    // afterwards never gets that backfill. Season membership is what grants a
    // player's guardian access to the team (can_access_season): the fee status,
    // the schedule, and the team chat all key off it, so this syncs on every
    // add rather than only for fee-collecting teams. Teams with no season yet
    // are left alone; the flows that create one already sync the roster too.
    const { data: currentSeason } = await supabase
      .from('seasons')
      .select('id')
      .eq('team_id', teamId)
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (currentSeason) {
      const seasonRows = [...byAthlete.values()].map((e) => ({
        season_id: currentSeason.id,
        athlete_id: e.athleteId,
      }));
      for (let i = 0; i < seasonRows.length; i += CHUNK_SIZE) {
        await supabase
          .from('season_roster')
          .upsert(seasonRows.slice(i, i + CHUNK_SIZE), { onConflict: 'season_id,athlete_id', ignoreDuplicates: true });
      }
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
    _guard: WriteGuard,
  ): Promise<{ athleteId: string }> {
    // Same owning-account rule as _addPlayer: a manager running a club's team
    // holds no membership on that club, and an athlete they create under their
    // own account is one the club cannot read.
    const ownerAccountId = await this.ownerAccountId('teams', teamId);
    const callerAccountId = await this.writableAccountIdOrNull();
    // A null owner means the row couldn't be read, not that it belongs to
    // someone else — falling back to the caller's own account there keeps a
    // coach whose lookup blipped on exactly the path they had before.
    const writesAsOwner =
      callerAccountId !== null && (ownerAccountId === null || callerAccountId === ownerAccountId);
    if (callerAccountId === null && ownerAccountId === null) {
      throw new Error('Current account lacks write permissions for this operation.');
    }

    let athleteId = form.athleteId;
    if (typeof athleteId === 'object' && athleteId !== null) {
      athleteId = String((athleteId as unknown as { id?: string }).id || athleteId);
    }
    if (!athleteId) {
      const fields: Row = {
        first_name: form.first,
        last_name: form.last,
        year_of_birth: form.yearOfBirth ? Number(form.yearOfBirth) : null,
        guardian_name: form.guardianName || null,
        guardian_email: form.guardianEmail || null,
        guardian_phone: form.guardianPhone || null,
        player_email: form.playerEmail || null,
        medical_info: form.medicalInfo || null,
        about: form.aboutChild || null,
        avatar_url: form.avatarUrl || null,
      };
      athleteId = writesAsOwner
        ? await this.createAthlete(callerAccountId!, fields)
        : await this.createAthleteForOwner({ teamId }, fields);
    }
    await this.saveDateOfBirth(athleteId, form.dateOfBirth || undefined);
    await this.addTeamRosterPlayers(teamId, [{ athleteId, jersey: form.jersey, pos: form.pos }]);
    return { athleteId };
  }

  /**
   * Edit an existing team-roster player — the athlete's own fields (name,
   * contact, guardian, medical) plus this team's jersey/position, which live
   * on team_roster rather than the athlete.
   *
   * Both tables carry `for all` policies for the team's owner and its
   * delegated managers, so this writes directly rather than routing through
   * the owner/RPC dance _addManualTeamPlayer needs for creating a brand new
   * athlete row.
   */
  /**
   * Save a player's full date of birth. Kept apart from the rest of the athlete's
   * fields on purpose: the create paths go through server functions that name
   * their columns, and a failure here (the column not deployed yet, say) must never
   * cost the coach the player they were saving, so it is logged rather than thrown.
   * `undefined` means "not given", '' clears it.
   */
  private async saveDateOfBirth(athleteId: string, dateOfBirth: string | null | undefined): Promise<void> {
    if (dateOfBirth === undefined || !athleteId) return;
    const { supabase } = await this.ctx();
    const { error } = await supabase
      .from('athletes')
      .update({ date_of_birth: dateOfBirth || null })
      .eq('id', athleteId);
    if (error) console.warn('Could not save the date of birth:', error.message);
  }

  /** Full dates of birth for many athletes, a few requests at a time. See BulkImportDeps.saveDatesOfBirth. */
  private async saveDatesOfBirth(entries: { athleteId: string; dateOfBirth: string }[]): Promise<void> {
    for (let i = 0; i < entries.length; i += 10) {
      await Promise.all(entries.slice(i, i + 10).map((e) => this.saveDateOfBirth(e.athleteId, e.dateOfBirth)));
    }
  }

  async updateTeamRosterPlayer(teamId: string, athleteId: string, form: AddPlayerForm): Promise<void> {
    const { supabase } = await this.ctx();
    await this.saveDateOfBirth(athleteId, form.dateOfBirth);

    const athletePatch: Row = {
      first_name: form.first,
      last_name: form.last,
      year_of_birth: form.yearOfBirth ? Number(form.yearOfBirth) : null,
      guardian_name: form.guardianName || null,
      guardian_email: form.guardianEmail || null,
      guardian_phone: form.guardianPhone || null,
      player_email: form.playerEmail || null,
    };
    // `about` is deliberately left untouched: the team-roster read
    // (TeamRosterPlayerSchema) never carries it, so there is no reliable
    // value here to round-trip — writing it would just blank out whatever an
    // assessment roster set.
    //
    // medical_info and avatar_url are only touched when the caller explicitly
    // sent them. TeamRosterPlayerSchema omits medical_info for anyone without
    // canViewMedical, and never carries avatar_url at all (only the
    // assessment-scoped Player record does on web) — either way, an untouched
    // field here means "unknown", not "clear it".
    if (form.medicalInfo !== undefined) athletePatch.medical_info = form.medicalInfo || null;
    if (form.avatarUrl !== undefined) athletePatch.avatar_url = form.avatarUrl || null;

    unwrap(await supabase.from('athletes').update(athletePatch).eq('id', athleteId));

    unwrap(
      await supabase
        .from('team_roster')
        .update({ jersey: form.jersey || null, position: form.pos || null })
        .eq('team_id', teamId)
        .eq('athlete_id', athleteId),
    );

    // The same athlete also sits in any evaluation they were pulled into, each
    // with its own jersey and position. Keep those in step, or the profile the
    // coach just corrected would still read the old number there.
    unwrap(
      await supabase
        .from('tryout_participants')
        .update({ jersey: form.jersey || null, position: form.pos || null })
        .eq('athlete_id', athleteId),
    );
  }

  /**
   * Shared body of the two roster imports: run `add` over the rows and collect
   * the outcome of each.
   *
   * Serial on purpose, where nearly every other fan-out in this file is
   * pooled. Adding a player provisions a guardian login and mails it, so a
   * pooled import would fire twenty auth writes and twenty emails at once, and
   * two rows sharing a guardian address would race each other to create the
   * same account. A roster is tens of rows, not thousands, and the caller shows
   * a progress bar.
   */
  private async importPlayers(
    rows: { line: number; form: AddPlayerForm }[],
    add: (form: AddPlayerForm) => Promise<unknown>,
    onProgress?: (done: number) => void,
  ): Promise<PlayerImportResult> {
    const result: PlayerImportResult = { added: 0, failed: [], athleteIds: [], participantIds: [] };
    for (const [i, { line, form }] of rows.entries()) {
      try {
        // Whatever the add path hands back; the team one returns the athlete it
        // landed and the evaluation one a whole Player, both of which the
        // caller needs to invite exactly the imported players rather than
        // re-mailing the whole roster.
        const added = (await add(form)) as { athleteId?: string; id?: string } | undefined;
        if (added?.athleteId) result.athleteIds!.push(added.athleteId);
        if (added?.id) result.participantIds!.push(added.id);
        result.added++;
      } catch (e) {
        result.failed.push({
          line,
          name: `${form.first} ${form.last}`.trim() || 'Unnamed player',
          message: e instanceof Error ? e.message : 'Could not add this player.',
        });
      }
      onProgress?.(i + 1);
    }
    return result;
  }

  async importTryoutPlayers(
    tryoutId: string,
    rows: { line: number; form: AddPlayerForm }[],
    onProgress?: (done: number) => void,
  ): Promise<PlayerImportResult> {
    const oneAtATime = () =>
      this.importPlayers(rows, (form) => this.addPlayer(tryoutId, form), onProgress);

    // Same gate as the team import below: the batched path files every athlete
    // under the caller's own account, which is right only when that account
    // owns the evaluation. An invited assessor or delegated manager keeps the
    // per-row path (its owner-side RPC has no batch form), as does a row naming
    // an existing athlete.
    const ownerAccountId = await this.ownerAccountId('tryouts', tryoutId);
    const callerAccountId = await this.writableAccountIdOrNull();
    const writesAsOwner =
      callerAccountId !== null && (ownerAccountId === null || callerAccountId === ownerAccountId);
    if (!writesAsOwner || rows.some((r) => r.form.athleteId)) return oneAtATime();

    const supabase = getSupabase();
    const result = await bulkImportPlayers(
      rows,
      {
        saveDatesOfBirth: (entries) => this.saveDatesOfBirth(entries),
        resolveGuardians: (forms) =>
          this.resolveGuardiansForRegistrations(
            supabase,
            forms.map((f) => ({ guardian_email: f.guardianEmail, guardian_name: f.guardianName })),
          ),
        createAthletes: async (payloads) => {
          const { data, error } = await supabase.rpc('create_athletes_for_caller', {
            account_hint: callerAccountId,
            players: payloads,
          });
          if (error) throw new Error(error.message);
          return (data ?? []) as string[];
        },
        // An upsert on the (tryout_id, athlete_id) key, so bulkImportPlayers
        // retrying a batch row-by-row after a failure can't trip over the
        // participants an earlier chunk already wrote.
        addToRoster: async (entries) => {
          const byAthlete = new Map<string, string>();
          for (let i = 0; i < entries.length; i += IMPORT_CREATE_CHUNK) {
            const chunk = entries.slice(i, i + IMPORT_CREATE_CHUNK).map(({ athleteId, form }) => ({
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
            }));
            const inserted = unwrap(
              await supabase
                .from('tryout_participants')
                .upsert(chunk, { onConflict: 'tryout_id,athlete_id' })
                .select('id, athlete_id'),
            ) as Row[];
            for (const r of inserted) byAthlete.set(r.athlete_id, r.id);
          }
          return byAthlete;
        },
        addOne: async (form) => {
          const player = await this.addPlayer(tryoutId, form);
          return { athleteId: player.athleteId ?? '', participantId: player.id };
        },
      },
      onProgress,
    );
    // addPlayer() flags this per player; the batched path does it once.
    if (result.added > 0) await this.markOnboarding({ addPlayers: true });
    return result;
  }

  async importTeamRosterPlayers(
    teamId: string,
    rows: { line: number; form: AddPlayerForm }[],
    onProgress?: (done: number) => void,
  ): Promise<PlayerImportResult> {
    const oneAtATime = () =>
      this.importPlayers(rows, (form) => this.addManualTeamPlayer(teamId, form), onProgress);

    // The batched path files every athlete under the caller's own account, which
    // is right only when that account owns the team. A delegated manager, or
    // anyone whose ownership couldn't be read, keeps the per-row path — its
    // owner-side RPC has no batch form. A row naming an existing athlete isn't
    // a spreadsheet row and takes the same path.
    const ownerAccountId = await this.ownerAccountId('teams', teamId);
    const callerAccountId = await this.writableAccountIdOrNull();
    const writesAsOwner =
      callerAccountId !== null && (ownerAccountId === null || callerAccountId === ownerAccountId);
    if (!writesAsOwner || rows.some((r) => r.form.athleteId)) return oneAtATime();

    const supabase = getSupabase();
    return bulkImportPlayers(
      rows,
      {
        saveDatesOfBirth: (entries) => this.saveDatesOfBirth(entries),
        resolveGuardians: (forms) =>
          this.resolveGuardiansForRegistrations(
            supabase,
            forms.map((f) => ({ guardian_email: f.guardianEmail, guardian_name: f.guardianName })),
          ),
        createAthletes: async (payloads) => {
          const { data, error } = await supabase.rpc('create_athletes_for_caller', {
            account_hint: callerAccountId,
            players: payloads,
          });
          if (error) throw new Error(error.message);
          return (data ?? []) as string[];
        },
        addToRoster: async (entries) => {
          await this.addTeamRosterPlayers(teamId, entries);
        },
        addOne: (form) => this.addManualTeamPlayer(teamId, form),
      },
      onProgress,
    );
  }

  async removeTeamRosterPlayers(
    teamId: string,
    athleteIds: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    const unique = [...new Set(athleteIds.filter(Boolean))];
    if (unique.length === 0) return;
    const { supabase } = await this.ctx();
    // Ids ride in the query string of each request, so they go in modest chunks.
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += TEAM_ROSTER_REMOVE_CHUNK) {
      chunks.push(unique.slice(i, i + TEAM_ROSTER_REMOVE_CHUNK));
    }
    let deleted = 0;
    let processed = 0;
    onProgress?.(0, unique.length);
    await mapPool(chunks, TEAM_ROSTER_REMOVE_CONCURRENCY, async (chunk) => {
      const rows = unwrap(
        await supabase.from('team_roster').delete().eq('team_id', teamId).in('athlete_id', chunk).select('id'),
      ) as Row[] | null;
      deleted += rows?.length ?? 0;
      processed += chunk.length;
      onProgress?.(processed, unique.length);
    });
    if (deleted >= unique.length) return;

    // Fewer rows came back than were asked for. Either someone else already
    // removed some (fine) or RLS filtered them out without an error (not fine),
    // and only a re-read tells the two apart.
    let remaining = 0;
    await mapPool(chunks, TEAM_ROSTER_REMOVE_CONCURRENCY, async (chunk) => {
      const { data } = await supabase.from('team_roster').select('id').eq('team_id', teamId).in('athlete_id', chunk);
      remaining += data?.length ?? 0;
    });
    if (remaining > 0) {
      throw new Error(
        `Could not remove ${remaining} of ${unique.length} players. You may not have permission to change this team’s roster.`,
      );
    }
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

  /**
   * Invite a team's roster to the player/guardian portal.
   *
   * The season equivalent (sendPortalInvite) takes one player and one address
   * chosen by the caller. A team roster is invited as a set, and each player has
   * up to two addresses — their own and their guardian's — so the recipient list
   * is derived here rather than passed in.
   *
   * Every address is attempted. A player with no email on file, or an address
   * the send-email function rejects, is reported back rather than thrown: on a
   * roster of any size at least one of those is normal, and failing the whole
   * batch on it would leave the coach unable to tell who was actually invited.
   *
   * `emails` narrows the derived recipient list down to specific addresses, so
   * a caller that already has one address in hand — the "Invite" button beside
   * an email field on the add-player form — can send to just that one.
   */
  async sendTeamRosterInvites(
    teamId: string,
    athleteIds?: string[],
    emails?: string[],
  ): Promise<TeamInviteResult> {
    const { supabase } = await this.ctx();

    // portal_invites.account_id is the *team's* owning account, not the
    // caller's: for a delegated team those differ, and its RLS policy is keyed
    // to the former — the same account team_roster's own policy checks.
    // accounts(name) rides along so the invite email can name the club that sent
    // it — a guardian with children at two clubs can't tell them apart otherwise.
    const team = unwrap(
      await supabase.from('teams').select('id, account_id, name, accounts(name)').eq('id', teamId).maybeSingle(),
    ) as Row | null;
    if (!team) throw new Error('Team not found');
    const rawAccount = team.accounts;
    const clubName = (Array.isArray(rawAccount) ? rawAccount[0] : rawAccount)?.name as string | undefined;

    const roster = await this.listTeamRoster(teamId);
    const invitees = athleteIds
      ? roster.filter((p) => athleteIds.includes(p.athleteId))
      : roster;

    const result: TeamInviteResult = { sent: [], failed: [], skipped: [] };

    // One work item per (player, address). A player and their guardian each get
    // their own invite row and token, so accepting one doesn't consume the other.
    // The role travels with the address because the email is worded differently
    // for the player than for their guardian; when one address is on file as
    // both, Player wins and it's only sent once.
    // Addresses are matched case-insensitively: the caller's copy of an address
    // comes off a form field, and mail addresses don't round-trip case.
    const wanted = emails?.length ? new Set(emails.map((e) => e.trim().toLowerCase())) : null;
    const targets: { player: TeamRosterPlayer; email: string; role: 'Player' | 'Guardian' }[] = [];
    for (const p of invitees) {
      const byEmail = new Map<string, 'Player' | 'Guardian'>();
      const guardian = p.guardianEmail?.trim();
      if (guardian) byEmail.set(guardian, 'Guardian');
      const own = p.playerEmail?.trim();
      if (own) byEmail.set(own, 'Player');
      const chosen = wanted
        ? [...byEmail].filter(([email]) => wanted.has(email.toLowerCase()))
        : [...byEmail];
      if (chosen.length === 0) {
        result.skipped.push(`${p.first} ${p.last}`.trim() || 'Unnamed player');
        continue;
      }
      for (const [email, role] of chosen) targets.push({ player: p, email, role });
    }

    if (targets.length === 0) return result;

    // Same bounded fan-out as the other per-recipient email loops — each target
    // is an insert plus a send-email call, and a full roster sent serially is
    // the dominant cost of the whole operation.
    await mapPool(targets, GUARDIAN_EMAIL_CONCURRENCY, async ({ player, email, role }) => {
      try {
        await this.insertPortalInvite(
          {
            account_id: team.account_id,
            athlete_id: player.athleteId,
            team_id: teamId,
            email,
            token: generateId('invite').slice(0, 20),
          },
          { teamId },
        );
        await this.sendEmail('player_invite', email, {
          playerName: `${player.first} ${player.last}`.trim(),
          teamName: team.name,
          clubName,
          jersey: player.jersey,
          position: player.pos,
          role,
        });
        result.sent.push(email);
      } catch (e) {
        result.failed.push({ email, message: e instanceof Error ? e.message : 'Could not send invite.' });
      }
    });

    return result;
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
    if (updates.sport !== undefined) patch.sport = updates.sport || null;
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
  ): Promise<import('../types').TeamManager> {
    const { supabase } = await this.ctx();

    // Read server-side rather than trusting a client-supplied team name — this
    // is the only place that name reaches an email. It runs alongside the invite
    // RPC rather than before it: the two are independent, and awaiting them in
    // series made adding a manager visibly slow.
    const teamNameRead = Promise.resolve(
      supabase.from('teams').select('name').eq('id', teamId).maybeSingle(),
    ).then((r) => ((r.data as Row | null)?.name as string | undefined) || 'a team', () => 'a team');

    const invite = async () =>
      await supabase.rpc('invite_team_manager_by_email', {
        team_uuid: teamId,
        lookup_email: email.trim(),
        manager_role: role,
      });

    const { data, error } = await invite();
    if (error) {
      // Only the pre-invites RPC still says this: it cannot save an invite for
      // an address with no account. Name the real cause.
      if (error.message.includes('User not found')) {
        throw new Error(
          'This address has no SquadOwl account yet, and saved invitations need the 20260923130000_team_manager_invites migration applied first.',
        );
      }
      throw error;
    }

    // No account yet: the RPC saved the invite against this address and it is
    // turned into access the moment they sign up with it. The email asks them
    // to create the account; nothing is created for them and no password is sent.
    const newUser = (data as { pending?: boolean } | null)?.pending === true;
    // The invite is already saved, so the caller should not wait on the mail
    // provider. Send in the background and retry once, since a cold edge
    // function is the usual reason a first send fails.
    const inviteUrl = `${actualOrigin() ?? 'https://www.tryouthq.ca'}/${newUser ? 'signup' : 'login'}`;
    void (async () => {
      const teamName = await teamNameRead;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await this.sendEmail('team_manager_invite', email.trim(), { teamName, role, newUser, inviteUrl });
          return;
        } catch (e) {
          if (attempt === 1) console.log('Failed to send team manager invite email:', e);
        }
      }
    })();

    return this.rowToTeamManager(data);
  }

  async removeTeamManager(managerId: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.rpc('remove_team_manager', { manager_id: managerId });
    if (error) throw error;
  }

  /**
   * Every delegated manager across the given teams, flattened.
   *
   * Goes team by team through list_team_managers because that is the only read
   * the backend exposes — `team_managers` itself is reached through those RPCs
   * everywhere else in the app, and a direct select that RLS filtered would
   * come back empty with no error, quietly showing an org no managers at all.
   * Callers are expected to be screens, not the every-route permission read.
   */
  private async fetchTeamManagers(teamIds: string[]): Promise<import('../types').TeamManager[]> {
    if (teamIds.length === 0) return [];
    const lists = await Promise.all(teamIds.map((id) => this.listTeamManagers(id)));
    // Saved invites have no account behind them, so they are not org members yet.
    return lists.flat().filter((m) => !m.pending);
  }

  private rowToTeamManager(r: Row): import('../types').TeamManager {
    return {
      id: r.id,
      teamId: r.teamId ?? r.team_id,
      userId: r.userId ?? r.user_id ?? undefined,
      email: r.email,
      name: r.name ?? undefined,
      role: (r.role ?? 'manager') as import('../types').TeamManagerRole,
      pending: r.pending === true,
      createdAt: r.created_at ? toMs(r.created_at) : Date.now(),
    };
  }

  async uploadTeamLogo(teamId: string, fileUri: string, fileType: string): Promise<string> {
    return this.uploadAvatarsImage(`teams/${teamId}`, fileUri, fileType);
  }

  /** The signed-in account's own logo, printed on exported reports. */
  async uploadOrganizationLogo(fileUri: string, fileType: string): Promise<string> {
    const { accountId } = await this.ctx();
    return this.uploadAvatarsImage(`organizations/${accountId}`, fileUri, fileType);
  }

  /** Uploads a local image to the public avatars bucket at `pathWithoutExt` and returns its cache-busted public URL. */
  private async uploadAvatarsImage(pathWithoutExt: string, fileUri: string, fileType: string): Promise<string> {
    const { supabase } = await this.ctx();

    const buffer = await uriToArrayBuffer(fileUri);
    const fileExtension = fileType.split('/')[1] || 'jpg';
    const filePath = `${pathWithoutExt}.${fileExtension}`;

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
      this.viewerRpc(supabase, 'list_tryouts_for_managed_teams'),
      this.viewerRpc(supabase, 'list_tryouts_on_my_owned_teams'),
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
        extra.push({ ...t, [VIEWER_MANAGES_TEAM]: true });
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

  async listSearchPlayers(): Promise<SearchPlayer[]> {
    const { supabase } = await this.ctx();
    const tryoutRows = await this.fetchVisibleTryoutRows(false);
    if (tryoutRows.length === 0) return [];
    const nameById = new Map(tryoutRows.map((t) => [t.id as string, t.name as string]));

    // `removed_at is null` is applied server-side, so soft-removed players never
    // cross the wire (see fetchAllByIn).
    const rows = await fetchAllByIn(
      supabase,
      'tryout_participants',
      'id, tryout_id, athlete_id, jersey, position, athletes(first_name, last_name, year_of_birth)',
      'tryout_id',
      [...nameById.keys()],
      PARTICIPANTS_PAGE,
      'removed_at',
    );

    return rows.map((r) => {
      const raw = r.athletes;
      const a = (Array.isArray(raw) ? raw[0] : raw) ?? {};
      return {
        id: r.id as string,
        athleteId: (r.athlete_id as string | null) ?? undefined,
        yob: a.year_of_birth ?? undefined,
        first: a.first_name ?? '',
        last: a.last_name ?? '',
        jersey: r.jersey ?? undefined,
        pos: r.position ?? undefined,
        tryoutId: r.tryout_id as string,
        tryoutName: nameById.get(r.tryout_id) ?? '',
      };
    });
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
      endTime: t.end_time ?? undefined,
      rink: t.location ?? undefined,
      sport: t.sport,
      sportOther: t.sport_other ?? undefined,
      assessors: assessorsByTryout[t.id] ?? [],
      playerCount: countByTryout[t.id] ?? 0,
      archived: !!t.archived,
      archivedReason: t.archived_reason === 'plan_downgrade' ? 'plan_downgrade' : undefined,
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
    // Evaluations on teams delegated to this user (list_tryouts_for_managed_teams)
    // belong to the club that owns them and are deliberately not counted here.
    const [ownRes, ownedTeamRes] = await Promise.all([
      supabase.from('tryouts').select('id').eq('account_id', accountId).is('deleted_at', null).eq('archived', false),
      this.viewerRpc(supabase, 'list_tryouts_on_my_owned_teams'),
    ]);
    const ids = new Set((unwrap(ownRes) as Row[]).map((t) => t.id as string));
    // Pre-migration instances have no such function; own assessments are
    // still counted correctly without it, same degrade as listTryouts().
    for (const rows of [ownedTeamRes.data]) {
      for (const t of (rows ?? []) as Row[]) {
        if (!t.deleted_at && !t.archived) ids.add(t.id as string);
      }
    }
    return ids.size;
  }

  async getTryout(id: string): Promise<Tryout | null> {
    const { supabase, accountId } = await this.ctx();
    const row = (
      await supabase.from('tryouts').select('*').eq('id', id).is('deleted_at', null).maybeSingle()
    ).data as Row | null;
    if (!row) return null;
    // One row read straight from the table, so unlike listTryouts() there is no
    // RPC merge to say whether a caller on another account is this team's coach
    // or only an invited assessor. Only ask when the account doesn't already
    // match — for the coach opening their own assessment, the common case, this
    // costs nothing.
    const tagged =
      row.account_id !== accountId && (await this.viewerManagesTryoutTeam(id))
        ? { ...row, [VIEWER_MANAGES_TEAM]: true }
        : row;
    const [assembled] = await this.assembleTryouts([tagged]);
    return assembled ?? null;
  }

  /**
   * Whether the caller reaches this assessment as a coach of its team rather
   * than through their own account: a team delegated to them (CLUB mode), or
   * their own team that a delegate created the assessment under. These are the
   * same two RPCs listTryouts() merges, so the coaches it lists keep an owner's
   * rights here. A pre-migration instance without the functions answers no,
   * which leaves ownership resting on account_id alone — the old behaviour.
   */
  private async viewerManagesTryoutTeam(id: string): Promise<boolean> {
    const supabase = getSupabase();
    const [managedRes, ownedTeamRes] = await Promise.all([
      this.viewerRpc(supabase, 'list_tryouts_for_managed_teams'),
      this.viewerRpc(supabase, 'list_tryouts_on_my_owned_teams'),
    ]);
    return [managedRes.data, ownedTeamRes.data].some((rows) =>
      ((rows ?? []) as Row[]).some((t) => t.id === id),
    );
  }

  /**
   * Guards the two actions that take an assessment away from everyone else on
   * it. Reported by a client coach: signed in on a second account that was only
   * an assessor on someone else's tryout, they could still delete it — the web
   * app hides Settings from assessors with a `?assessor=1` query parameter, and
   * dropping the parameter from the URL brought the whole tab back, Danger Zone
   * included.
   *
   * The real gate is soft_delete_tryout() (see the migration) which re-checks
   * this server-side; this is the same check in front of it, so an unauthorized
   * attempt fails with a sentence the coach can read rather than a raw
   * Postgres error, and so archiving — a plain update, with no RPC of its own —
   * is covered too.
   */
  private async assertCanManageTryout(id: string): Promise<void> {
    const { supabase, userId, accountId } = await this.ctx();
    const row = (
      await supabase.from('tryouts').select('account_id').eq('id', id).maybeSingle()
    ).data as Row | null;
    if (row?.account_id === accountId) return;

    const assessor = (
      await supabase
        .from('tryout_assessors')
        .select('role')
        .eq('tryout_id', id)
        .eq('user_id', userId)
        .maybeSingle()
    ).data as Row | null;
    if (assessor?.role === 'lead') return;

    if (await this.viewerManagesTryoutTeam(id)) return;

    throw new Error('Only the coach who created this evaluation can archive or delete it.');
  }

  async listAssignedTryouts(): Promise<Tryout[]> {
    return this.assembleTryouts(await this.fetchAssignedTryoutRows());
  }

  private async fetchAssignedTryoutRows(): Promise<Row[]> {
    const { supabase, userId, accountId } = await this.ctx();
    // Org view: assignments given to any member of the organization, not only
    // the one id ctx() resolves to.
    if (getImpersonationTarget()) await this.ensureViewedMembers(supabase);
    const viewedIds = getImpersonationTarget() ? getViewedPersonIds() : [];
    const links = unwrap(
      // `> 0`, not `> 1`: an organization with a single staff member has one viewed id, and
      // falling back to the founder's own id here listed nobody's assignments.
      await (viewedIds.length > 0
        ? supabase.from('tryout_assessors').select('tryout_id').in('user_id', viewedIds)
        : supabase.from('tryout_assessors').select('tryout_id').eq('user_id', userId)
      ).not('status', 'in', '(declined,completed)'),
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
      this.viewerRpc(supabase, 'list_tryouts_for_managed_teams'),
      this.viewerRpc(supabase, 'list_tryouts_on_my_owned_teams'),
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

  /**
   * Complete Assessing. Only the caller's own tryout_assessors row changes, so
   * the owner/coach keeps the evaluation and every score; the assessor's hub
   * stops listing it (fetchAssignedTryoutRows skips 'completed').
   */
  async completeAssignedTryout(tryoutId: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.rpc('set_assessor_status', { p_tryout_id: tryoutId, p_status: 'completed' });
    if (error) {
      if (/Invalid assessor status/i.test(error.message)) {
        throw new Error('Completing an evaluation is not available yet. Please try again after the next update.');
      }
      throw new Error(error.message);
    }
  }

  async createTryout(form: CreateAssessmentForm): Promise<Tryout> {
    return this.withFreshAccount((guard) => this._createTryout(form, guard));
  }

  private async _createTryout(form: CreateAssessmentForm, _guard?: unknown): Promise<Tryout> {
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
          end_time: form.endTime || null,
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
          await insertChunked(
            participants,
            DUMMY_CHUNK.participants,
            async (chunk) => unwrap(await supabase.from('tryout_participants').insert(chunk).select('id')) as Row[],
          );
        }
      } catch (e) {
        // Non-fatal: the assessment is created, the coach can add players later.
        console.error('Failed to auto-import team roster into new tryout', e);
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

    if (
      updates.teamBuilder !== undefined ||
      updates.friendPackages !== undefined ||
      updates.aiAssessments !== undefined
    ) {
      const current = (await supabase.from('tryouts').select('ai_assessments').eq('id', id).single())
        .data?.ai_assessments ?? {};
      const next = { ...current };
      if (updates.aiAssessments !== undefined) Object.assign(next, updates.aiAssessments);
      if (updates.teamBuilder !== undefined) next.teamBuilder = updates.teamBuilder;
      if (updates.friendPackages !== undefined) next.friendPackages = updates.friendPackages;
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

  /**
   * The team_id write on its own — see DataSource.setTryoutTeam for why the
   * team screen can't go through updateTryout() for it. `select('id')` keeps
   * the response to one column while still turning an RLS refusal into an
   * error rather than a silent no-op.
   */
  async setTryoutTeam(id: string, teamId: string | null): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('tryouts').update({ team_id: teamId }).eq('id', id).select('id').single());
  }

  async setFriendPackages(id: string, packages: FriendPackage[]): Promise<void> {
    const { supabase } = await this.ctx();
    const current = (await supabase.from('tryouts').select('ai_assessments').eq('id', id).single())
      .data?.ai_assessments ?? {};
    const next = { ...current, friendPackages: packages };
    unwrap(await supabase.from('tryouts').update({ ai_assessments: next }).eq('id', id).select('id').single());
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
      // The rows the delete actually took, not just its error. Under RLS a
      // DELETE whose rows the policy filters out removes nothing and still
      // answers with no error, so throwing this result away reported a removal
      // that never happened: updateTryout() went on to re-read the tryout, the
      // assessor came back with it, and Remove looked like a button that does
      // nothing. Same failure, on this same table, that
      // 20260831000000_remove_org_member_rpc.sql was written for.
      const deleted = unwrap(
        await supabase.from('tryout_assessors').delete().in('id', toDelete).select('id'),
      ) as Row[];
      if (deleted.length < toDelete.length) {
        console.error(
          `syncAssessors: asked to remove ${toDelete.length} assessor row(s) from tryout ${tryoutId}, ` +
            `the delete took ${deleted.length} — the tryout_assessors DELETE policy most likely refused the rest.`,
        );
        throw new Error(
          'Could not remove this assessor. You may not have permission to change who assesses this evaluation.',
        );
      }
    }

    if (desired.length > 1) await this.markOnboarding({ inviteAssessors: true });
  }

  async archiveTryout(id: string): Promise<Tryout> {
    await this.assertCanManageTryout(id);
    return this.updateTryout(id, { archived: true });
  }

  async restoreTryout(id: string): Promise<Tryout> {
    const restored = await this.updateTryout(id, { archived: false });
    // Clear the plan-downgrade marker in a separate, best-effort write so a
    // restore never depends on the archived_reason column existing: on an
    // instance that hasn't run 20260924120000_archive_on_plan_downgrade.sql the
    // write errors, nothing was ever archived by a plan change, and the restore
    // has already succeeded.
    const { supabase } = await this.ctx();
    await supabase.from('tryouts').update({ archived_reason: null }).eq('id', id);
    return restored;
  }

  async deleteTryout(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    // Soft delete — the row (and the evaluations/scores it cascades to) stays
    // in the database so it still counts toward a player's permanent history,
    // it just disappears from every coach-facing view (see the deleted_at
    // filters on listTryouts/listAssignedTryouts/getTryout).
    //
    // Through the RPC rather than straight at the table: it authorizes the
    // caller server-side, where an assessor can't get past it by editing a URL
    // or calling PostgREST directly. See the migration for why the tryouts
    // policies themselves aren't the place this is fixed from this repo.
    const { error } = await supabase.rpc('soft_delete_tryout', { p_tryout_id: id });
    if (!error) return;

    const missingFunction = error.code === 'PGRST202' || error.code === '42883';
    if (!missingFunction) throw new Error(error.message);
    console.warn('soft_delete_tryout() not deployed — falling back to a client-authorized update.');

    await this.assertCanManageTryout(id);
    unwrap(
      await supabase
        .from('tryouts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .maybeSingle(),
    );
  }

  async sendEmail(type: 'org_invite' | 'player_invite' | 'team_manager_invite' | 'tryout_invite' | 'schedule_update' | 'schedule_digest' | 'schedule_cancel' | 'reminder' | 'registration_confirmation' | 'tryout_letter', to: string, payload: Record<string, unknown>): Promise<void> {
    assertNotViewingAs();
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
      const copiedParticipants = participants.map((p) => ({
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
      }));
      await insertChunked(
        copiedParticipants,
        DUMMY_CHUNK.participants,
        async (chunk) => unwrap(await supabase.from('tryout_participants').insert(chunk).select('id')) as Row[],
      );
    }
    const [assembled] = await this.assembleTryouts([copy]);
    return assembled;
  }

  // ─── Players ──────────────────────────────────────────────────────────────────
  /**
   * Which account owns the roster a player is being added to — the evaluation's
   * or the team's, not the caller's.
   *
   * Readable by everyone who can reach the row at all, assessors and delegated
   * managers included, because it comes off the `tryouts`/`teams` row itself
   * rather than from a membership. Returns null when the row can't be read,
   * which the callers treat as "can't tell" and fall back to the caller's own
   * account, exactly as before this existed.
   */
  private async ownerAccountId(table: 'tryouts' | 'teams', id: string): Promise<string | null> {
    const key = `${table}:${id}`;
    const cached = this.ownerAccountByRow[key];
    if (cached) return cached;
    try {
      const supabase = getSupabase();
      const { data } = await supabase.from(table).select('account_id').eq('id', id).maybeSingle();
      const found = ((data as Row | null)?.account_id as string | undefined) ?? null;
      // Only a hit is cached: a miss is usually "not readable right now" (a
      // read that raced a sign-in, say), which must stay re-askable.
      if (found) this.ownerAccountByRow[key] = found;
      return found;
    } catch {
      return null;
    }
  }

  /**
   * writableAccountId() for callers who have somewhere else to go.
   *
   * An invited assessor can have no staff membership anywhere — an assessor is
   * reached through `tryout_assessors`, not `memberships` — and for them
   * writableAccountId() throws "Current account lacks write permissions", which
   * used to be the end of adding a player. Now it only means the write has to
   * go through the owning account instead.
   */
  private async writableAccountIdOrNull(): Promise<string | null> {
    try {
      return await this.writableAccountId();
    } catch {
      return null;
    }
  }

  /**
   * The athlete row for a player being added to someone else's roster.
   *
   * `create_athlete_for_caller()` resolves the owning account from auth.uid()
   * server-side. That is right for a coach and wrong for everyone else who may
   * edit a roster without being staff on the account behind it: an assessor who
   * coaches elsewhere filed the athlete under *their* club, so the evaluation's
   * owner could read the participant row and not the athlete it points at, and
   * the player they had just watched being added rendered as "Unknown Player"
   * with no birth year, guardian or photo. These two functions take the account
   * off the evaluation or the team and check the caller's grant over that
   * specific row (see 20260911120000_create_athlete_in_owning_account.sql).
   */
  private async createAthleteForOwner(
    owner: { tryoutId: string } | { teamId: string },
    fields: Row,
  ): Promise<string> {
    const supabase = getSupabase();
    await this.resolveGuardianUserId(fields);

    const [fn, args] =
      'tryoutId' in owner
        ? (['create_athlete_for_tryout', { p_tryout_id: owner.tryoutId, p_payload: fields }] as const)
        : (['create_athlete_for_team', { p_team_id: owner.teamId, p_payload: fields }] as const);

    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        console.warn(
          `${fn}() not deployed — apply 20260911120000_create_athlete_in_owning_account.sql. ` +
            'Until then only staff on the owning account can add players.',
        );
        throw new Error(
          'Your account cannot add players to this roster yet. Ask the coach who owns it to add them, ' +
            'or to update the database.',
        );
      }
      throw unwrapError(error);
    }
    return data as string;
  }

  /**
   * Insert one `portal_invites` row, falling back to a security-definer RPC
   * when the direct insert is refused by RLS.
   *
   * `account_id` on the row is (correctly) the evaluation's or team's owning
   * account, not the caller's — but the table's own INSERT policy requires a
   * `memberships` row with owner/admin/coach on that account, which an invited
   * assessor or a delegated CLUB-mode manager simply doesn't have. That surfaced
   * as "new row violates row-level security policy for table portal_invites" the
   * moment the automatic post-add invite tried to fire for either of them. The
   * RPC re-checks the same grant `createAthleteForOwner` already relies on and
   * does the insert itself (see 20260911130000_create_portal_invite_in_owning_account.sql).
   *
   * `fallback` is omitted by the one caller (sendPortalInvite, the manual
   * one-address button) that already inserts with the caller's *own*
   * account_id — for that path a refusal is a genuine "you can't do this",
   * not a missing grant to route around.
   */
  private async insertPortalInvite(
    fields: Row,
    fallback: { tryoutId: string } | { teamId: string } | null,
  ): Promise<void> {
    const supabase = getSupabase();
    try {
      unwrap(await supabase.from('portal_invites').insert(fields).select('id'));
      return;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const refused = err.code === '42501' || /row-level security/i.test(err.message ?? '');
      if (!refused || !fallback) throw e;
    }

    const [fn, args] =
      'tryoutId' in fallback
        ? ([
            'create_portal_invite_for_tryout',
            { p_tryout_id: fallback.tryoutId, p_athlete_id: fields.athlete_id, p_email: fields.email, p_token: fields.token },
          ] as const)
        : ([
            'create_portal_invite_for_team',
            { p_team_id: fallback.teamId, p_athlete_id: fields.athlete_id, p_email: fields.email, p_token: fields.token },
          ] as const);

    const { error } = await supabase.rpc(fn, args);
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        console.warn(
          `${fn}() not deployed — apply 20260911130000_create_portal_invite_in_owning_account.sql. ` +
            'Until then an assessor or delegated manager cannot send this invite.',
        );
      }
      throw unwrapError(error);
    }
  }

  /**
   * Provision the guardian login for an athlete about to be created, in place
   * on `fields`.
   *
   * Extracted from createAthlete() so the owning-account path above links the
   * guardian exactly the same way — the link to the guardian's email is the
   * point of saving a player with one on the form, and it must not depend on
   * which of the two insert routes the row happens to take. Best-effort
   * throughout: a player with an unreachable guardian still saves.
   */
  /**
   * Set `fields.guardian_user_id`, whether or not the guardian's email already
   * has a login.
   *
   * Used to only handle the "brand-new guardian" half of this: when the email
   * already belonged to *someone* — an existing guardian on another team, or
   * the coach's/assessor's own login, both routine (a coach whose own kid is
   * on the roster is not an edge case in this sport) — `check_user_exists`
   * came back true and the whole block was skipped, so `guardian_user_id` was
   * left null. The athlete still got a `guardian_email` and still got mailed a
   * portal invite, but nothing on the athlete row actually linked it to that
   * account, so the guardian never saw the player anywhere in their own
   * portal. Reported 2026-09-11: an email arrived, but the player stayed
   * unlinked. The app repo already had the `else` branch below; this brings
   * web to parity with it.
   */
  private async resolveGuardianUserId(fields: Row): Promise<void> {
    const supabase = getSupabase();
    if (!fields.guardian_email || fields.guardian_user_id) return;
    try {
      const { data: exists } = await supabase.rpc('check_user_exists', { lookup_email: fields.guardian_email });
      if (!exists) {
        // create_user_with_password() requires the caller to hold owner/admin/
        // coach on *some* account — an assessor with no membership anywhere
        // gets "Not authorized to create user accounts" here, caught below.
        // The athlete still saves; it just isn't linked to a brand-new
        // guardian login until a coach touches it. (resolve_guardians_for_caller,
        // the bulk equivalent, has the identical staff-only check — there is no
        // RPC that lets a bare assessor provision a new login, by design.)
        const defaultPassword = Math.random().toString(36).slice(-8) + 'Aa1!';
        const name = fields.guardian_name || 'Guardian';
        const { data: newUserId, error } = await supabase.rpc('create_user_with_password', {
          email: fields.guardian_email,
          password: defaultPassword,
          display_name: name,
          account_type: 'guardian',
        });
        if (newUserId && !error) {
          fields.guardian_user_id =
            typeof newUserId === 'object' && newUserId !== null
              ? (newUserId as { id?: string }).id || (newUserId as unknown as string)
              : (newUserId as string);
          try {
            await this.sendEmail('org_invite', fields.guardian_email, { role: 'guardian', password: defaultPassword });
          } catch (emailErr) {
            console.warn('Failed to send auto-created guardian invite email:', emailErr);
          }
        }
      } else {
        // The email already belongs to someone — another guardian, or the
        // coach's/assessor's own login (routine in this sport: a coach whose
        // own kid is on the roster). check_user_exists() only answered "yes",
        // so without this the athlete kept a guardian_email but never got
        // guardian_user_id set, and that account never saw the player anywhere
        // in its own portal even though it *did* receive the invite email.
        // get_user_id_by_email() has no staff check — any authenticated caller,
        // assessor included, can resolve and link an existing account.
        const { data: existingId } = await supabase.rpc('get_user_id_by_email', {
          lookup_email: fields.guardian_email,
        });
        if (existingId) {
          fields.guardian_user_id =
            typeof existingId === 'object' && existingId !== null
              ? (existingId as { id?: string }).id || (existingId as unknown as string)
              : (existingId as string);
        }
      }
    } catch (err) {
      console.warn('Failed to resolve guardian account:', err);
    }
  }

  private async createAthlete(accountId: string, fields: Row): Promise<string> {
    const supabase = getSupabase();
    await this.resolveGuardianUserId(fields);

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
    assertNotViewingAs();
    return this.withFreshAccount((guard) => this._addPlayer(tryoutId, form, guard));
  }

  private async _addPlayer(tryoutId: string, form: AddPlayerForm, guard: WriteGuard): Promise<Player> {
    const { supabase } = await this.ctx();
    if (typeof tryoutId === 'object' && tryoutId !== null) {
      tryoutId = String((tryoutId as unknown as { id?: string }).id || tryoutId);
    }

    // Who owns the evaluation decides where the athlete is filed. A coach
    // adding to their own evaluation is the common case and goes through
    // create_athlete_for_caller() exactly as before; anyone else who may edit
    // this roster without being staff on the account behind it — an invited
    // assessor, a delegated manager — has to write to the owning account or the
    // owner ends up unable to read the athlete they just watched being added.
    const ownerAccountId = await this.ownerAccountId('tryouts', tryoutId);
    const callerAccountId = await this.writableAccountIdOrNull();
    // A null owner means the row couldn't be read, not that it belongs to
    // someone else — falling back to the caller's own account there keeps a
    // coach whose lookup blipped on exactly the path they had before.
    const writesAsOwner =
      callerAccountId !== null && (ownerAccountId === null || callerAccountId === ownerAccountId);
    if (callerAccountId === null && ownerAccountId === null) {
      // Neither route is available: no staff membership anywhere, and the
      // evaluation itself unreadable. Same message writableAccountId() gave.
      throw new Error('Current account lacks write permissions for this operation.');
    }

    let athleteId = form.athleteId;
    if (typeof athleteId === 'object' && athleteId !== null) {
      athleteId = String((athleteId as unknown as { id?: string }).id || athleteId);
    }

    if (!athleteId) {
      const fields: Row = {
        first_name: form.first,
        last_name: form.last,
        year_of_birth: form.yearOfBirth ? Number(form.yearOfBirth) : null,
        guardian_name: form.guardianName || null,
        guardian_email: form.guardianEmail || null,
        guardian_phone: form.guardianPhone || null,
        player_email: form.playerEmail || null,
        medical_info: form.medicalInfo || null,
        about: form.aboutChild || null,
        avatar_url: form.avatarUrl || null,
      };
      athleteId = writesAsOwner
        ? await this.createAthlete(callerAccountId!, fields)
        : await this.createAthleteForOwner({ tryoutId }, fields);
      guard.wrote = true;
    }
    await this.saveDateOfBirth(athleteId, form.dateOfBirth || undefined);
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
    // Set even though nothing after this point retries cleanly on its own: a
    // duplicate participant row is the failure this exists to prevent, and
    // that risk starts here, not at the read below.
    guard.wrote = true;
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
    if (updates.playerEmail !== undefined) athletePatch.player_email = updates.playerEmail || null;
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

    // The direct writes first, so a coach keeps going through the tables' own
    // policies exactly as before and nothing here depends on the RPC's
    // reconstruction of who may edit. `.select().single()` is what makes a
    // refusal visible at all: RLS rejects an UPDATE by matching zero rows,
    // which Postgres reports as an ordinary success, so without it this method
    // wrote nothing and then re-read the unchanged row as if it had saved.
    let refused = false;

    if (Object.keys(athletePatch).length) {
      const part = unwrap(
        await supabase.from('tryout_participants').select('athlete_id').eq('id', playerId).single(),
      ) as Row;
      refused = !(await wroteRow(
        supabase.from('athletes').update(athletePatch).eq('id', part.athlete_id).select().single(),
      ));
    }
    if (!refused && Object.keys(participantPatch).length) {
      refused = !(await wroteRow(
        supabase.from('tryout_participants').update(participantPatch).eq('id', playerId).select().single(),
      ));
    }

    // Refused means the caller reaches this evaluation some way the tables'
    // policies don't admit — an invited assessor, who gets to an evaluation
    // through a tryout_assessors row rather than a membership. The RPC does the
    // same write behind a check that authorizes them explicitly; it re-applies
    // both patches, which is harmless where one of the two already landed.
    if (refused) {
      const { error } = await supabase.rpc('update_tryout_player', {
        p_participant_id: playerId,
        p_athlete_patch: athletePatch,
        p_participant_patch: participantPatch,
      });
      if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') {
          console.warn('update_tryout_player() not deployed — an assessor cannot save player edits.');
          throw new Error(
            'Your account does not have permission to edit this player. Ask the coach who owns this evaluation to make the change.',
          );
        }
        throw unwrapError(error);
      }
    }
    if (updates.dateOfBirth !== undefined) {
      const part = (
        await supabase.from('tryout_participants').select('athlete_id').eq('id', playerId).maybeSingle()
      ).data as Row | null;
      if (part?.athlete_id) await this.saveDateOfBirth(part.athlete_id as string, updates.dateOfBirth);
    }
    return this.fetchPlayer(playerId);
  }

  async deletePlayer(_tryoutId: string, playerId: string): Promise<void> {
    const { supabase } = await this.ctx();
    // Best-effort: if this player was created by accepting a guardian's shared
    // athlete, flip that share to 'released' so the guardian is told the coach
    // let them go. Never let this block the actual removal below.
    try {
      await supabase.rpc('release_athlete_share_for_participant', { p_participant_id: playerId });
    } catch {
      // non-blocking
    }
    // Soft delete — the participant row (and its evaluations/scores) stays in
    // the database so it still counts toward the player's permanent profile
    // history, it just disappears from this tryout's active roster (see the
    // removed_at filter in assembleTryouts).
    const removed = unwrap(
      await supabase
        .from('tryout_participants')
        .update({ removed_at: new Date().toISOString() })
        .eq('id', playerId)
        .select('athlete_id')
        .maybeSingle(),
    ) as Row | null;
    if (removed?.athlete_id) await this.clearGuardianIfUnrostered(removed.athlete_id as string);
  }

  async deletePlayers(
    tryoutId: string,
    playerIds: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ deleted: string[]; failed: { id: string; message: string }[] }> {
    const ids = [...new Set(playerIds)];
    const deleted: string[] = [];
    const failed: { id: string; message: string }[] = [];
    if (ids.length === 0) return { deleted, failed };
    const { supabase } = await this.ctx();

    // deletePlayer() costs about four round trips per player, and this used to
    // run it four players at a time — minutes for a full roster. It now works in
    // batches: the share release stays one RPC per player (it carries its own
    // permission check, so it is not replaced with a client-side write), the soft
    // delete is one request per batch, and the guardian cleanup below is grouped.
    // Progress is reported as each batch lands, so the count is players actually
    // removed rather than a guess.
    const freed = new Set<string>();
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += PLAYER_DELETE_CHUNK) chunks.push(ids.slice(i, i + PLAYER_DELETE_CHUNK));
    onProgress?.(0, ids.length);
    await mapPool(chunks, PLAYER_DELETE_BATCH_CONCURRENCY, async (chunk) => {
      await mapPool(chunk, PLAYER_RELEASE_CONCURRENCY, async (playerId) => {
        try {
          await supabase.rpc('release_athlete_share_for_participant', { p_participant_id: playerId });
        } catch {
          // best-effort, same as deletePlayer()
        }
      });
      try {
        const rows = unwrap(
          await supabase
            .from('tryout_participants')
            .update({ removed_at: new Date().toISOString() })
            .in('id', chunk)
            .select('id, athlete_id'),
        ) as Row[] | null;
        const landed = new Set<string>();
        for (const r of rows ?? []) {
          landed.add(r.id as string);
          deleted.push(r.id as string);
          if (r.athlete_id) freed.add(r.athlete_id as string);
        }
        // RLS reports a refused UPDATE as zero rows rather than an error.
        for (const id of chunk) {
          if (!landed.has(id)) failed.push({ id, message: 'Could not delete this player.' });
        }
      } catch {
        // The batch failed as a whole — fall back to one at a time so each
        // player still gets its own outcome (and error message).
        await mapPool(chunk, PLAYER_DELETE_CONCURRENCY, async (playerId) => {
          try {
            await this.deletePlayer(tryoutId, playerId);
            deleted.push(playerId);
          } catch (e) {
            failed.push({ id: playerId, message: e instanceof Error ? e.message : 'Could not delete this player.' });
          }
        });
      }
      onProgress?.(deleted.length + failed.length, ids.length);
    });

    // Guardian contacts go once the athlete is on no roster anywhere, same rule
    // as clearGuardianIfUnrostered(), evaluated for a group at a time. A failure
    // here must not undo or hide deletions that already landed.
    try {
      const athleteIds = [...freed];
      const groups: string[][] = [];
      for (let i = 0; i < athleteIds.length; i += GUARDIAN_CLEAR_CHUNK) {
        groups.push(athleteIds.slice(i, i + GUARDIAN_CLEAR_CHUNK));
      }
      await mapPool(groups, PLAYER_DELETE_BATCH_CONCURRENCY, async (group) => {
        const [participants, teamRoster, seasonRoster] = await Promise.all([
          supabase.from('tryout_participants').select('athlete_id').in('athlete_id', group).is('removed_at', null),
          supabase.from('team_roster').select('athlete_id').in('athlete_id', group),
          supabase.from('season_roster').select('athlete_id').in('athlete_id', group),
        ]);
        // If any read failed, clear nobody: keeping a contact is the safe side.
        if (participants.error || teamRoster.error || seasonRoster.error) return;
        const still = new Set<string>();
        for (const set of [participants.data, teamRoster.data, seasonRoster.data]) {
          for (const r of (set ?? []) as Row[]) still.add(r.athlete_id as string);
        }
        const orphans = group.filter((a) => !still.has(a));
        if (orphans.length === 0) return;
        await supabase
          .from('athletes')
          .update({ guardian_name: null, guardian_email: null, guardian_phone: null, guardian_user_id: null })
          .in('id', orphans);
      });
    } catch (e) {
      console.error('Bulk guardian cleanup failed; players were still removed.', e);
    }
    return { deleted, failed };
  }

  /**
   * Drop the guardian contact from an athlete once that athlete is off every
   * roster. Guardians have no rows of their own — they are contact columns on
   * `athletes`, and everything that lists them derives them from those columns.
   * Removing a player therefore has to clear them here, or the parent lingers
   * as a "member" of the org with no player attached.
   *
   * Guarded on the athlete holding no remaining spot in any assessment, team, or
   * season: one athlete row is shared across all three, so a player cut from one
   * assessment but still rostered elsewhere keeps their guardian.
   */
  private async clearGuardianIfUnrostered(athleteId: string): Promise<void> {
    const { supabase } = await this.ctx();
    const [participants, teamRoster, seasonRoster] = await Promise.all([
      supabase
        .from('tryout_participants')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteId)
        .is('removed_at', null),
      supabase.from('team_roster').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
      supabase.from('season_roster').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
    ]);
    const stillRostered =
      (participants.count ?? 0) + (teamRoster.count ?? 0) + (seasonRoster.count ?? 0) > 0;
    if (stillRostered) return;
    await supabase
      .from('athletes')
      .update({
        guardian_name: null,
        guardian_email: null,
        guardian_phone: null,
        guardian_user_id: null,
      })
      .eq('id', athleteId);
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

    // Scores are written after the evaluation row, so the realtime event for that
    // row can reach other screens before the scores exist. Touch the row again now
    // that they do, so their debounced refetch (see useTryoutRealtimeSync, which
    // no longer listens to evaluation_scores) lands on the final values.
    void Promise.resolve(
      supabase.from('evaluations').update({ updated_at: new Date().toISOString() }).eq('id', id),
    ).catch(() => { });

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
    session = 'Scan Import',
  ): Promise<void> {
    const byPlayer: Record<string, Record<string, number>> = {};
    for (const s of scores) (byPlayer[s.playerId] ??= {})[s.rubricKey] = s.value;
    for (const [playerId, scoreMap] of Object.entries(byPlayer)) {
      await this.saveEvaluation(tryoutId, playerId, {
        session,
        recommendation: '',
        scores: scoreMap,
      });
    }
  }

  // ─── Event comments & files ──────────────────────────────────────────────────
  private rowToEventComment(r: Row): import('@/data/types').EventComment {
    return {
      id: r.id,
      eventId: r.event_id,
      authorUserId: r.author_user_id,
      authorName: r.author_name ?? '',
      body: r.body,
      createdAt: new Date(r.created_at).getTime(),
    };
  }

  async listEventComments(eventId: string): Promise<import('@/data/types').EventComment[]> {
    const { supabase } = await this.userCtx();
    const rows = unwrap(
      await supabase.from('season_event_comments').select('*').eq('event_id', eventId).order('created_at', { ascending: true }),
    ) as Row[];
    return rows.map((r) => this.rowToEventComment(r));
  }

  async addEventComment(eventId: string, body: string): Promise<import('@/data/types').EventComment> {
    assertNotViewingAs();
    const { supabase, userId } = await this.userCtx();
    const text = body.trim();
    if (!text) throw new Error('Write a comment first.');
    const profile = await this.loadUserProfile(userId);
    const row = unwrap(
      await supabase
        .from('season_event_comments')
        .insert({ event_id: eventId, author_user_id: userId, author_name: profile.displayName ?? '', body: text })
        .select()
        .single(),
    ) as Row;
    return this.rowToEventComment(row);
  }

  async deleteEventComment(commentId: string): Promise<void> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    unwrap(await supabase.from('season_event_comments').delete().eq('id', commentId));
  }

  async listEventFiles(eventId: string): Promise<import('@/data/types').EventFile[]> {
    const { supabase } = await this.userCtx();
    const rows = unwrap(
      await supabase.from('season_event_files').select('*').eq('event_id', eventId).order('created_at', { ascending: true }),
    ) as Row[];
    const { data: signed } = rows.length
      ? await supabase.storage.from(EVENT_FILES_BUCKET).createSignedUrls(rows.map((r) => r.path), 3600)
      : { data: [] as { path: string | null; signedUrl: string }[] };
    const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    return rows.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      name: r.name,
      path: r.path,
      size: Number(r.size ?? 0),
      contentType: r.content_type,
      createdAt: new Date(r.created_at).getTime(),
      url: urls.get(r.path) ?? undefined,
    }));
  }

  async uploadEventFile(seasonId: string, eventId: string, file: File): Promise<import('@/data/types').EventFile> {
    assertNotViewingAs();
    const { supabase, userId } = await this.userCtx();
    const contentType = file.type || 'application/octet-stream';
    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
    // First segment is the season id: the storage policies check staff access against it.
    const path = `${seasonId}/${eventId}/${generateId('ef')}/${safeName}`;
    const { error } = await supabase.storage.from(EVENT_FILES_BUCKET).upload(path, file, { contentType, upsert: false });
    if (error) throw new Error(`Could not upload ${file.name}: ${error.message}`);
    const inserted = await supabase
      .from('season_event_files')
      .insert({ event_id: eventId, name: file.name, path, size: file.size, content_type: contentType, uploaded_by: userId })
      .select()
      .single();
    if (inserted.error) {
      await supabase.storage.from(EVENT_FILES_BUCKET).remove([path]);
      throw new Error(inserted.error.message);
    }
    const r = inserted.data as Row;
    return {
      id: r.id,
      eventId: r.event_id,
      name: r.name,
      path: r.path,
      size: Number(r.size ?? 0),
      contentType: r.content_type,
      createdAt: new Date(r.created_at).getTime(),
    };
  }

  async deleteEventFile(file: import('@/data/types').EventFile): Promise<void> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    unwrap(await supabase.from('season_event_files').delete().eq('id', file.id));
    await supabase.storage.from(EVENT_FILES_BUCKET).remove([file.path]);
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
    if (!tryout) throw new Error('Evaluation not found');

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
    let athleteIds: string[] | undefined;
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
      athleteIds = res.athleteIds;
    }
    report(totalUnits);

    // Only set flags we actually earned — `markOnboarding` spreads the patch, so
    // an `undefined` value would wipe a step the user had already completed.
    const steps: Record<string, boolean> = {};
    if (players > 0) steps.addPlayers = true;
    if (evaluations > 0) steps.scorePlayers = true;
    if (Object.keys(steps).length) await this.markOnboarding(steps);

    return { registrations, players, evaluations, athleteIds };
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
        player_email: form.playerEmail || null,
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

    // 1. Bulk-insert canonical athletes, contact details included.
    //
    // Safe to carry here, unlike the single-player and registration paths:
    // create_athletes_for_caller() is a plain insert and never resolves or
    // creates a guardian auth account, and the addresses are on a disposable
    // testing domain. Omitting them is what left dummy players with no contact
    // details on the player detail and nothing for "Send Invites" to reach.
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
            guardian_name: g.form.guardianName || null,
            guardian_email: g.form.guardianEmail || null,
            player_email: g.form.playerEmail || null,
          })),
        });
        // Rethrown through `unwrap`'s shape rather than as a bare Error so the
        // SQLSTATE survives — insertChunked reads it to tell a statement
        // timeout (retry this chunk smaller) from a real failure (give up).
        if (error) throw unwrapError(error);
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

    // 3. Build evaluations: every player gets exactly `sessionsPerPlayer`
    //    sessions, spread across the assessment's assessors.
    const profile = await this.loadUserProfile(userId);
    const assessorNames = tryout.assessors.length
      ? tryout.assessors.map((a) => a.name)
      : [profile.displayName];

    const evalRows: Row[] = [];
    const evalPlayerIndex: number[] = [];
    generated.forEach((g, i) => {
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

    const sport: Sport = options?.sport && SPORTS.includes(options.sport) ? options.sport : 'Hockey';
    const rubrics = generateDummyRubrics(sport);
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
      const teamBase = { account_id: accountId, name, season_label: `${currentYear}-${String((currentYear + 1) % 100).padStart(2, '0')}` };
      let createdTeam = await supabase.from('teams').insert({ ...teamBase, sport }).select().single();
      // A database without the team sport column yet: make the team without it.
      if (createdTeam.error && /sport/i.test(createdTeam.error.message)) {
        createdTeam = await supabase.from('teams').insert(teamBase).select().single();
      }
      const team = unwrap(createdTeam) as Row;
      result.teams++;

      const tryoutRow = unwrap(
        await supabase
          .from('tryouts')
          .insert({
            account_id: accountId,
            team_id: team.id,
            name: `${name} Tryout`,
            event_type: 'tryout',
            sport,
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

    const ids = rows.map((r) => r.id) as string[];
    // Chunked for the same URL-length reason as clearTestData: repeated presses
    // of the generate button can leave more test assessments than fit in one
    // filter, and an over-long one is rejected whole rather than truncated.
    await insertChunked(ids, IN_FILTER_CHUNK, async (chunk) => {
      unwrap(await supabase.from('tryouts').delete().in('id', chunk).select('id'));
      return chunk;
    });

    const teamIds = [...new Set(rows.map((r) => r.team_id).filter(Boolean))] as string[];
    let teams = 0;
    // One lookup and one delete per chunk of teams, not two round trips per team.
    // A team is only removed once no assessment still points at it.
    for (let i = 0; i < teamIds.length; i += CLEAR_TEAMS_CHUNK) {
      const chunk = teamIds.slice(i, i + CLEAR_TEAMS_CHUNK);
      const used = unwrap(await supabase.from('tryouts').select('team_id').in('team_id', chunk)) as Row[];
      // PostgREST silently truncates at its row cap. If the lookup hit it, it
      // may have missed a team that is still in use, so check this chunk one
      // team at a time rather than risk deleting a team that has real work.
      const truncated = used.length >= PG_ROW_CAP;
      const inUse = new Set(used.map((r) => r.team_id));
      const empty: string[] = [];
      for (const teamId of chunk) {
        if (inUse.has(teamId)) continue;
        if (truncated) {
          const remaining = unwrap(
            await supabase.from('tryouts').select('id').eq('team_id', teamId).limit(1),
          ) as Row[];
          if (remaining.length > 0) continue;
        }
        empty.push(teamId);
      }
      if (empty.length === 0) continue;
      const deleted = unwrap(await supabase.from('teams').delete().in('id', empty).select('id')) as Row[];
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

    // Both deletes used to go out as a single unbounded statement, which is the
    // same statement-timeout trap the inserts fell into (see DUMMY_CHUNK) — and
    // worse on this side, because deleting a participant cascades to its
    // evaluations and their scores. Clearing a full 1000-player × 5-session
    // batch is ~36,000 cascaded row deletes in one statement; it dies on the 8s
    // timeout, and because the tagged rows it did not reach are still there, the
    // user is left with dummy data they have no other way to remove.
    //
    // So: collect the tagged ids first, then delete them through insertChunked,
    // which bounds each statement and shrinks further if one still times out.
    // The chunk is additionally capped at IN_FILTER_CHUNK, because a delete
    // spends its ids on URL length rather than on statement cost — an
    // insert-sized chunk of them never reaches Postgres at all.
    const collectRows = async (table: string, columns: string): Promise<Row[]> => {
      const out: Row[] = [];
      let cursor: string | null = null;
      for (;;) {
        let q = supabase
          .from(table)
          .select(columns)
          .eq('tryout_id', tryoutId)
          .eq('current_team', TEST_DATA_TAG);
        // Keyset, not OFFSET — same reasoning as fetchAllByIn. An unranged
        // select would also stop silently at PostgREST's 1000-row default and
        // leave a 1000-player batch permanently half-cleared.
        if (cursor !== null) q = q.gt('id', cursor);
        const page = ((unwrap(await q.order('id').limit(FETCH_PAGE_SIZE)) as Row[] | null) ?? []) as Row[];
        out.push(...page);
        if (page.length < FETCH_PAGE_SIZE) return out;
        cursor = page[page.length - 1].id as string;
      }
    };

    const deleteByIds = async (table: string, ids: string[], size: number, column = 'id'): Promise<number> => {
      if (ids.length === 0) return 0;
      const deleted = await insertChunked(ids, Math.min(size, IN_FILTER_CHUNK), async (chunk) => {
        unwrap(await supabase.from(table).delete().in(column, chunk));
        return chunk;
      });
      return deleted.length;
    };

    const participantRows = await collectRows('tryout_participants', 'id');
    const removedPlayers = await deleteByIds(
      'tryout_participants',
      participantRows.map((r) => r.id as string),
      DUMMY_CHUNK.participants,
    );

    // A team-linked evaluation's roster players are copied onto the team's own
    // roster too (see addTeamRosterPlayers in generateTestData's caller), tagged
    // there with source_tryout_id at insert time — a dedicated column, unlike
    // tryout_participants.current_team, which doubles as a free-text field and
    // isn't reliable to key off of. Queried directly rather than cross-referenced
    // through participantRows above, so this still finds and removes them even
    // if the evaluation side was already cleared or its rows were edited since.
    const rosterRows = await (async () => {
      const out: Row[] = [];
      let cursor: string | null = null;
      for (;;) {
        let q = supabase.from('team_roster').select('id').eq('source_tryout_id', tryoutId);
        if (cursor !== null) q = q.gt('id', cursor);
        const page = ((unwrap(await q.order('id').limit(FETCH_PAGE_SIZE)) as Row[] | null) ?? []) as Row[];
        out.push(...page);
        if (page.length < FETCH_PAGE_SIZE) return out;
        cursor = page[page.length - 1].id as string;
      }
    })();
    const removedRoster = await deleteByIds(
      'team_roster',
      rosterRows.map((r) => r.id as string),
      DUMMY_CHUNK.participants,
    );

    // Generated registrations carry the same tag, so a pending queue filled by
    // the dummy button is cleared by the same action.
    const registrationRows = await collectRows('registrations', 'id');
    const removedRegs = await deleteByIds(
      'registrations',
      registrationRows.map((r) => r.id as string),
      DUMMY_CHUNK.registrations,
    );

    return { removed: removedPlayers + removedRoster + removedRegs };
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

  async countPendingRegistrations(tryoutId: string): Promise<number> {
    const { supabase } = await this.ctx();
    // head + exact count: the server answers with a number and no rows, so the
    // badge costs one tiny request however many registrations a QR link drew.
    const { count, error } = await supabase
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .eq('tryout_id', tryoutId)
      .eq('status', 'pending');
    if (error) throw error;
    return count ?? 0;
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
          player_email: form.playerEmail || null,
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
    if (form.dateOfBirth) {
      const { error } = await supabase
        .from('registrations')
        .update({ date_of_birth: form.dateOfBirth })
        .eq('id', row.id);
      if (error) console.warn('Could not save the date of birth:', error.message);
      else row.date_of_birth = form.dateOfBirth;
    }
    return this.rowToRegistration(row);
  }

  /**
   * What a public sign-up link opens (an evaluation or a team) and its sport, so
   * the form can drop what the sport does not use. Null when the code is
   * unknown or closed, or when the lookup is not available: the form then keeps
   * its standard fields.
   */
  async getRegistrationLinkInfo(eventIdOrCode: string): Promise<{ kind: 'evaluation' | 'team'; name: string; sport?: string } | null> {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('registration_link_info', { code: eventIdOrCode });
      if (error || !data) return null;
      const info = data as { kind?: string; name?: string; sport?: string | null };
      if (info.kind !== 'evaluation' && info.kind !== 'team') return null;
      return { kind: info.kind, name: info.name ?? '', sport: info.sport ?? undefined };
    } catch {
      return null;
    }
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
    _guard: WriteGuard,
  ): Promise<Player> {
    const { supabase } = await this.ctx();
    const accountId = await this.writableAccountId();
    const reg = unwrap(
      await supabase.from('registrations').select('*').eq('id', registrationId).single(),
    ) as Row;
    // Same owning-account rule as _addPlayer: whoever places the
    // registration may not be staff on the account that owns the roster
    // receiving it, and an athlete filed under the wrong account reads
    // back as "Unknown Player" for everyone on the right one.
    const fields: Row = {
      first_name: reg.first_name,
      last_name: reg.last_name,
      year_of_birth: reg.year_of_birth ?? null,
      guardian_name: reg.guardian_name || null,
      guardian_email: reg.guardian_email || null,
      guardian_phone: reg.guardian_phone || null,
      player_email: reg.player_email || null,
      medical_info: reg.medical_info || null,
      about: reg.about_player || null,
    };
    const ownerAccountId = await this.ownerAccountId('tryouts', tryoutId);
    const athleteId =
      ownerAccountId && ownerAccountId !== accountId
        ? await this.createAthleteForOwner({ tryoutId }, fields)
        : await this.createAthlete(accountId, fields);
    await this.saveDateOfBirth(athleteId, reg.date_of_birth ?? undefined);
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
    _guard: WriteGuard,
  ): Promise<TeamRosterPlayer[]> {
    const { supabase } = await this.ctx();
    const accountId = await this.writableAccountId();
    const reg = unwrap(
      await supabase.from('registrations').select('*').eq('id', registrationId).single(),
    ) as Row;
    // Same owning-account rule as _addPlayer: whoever places the
    // registration may not be staff on the account that owns the roster
    // receiving it, and an athlete filed under the wrong account reads
    // back as "Unknown Player" for everyone on the right one.
    const fields: Row = {
      first_name: reg.first_name,
      last_name: reg.last_name,
      year_of_birth: reg.year_of_birth ?? null,
      guardian_name: reg.guardian_name || null,
      guardian_email: reg.guardian_email || null,
      guardian_phone: reg.guardian_phone || null,
      player_email: reg.player_email || null,
      medical_info: reg.medical_info || null,
      about: reg.about_player || null,
    };
    const ownerAccountId = await this.ownerAccountId('teams', teamId);
    const athleteId =
      ownerAccountId && ownerAccountId !== accountId
        ? await this.createAthleteForOwner({ teamId }, fields)
        : await this.createAthlete(accountId, fields);
    await this.saveDateOfBirth(athleteId, reg.date_of_birth ?? undefined);
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
      player_email: reg.player_email || null,
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
    // The bulk athlete create names its columns, so the full date of birth a
    // registration carries is copied across here, only for the ones that have it.
    const withDate = placed.filter(({ reg }) => !!reg.date_of_birth);
    await mapPool(withDate, 8, ({ reg, athleteId }) => this.saveDateOfBirth(athleteId, reg.date_of_birth as string));
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
      // One id per registration, in order — the zip below depends on it. A
      // short answer would leave undefined athlete ids that the roster upsert
      // then collapses into a single row, i.e. "added 20, only one landed".
      if (athleteIds.length !== regs.length || athleteIds.some((athleteId) => !athleteId)) {
        throw new Error(`Could not create every player in this batch (${athleteIds.length} of ${regs.length}). Please try again.`);
      }
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

  // ─── Team registration link ─────────────────────────────────────────────────
  async ensureTeamRegistrationLink(teamId: string): Promise<string> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.rpc('ensure_team_registration_code', { t: teamId });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async setTeamRegistrationOpen(teamId: string, open: boolean): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.rpc('set_team_registration_open', { t: teamId, is_open: open });
    if (error) throw new Error(error.message);
  }

  async listTeamRegistrations(teamId: string): Promise<Registration[]> {
    const { supabase } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('registrations')
        .select('*')
        .eq('team_id', teamId)
        .order('created_at', { ascending: false }),
    ) as Row[];
    return rows.map((r) => this.rowToRegistration(r));
  }

  async countPendingTeamRegistrations(teamId: string): Promise<number> {
    const { supabase } = await this.ctx();
    const { count, error } = await supabase
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('status', 'pending');
    if (error) throw error;
    return count ?? 0;
  }

  // ─── Phase 2: Team Builder, AI, Export ──────────────────────────────────────────
  async generateTeamBuilder(tryoutId: string, config: TeamBuilderConfig): Promise<TeamBuilderState> {
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Tryout not found');

    let result: TeamBuilderState;
    if (config.prompt) {
      // The model reads the instructions; this code does the maths.
      //
      // It used to be handed the whole roster and asked for the split itself,
      // which is a numeric partition over every score at once — the one thing a
      // language model is worst at. On a 142-player roster the instruction
      // "build 10 evenly ranked teams" came back with team averages from 1.5 to
      // 4.9, and nothing downstream checked balance, so that shipped as the
      // answer. Now the call returns only the *rules* it found in the sentence
      // (how many teams, what size, per-position counts, whether to keep friend
      // groups) and buildTeams() applies them deterministically, which is what
      // makes the result both level and reproducible.
      const positions = [
        ...new Set(tryout.roster.map((p) => p.pos).filter((p): p is string => !!p && !!p.trim())),
      ];

      const { supabase } = await this.ctx();
      const { data, error } = await supabase.functions.invoke('generate-ai-insights', {
        body: {
          action: 'team_builder_constraints',
          // Only what the extraction needs to interpret positions — never the roster.
          tryout: { id: tryout.id, sport: tryout.sport, sportOther: tryout.sportOther },
          prompt: config.prompt,
          positions,
          playerCount: tryout.roster.length,
        },
      });

      // A failed extraction must not cost the coach their split. The team count
      // is the one instruction that is unambiguous in plain text, so it is read
      // locally and the rest of the request is reported as not applied — a
      // balanced split of the right shape beats an error message.
      const extractionFailed = !!error || !!data?.error;
      if (extractionFailed) {
        console.warn('Could not read the team-builder instructions:', error?.message ?? data?.error);
      }
      const parsed = extractionFailed ? null : data;

      const teamCount = parsed?.teamCount ?? parseTeamCountFromPrompt(config.prompt) ?? config.teamCount;
      // Bands come from the AI when it is reachable, and are read out of the
      // sentence directly when it is not — so tiering works without a deploy.
      const tiers = parsed?.tiers ?? parseTiersFromPrompt(config.prompt);

      result = buildTeams(tryout, {
        ...config,
        teamCount,
        teamSize: parsed?.teamSize ?? undefined,
        teamNames: parsed?.teamNames ?? config.teamNames,
        positionQuotas: parsed?.positionQuotas ?? undefined,
        positionCap: parsed?.positionCap ?? undefined,
        tiers,
        keepFriendPackages: parsed?.keepFriendPackages ?? config.keepFriendPackages,
        splitGoalies: parsed?.splitGoalies ?? config.splitGoalies,
        // Balancing is the whole point of this path; a snake draft is only ever
        // an explicit choice made with an empty prompt.
        sortMethod: 'balanced',
      });

      // Say plainly which words didn't match a position on this roster, rather
      // than silently returning teams that ignore part of the instruction.
      const unmatched: string[] = Array.isArray(parsed?.unmatchedPositions)
        ? parsed.unmatchedPositions
        : [];
      if (unmatched.length > 0) {
        result.warnings = [
          ...result.warnings,
          `"${unmatched.join('", "')}" didn't match any position on this roster, so that part of your instructions wasn't applied. This roster's positions are: ${positions.join(', ') || 'none set'}.`,
        ];
      }
      if (extractionFailed) {
        result.warnings = [
          ...result.warnings,
          'Your instructions could not be read this time, so the teams were balanced by rating using only the team count. Try again, or simplify the wording.',
        ];
      }

      // Describes what was actually applied, from the split itself — the card
      // above the teams used to show the model's own prose about a split this
      // code no longer takes from it.
      const applied: string[] = tiers
        ? [
            `${result.teams.length} teams in ${tiers.length} skill tiers, balanced within each tier`,
          ]
        : [`${result.teams.length} teams balanced by weighted overall rating`];
      if (parsed?.teamSize) applied.push(`${parsed.teamSize} players per team`);
      if (parsed?.positionQuotas) {
        applied.push(
          Object.entries(parsed.positionQuotas as Record<string, number>)
            .map(([pos, n]) => `${n} ${pos} per team`)
            .join(', '),
        );
      }
      if (parsed?.positionCap) applied.push(`at most ${parsed.positionCap} of any one position per team`);
      if (result.config.keepFriendPackages) {
        const kept = result.friendPackages?.length ?? 0;
        // Naming the count is what tells a coach their hand-built packages were
        // actually picked up, rather than the instruction just being echoed back.
        applied.push(
          kept > 0 ? `${kept} friend group${kept === 1 ? '' : 's'} kept together` : 'friend groups kept together',
        );
      }
      result.explanation = `${applied.join('; ')}.`;
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
    availabilityPending = false,
  ): SeasonEvent {
    return {
      id: ev.id,
      availabilityUnavailable: availabilityUnavailable || undefined,
      // The RSVP read hasn't finished yet — an empty `availability` here means
      // "not loaded", not "nobody invited". Absent once the full season lands.
      availabilityPending: availabilityPending || undefined,
      type: EVENT_KIND_FROM_DB[ev.kind] ?? 'Game',
      title: ev.title,
      date: ev.event_date,
      endDate: ev.end_date && ev.end_date !== ev.event_date ? ev.end_date : undefined,
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
      // The season enrollment can override it, but the athlete's own address is
      // the default — otherwise a player email captured on the assessment or
      // team roster would be invisible here until it was retyped per season.
      playerEmail: r.player_email ?? a.player_email ?? undefined,
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

    // Keyset-paged, not one shot: the RPC returns a row set, so PostgREST caps
    // it at db-max-rows exactly like a table read, and the function's own
    // `p_limit` defaults to 1000. Taking the first response as the whole answer
    // silently dropped every RSVP past that cap — and because the rows come back
    // ordered by `ea.id`, which interleaves events, the cap didn't truncate one
    // event's list, it split one budget across all of them: three full-roster
    // events showed about a third of the roster each. Invisibly, with no error.
    const rpcRows: Row[] = [];
    let cursor: string | null = null;
    for (;;) {
      const { data, error } = await supabase.rpc('get_event_availability', {
        p_event_ids: eventIds,
        p_after_id: cursor,
        p_limit: AVAILABILITY_RPC_PAGE,
      });

      if (error) {
        const missingFunction = error.code === 'PGRST202' || error.code === '42883';
        if (!missingFunction) {
          console.error('get_event_availability failed:', error);
          // Pages that already landed are real rows and worth keeping; the
          // caller reads `failed` as "this list may be short", which is exactly
          // right for a read that died partway through.
          return { rows: rpcRows, failed: true };
        }
        // Only a genuinely absent function falls through to the older, slower
        // paths below — and only from the first page, since a function that
        // existed a moment ago cannot vanish mid-scan. A deployment carrying
        // only the older one-argument signature lands here too, since the paged
        // arguments make PostgREST fail to resolve it.
        if (rpcRows.length > 0) return { rows: rpcRows, failed: true };
        console.warn('get_event_availability() not deployed — trying the embedded read.');
        break;
      }

      const page = ((data as Row[]) ?? []) as Row[];
      rpcRows.push(...page);
      // A short page means the server had nothing left to give.
      if (page.length < AVAILABILITY_RPC_PAGE) return { rows: rpcRows, failed: false };
      cursor = page[page.length - 1].id as string;
    }

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

  /**
   * Turns season rows into Seasons, fetching everything that hangs off them.
   *
   * `onPartial` (detail reads only) is called more than once, each time with a
   * more complete season, because the four reads behind a season differ in cost
   * by orders of magnitude and the schedule only needs the cheapest one:
   *
   *   1. `season_events` — one indexed page. This is the schedule.
   *   2. `season_roster` + its athletes — per-row can_access_athlete(), which
   *      is five OR'd EXISTS branches, over the whole roster.
   *   3. RSVPs — per-row can_access_season() over every invite on every event.
   *   4. portal invites.
   *
   * Waiting for 2-4 before handing anything back is what left a coach watching
   * a loading spinner for seconds after their events were already in memory. So
   * the events go out on their own first (`rosterPending` and
   * `availabilityPending` set), the roster follows, and the resolved value is
   * the complete season. A view that needs a later stage checks the flags and
   * waits; the schedule doesn't have to. Mirrors the mobile app's
   * assembleSeasons().
   */
  private async assembleSeasons(
    seasonRows: Row[],
    withDetail: boolean,
    onPartial?: (seasons: Season[]) => void,
    preload?: SeasonBaseReads,
  ): Promise<Season[]> {
    if (seasonRows.length === 0) return [];
    const supabase = getSupabase();
    const ids = seasonRows.map((s) => s.id);

    // Keyset-paged like every other batched read here (see fetchAllByIn), not
    // one unbounded select each. A season roster is seeded from every
    // participant of every tryout linked to the team and never pruned, so on a
    // club-sized team it runs past PostgREST's 1,000-row default — which
    // truncates silently rather than erroring. The rows that landed past the
    // cutoff took their players out of every event's RSVP list (the availability
    // rows join back through `rosterById` below), so a coach saw part of the
    // roster on an event the whole team was invited to. It also fed
    // addSeasonEvent(), which builds an event's invites from this roster.
    //
    // Both reads start together — the staging below only changes when each one
    // is *awaited*, never when it is issued, so the roster is already in flight
    // while the events are being handed to the UI. getSeason() starts them
    // earlier still and passes them in.
    const { events: eventsPromise, roster: rosterPromise } =
      preload ?? seasonBaseReads(supabase, ids);

    /**
     * The mapping half, run once per stage. Everything it needs from the
     * network is a parameter, so the stages can't drift apart.
     */
    const build = (
      eventRowsUnsorted: Row[],
      rosterRows: Row[],
      availabilityRows: Row[],
      inviteRows: Row[],
      flags: { availabilityFailed?: boolean; availabilityPending?: boolean; rosterPending?: boolean },
    ): Season[] => {
      // `.order()` isn't available through the paged helper — it keysets on
      // `id` — so the event_date ordering callers rely on is restored here.
      // Dates are ISO `YYYY-MM-DD`, so a string compare is the date compare the
      // server was doing. Undated rows go last, where PostgREST's `.order()`
      // put them, rather than sorting ahead of everything as an empty string
      // would.
      const eventRows = [...eventRowsUnsorted].sort((a, b) => {
        const ad = (a.event_date as string | null) ?? '';
        const bd = (b.event_date as string | null) ?? '';
        if (!ad || !bd) return (ad ? 0 : 1) - (bd ? 0 : 1);
        return ad.localeCompare(bd);
      });
      const eventsBySeason: Record<string, Row[]> = {};
      for (const e of eventRows) (eventsBySeason[e.season_id] ??= []).push(e);
      const rosterBySeason: Record<string, Row[]> = {};
      for (const r of rosterRows) (rosterBySeason[r.season_id] ??= []).push(r);
      // Indexed once rather than a .find() per availability row — that scan was
      // O(roster × RSVPs), which for a full-roster event on a large team is a
      // million comparisons on the main thread before anything renders.
      const rosterById = new Map(rosterRows.map((r) => [r.id, r]));
      const availByEvent: Record<string, Record<string, string>> = {};
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
          this.rowToSeasonEvent(
            ev,
            availByEvent[ev.id] ?? {},
            flags.availabilityFailed ?? false,
            flags.availabilityPending ?? false,
          ),
        ),
        roster: (rosterBySeason[s.id] ?? []).map((r) => this.rowToSeasonPlayer(r, inviteRows)),
        rosterPending: flags.rosterPending || undefined,
        scheduleShareToken: s.schedule_share_token ?? undefined,
        createdAt: toMs(s.created_at),
        updatedAt: toMs(s.updated_at),
        archived: s.archived || undefined,
      })) as Season[];
    };

    if (!withDetail || !onPartial) {
      const [eventRows, rosterRows] = await Promise.all([eventsPromise, rosterPromise]);
      if (!withDetail) return build(eventRows, rosterRows, [], [], {});
      return build(eventRows, rosterRows, ...(await this.fetchSeasonDetail(supabase, eventRows, ids)));
    }

    // Stage 1: the schedule, on its own, as soon as it lands.
    const eventRows = await eventsPromise;
    onPartial(build(eventRows, [], [], [], { rosterPending: true, availabilityPending: true }));

    // Stage 2: the roster, which the RSVP read below is keyed against anyway.
    const rosterRows = await rosterPromise;
    onPartial(build(eventRows, rosterRows, [], [], { availabilityPending: true }));

    return build(eventRows, rosterRows, ...(await this.fetchSeasonDetail(supabase, eventRows, ids)));
  }

  /**
   * The two reads only the detail path makes: every RSVP on every event, and
   * the season's portal invites. On a large season they're the heaviest part of
   * the assembly by far. Returns the tail of build()'s argument list, so both
   * callers can spread it.
   */
  private async fetchSeasonDetail(
    supabase: SupabaseClient,
    eventRows: Row[],
    ids: string[],
  ): Promise<[Row[], Row[], { availabilityFailed: boolean }]> {
    const eventIds = eventRows.map((e) => e.id as string);
    const [avail, invites] = await Promise.all([
      this.fetchEventAvailability(supabase, eventIds),
      fetchAllByIn(supabase, 'portal_invites', '*', 'season_id', ids),
    ]);
    return [avail.rows, invites, { availabilityFailed: avail.failed }];
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
    const { data: managedRows, error: managedErr } = await this.viewerRpc(supabase, 'list_seasons_for_managed_teams');
    if (managedErr) {
      console.log('list_seasons_for_managed_teams unavailable:', managedErr.message);
      return this.assembleSeasons(rows, false);
    }
    const { data: ownedTeamRows, error: ownedErr } = await this.viewerRpc(supabase, 'list_seasons_on_my_owned_teams');
    if (ownedErr) {
      console.log('list_seasons_on_my_owned_teams unavailable:', ownedErr.message);
    }

    const ownIds = new Set(rows.map((s) => s.id));
    const managed = ((managedRows ?? []) as Row[]).filter((s) => !ownIds.has(s.id));
    const onOwnedTeams = ((ownedTeamRows ?? []) as Row[]).filter(
      (s) => !ownIds.has(s.id) && !managed.some((m) => m.id === s.id),
    );

    // `false`: the list's consumers (the Seasons grid, search, the team hub's
    // season lookup, the enterprise count) read names, events and roster —
    // never RSVPs or portal invites. Fetching detail here meant every RSVP row
    // of every event of every season in the account came down before the
    // Seasons page could paint a single card. The season pages that do need
    // RSVPs call getSeason() for the one season they show. Matches the mobile
    // app's listSeasons().
    return this.assembleSeasons([...rows, ...managed, ...onOwnedTeams], false);
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
      this.viewerRpc(supabase, 'list_seasons_for_managed_teams'),
      this.viewerRpc(supabase, 'list_seasons_on_my_owned_teams'),
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

  async getSeason(id: string, onPartial?: (season: Season) => void): Promise<Season | null> {
    await this.ctx();
    const supabase = getSupabase();
    // In flight while the season row itself is being read, not after it: the
    // schedule is what the caller is waiting for and it needs nothing from that
    // row but the id.
    const preload = seasonBaseReads(supabase, [id]);
    const row = (await supabase.from('seasons').select('*').eq('id', id).maybeSingle()).data as Row | null;
    if (!row) return null;
    const [assembled] = await this.assembleSeasons(
      [row],
      true,
      ([partial]) => {
        if (partial) onPartial?.(partial);
      },
      preload,
    );
    return assembled ?? null;
  }

  /**
   * One keyset page of a season's roster, with the portal invites for exactly
   * the players on it.
   *
   * The screen-facing counterpart to getSeason(), which reads every enrolled
   * player before the roster renders — on a club-sized season that's several
   * 200-row pages, each paying can_access_athlete() per row through the
   * `athletes` embed, to fill a list the coach scrolls a screenful of. Here the
   * first page is one statement and the rest are fetched only if the coach asks
   * for them.
   *
   * `after` is the last id of the previous page (keyset rather than offset for
   * the reason fetchAllByIn gives: an OFFSET re-authorizes every row it skips).
   * `nextCursor` is undefined once a short page says the server had nothing
   * left to give.
   *
   * The flows that genuinely need everyone — inviting a roster to an event, the
   * availability grid, attendance rates — still read the whole roster.
   */
  async listSeasonRosterPage(
    seasonId: string,
    opts?: { after?: string; limit?: number },
  ): Promise<{ players: SeasonPlayer[]; nextCursor?: string }> {
    await this.ctx();
    const supabase = getSupabase();
    const limit = opts?.limit ?? SEASON_ROSTER_SCREEN_PAGE;

    let q = supabase
      .from('season_roster')
      .select(SEASON_ROSTER_SELECT)
      .eq('season_id', seasonId)
      // `id` is the primary key, so this order is total — pages can neither
      // overlap nor skip rows, and it matches the order assembleSeasons()
      // produces so the list doesn't reshuffle against the rest of the app.
      .order('id')
      .limit(limit);
    if (opts?.after) q = q.gt('id', opts.after);
    const rows = (unwrap(await q) ?? []) as Row[];

    // Scoped to this page's athletes rather than the season's whole invite
    // history: the badge only ever renders for a player on screen.
    let inviteRows: Row[] = [];
    const athleteIds = rows.map((r) => r.athlete_id as string | null).filter(Boolean) as string[];
    if (athleteIds.length > 0) {
      try {
        inviteRows = (unwrap(
          await supabase
            .from('portal_invites')
            .select('*')
            .eq('season_id', seasonId)
            .in('athlete_id', athleteIds),
        ) ?? []) as Row[];
      } catch (e) {
        // A missing invite badge is not worth failing a page of the roster for.
        console.warn('Portal-invite read failed for a roster page:', e);
      }
    }

    return {
      players: rows.map((r) => this.rowToSeasonPlayer(r, inviteRows)),
      // A short page means there is nothing after it.
      nextCursor: rows.length === limit ? (rows[rows.length - 1].id as string) : undefined,
    };
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


  /**
   * The subscribable calendar feed for the season an event belongs to, or null
   * when the caller cannot see it. Read through the event, because that is all
   * most calendar buttons hold. The token is the season's schedule_share_token,
   * which RLS already shows to anyone who can open the season (coaches,
   * managers, and the guardians on its roster).
   */
  async getSeasonCalendarFeed(eventId: string): Promise<{ url: string; name: string } | null> {
    const { supabase } = await this.ctx();
    const { data } = await supabase
      .from('season_events')
      .select('seasons(name, team_name, schedule_share_token)')
      .eq('id', eventId)
      .maybeSingle();
    const raw = (data as Row | null)?.seasons;
    const season = (Array.isArray(raw) ? raw[0] : raw) as Row | undefined;
    const token = season?.schedule_share_token as string | undefined;
    const base = APP_CONFIG.supabaseUrl.replace(/\/+$/, '');
    if (!token || !base) return null;
    return {
      url: `${base}/functions/v1/season-calendar-feed?token=${encodeURIComponent(token)}`,
      name: `${season?.team_name || season?.name || 'Team'} schedule`,
    };
  }

  /**
   * Creates several events in one go (a repeating practice, a full season of
   * games) and tells everyone once.
   *
   * Each event is written exactly as addSeasonEvent writes it, but with its
   * own schedule email switched off; afterwards a single digest goes to every
   * invited player and guardian. Before this a 30-event season sent every
   * guardian 30 separate emails. The digest also carries a subscribe link for
   * the whole season, so later additions and deletions reach calendars on their
   * own.
   */
  async addSeasonEvents(
    seasonId: string,
    forms: CreateEventForm[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<SeasonEvent[]> {
    if (forms.length === 0) return [];
    if (forms.length === 1) return [await this.addSeasonEvent(seasonId, forms[0], undefined)];

    // Only the web implementation needs this (it reads the roster per event);
    // the other ignores it. Read once here rather than once per event.
    const prefetched = await this.prefetchSeasonForEvents(seasonId);

    const created: SeasonEvent[] = new Array(forms.length);
    let done = 0;
    onProgress?.(0, forms.length);
    await mapPool(forms.map((form, i) => ({ form, i })), 3, async ({ form, i }) => {
      created[i] = await this.addSeasonEvent(seasonId, form, undefined, {
        notify: false,
        season: prefetched,
      });
      onProgress?.(++done, forms.length);
    });

    this.dispatchScheduleDigest(seasonId, created);
    return created;
  }

  private reportScheduleEmailFailures(results: PromiseSettledResult<unknown>[], total: number): void {
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) {
      console.error(
        `Failed to send ${failed.length}/${total} schedule emails`,
        (failed[0] as PromiseRejectedResult).reason,
      );
    }
  }

  /** One email per recipient for a batch of new events. Best-effort, off the critical path. */
  private dispatchScheduleDigest(seasonId: string, events: SeasonEvent[]): void {
    if (events.length === 0) return;
    void (async () => {
      try {
        const { supabase } = await this.ctx();
        const [{ data: seasonRow }, recipients] = await Promise.all([
          supabase
            .from('seasons')
            .select('name, team_name, schedule_share_token')
            .eq('id', seasonId)
            .maybeSingle(),
          this.eventRecipientEmails(events[0].id),
        ]);
        if (recipients.length === 0) return;
        const season = seasonRow as Row | null;
        const payload = {
          teamName: season?.team_name ?? undefined,
          seasonName: season?.name ?? undefined,
          feedToken: season?.schedule_share_token ?? undefined,
          events: events.map((e) => ({
            eventId: e.id,
            title: e.title,
            date: e.date,
            startTime: e.startTime,
            endTime: e.endTime,
            location: e.location,
            notes: e.notes,
          })),
        };
        const results = await Promise.allSettled(
          recipients.map((email) => this.sendEmail('schedule_digest', email, payload)),
        );
        this.reportScheduleEmailFailures(results, recipients.length);
      } catch (e) {
        console.error('Failed to send the schedule digest', e);
      }
    })();
  }

  /**
   * Every address that should hear about an event: each invited player's own
   * and their guardian's. issue_event_rsvp_tokens() already joins through to
   * both; the plain read is the fallback when it cannot run.
   */
  private async eventRecipientEmails(eventId: string): Promise<string[]> {
    const out = new Set<string>();
    try {
      for (const t of await this.issueEventRsvpTokens(eventId)) {
        if (t.playerEmail) out.add(t.playerEmail);
        if (t.guardianEmail) out.add(t.guardianEmail);
      }
    } catch (e) {
      console.error('Could not issue RSVP links for this event', e);
    }
    if (out.size > 0) return Array.from(out);

    const { supabase } = await this.ctx();
    const { data } = await supabase
      .from('event_availability')
      .select('season_roster(player_email, athletes(guardian_email))')
      .eq('season_event_id', eventId);
    for (const item of (data ?? []) as Row[]) {
      const sr = Array.isArray(item.season_roster) ? item.season_roster[0] : item.season_roster;
      if (sr?.player_email) out.add(sr.player_email);
      const a = Array.isArray(sr?.athletes) ? sr.athletes[0] : sr?.athletes;
      if (a?.guardian_email) out.add(a.guardian_email);
    }
    return Array.from(out);
  }

  /** The season, read once for a batch so each event does not re-read the whole roster. */
  private async prefetchSeasonForEvents(seasonId: string): Promise<Season | null> {
    return this.getSeason(seasonId);
  }

  async addSeasonEvent(
    seasonId: string,
    form: CreateEventForm,
    onProgress?: (done: number, total: number) => void,
    // `notify: false` is for addSeasonEvents, which sends one digest instead;
    // `season` lets it hand over a roster it already read.
    opts: { notify?: boolean; season?: Season | null } = {},
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
          end_date: form.endDate || form.date,
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

    const season = opts.season !== undefined ? opts.season : await this.getSeason(seasonId);
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

      if (opts.notify === false) return this.rowToSeasonEvent(row, {});

      // Find all guardians related to the selected players and send them emails.
      // Fanned out through the same bounded pool as the other guardian-email
      // sends (GUARDIAN_EMAIL_CONCURRENCY): each is a network call to the
      // send-email edge function, so a large roster sent one at a time was the
      // dominant cost of creating an event — a 1,000-player team spent minutes
      // here alone. Emailing is best-effort per guardian, not for the batch as
      // a whole — one bounce or transient function error must not cost every
      // other guardian their invite.
      // Per-player RSVP links, so the email can be answered without opening the
      // app at all. Grouped by address rather than by player: a guardian with
      // two kids on this event gets one email asking about both, not two.
      //
      // Best-effort — if minting fails the notification still goes out, just
      // without the buttons, which is strictly what happened before this
      // existed. Never let it cost a guardian their invite.
      const rsvpsByEmail = new Map<string, { playerName: string; token: string }[]>();
      try {
        for (const t of await this.issueEventRsvpTokens(eventId)) {
          if (!t.guardianEmail) continue;
          const list = rsvpsByEmail.get(t.guardianEmail) ?? [];
          list.push({ playerName: t.playerName, token: t.token });
          rsvpsByEmail.set(t.guardianEmail, list);
        }
      } catch (e) {
        console.error('Could not issue RSVP links for this event', e);
      }

      const emails = Array.from(new Set([
        ...rsvpsByEmail.keys(),
        ...season.roster
          .filter(p => selectedPlayerIds.includes(p.id))
          .map(p => p.guardianEmail)
          .filter((e): e is string => !!e),
      ]));

      onProgress?.(0, emails.length);
      let sent = 0;
      await mapPool(emails, GUARDIAN_EMAIL_CONCURRENCY, async (email) => {
        try {
          await this.sendEmail('schedule_update', email, {
            eventId,
            eventName: form.title,
            date: form.date,
            startTime: form.startTime,
            endTime: form.endTime,
            location: form.location,
            notes: form.notes,
            teamName: season.teamName,
            seasonName: season.name,
            // Freshly created, so this is the first version of the invite any
            // calendar client will see.
            sequence: 0,
            rsvps: rsvpsByEmail.get(email) ?? [],
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
    // A blank end date means "same day as the start", and moving the start date
    // has to move the end with it, or an edit could leave an end before the start.
    if (updates.endDate !== undefined || updates.date !== undefined) {
      patch.end_date = updates.endDate || updates.date || patch.event_date;
    }
    if (updates.startTime !== undefined) patch.start_time = updates.startTime || null;
    if (updates.endTime !== undefined) patch.end_time = updates.endTime || null;
    if (updates.location !== undefined) patch.location = updates.location || null;
    if (updates.notes !== undefined) patch.notes = updates.notes || null;
    const row = unwrap(
      await supabase.from('season_events').update(patch).eq('id', eventId).select().single(),
    ) as Row;

    // Notifying the roster is deliberately not awaited. It needs the RSVP-token
    // RPC and a recipient lookup across the whole roster, and awaiting it kept
    // the edit dialog open for that long — seconds, growing with the roster —
    // for a save that had already landed. Errors are logged inside.
    void (async () => {
    try {
      const playerEmails = new Set<string>();
      const guardianEmails = new Set<string>();
      const rsvpsByEmail = new Map<string, { playerName: string; token: string }[]>();

      // issue_event_rsvp_tokens() already joins through to each invited
      // player's own address and their guardian's, so it doubles as the
      // recipient list this used to assemble with a nested select — and it
      // returns the RSVP link alongside, letting the re-send carry buttons.
      // Idempotent, so a link already in an inbox from the original invite
      // keeps working after an edit.
      let tokensIssued = false;
      try {
        for (const t of await this.issueEventRsvpTokens(eventId)) {
          tokensIssued = true;
          for (const addr of [t.playerEmail, t.guardianEmail]) {
            if (!addr) continue;
            if (addr === t.playerEmail) playerEmails.add(addr);
            else guardianEmails.add(addr);
            const list = rsvpsByEmail.get(addr) ?? [];
            list.push({ playerName: t.playerName, token: t.token });
            rsvpsByEmail.set(addr, list);
          }
        }
      } catch (e) {
        console.error('Could not issue RSVP links for this event', e);
      }

      // Minting failed — fall back to the plain address lookup so an edit still
      // notifies everyone, just without the RSVP buttons.
      if (!tokensIssued) {
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
      }

      const allEmails = new Set([...playerEmails, ...guardianEmails]);

      // A calendar client only replaces the copy it already holds when SEQUENCE
      // is higher than the one it stored. Seconds since the event was created is
      // monotonic per event and stays a small integer, so each edit supersedes
      // the last instead of stacking up duplicates in someone's calendar.
      const sequence = Math.max(0, Math.floor((toMs(row.updated_at) - toMs(row.created_at)) / 1000));

      if (playerEmails.size > 0) {
        supabase.functions.invoke('send-push-notification', {
          body: { target_user_ids: Array.from(playerEmails), heading: `Schedule Update: ${row.title}`, content: `Event updated to ${row.event_date}.` }
        }).catch(console.error);
      }

      for (const email of allEmails) {
        supabase.functions.invoke('send-email', {
          body: {
            type: 'schedule_update',
            to: email,
            payload: {
              eventId,
              eventName: row.title,
              date: row.event_date,
              startTime: row.start_time,
              endTime: row.end_time,
              location: row.location,
              notes: row.notes,
              sequence,
              rsvps: rsvpsByEmail.get(email) ?? [],
            },
          },
        }).catch(console.error);
      }
    } catch (e) {
      console.error('Failed to send update emails', e);
    }
    })();

    return this.rowToSeasonEvent(row, {});
  }

  async deleteSeasonEvent(_seasonId: string, eventId: string): Promise<void> {
    const { supabase } = await this.ctx();

    // Read what the cancellation needs before the delete: the event row and its
    // invitees both go with it (event_availability cascades), and the email has
    // to say which event and reach the people who were invited.
    const [{ data: eventRow }, recipients] = await Promise.all([
      supabase
        .from('season_events')
        .select('id, title, event_date, start_time, end_time, location, created_at, updated_at, seasons(team_name)')
        .eq('id', eventId)
        .maybeSingle(),
      this.eventRecipientEmails(eventId).catch(() => [] as string[]),
    ]);

    unwrap(await supabase.from('season_events').delete().eq('id', eventId).select().maybeSingle());

    // The delete has landed; telling people is best-effort and never blocks it.
    const ev = eventRow as Row | null;
    if (!ev || recipients.length === 0) return;
    const season = Array.isArray(ev.seasons) ? ev.seasons[0] : ev.seasons;
    // A calendar only applies a cancellation whose SEQUENCE beats the copy it
    // holds, and edits raise it with the seconds since creation, so go one past.
    const sequence = Math.max(0, Math.floor((toMs(ev.updated_at) - toMs(ev.created_at)) / 1000)) + 1;
    void Promise.allSettled(
      recipients.map((email) =>
        this.sendEmail('schedule_cancel', email, {
          eventId,
          eventName: ev.title,
          date: ev.event_date,
          startTime: ev.start_time,
          endTime: ev.end_time,
          location: ev.location,
          teamName: season?.team_name ?? undefined,
          sequence,
        }),
      ),
    ).then((results) => this.reportScheduleEmailFailures(results, recipients.length));
  }

  /**
   * Backfills event_availability for athletes who joined the roster after
   * these events were created — see addAthletesToEvents on DataSource. The
   * batch here is always small (the players just added × the events a coach
   * picked in one modal), unlike a whole-roster invite, so this skips the
   * create_season_event_for_caller-style RPC fast path and just chunks the
   * insert the way addSeasonEvent's own fallback does.
   */
  async addAthletesToEvents(
    seasonId: string,
    eventIds: string[],
    athleteIds: string[],
  ): Promise<{ added: number; failed: number }> {
    if (eventIds.length === 0 || athleteIds.length === 0) return { added: 0, failed: 0 };
    const { supabase } = await this.ctx();

    const rosterRows = unwrap(
      await supabase
        .from('season_roster')
        .select('id, athlete_id')
        .eq('season_id', seasonId)
        .in('athlete_id', athleteIds),
    ) as Row[];
    if (rosterRows.length === 0) return { added: 0, failed: 0 };

    const rows = eventIds.flatMap((eventId) =>
      rosterRows.map((r) => ({
        season_event_id: eventId,
        roster_id: r.id as string,
        response: 'pending' as const,
      })),
    );

    const chunks: (typeof rows)[] = [];
    for (let i = 0; i < rows.length; i += REGISTRATION_CHUNK) {
      chunks.push(rows.slice(i, i + REGISTRATION_CHUNK));
    }
    let added = 0;
    let failed = 0;
    await mapPool(chunks, REGISTRATION_CHUNK_CONCURRENCY, async (chunk) => {
      // ignoreDuplicates: an athlete already invited to one of these events
      // (e.g. re-running this for an overlapping event selection) is left
      // alone rather than having a real response clobbered back to 'pending'.
      const { error } = await supabase
        .from('event_availability')
        .upsert(chunk, { onConflict: 'season_event_id,roster_id', ignoreDuplicates: true });
      if (error) {
        failed += chunk.length;
        console.error('Failed to add players to events:', error);
      } else {
        added += chunk.length;
      }
    });
    return { added, failed };
  }

  async addSeasonPlayer(seasonId: string, player: Omit<SeasonPlayer, 'id'>): Promise<SeasonPlayer> {
    const { supabase, accountId } = await this.ctx();
    const athleteId = player.athleteId || await this.createAthlete(accountId, {
      first_name: player.firstName,
      last_name: player.lastName,
      guardian_email: player.guardianEmail || null,
      guardian_phone: player.guardianPhone || null,
      player_email: player.playerEmail || null,
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
        .maybeSingle(),
    ) as Row | null;
    // No row back means the database skipped the enrolment: the player's
    // guardian left this team (guardian_leave_season), and nothing may enrol
    // them again until a coach removes and re-adds the player on the roster.
    if (!row) {
      throw Object.assign(
        new Error("This player's guardian has left the team. Remove the player from the team roster and add them again to enrol them."),
        { code: GUARDIAN_OPTED_OUT },
      );
    }
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

    await inBatches([...emails], EMAIL_SEND_CONCURRENCY, (email) =>
      supabase.functions.invoke('send-email', {
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
      }),
    );
  }



  /**
   * Link season-roster players to the player/guardian portal, on every address
   * each of them has on file.
   *
   * This is what makes the link automatic: the roster screens call it the
   * moment players are added, so being on a roster and having a way into the
   * portal are one event rather than two, and nobody has to remember to come
   * back and press Invite. sendPortalInvite() stays for the manual button on a
   * player's profile, which sends to one address the coach chose.
   *
   * The season twin of sendTeamRosterInvites(), down to the signature: pass
   * `playerIds` to narrow to specific roster entries and `emails` to narrow to
   * specific addresses; omit both to invite the whole season roster.
   *
   * Partial success is the normal outcome — a player with no email on file is a
   * `skipped`, not a failure, and must never take the add down with it.
   *
   * An address that already has a pending invite is skipped silently rather
   * than mailed again. Re-adding a player to a roster is routine (a mid-season
   * move, a corrected entry, a season imported from its team), and each one
   * firing another "you have been invited" at a parent who never used the first
   * is how automatic sending turns into a complaint.
   */
  async sendSeasonRosterInvites(
    seasonId: string,
    playerIds?: string[],
    emails?: string[],
  ): Promise<TeamInviteResult> {
    const { supabase, accountId } = await this.ctx();
    const result: TeamInviteResult = { sent: [], failed: [], skipped: [] };

    let query = supabase
      .from('season_roster')
      .select('id, athlete_id, jersey, player_email, athletes(first_name, last_name, guardian_email, player_email)')
      .eq('season_id', seasonId);
    if (playerIds?.length) query = query.in('id', playerIds);
    const rows = (unwrap(await query) as Row[] | null) ?? [];
    if (rows.length === 0) return result;

    // The season carries the team's name for the email; a failed read here is
    // not worth failing the invites over, so it degrades to an unnamed team.
    const season = (
      await supabase.from('seasons').select('name, team_name').eq('id', seasonId).maybeSingle()
    ).data as Row | null;
    const teamName = (season?.team_name as string | null) ?? (season?.name as string | null) ?? undefined;

    // One work item per (player, address). A player and their guardian each get
    // their own invite row and token, so accepting one doesn't consume the
    // other. Player wins when one address is on file as both — the wording
    // differs between the two roles and it must only go once.
    const targets: { athleteId: string; playerName: string; jersey?: string; email: string; role: 'Player' | 'Guardian' }[] = [];
    const wanted = emails?.length ? new Set(emails.map((e) => e.trim().toLowerCase())) : null;
    for (const r of rows) {
      const rawAthlete = r.athletes;
      const a = (Array.isArray(rawAthlete) ? rawAthlete[0] : rawAthlete) ?? {};
      const playerName = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || 'Unnamed player';

      const byEmail = new Map<string, 'Player' | 'Guardian'>();
      const guardian = (a.guardian_email as string | null)?.trim();
      if (guardian) byEmail.set(guardian, 'Guardian');
      // The season enrollment's address overrides the athlete's own, matching
      // rowToSeasonPlayer — a player who uses a different address for this club
      // should be invited at the one the roster holds.
      const own = ((r.player_email ?? a.player_email) as string | null)?.trim();
      if (own) byEmail.set(own, 'Player');

      const chosen = wanted
        ? [...byEmail].filter(([email]) => wanted.has(email.toLowerCase()))
        : [...byEmail];
      if (chosen.length === 0) {
        result.skipped.push(playerName);
        continue;
      }
      for (const [email, role] of chosen) {
        targets.push({ athleteId: r.athlete_id, playerName, jersey: r.jersey ?? undefined, email, role });
      }
    }

    if (targets.length === 0) return result;

    // One read covering every athlete rather than one per address. A failed
    // read leaves `pending` empty, which means "send it" — a duplicate invite
    // is a far better failure than a silently withheld one.
    let pending = new Set<string>();
    try {
      const existing = await fetchAllByIn(
        supabase,
        'portal_invites',
        // `id` is not read here but fetchAllByIn keysets on it, so a set of
        // invites larger than one page would page incorrectly without it.
        'id, athlete_id, email',
        'athlete_id',
        [...new Set(targets.map((t) => t.athleteId))],
        undefined,
        'accepted_at',
      );
      pending = new Set(
        existing.map((r) => `${r.athlete_id}|${String(r.email).toLowerCase()}`),
      );
    } catch (e) {
      console.warn('Could not check existing portal invites; sending anyway:', e);
    }

    // Same bounded fan-out as the team path — each target is an insert plus a
    // send-email call, and a full roster sent serially is the dominant cost of
    // the whole operation.
    const fresh = targets.filter((t) => !pending.has(`${t.athleteId}|${t.email.toLowerCase()}`));
    await mapPool(fresh, GUARDIAN_EMAIL_CONCURRENCY, async (t) => {
      try {
        unwrap(
          await supabase
            .from('portal_invites')
            .insert({
              account_id: accountId,
              athlete_id: t.athleteId,
              season_id: seasonId,
              email: t.email,
              token: generateId('invite').slice(0, 20),
            })
            .select('id'),
        );
        await this.sendEmail('player_invite', t.email, {
          playerName: t.playerName,
          teamName,
          jersey: t.jersey,
          role: t.role,
        });
        result.sent.push(t.email);
      } catch (e) {
        result.failed.push({
          email: t.email,
          message: e instanceof Error ? e.message : 'Could not send invite.',
        });
      }
    });

    return result;
  }

  /**
   * Link tryout participants to the player/guardian portal, on every address
   * each of them has on file.
   *
   * Assessors can add players straight onto a tryout roster, and until now
   * that guardian never got a way into the portal at all — there was no invite
   * of any kind on this side, only on season/team rosters. `can_access_tryout`
   * already grants a guardian read access to any tryout their athlete
   * participates in once `athletes.guardian_user_id` is set (see migration
   * 0006_guardian_roster_access.sql); all that was missing was actually
   * inviting them, which is pure application code — no RLS or RPC change.
   *
   * `portal_invites` has no tryout_id column and doesn't need one: access is
   * governed by `tryout_participants` + `guardian_user_id`, not by which
   * season/team the invite row names, so this leaves both null exactly like a
   * standalone tryout has neither.
   *
   * Same shape as sendSeasonRosterInvites/sendTeamRosterInvites: pass
   * `participantIds` to narrow to specific roster rows, `emails` to narrow to
   * specific addresses; omit both to invite the whole tryout roster. Partial
   * success is the normal outcome, and an address with a still-pending invite
   * is skipped rather than mailed again.
   */
  async sendTryoutRosterInvites(
    tryoutId: string,
    participantIds?: string[],
    emails?: string[],
  ): Promise<TeamInviteResult> {
    const { supabase } = await this.ctx();
    const result: TeamInviteResult = { sent: [], failed: [], skipped: [] };

    let query = supabase
      .from('tryout_participants')
      .select('id, athlete_id, jersey, athletes(first_name, last_name, guardian_email, player_email)')
      .eq('tryout_id', tryoutId);
    if (participantIds?.length) query = query.in('id', participantIds);
    const rows = (unwrap(await query) as Row[] | null) ?? [];
    if (rows.length === 0) return result;

    // The tryout's own account, not the caller's: a delegated manager can run
    // a tryout that lives on the club's account, and portal_invites.account_id
    // is keyed to the row it's about, same as the team path.
    const tryout = unwrap(
      await supabase.from('tryouts').select('account_id, name, teams(name)').eq('id', tryoutId).maybeSingle(),
    ) as Row | null;
    if (!tryout) throw new Error('Assessment not found');
    const rawTeam = tryout.teams;
    const teamName =
      (Array.isArray(rawTeam) ? rawTeam[0] : rawTeam)?.name ?? (tryout.name as string | undefined);

    // One work item per (player, address) — same Player-wins-over-Guardian rule
    // as the season/team paths, for the same reason: the email is worded
    // differently for each role and an address on file as both must only be
    // sent once.
    const targets: { athleteId: string; playerName: string; jersey?: string; email: string; role: 'Player' | 'Guardian' }[] = [];
    const wanted = emails?.length ? new Set(emails.map((e) => e.trim().toLowerCase())) : null;
    for (const r of rows) {
      const rawAthlete = r.athletes;
      const a = (Array.isArray(rawAthlete) ? rawAthlete[0] : rawAthlete) ?? {};
      const playerName = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || 'Unnamed player';

      const byEmail = new Map<string, 'Player' | 'Guardian'>();
      const guardian = (a.guardian_email as string | null)?.trim();
      if (guardian) byEmail.set(guardian, 'Guardian');
      const own = (a.player_email as string | null)?.trim();
      if (own) byEmail.set(own, 'Player');

      const chosen = wanted
        ? [...byEmail].filter(([email]) => wanted.has(email.toLowerCase()))
        : [...byEmail];
      if (chosen.length === 0) {
        result.skipped.push(playerName);
        continue;
      }
      for (const [email, role] of chosen) {
        targets.push({ athleteId: r.athlete_id, playerName, jersey: r.jersey ?? undefined, email, role });
      }
    }

    if (targets.length === 0) return result;

    // One read covering every athlete rather than one per address. A failed
    // read leaves `pending` empty, which means "send it" — a duplicate invite
    // is a far better failure than a silently withheld one.
    let pending = new Set<string>();
    try {
      const existing = await fetchAllByIn(
        supabase,
        'portal_invites',
        'id, athlete_id, email',
        'athlete_id',
        [...new Set(targets.map((t) => t.athleteId))],
        undefined,
        'accepted_at',
      );
      pending = new Set(existing.map((r) => `${r.athlete_id}|${String(r.email).toLowerCase()}`));
    } catch (e) {
      console.warn('Could not check existing portal invites; sending anyway:', e);
    }

    const fresh = targets.filter((t) => !pending.has(`${t.athleteId}|${t.email.toLowerCase()}`));
    await mapPool(fresh, GUARDIAN_EMAIL_CONCURRENCY, async (t) => {
      try {
        await this.insertPortalInvite(
          {
            account_id: tryout.account_id,
            athlete_id: t.athleteId,
            email: t.email,
            token: generateId('invite').slice(0, 20),
          },
          { tryoutId },
        );
        await this.sendEmail('player_invite', t.email, {
          playerName: t.playerName,
          teamName,
          jersey: t.jersey,
          role: t.role,
        });
        result.sent.push(t.email);
      } catch (e) {
        result.failed.push({
          email: t.email,
          message: e instanceof Error ? e.message : 'Could not send invite.',
        });
      }
    });

    return result;
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

      // Background, a few at a time, so a big roster doesn't open hundreds of requests at once.
      void inBatches(emails, EMAIL_SEND_CONCURRENCY, (email) =>
        supabase.functions.invoke('send-email', {
          body: { type: 'reminder', to: email, payload: { title, message } }
        }).catch(console.error),
      ).catch(console.error);
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

  /**
   * Ids of the people the signed-in user has blocked. Never throws: if the
   * block list can't be read (for instance before the report-and-block
   * migration has been applied) chat carries on exactly as it did before,
   * showing everyone, rather than failing to load at all.
   */
  private async blockedAuthorIds(): Promise<string[]> {
    try {
      const { supabase } = await this.userCtx();
      const { data, error } = await supabase.from('user_blocks').select('blocked_user_id');
      if (error || !data) return [];
      return (data as Row[]).map((r) => r.blocked_user_id as string);
    } catch {
      return [];
    }
  }

  async listBlockedChatUsers(): Promise<BlockedChatUser[]> {
    try {
      const { supabase } = await this.userCtx();
      const { data, error } = await supabase
        .from('user_blocks')
        .select('blocked_user_id, blocked_name, created_at')
        .order('created_at', { ascending: false });
      if (error || !data) return [];
      return (data as Row[]).map((r) => ({
        userId: r.blocked_user_id,
        name: r.blocked_name || 'Unknown',
        blockedAt: toMs(r.created_at),
      }));
    } catch {
      return [];
    }
  }

  async blockChatUser(userId: string): Promise<void> {
    const { supabase } = await this.userCtx();
    unwrap(await supabase.rpc('block_chat_user', { p_user_id: userId }));
  }

  async unblockChatUser(userId: string): Promise<void> {
    const { supabase, userId: me } = await this.userCtx();
    const { error } = await supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_user_id', me)
      .eq('blocked_user_id', userId);
    if (error) throw new Error(error.message);
  }

  async reportTeamMessage(messageId: string, reason: ChatReportReason, details?: string): Promise<void> {
    const { supabase } = await this.userCtx();
    unwrap(
      await supabase.rpc('report_season_message', {
        p_message_id: messageId,
        p_reason: reason,
        p_details: details?.trim() || null,
      }),
    );
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
    // People the user has blocked are hidden here, for the live view and for
    // history alike. It is the user's own filter: nobody else's chat changes.
    const blocked = new Set(await this.blockedAuthorIds());
    return (rows ?? [])
      .reverse()
      .filter((row) => !blocked.has(row.author_user_id))
      .map((row) => this.mapTeamMessage(row));
  }

  async countUnreadTeamMessages(seasonId: string, sinceMs: number): Promise<number> {
    const { supabase, userId } = await this.userCtx();
    // head:true — the rows are never read, only counted, so none come back.
    // The caller's own messages are excluded: posting to a chat is not a
    // notification to yourself, and every send would otherwise badge the tab
    // it was sent from.
    let query = supabase
      .from('season_messages')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', seasonId)
      .gt('created_at', new Date(sinceMs).toISOString())
      .neq('author_user_id', userId);
    // Blocked people don't badge the chat either.
    const blocked = await this.blockedAuthorIds();
    if (blocked.length > 0) query = query.not('author_user_id', 'in', `(${blocked.join(',')})`);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async sendTeamMessage(seasonId: string, body: string): Promise<TeamMessage> {
    const { supabase } = await this.userCtx();
    // author_name/author_role are derived inside the function — see the
    // season_messages migration for why clients can't insert directly.
    const data = unwrap(
      await supabase.rpc('send_season_message', { p_season_id: seasonId, p_body: body }),
    );
    const row = Array.isArray(data) ? data[0] : data;
    const message = this.mapTeamMessage(row as Row);
    // The message is saved; telling the rest of the chat is best effort and never
    // holds up or fails the send.
    void this.pushTeamMessage(supabase, message).catch((e) => console.log('Chat push failed:', e));
    return message;
  }

  /**
   * Puts a new chat message in everyone else's notification bar: staff, managers,
   * guardians and players who can open this chat, except the sender.
   */
  private async pushTeamMessage(supabase: SupabaseClient, message: TeamMessage): Promise<void> {
    const { data, error } = await supabase.rpc('season_chat_push_targets', { p_season_id: message.seasonId });
    if (error) throw new Error(error.message);
    const targets = (data ?? []) as { team_name: string | null; user_id: string }[];
    const ids = [...new Set(targets.map((t) => t.user_id))];
    if (ids.length === 0) return;
    const snippet = message.body.length > 140 ? `${message.body.slice(0, 139)}…` : message.body;
    await supabase.functions.invoke('send-push-notification', {
      body: {
        target_user_ids: ids,
        heading: targets[0]?.team_name || 'Team chat',
        content: `${message.authorName}: ${snippet}`,
        data: { screen: 'chat', seasonId: message.seasonId },
      },
    });
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

  async countActiveAthletes(): Promise<number> {
    const { supabase, accountId } = await this.ctx();
    const [onEvaluations, onTeams] = await Promise.all([
      supabase
        .from('tryout_participants')
        .select('athlete_id, tryouts!inner(account_id, deleted_at)')
        .eq('tryouts.account_id', accountId)
        .is('tryouts.deleted_at', null)
        .is('removed_at', null),
      supabase
        .from('season_roster')
        .select('athlete_id, seasons!inner(account_id)')
        .eq('seasons.account_id', accountId),
    ]);
    const ids = new Set<string>();
    for (const r of [...(onEvaluations.data ?? []), ...(onTeams.data ?? [])] as Row[]) {
      if (r.athlete_id) ids.add(r.athlete_id as string);
    }
    return ids.size;
  }

  async listAthleteHub(
    search: string,
    offset: number,
    limit: number,
  ): Promise<{ rows: Athlete[]; next: number | null }> {
    const { supabase, accountId } = await this.ctx();
    const { data: grantRows } = await supabase
      .from('athlete_account_access')
      .select('athlete_id')
      .eq('account_id', accountId);
    const grantedIds = (grantRows ?? []).map((g: { athlete_id: string }) => g.athlete_id);

    // The athletes read policy is costly per row, and a name filter in the
    // query makes the database run it on every athlete before it can answer,
    // which times out on a large account. So the list is read in small id-ordered
    // chunks (cheap, they stop early) and names are matched here instead.
    const CHUNK = 200;
    const MAX_SCAN = 4000;
    const term = search.trim().toLowerCase();
    const take = term ? CHUNK : limit;
    const out: Athlete[] = [];
    let pos = offset;
    let exhausted = false;
    while (out.length < limit && pos - offset < (term ? MAX_SCAN : take)) {
      let q = supabase
        .from('athletes')
        .select('id, first_name, last_name, avatar_url, default_position, guardian_name, guardian_email, player_email')
        // Ordered by id, not name, so the database can stop after one chunk.
        .order('id')
        .range(pos, pos + take - 1);
      q = grantedIds.length
        ? q.or(`account_id.eq.${accountId},id.in.(${grantedIds.join(',')})`)
        : q.eq('account_id', accountId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Row[];
      for (const a of rows) {
        const hay = [a.first_name, a.last_name, `${a.first_name ?? ''} ${a.last_name ?? ''}`, a.guardian_name]
          .filter(Boolean)
          .join(' | ')
          .toLowerCase();
        if (term && !hay.includes(term)) continue;
        out.push({
          id: a.id,
          first: a.first_name ?? '',
          last: a.last_name ?? '',
          avatarUrl: a.avatar_url ?? undefined,
          currentPosition: a.default_position ?? undefined,
          guardianName: a.guardian_name ?? undefined,
          guardianEmail: a.guardian_email ?? undefined,
          playerEmail: a.player_email ?? undefined,
        });
      }
      pos += rows.length;
      if (rows.length < take) {
        exhausted = true;
        break;
      }
      if (!term) break;
    }
    return { rows: out, next: exhausted ? null : pos };
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
        dateOfBirth: a.date_of_birth ?? undefined,
        playerEmail: a.player_email ?? undefined,
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

  async getSessionProgress(tryoutId: string): Promise<Record<string, number>> {
    const { supabase } = await this.ctx();
    if (getImpersonationTarget()) {
      // The RPC authorizes by auth.uid()'s assessor row or membership, which
      // the founder never has, so it would restart numbering at Session 1.
      // The founder can read the evaluations themselves; same parse as the RPC.
      const rows = await fetchAllByIn(supabase, 'evaluations', 'id, participant_id, session', 'tryout_id', [tryoutId]);
      const progress: Record<string, number> = {};
      for (const r of rows) {
        const n = /^Session ([0-9]+)$/.exec((r.session as string | null) ?? '')?.[1];
        if (n && r.participant_id) progress[r.participant_id] = Math.max(progress[r.participant_id] ?? 0, Number(n));
      }
      return progress;
    }
    const { data, error } = await supabase.rpc('get_session_progress_for_tryout', {
      p_tryout_id: tryoutId,
    });
    if (error) {
      // An instance that hasn't deployed the function yet keeps the old
      // behaviour — numbering off whatever evaluations the caller can read —
      // rather than failing the scoring screen outright.
      console.log('get_session_progress_for_tryout unavailable:', error.message);
      return {};
    }
    const progress: Record<string, number> = {};
    for (const row of (data as Row[]) ?? []) {
      if (row.participant_id != null && row.max_session != null) {
        progress[row.participant_id as string] = Number(row.max_session);
      }
    }
    return progress;
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
    // Only evaluations that still exist for this player: one that was deleted
    // (tryouts.deleted_at) or that the player was taken off (removed_at) is no
    // longer part of their record, and showing its scores here is the old
    // evaluation's scoring following the player into a new one.
    const { data: participantRows } = await supabase
      .from('tryout_participants')
      .select('id, tryout_id')
      .eq('athlete_id', athleteId)
      .is('removed_at', null);

    let tryoutRosterRows: { id: string }[] = [];
    if (participantRows && participantRows.length > 0) {
      const { data: liveTryouts } = await supabase
        .from('tryouts')
        .select('id')
        .in('id', [...new Set(participantRows.map((p) => p.tryout_id))])
        .is('deleted_at', null);
      const liveIds = new Set((liveTryouts ?? []).map((t) => t.id));
      tryoutRosterRows = participantRows.filter((p) => liveIds.has(p.tryout_id));
    }

    let pastEvaluations: Evaluation[] = [];
    if (tryoutRosterRows.length > 0) {
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
    // Independent of everything else here — run alongside the roster fetch
    // instead of after it, since neither depends on the other's result.
    const teamRosterPromise = supabase
      .from('team_roster')
      .select('team_id, created_at, teams(name)')
      .eq('athlete_id', athleteId)
      .order('created_at', { ascending: false });

    const { data: participantRows } = await supabase
      .from('tryout_participants')
      .select('id, tryout_id, jersey, position, current_team, current_level, created_at')
      .eq('athlete_id', athleteId)
      .is('removed_at', null);
    const participants = participantRows ?? [];

    const tryoutIds = [...new Set(participants.map((p) => p.tryout_id))];
    const participantIds = participants.map((p) => p.id);

    // Both depend only on `participants`, not on each other — fetch together.
    const [{ data: tryoutRows }, { data: evalRows }, { data: teamRosterRows }] = await Promise.all([
      tryoutIds.length
        ? supabase
            .from('tryouts')
            .select('id, name, sport, settings, tryout_date, created_at, event_type, season_id, team_id, teams(name)')
            .in('id', tryoutIds)
            .is('deleted_at', null)
        : Promise.resolve({ data: [] as Row[] }),
      participantIds.length
        ? supabase
            .from('evaluations')
            .select('*, evaluation_scores(rubric_key, value)')
            .in('participant_id', participantIds)
        : Promise.resolve({ data: [] as Row[] }),
      teamRosterPromise,
    ]);
    const tryoutById = new Map((tryoutRows ?? []).map((t) => [t.id, t]));

    // Actual team membership (Teams feature) — the source of truth for "current
    // team", since tryout_participants.current_team is a free-text field that's
    // usually left blank.
    const teamRoster = teamRosterRows ?? [];
    const teams = [
      ...new Map(
        teamRoster.map((r) => {
          const t = Array.isArray(r.teams) ? r.teams[0] : r.teams;
          return [r.team_id, { teamId: r.team_id, teamName: t?.name ?? 'Unknown Team' }];
        }),
      ).values(),
    ];

    const evalsByParticipant = new Map<string, Evaluation[]>();
    for (const row of evalRows ?? []) {
      const ev = this.rowToEval(row);
      const arr = evalsByParticipant.get(ev.playerId) ?? [];
      arr.push(ev);
      evalsByParticipant.set(ev.playerId, arr);
    }

    // A tryout's `season_id` column is only ever set when it's created from
    // inside a Season Hub screen. What every team-linked assessment DOES have
    // is the Season Hub entry auto-created alongside its team (see
    // createTeam/team/new), which is what actually carries season identity here.
    const tryoutTeamIds = [...new Set((tryoutRows ?? []).map((t) => t.team_id).filter(Boolean))];
    const tryoutSeasonIds = [...new Set((tryoutRows ?? []).map((t) => t.season_id).filter(Boolean))];

    // Fetched together and deduped afterward rather than fetching the
    // season-id batch only for what the team-id batch didn't already cover —
    // a season can legitimately turn up in both, and the id Map below
    // collapses any overlap for free.
    const [teamSeasonsRes, seasonByIdRes] = await Promise.all([
      tryoutTeamIds.length > 0
        ? supabase
            .from('seasons')
            .select('id, name, team_id, created_at')
            .in('team_id', tryoutTeamIds)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] as Row[] }),
      tryoutSeasonIds.length > 0
        ? supabase.from('seasons').select('id, name, team_id, created_at').in('id', tryoutSeasonIds)
        : Promise.resolve({ data: [] as Row[] }),
    ]);
    const allSeasons: Row[] = [...(teamSeasonsRes.data ?? [])];
    const seenSeasonIds = new Set(allSeasons.map((s) => s.id));
    for (const s of seasonByIdRes.data ?? []) {
      if (!seenSeasonIds.has(s.id)) {
        allSeasons.push(s);
        seenSeasonIds.add(s.id);
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

  async getPlayerProfile(athleteId: string, alsoAthleteIds?: string[]): Promise<PlayerProfile> {
    const { supabase, userId, accountId } = await this.ctx();

    // None of these three depend on each other's results — run together
    // instead of as a chain of round trips.
    const ids = [athleteId, ...(alsoAthleteIds ?? []).filter((i) => i && i !== athleteId)];
    const [{ data: athleteRow }, contexts, { data: rosterRows }] = await Promise.all([
      supabase
        .from('athletes')
        .select(
          'id, first_name, last_name, avatar_url, player_email, guardian_name, guardian_email, guardian_phone, guardian_user_id, default_position, year_of_birth, date_of_birth, about, medical_info, account_id',
        )
        .eq('id', athleteId)
        .maybeSingle(),
      Promise.all(ids.map((id) => this.fetchAthleteAssessmentContext(supabase, id))),
      supabase.from('season_roster').select('season_id, seasons(name, team_name)').in('athlete_id', ids),
    ]);
    if (!athleteRow) throw new Error('Athlete not found');

    // Medical is sensitive: only the account this athlete actually belongs to
    // (not a delegated team manager or an invited assessor, who can both
    // legitimately read everything else here) or the athlete's own guardian
    // gets it. Computed off the row itself rather than cross-referencing a
    // separate teams query, which can't tell true ownership from delegation
    // and goes stale/empty independently of this request.
    const canViewMedical = athleteRow.account_id === accountId || (!!userId && athleteRow.guardian_user_id === userId);

    // The same person is sometimes stored as more than one athlete record (an
    // athlete imported separately into two evaluations gets two). Search folds
    // those into one result and passes the others in, so this profile shows
    // every evaluation. Only the first record's own details are shown.
    const participants = contexts.flatMap((c) => c.participants);
    const tryoutById = new Map(contexts.flatMap((c) => Array.from(c.tryoutById)));
    const teams = Array.from(new Map(contexts.flatMap((c) => c.teams).map((t) => [t.teamId, t])).values());
    const assessments = Array.from(new Map(contexts.flatMap((c) => c.assessments).map((a) => [a.tryoutId, a])).values());

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
      dateOfBirth: athleteRow.date_of_birth ?? undefined,
      aboutChild: athleteRow.about ?? undefined,
      medicalInfo: canViewMedical ? (athleteRow.medical_info ?? undefined) : undefined,
      playerEmail: athleteRow.player_email ?? undefined,
      guardianName: athleteRow.guardian_name ?? undefined,
      guardianEmail: athleteRow.guardian_email ?? undefined,
      linkedGuardianId: athleteRow.guardian_user_id ?? undefined,
      guardianPhone: athleteRow.guardian_phone ?? undefined,
      pastSeasons,
      teams,
      assessments,
      canViewMedical,
    };
  }

  async setEventAvailability(
    seasonId: string,
    eventId: string,
    playerId: string,
    response: 'yes' | 'maybe' | 'no',
  ): Promise<void> {
    // userCtx(), not ctx(): a guardian answers RSVPs for their own athlete
    // and, by design, has no accounts/memberships row (see 0011_user_account_types).
    // ctx() insists on one and threw 'No account for user' before the request
    // reached the database. Authorization is availability_write's guardian
    // branch (roster -> athletes.guardian_user_id), not the caller's account.
    const { supabase } = await this.userCtx();
    const rosterRow = unwrap(
      await supabase
        .from('season_roster')
        .select('id')
        .eq('season_id', seasonId)
        .or(`athlete_id.eq.${playerId},id.eq.${playerId}`)
        .maybeSingle()
    ) as Row | null;

    // Throw rather than return: the caller has already shown the answer as
    // saved, and a silent return leaves it looking recorded when nothing was
    // written. The mutation rolls the button back and the screen shows this.
    if (!rosterRow) {
      throw new Error("This player isn't on this season's roster, so the response couldn't be saved.");
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

  /**
   * Mint (or re-read) the per-player RSVP links for one event.
   *
   * Called just before the schedule email goes out, so each recipient's message
   * can carry Yes/Maybe/No links bound to their own player. Idempotent on the
   * backend — a re-send reuses the tokens already issued, which keeps links
   * already sitting in an inbox working.
   *
   * Best-effort by design at every call site: a failure here must cost the
   * recipient their RSVP buttons, not their notification.
   */
  async issueEventRsvpTokens(eventId: string): Promise<EventRsvpToken[]> {
    const { supabase } = await this.ctx();
    const rows = unwrap(
      await supabase.rpc('issue_event_rsvp_tokens', { p_event_id: eventId }),
    ) as Row[] | null;
    return (rows ?? []).map((r) => ({
      rosterId: r.roster_id,
      playerName: r.player_name ?? '',
      playerEmail: r.player_email ?? undefined,
      guardianEmail: r.guardian_email ?? undefined,
      token: r.token,
    }));
  }

  /**
   * Resolve an emailed RSVP link. Uses the plain anon client rather than
   * `ctx()`: the recipient is usually not signed in — that is the whole point of
   * the link — and requiring a session here would defeat it.
   */
  async getEventRsvpContext(token: string): Promise<EventRsvpContext | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('get_event_rsvp_context', { p_token: token });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
    return row ? this.rowToRsvpContext(row) : null;
  }

  /** Record an answer from an emailed RSVP link. Anon for the same reason. */
  async submitEventRsvp(token: string, response: 'yes' | 'maybe' | 'no'): Promise<EventRsvpContext> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('submit_event_rsvp', {
      p_token: token,
      p_response: response,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
    if (!row) throw new Error('This RSVP link is no longer valid.');
    return this.rowToRsvpContext(row);
  }

  private rowToRsvpContext(row: Row): EventRsvpContext {
    return {
      eventId: row.event_id,
      type: EVENT_KIND_FROM_DB[row.kind] ?? 'Event',
      title: row.title,
      date: row.event_date,
      startTime: row.start_time ?? undefined,
      endTime: row.end_time ?? undefined,
      location: row.location ?? undefined,
      notes: row.notes ?? undefined,
      seasonName: row.season_name ?? '',
      teamName: row.team_name ?? '',
      playerName: row.player_name ?? '',
      response: row.response ?? 'pending',
    };
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
    // SquadOwl's own subscription invoices (billed on the platform's Stripe
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

  async createCheckoutSession(
    planTier: string,
    interval: 'year' | 'month',
    options?: { applyCredits?: boolean; origin?: string; discountCode?: string },
  ): Promise<{ url: string }> {
    assertNotViewingAs();
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: {
        planTier,
        interval,
        origin: options?.origin ?? webOrigin(),
        applyCredits: options?.applyCredits === true,
        discountCode: options?.discountCode?.trim() || undefined,
      },
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

  async previewDiscountCode(code: string, planTier?: string): Promise<DiscountCodePreview> {
    const { data, error } = await getSupabase().rpc('preview_discount_code', {
      p_code: code.trim(),
      p_plan_tier: planTier ?? null,
    });
    if (error) {
      // Not deployed yet (20260917130000_founder_billing.sql) reads as an invalid code, not a crash.
      if (error.code === 'PGRST202' || error.code === '42883') {
        return { valid: false, message: 'Discount codes are not available yet.' };
      }
      throw new Error(error.message);
    }
    const r = (data ?? {}) as Row;
    if (!r.valid) return { valid: false, message: r.message ?? "That discount code isn't valid." };
    return {
      valid: true,
      code: r.code,
      kind: r.kind,
      percentOff: r.percentOff != null ? Number(r.percentOff) : undefined,
      amountOffCents: r.amountOffCents ?? undefined,
      duration: r.duration,
      durationMonths: r.durationMonths ?? undefined,
      planTiers: r.planTiers ?? [],
    };
  }

  async createPortalSession(): Promise<{ url: string }> {
    assertNotViewingAs();
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

  async createTeamLicenseCheckoutSession(
    quantity: number,
    options?: { applyCredits?: boolean },
  ): Promise<{ url: string }> {
    assertNotViewingAs();
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: {
        addOn: 'team_licenses',
        quantity: Math.max(1, Math.round(quantity)),
        interval: 'year',
        origin: webOrigin(),
        applyCredits: options?.applyCredits === true,
      },
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

  async getReferralSummary(): Promise<ReferralSummary> {
    const { supabase } = await this.ctx();

    // Minting the code is its own call so the summary can stay `stable` and be
    // safely re-read on every navigation. It's a no-op once a code exists, and
    // a failure here is not fatal — the screen still shows the balance and
    // just can't offer a code to share yet.
    try {
      await supabase.rpc('ensure_referral_code');
    } catch (e) {
      console.warn('Could not mint a referral code:', e);
    }

    const { data, error } = await supabase.rpc('get_referral_summary');
    if (error) throw new Error(error.message);

    const raw = (data ?? {}) as Partial<ReferralSummary>;
    return {
      code: raw.code ?? null,
      balanceCents: raw.balanceCents ?? 0,
      earnedLastYearCents: raw.earnedLastYearCents ?? 0,
      annualCapCents: raw.annualCapCents ?? 6000,
      referredCount: raw.referredCount ?? 0,
      convertedCount: raw.convertedCount ?? 0,
      redeemedByCode: raw.redeemedByCode ?? null,
      entries: raw.entries ?? [],
    };
  }

  async applyReferralCode(code: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.rpc('apply_referral_code', { p_code: code });
    // The RPC raises with customer-facing wording ("You can't refer yourself",
    // "already been applied"), so pass it straight through rather than
    // flattening every failure into one generic message.
    if (error) throw new Error(error.message);
  }

  async createConnectAccountLink(): Promise<{ url: string }> {
    assertNotViewingAs();
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
  // ─── Feedback ────────────────────────────────────────────────────────────────

  /**
   * The submitter's identity, without requiring a tenant account.
   *
   * ctx() resolves an account and raises when there isn't one, which is the
   * ordinary state for a guardian — and a guardian's feedback is worth as much
   * as a coach's, so the account is looked up separately and allowed to come
   * back null rather than failing the submission.
   */
  private async feedbackIdentity(): Promise<{
    supabase: SupabaseClient;
    userId: string;
    accountId: string | null;
    email?: string;
    displayName?: string;
  }> {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user?.id) throw new Error('User not authenticated');

    let accountId: string | null = null;
    try {
      accountId = (await this.ctx()).accountId;
    } catch {
      // No membership — a guardian, or an account still being provisioned.
    }

    return {
      supabase,
      userId: user.id,
      accountId,
      email: user.email ?? undefined,
      displayName: (user.user_metadata?.display_name as string | undefined) ?? undefined,
    };
  }

  async uploadFeedbackAttachment(file: File): Promise<FeedbackAttachment> {
    const { supabase, userId } = await this.feedbackIdentity();

    // The first path segment is what the storage policies check, so it has to
    // be the uploader's id. The middle segment groups one form's files together
    // and keeps two uploads of the same filename apart.
    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-120) || 'attachment';
    const path = `${userId}/${generateId('fb')}/${safeName}`;

    const { error } = await supabase.storage
      .from(FEEDBACK_BUCKET)
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) throw new Error(`Could not upload ${file.name}: ${error.message}`);

    return {
      path,
      name: file.name,
      size: file.size,
      contentType: file.type || 'application/octet-stream',
    };
  }

  async deleteFeedbackAttachment(path: string): Promise<void> {
    assertNotViewingAs();
    const { supabase } = await this.feedbackIdentity();
    const { error } = await supabase.storage.from(FEEDBACK_BUCKET).remove([path]);
    if (error) throw new Error(error.message);
  }

  async submitFeedback(submission: FeedbackSubmission): Promise<void> {
    const { supabase, userId, accountId, email, displayName } = await this.feedbackIdentity();

    unwrap(
      await supabase
        .from('feedback_submissions')
        .insert({
          user_id: userId,
          account_id: accountId,
          email,
          display_name: displayName,
          overall_experience: submission.overallExperience,
          ease_of_use: submission.easeOfUse,
          team_hub_scheduling: submission.teamHubScheduling,
          value_for_money: submission.valueForMoney,
          what_is_working_well: submission.whatIsWorkingWell,
          what_can_be_improved: submission.whatCanBeImproved,
          attachments: submission.attachments ?? [],
        })
        .select('id')
        .single(),
    );
  }

  async isFeedbackReviewer(): Promise<boolean> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('is_feedback_reviewer');
    // A missing function (the migration not yet applied) is a "no", not a
    // broken screen — the portal simply stays hidden until it is deployed.
    if (error) {
      console.warn('Could not check feedback reviewer access:', error.message);
      return false;
    }
    return data === true;
  }

  async getPlatformBlockedFeatures() {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('platform_blocked_features');
    // A missing function (the migration not yet applied) reads as "nothing
    // blocked" rather than a broken shell for every signed-in user.
    if (error) {
      console.warn('Could not check platform feature blocks:', error.message);
      return [];
    }
    return ((data as string[] | null) ?? []).filter(isBlockableFeature);
  }

  async getPlatformBlockedPlanTiers(): Promise<PlanTier[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('platform_blocked_plan_tiers');
    if (error) {
      console.warn('Could not check platform plan-tier blocks:', error.message);
      return [];
    }
    const tiers: readonly string[] = PLAN_TIERS;
    return ((data as string[] | null) ?? []).filter((t): t is PlanTier => tiers.includes(t));
  }

  async getDummyDataBlockedPlanTiers(): Promise<PlanTier[]> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('platform_dummy_data_blocked_plan_tiers');
    // A missing function (the migration not yet applied) reads as "nothing
    // blocked": the tools stay available rather than vanishing for everyone.
    if (error) {
      console.warn('Could not check dummy-data blocks:', error.message);
      return [];
    }
    const tiers: readonly string[] = PLAN_TIERS;
    return ((data as string[] | null) ?? []).filter((t): t is PlanTier => tiers.includes(t));
  }

  async listFeedbackSubmissions(): Promise<FeedbackReport[]> {
    const supabase = getSupabase();
    // No reviewer check here: the select policy already narrows a non-reviewer
    // to their own rows, so this is safe to call from anywhere and can't be
    // widened by lying to the client.
    const rows = unwrap(
      await supabase
        .from('feedback_submissions')
        .select('*')
        .order('created_at', { ascending: false }),
    ) as Row[];

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      email: r.email ?? undefined,
      displayName: r.display_name ?? undefined,
      overallExperience: r.overall_experience,
      easeOfUse: r.ease_of_use,
      teamHubScheduling: r.team_hub_scheduling,
      valueForMoney: r.value_for_money,
      whatIsWorkingWell: r.what_is_working_well ?? '',
      whatCanBeImproved: r.what_can_be_improved ?? '',
      attachments: Array.isArray(r.attachments) ? (r.attachments as FeedbackAttachment[]) : [],
      createdAt: toMs(r.created_at),
    }));
  }

  async getFeedbackAttachmentUrl(path: string): Promise<string> {
    const supabase = getSupabase();
    const { data, error } = await supabase.storage
      .from(FEEDBACK_BUCKET)
      .createSignedUrl(path, FEEDBACK_SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not open that attachment.');
    return data.signedUrl;
  }

  async deleteFeedbackSubmission(id: string, attachments: FeedbackAttachment[]): Promise<void> {
    const supabase = getSupabase();

    // `.select('id')` is load-bearing: a DELETE that RLS filters down to zero
    // rows comes back with no error and no data, so without it a blocked
    // delete is indistinguishable from a successful one — the caller
    // invalidates, refetches, and the submission is simply still there with
    // nothing shown to the user. Same silent-no-op trap as deleteTeamMessage.
    const rows = unwrap(
      await supabase.from('feedback_submissions').delete().eq('id', id).select('id'),
    ) as Row[] | null;
    if (!rows || rows.length === 0) {
      throw new Error(
        'That submission could not be removed. feedback_submissions_delete_reviewer only allows accounts on the feedback_reviewers allowlist.',
      );
    }

    if (attachments.length > 0) {
      const { error } = await supabase.storage
        .from(FEEDBACK_BUCKET)
        .remove(attachments.map((a) => a.path));
      // The submission is already gone — an attachment left behind in the
      // bucket is orphaned but harmless, so this doesn't fail the removal.
      if (error) console.warn('Could not remove feedback attachments:', error.message);
    }
  }

  // ─── Player report cards ─────────────────────────────────────────────────────
  private async rowToReportCard(supabase: SupabaseClient, r: Row): Promise<import('@/data/types').PlayerReportCard> {
    const attachments = ((r.attachments ?? []) as import('@/data/types').ReportCardAttachment[]).map((a) => ({ ...a }));
    const paths = attachments.map((a) => a.path).filter((p): p is string => !!p);
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(REPORT_CARD_FILES_BUCKET).createSignedUrls(paths, 3600);
      const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
      for (const a of attachments) if (a.path) a.signedUrl = urls.get(a.path) ?? undefined;
    }
    return {
      id: r.id,
      accountId: r.account_id,
      athleteId: r.athlete_id,
      tryoutId: r.tryout_id ?? undefined,
      title: r.title,
      evalIds: (r.eval_ids ?? []) as string[],
      coachComments: r.coach_comments ?? '',
      aiComments: r.ai_comments ?? '',
      attachments,
      createdAt: toMs(r.created_at),
      updatedAt: toMs(r.updated_at),
    };
  }

  async listPlayerReportCards(athleteId: string): Promise<import('@/data/types').PlayerReportCard[]> {
    const { supabase } = await this.userCtx();
    const rows = unwrap(
      await supabase.from('player_report_cards').select('*').eq('athlete_id', athleteId).order('created_at', { ascending: false }),
    ) as Row[];
    return Promise.all(rows.map((r) => this.rowToReportCard(supabase, r)));
  }

  async savePlayerReportCard(
    input: import('@/data/types').PlayerReportCardInput,
    newFiles: File[] = [],
  ): Promise<import('@/data/types').PlayerReportCard> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    // The card belongs to the evaluation's account, which for a delegated
    // manager is not their own.
    const tryoutRow = unwrap(
      await supabase.from('tryouts').select('account_id').eq('id', input.tryoutId).single(),
    ) as Row;
    const accountId = tryoutRow.account_id as string;

    const uploaded: import('@/data/types').ReportCardAttachment[] = [];
    try {
      for (const file of newFiles) {
        const contentType = file.type || 'application/octet-stream';
        const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
        // First segment is the account id: the storage policies check staff access against it.
        const path = `${accountId}/${generateId('rc')}/${safeName}`;
        const { error } = await supabase.storage.from(REPORT_CARD_FILES_BUCKET).upload(path, file, { contentType, upsert: false });
        if (error) throw new Error(`Could not upload ${file.name}: ${error.message}`);
        uploaded.push({
          kind: contentType.startsWith('video/') ? 'video' : 'file',
          name: file.name,
          path,
          size: file.size,
          contentType,
        });
      }
    } catch (e) {
      if (uploaded.length) await supabase.storage.from(REPORT_CARD_FILES_BUCKET).remove(uploaded.map((u) => u.path!));
      throw e;
    }

    const fields = {
      title: input.title.trim() || 'Player Report Card',
      tryout_id: input.tryoutId,
      eval_ids: input.evalIds,
      coach_comments: input.coachComments.trim(),
      ai_comments: input.aiComments.trim(),
      attachments: [
        ...input.attachments.map((a) => ({ kind: a.kind, name: a.name, path: a.path, url: a.url, size: a.size, contentType: a.contentType })),
        ...uploaded,
      ],
    };
    const query = input.id
      ? supabase.from('player_report_cards').update(fields).eq('id', input.id)
      : supabase.from('player_report_cards').insert({ ...fields, account_id: accountId, athlete_id: input.athleteId });
    const res = await query.select('*').maybeSingle();
    if (res.error || !res.data) {
      if (uploaded.length) await supabase.storage.from(REPORT_CARD_FILES_BUCKET).remove(uploaded.map((u) => u.path!));
      throw new Error(res.error?.message ?? 'You do not have permission to save this report card.');
    }
    return this.rowToReportCard(supabase, res.data as Row);
  }

  async deletePlayerReportCard(card: import('@/data/types').PlayerReportCard): Promise<void> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    const res = await supabase.from('player_report_cards').delete().eq('id', card.id).select('id');
    if (res.error) throw new Error(res.error.message);
    if (!res.data?.length) throw new Error('You do not have permission to delete this report card.');
    const paths = card.attachments.map((a) => a.path).filter((p): p is string => !!p);
    if (paths.length) await supabase.storage.from(REPORT_CARD_FILES_BUCKET).remove(paths);
  }

  async generateReportCardComments(
    tryoutId: string,
    playerId: string,
    evalIds: string[],
  ): Promise<import('@/data/types').AiPlayerSummary> {
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Tryout not found');
    const chosen = new Set(evalIds);
    // Only this player's chosen evaluations reach the model, so the comments
    // describe what the coach is actually showing the family.
    const scoped = {
      ...tryout,
      evals: tryout.evals.filter((e) => e.playerId !== playerId || chosen.has(e.id)),
    };
    if (!scoped.evals.some((e) => e.playerId === playerId)) {
      throw new Error('Select at least one evaluation first.');
    }
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('generate-ai-insights', {
      body: { action: 'summary', tryout: scoped, playerIds: [playerId] },
    });
    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, error.message));
    }
    // The function reports expected problems as { error, message } with status 200.
    if (data?.error) throw new Error(data.message || data.error);
    return data as import('@/data/types').AiPlayerSummary;
  }

  // ─── Library ─────────────────────────────────────────────────────────────────
  private rowToLibraryItem(r: Row, fileUrl?: string): import('@/data/types').LibraryItem {
    const acct = Array.isArray(r.accounts) ? r.accounts[0] : r.accounts;
    return {
      id: r.id,
      accountId: r.account_id,
      accountName: acct?.name ?? undefined,
      kind: r.kind,
      title: r.title,
      body: r.body ?? '',
      url: r.url ?? undefined,
      fileName: r.file_name ?? undefined,
      filePath: r.file_path ?? undefined,
      fileSize: Number(r.file_size ?? 0),
      contentType: r.content_type ?? undefined,
      fileUrl,
      audience: {
        coaches: !!r.for_coaches,
        managers: !!r.for_managers,
        assessors: !!r.for_assessors,
        players: !!r.for_players,
        guardians: !!r.for_guardians,
      },
      createdAt: toMs(r.created_at),
      updatedAt: toMs(r.updated_at),
    };
  }

  async listLibraryItems(): Promise<import('@/data/types').LibraryItem[]> {
    const { supabase } = await this.userCtx();
    const rows = unwrap(
      await supabase.from('library_items').select('*, accounts(name)').order('created_at', { ascending: false }),
    ) as Row[];
    const paths = rows.map((r) => r.file_path as string | null).filter((p): p is string => !!p);
    const urls = new Map<string, string>();
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(LIBRARY_FILES_BUCKET).createSignedUrls(paths, 3600);
      for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
    }
    const items = rows.map((r) => this.rowToLibraryItem(r, r.file_path ? urls.get(r.file_path) : undefined));
    // Videos stored through the add-on live in account_videos, attached by item id.
    const videoItemIds = rows.filter((r) => r.kind === 'video').map((r) => r.id as string);
    if (videoItemIds.length) {
      const videos = await this.listVideosForContext('library', videoItemIds);
      const byItem = new Map(videos.map((v) => [v.contextId, v]));
      for (const item of items) item.video = byItem.get(item.id);
    }
    return items;
  }

  async createLibraryItem(
    input: import('@/data/types').LibraryItemInput,
    file?: File,
  ): Promise<import('@/data/types').LibraryItem> {
    assertNotViewingAs();
    const { supabase, accountId } = await this.ctx();
    const title = input.title.trim();
    if (!title) throw new Error('Give the item a title.');
    if (input.kind === 'note' && !input.body.trim()) throw new Error('A note needs some text.');
    if ((input.kind === 'link' || (input.kind === 'video' && !file && !input.uploadedVideo)) && !input.url?.trim()) {
      throw new Error(input.kind === 'video' ? 'Add a video link or upload a video.' : 'Add the link.');
    }
    if (input.kind === 'file' && !file) throw new Error('Choose a file to upload.');

    let upload: { path: string; name: string; size: number; contentType: string } | null = null;
    if (file) {
      const contentType = file.type || 'application/octet-stream';
      const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
      // First segment is the account id: the storage policies check ownership against it.
      const path = `${accountId}/${generateId('lib')}/${safeName}`;
      const { error } = await supabase.storage.from(LIBRARY_FILES_BUCKET).upload(path, file, { contentType, upsert: false });
      if (error) throw new Error(`Could not upload ${file.name}: ${error.message}`);
      upload = { path, name: file.name, size: file.size, contentType };
    }

    const inserted = await supabase
      .from('library_items')
      .insert({
        account_id: accountId,
        kind: input.kind,
        title,
        body: input.body.trim(),
        url: input.url?.trim() || null,
        file_name: upload?.name ?? null,
        file_path: upload?.path ?? null,
        file_size: upload?.size ?? 0,
        content_type: upload?.contentType ?? null,
        for_coaches: input.audience.coaches,
        for_managers: input.audience.managers,
        for_assessors: input.audience.assessors,
        for_players: input.audience.players,
        for_guardians: input.audience.guardians,
      })
      .select('*, accounts(name)')
      .single();
    if (inserted.error) {
      // Don't leave an unreachable object behind.
      if (upload) await supabase.storage.from(LIBRARY_FILES_BUCKET).remove([upload.path]);
      throw new Error(inserted.error.message);
    }
    return this.rowToLibraryItem(inserted.data as Row);
  }

  async updateLibraryItem(
    id: string,
    updates: Partial<import('@/data/types').LibraryItemInput>,
  ): Promise<import('@/data/types').LibraryItem> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    const patch: Row = {};
    if (updates.title !== undefined) {
      if (!updates.title.trim()) throw new Error('Give the item a title.');
      patch.title = updates.title.trim();
    }
    if (updates.body !== undefined) patch.body = updates.body.trim();
    if (updates.url !== undefined) patch.url = updates.url.trim() || null;
    if (updates.audience) {
      patch.for_coaches = updates.audience.coaches;
      patch.for_managers = updates.audience.managers;
      patch.for_assessors = updates.audience.assessors;
      patch.for_players = updates.audience.players;
      patch.for_guardians = updates.audience.guardians;
    }
    const row = await supabase.from('library_items').update(patch).eq('id', id).select('*, accounts(name)').maybeSingle();
    if (row.error) throw new Error(row.error.message);
    // RLS hides a row the caller cannot write, so "no row" means no permission.
    if (!row.data) throw new Error('Only an owner or admin can change the library.');
    return this.rowToLibraryItem(row.data as Row);
  }

  async deleteLibraryItem(item: import('@/data/types').LibraryItem): Promise<void> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    const res = await supabase.from('library_items').delete().eq('id', item.id).select('id');
    if (res.error) throw new Error(res.error.message);
    if (!res.data?.length) throw new Error('Only an owner or admin can change the library.');
    if (item.filePath) await supabase.storage.from(LIBRARY_FILES_BUCKET).remove([item.filePath]);
  }

  // ─── Video storage add-on ───────────────────────────────────────────────────
  private rowToAccountVideo(r: Row, url?: string): import('../videoStorage').AccountVideo {
    return {
      id: r.id as string,
      accountId: r.account_id as string,
      storagePath: r.storage_path as string,
      fileName: r.file_name as string,
      title: (r.title as string) ?? '',
      sizeBytes: Number(r.size_bytes ?? 0),
      durationSeconds: r.duration_seconds != null ? Number(r.duration_seconds) : undefined,
      context: r.context as import('../videoStorage').VideoContext,
      contextId: (r.context_id as string | null) ?? undefined,
      status: r.status as 'pending' | 'ready',
      createdBy: r.created_by as string,
      createdAt: toMs(r.created_at as string),
      viewersCanDownload: !!r.viewers_can_download,
      url,
    };
  }

  async getVideoStorage(accountId?: string): Promise<import('../videoStorage').VideoStorageInfo> {
    const { supabase, accountId: own } = await this.ctx();
    const { data, error } = await supabase.rpc('get_video_storage', { p_account_id: accountId ?? own });
    if (error) throw new Error(friendlyVideoError(error.message));
    const d = data as Row;
    return {
      accountId: d.accountId as string,
      planTier: d.planTier as string,
      planEligible: !!d.planEligible,
      gb: Number(d.gb ?? 0),
      entitled: !!d.entitled,
      source: (d.source as 'stripe' | 'apple' | 'google' | null) ?? null,
      quotaBytes: Number(d.quotaBytes ?? 0),
      usedBytes: Number(d.usedBytes ?? 0),
      videoCount: Number(d.videoCount ?? 0),
      canUpload: !!d.canUpload,
      canManage: !!d.canManage,
      managersCanUpload: !!d.managersCanUpload,
      viewersCanDownload: !!d.viewersCanDownload,
      cancelAt: d.cancelAt ? toMs(d.cancelAt as string) : null,
      endedAt: d.endedAt ? toMs(d.endedAt as string) : null,
      deletionAt: d.deletionAt ? toMs(d.deletionAt as string) : null,
    };
  }

  async listAccountVideos(accountId?: string): Promise<import('../videoStorage').AccountVideo[]> {
    const { supabase, accountId: own } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('account_videos')
        .select('*')
        .eq('account_id', accountId ?? own)
        .eq('status', 'ready')
        .is('purge_after', null)
        .order('created_at', { ascending: false }),
    ) as Row[];
    return rows.map((r) => this.rowToAccountVideo(r));
  }

  async listVideosForContext(
    context: import('../videoStorage').VideoContext,
    contextIds: string[],
  ): Promise<import('../videoStorage').AccountVideo[]> {
    if (!contextIds.length) return [];
    const { supabase } = await this.userCtx();
    const rows = unwrap(
      await supabase
        .from('account_videos')
        .select('*')
        .eq('context', context)
        .in('context_id', contextIds)
        .eq('status', 'ready')
        .is('purge_after', null)
        .order('created_at', { ascending: true }),
    ) as Row[];
    if (!rows.length) return [];
    const { data: signed } = await supabase.storage
      .from(ACCOUNT_VIDEOS_BUCKET)
      .createSignedUrls(rows.map((r) => r.storage_path as string), 3600);
    const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    return rows.map((r) => this.rowToAccountVideo(r, urls.get(r.storage_path as string) ?? undefined));
  }

  async uploadAccountVideo(args: {
    file: File;
    context: import('../videoStorage').VideoContext;
    title?: string;
    accountId?: string;
    durationSeconds?: number;
    onProgress?: (fraction: number) => void;
  }): Promise<import('../videoStorage').AccountVideo> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    const accountId = args.accountId ?? (await this.ctx()).accountId;
    const { file } = args;
    if (file.type !== 'video/mp4') throw new Error('Videos are stored as MP4. Compress the video first.');

    const reserved = await supabase.rpc('reserve_account_video', {
      p_account_id: accountId,
      p_file_name: file.name,
      p_size_bytes: file.size,
      p_content_type: file.type,
      p_context: args.context,
      p_title: args.title ?? '',
      p_duration_seconds: args.durationSeconds != null ? Math.round(args.durationSeconds) : null,
    });
    if (reserved.error) throw new Error(friendlyVideoError(reserved.error.message));
    const reservedRow = reserved.data as Row;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');
      const base = APP_CONFIG.supabaseUrl.replace(/\/+$/, '');
      const encodedPath = (reservedRow.storage_path as string).split('/').map(encodeURIComponent).join('/');
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${base}/storage/v1/object/${ACCOUNT_VIDEOS_BUCKET}/${encodedPath}`);
        xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
        xhr.setRequestHeader('apikey', APP_CONFIG.supabaseAnonKey);
        xhr.setRequestHeader('Content-Type', 'video/mp4');
        xhr.setRequestHeader('Cache-Control', 'max-age=3600');
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) args.onProgress?.(e.loaded / e.total);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve();
          let detail = '';
          try { detail = JSON.parse(xhr.responseText)?.message ?? ''; } catch { }
          reject(new Error(detail || `Upload failed (${xhr.status}).`));
        };
        xhr.onerror = () => reject(new Error(NETWORK_ERROR_MESSAGE));
        xhr.send(file);
      });

      const confirmed = await supabase.rpc('confirm_account_video', { p_video_id: reservedRow.id });
      if (confirmed.error) throw new Error(friendlyVideoError(confirmed.error.message));
      return this.rowToAccountVideo(confirmed.data as Row);
    } catch (err) {
      // Give the reserved space back and let the maintenance function remove any partial object.
      await supabase.rpc('delete_account_video', { p_video_id: reservedRow.id });
      throw err;
    }
  }

  async attachAccountVideo(
    videoId: string,
    context: import('../videoStorage').VideoContext,
    contextId: string,
  ): Promise<void> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    const { error } = await supabase.rpc('attach_account_video', {
      p_video_id: videoId,
      p_context: context,
      p_context_id: contextId,
    });
    if (error) throw new Error(friendlyVideoError(error.message));
  }

  async deleteAccountVideo(videoId: string): Promise<void> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    const { error } = await supabase.rpc('delete_account_video', { p_video_id: videoId });
    if (error) throw new Error(friendlyVideoError(error.message));
  }

  async getAccountVideoUrl(storagePath: string): Promise<string> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase.storage.from(ACCOUNT_VIDEOS_BUCKET).createSignedUrl(storagePath, 3600);
    if (error || !data?.signedUrl) throw new Error('Could not open that video.');
    return data.signedUrl;
  }

  async setVideoPermissions(
    accountId: string,
    perms: { managersCanUpload?: boolean; viewersCanDownload?: boolean },
  ): Promise<void> {
    const { supabase } = await this.userCtx();
    const { error } = await supabase.rpc('set_video_permissions', {
      p_account_id: accountId,
      p_managers_can_upload: perms.managersCanUpload ?? null,
      p_viewers_can_download: perms.viewersCanDownload ?? null,
    });
    if (error) throw new Error(friendlyVideoError(error.message));
  }

  async getVideoContextAccount(
    context: import('../videoStorage').VideoContext,
    contextId: string,
  ): Promise<string | null> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase.rpc('video_context_account', { p_context: context, p_context_id: contextId });
    if (error) throw new Error(friendlyVideoError(error.message));
    return (data as string | null) ?? null;
  }

  async acknowledgeVideoDeletion(accountId: string): Promise<void> {
    const { supabase } = await this.userCtx();
    const { error } = await supabase.rpc('acknowledge_video_deletion', { p_account_id: accountId });
    if (error) throw new Error(friendlyVideoError(error.message));
  }

  async createVideoStorageCheckoutSession(gb: number, options?: { applyCredits?: boolean }): Promise<{ url: string }> {
    assertNotViewingAs();
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: { addOn: 'video_storage', storageGb: gb, interval: 'year', origin: webOrigin(), applyCredits: options?.applyCredits === true },
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

  async manageVideoStorage(
    action: 'change' | 'cancel' | 'resume',
    args?: { storageGb?: number; confirm?: string },
  ): Promise<{ cancelAt?: string | null; url?: string }> {
    assertNotViewingAs();
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('manage-video-storage', {
      body: {
        action,
        storageGb: args?.storageGb,
        confirm: args?.confirm,
        origin: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    });
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch { }
      throw new Error(detail || error.message || 'Could not update video storage');
    }
    if (data?.error) throw new Error(data.error);
    return data ?? {};
  }

  // ─── Team feed & organization info ───────────────────────────────────────────
  private async signFeedFiles(supabase: SupabaseClient, bucket: string, rows: Row[], parentKey: string): Promise<import('@/data/types').FeedFile[]> {
    if (!rows.length) return [];
    const { data: signed } = await supabase.storage.from(bucket).createSignedUrls(rows.map((r) => r.path), 3600);
    const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    return rows.map((r) => ({
      id: r.id,
      parentId: r[parentKey],
      name: r.name,
      path: r.path,
      size: Number(r.size ?? 0),
      contentType: r.content_type,
      createdAt: new Date(r.created_at).getTime(),
      url: urls.get(r.path) ?? undefined,
    }));
  }

  private async uploadFeedFile(
    bucket: string,
    table: string,
    parentKey: string,
    scopeId: string,
    parentId: string,
    file: File,
  ): Promise<import('@/data/types').FeedFile> {
    assertNotViewingAs();
    const { supabase, userId } = await this.userCtx();
    const contentType = file.type || 'application/octet-stream';
    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
    // First segment is the season/account id: the storage policies check access against it.
    const path = `${scopeId}/${parentId}/${generateId('ff')}/${safeName}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType, upsert: false });
    if (error) throw new Error(`Could not upload ${file.name}: ${error.message}`);
    const inserted = await supabase
      .from(table)
      .insert({ [parentKey]: parentId, name: file.name, path, size: file.size, content_type: contentType, uploaded_by: userId })
      .select()
      .single();
    if (inserted.error) {
      // Don't leave an unreachable object behind.
      await supabase.storage.from(bucket).remove([path]);
      throw new Error(inserted.error.message);
    }
    const r = inserted.data as Row;
    return {
      id: r.id,
      parentId: r[parentKey],
      name: r.name,
      path: r.path,
      size: Number(r.size ?? 0),
      contentType: r.content_type,
      createdAt: new Date(r.created_at).getTime(),
    };
  }

  private rowToPostComment(r: Row): import('@/data/types').PostComment {
    return {
      id: r.id,
      postId: r.post_id,
      authorUserId: r.author_user_id,
      authorName: r.author_name ?? '',
      body: r.body,
      createdAt: new Date(r.created_at).getTime(),
    };
  }

  async listSeasonPosts(seasonId: string): Promise<import('@/data/types').SeasonPost[]> {
    const { supabase } = await this.userCtx();
    const posts = unwrap(
      await supabase.from('season_posts').select('*').eq('season_id', seasonId).order('created_at', { ascending: false }).limit(100),
    ) as Row[];
    if (!posts.length) return [];
    const ids = posts.map((p) => p.id);
    const [fileRows, commentRows] = await Promise.all([
      supabase.from('season_post_files').select('*').in('post_id', ids).order('created_at', { ascending: true }),
      supabase.from('season_post_comments').select('post_id').in('post_id', ids),
    ]);
    const files = await this.signFeedFiles(supabase, FEED_FILES_BUCKET, unwrap(fileRows) as Row[], 'post_id');
    const filesByPost = new Map<string, import('@/data/types').FeedFile[]>();
    for (const f of files) filesByPost.set(f.parentId, [...(filesByPost.get(f.parentId) ?? []), f]);
    const counts = new Map<string, number>();
    for (const c of unwrap(commentRows) as Row[]) counts.set(c.post_id, (counts.get(c.post_id) ?? 0) + 1);
    return posts.map((p) => ({
      id: p.id,
      seasonId: p.season_id,
      authorUserId: p.author_user_id,
      authorName: p.author_name ?? '',
      title: p.title ?? '',
      body: p.body,
      createdAt: new Date(p.created_at).getTime(),
      files: filesByPost.get(p.id) ?? [],
      commentCount: counts.get(p.id) ?? 0,
    }));
  }

  async addSeasonPost(seasonId: string, input: { title: string; body: string }): Promise<import('@/data/types').SeasonPost> {
    assertNotViewingAs();
    const { supabase, userId } = await this.userCtx();
    const body = input.body.trim();
    if (!body) throw new Error('Write something to post first.');
    const profile = await this.loadUserProfile(userId);
    const row = unwrap(
      await supabase
        .from('season_posts')
        .insert({ season_id: seasonId, author_user_id: userId, author_name: profile.displayName ?? '', title: input.title.trim(), body })
        .select()
        .single(),
    ) as Row;
    return {
      id: row.id,
      seasonId: row.season_id,
      authorUserId: row.author_user_id,
      authorName: row.author_name ?? '',
      title: row.title ?? '',
      body: row.body,
      createdAt: new Date(row.created_at).getTime(),
      files: [],
      commentCount: 0,
    };
  }

  async deleteSeasonPost(post: import('@/data/types').SeasonPost): Promise<void> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    unwrap(await supabase.from('season_posts').delete().eq('id', post.id));
    if (post.files.length) await supabase.storage.from(FEED_FILES_BUCKET).remove(post.files.map((f) => f.path));
  }

  async uploadPostFile(seasonId: string, postId: string, file: File): Promise<import('@/data/types').FeedFile> {
    return this.uploadFeedFile(FEED_FILES_BUCKET, 'season_post_files', 'post_id', seasonId, postId, file);
  }

  async deletePostFile(file: import('@/data/types').FeedFile): Promise<void> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    unwrap(await supabase.from('season_post_files').delete().eq('id', file.id));
    await supabase.storage.from(FEED_FILES_BUCKET).remove([file.path]);
  }

  async listPostComments(postId: string): Promise<import('@/data/types').PostComment[]> {
    const { supabase } = await this.userCtx();
    const rows = unwrap(
      await supabase.from('season_post_comments').select('*').eq('post_id', postId).order('created_at', { ascending: true }),
    ) as Row[];
    return rows.map((r) => this.rowToPostComment(r));
  }

  async addPostComment(postId: string, body: string): Promise<import('@/data/types').PostComment> {
    assertNotViewingAs();
    const { supabase, userId } = await this.userCtx();
    const text = body.trim();
    if (!text) throw new Error('Write a comment first.');
    const profile = await this.loadUserProfile(userId);
    const row = unwrap(
      await supabase
        .from('season_post_comments')
        .insert({ post_id: postId, author_user_id: userId, author_name: profile.displayName ?? '', body: text })
        .select()
        .single(),
    ) as Row;
    return this.rowToPostComment(row);
  }

  async deletePostComment(commentId: string): Promise<void> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    unwrap(await supabase.from('season_post_comments').delete().eq('id', commentId));
  }

  private async seasonAccountId(supabase: SupabaseClient, seasonId: string): Promise<string> {
    const row = unwrap(await supabase.from('seasons').select('account_id').eq('id', seasonId).maybeSingle()) as Row | null;
    if (!row?.account_id) throw new Error('Team not found.');
    return row.account_id as string;
  }

  async listOrgInfo(seasonId: string): Promise<import('@/data/types').OrgInfoItem[]> {
    const { supabase } = await this.userCtx();
    const accountId = await this.seasonAccountId(supabase, seasonId);
    const items = unwrap(
      await supabase.from('account_info_items').select('*').eq('account_id', accountId).order('created_at', { ascending: false }).limit(200),
    ) as Row[];
    if (!items.length) return [];
    const fileRows = unwrap(
      await supabase.from('account_info_files').select('*').in('info_id', items.map((i) => i.id)).order('created_at', { ascending: true }),
    ) as Row[];
    const files = await this.signFeedFiles(supabase, ORG_INFO_FILES_BUCKET, fileRows, 'info_id');
    const filesByItem = new Map<string, import('@/data/types').FeedFile[]>();
    for (const f of files) filesByItem.set(f.parentId, [...(filesByItem.get(f.parentId) ?? []), f]);
    return items.map((i) => this.rowToOrgInfo(i, filesByItem.get(i.id) ?? []));
  }

  private rowToOrgInfo(i: Row, files: import('@/data/types').FeedFile[]): import('@/data/types').OrgInfoItem {
    return {
      id: i.id,
      accountId: i.account_id,
      category: i.category,
      title: i.title,
      body: i.body ?? '',
      url: i.url ?? '',
      authorName: i.author_name ?? '',
      createdAt: new Date(i.created_at).getTime(),
      files,
    };
  }

  async addOrgInfo(seasonId: string, input: import('@/data/types').OrgInfoInput): Promise<import('@/data/types').OrgInfoItem> {
    assertNotViewingAs();
    const { supabase, userId } = await this.userCtx();
    const title = input.title.trim();
    if (!title) throw new Error('Add a title first.');
    let url = input.url.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    const accountId = await this.seasonAccountId(supabase, seasonId);
    const profile = await this.loadUserProfile(userId);
    const row = unwrap(
      await supabase
        .from('account_info_items')
        .insert({
          account_id: accountId,
          category: input.category,
          title,
          body: input.body.trim(),
          url,
          author_user_id: userId,
          author_name: profile.displayName ?? '',
        })
        .select()
        .single(),
    ) as Row;
    return this.rowToOrgInfo(row, []);
  }

  async deleteOrgInfo(item: import('@/data/types').OrgInfoItem): Promise<void> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    unwrap(await supabase.from('account_info_items').delete().eq('id', item.id));
    if (item.files.length) await supabase.storage.from(ORG_INFO_FILES_BUCKET).remove(item.files.map((f) => f.path));
  }

  async uploadOrgInfoFile(accountId: string, infoId: string, file: File): Promise<import('@/data/types').FeedFile> {
    return this.uploadFeedFile(ORG_INFO_FILES_BUCKET, 'account_info_files', 'info_id', accountId, infoId, file);
  }

  async deleteOrgInfoFile(file: import('@/data/types').FeedFile): Promise<void> {
    assertNotViewingAs();
    const { supabase } = await this.userCtx();
    unwrap(await supabase.from('account_info_files').delete().eq('id', file.id));
    await supabase.storage.from(ORG_INFO_FILES_BUCKET).remove([file.path]);
  }

  // ─── Org Members ─────────────────────────────────────────────────────────────
  /**
   * @param includeTeamManagers  Also list the coaches a club has delegated a
   *   single team to. Off by default and paid for only by Manage Organization:
   *   there is no account-wide read for them — the deployed RPC is per team —
   *   and AppShell's usePermissions() subscribes to this query on every route,
   *   where a per-team fan-out would land on every navigation.
   */
  async listOrgMembers(includeTeamManagers = false): Promise<import('../types').OrgMember[]> {
    const { supabase, accountId } = await this.ctx();

    // Memberships, the account's tryouts (needed only to scope the assessor
    // read) and the guardian-bearing athletes are three independent reads —
    // only the assessors depend on anything here. Running all four in series
    // put ~2.1s in front of every screen in the app, since AppShell's
    // usePermissions() subscribes to this query on every route.
    const [memRes, tryoutRes, teamRes, athleteRes] = await Promise.all([
      supabase
        .from('memberships')
        .select('id, user_id, role, created_at, profiles(email, display_name)')
        .eq('account_id', accountId),
      // Fetch tryouts for the account to get assessors. Deleted ones excluded —
      // deleteTryout() only sets deleted_at (the row and its assessors stay for
      // history), so without this an assessor on a deleted evaluation never
      // left this list no matter how many evaluations under them got deleted.
      supabase.from('tryouts').select('id').eq('account_id', accountId).is('deleted_at', null),
      // …and the teams, for the managers they've been delegated to. Archived
      // ones included: the delegation survives the archive and comes back with
      // the team, so hiding it here would hide access that still exists.
      includeTeamManagers
        ? supabase.from('teams').select('id, name').eq('account_id', accountId)
        : Promise.resolve({ data: [] as Row[] }),
      supabase
        .from('athletes')
        .select('id, guardian_name, guardian_email, guardian_user_id, created_at')
        .eq('account_id', accountId)
        .eq('archived', false),
    ]);

    const memData = memRes.data;
    const tryouts = tryoutRes.data;
    const teams = (teamRes.data ?? []) as Row[];
    const athletesData = athleteRes.data;

    // Second wave: both of these need ids from the first one, and neither needs
    // anything from the other.
    const [assData, teamManagers] = await Promise.all([
      (async (): Promise<Row[]> => {
        if (!tryouts || tryouts.length === 0) return [];
        const tryoutIds = tryouts.map(t => t.id);
        const { data } = await supabase
          .from('tryout_assessors')
          .select('id, user_id, role, joined_at, email, name')
          .in('tryout_id', tryoutIds);
        return data || [];
      })(),
      this.fetchTeamManagers(teams.map((t) => t.id as string)),
    ]);
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
        source: 'membership',
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
        source: 'assessor',
      });
    }

    // Delegated team managers (CLUB mode). They hold no membership, so before
    // this they were invisible here — Manage Organization showed no trace of
    // someone who had been handed a whole team, and removing their membership
    // (when they even had one) left the delegation behind.
    const teamNames = new Map(teams.map((t) => [t.id as string, (t.name as string) ?? 'a team']));
    for (const tm of teamManagers) {
      const email = tm.email;
      if (!email) continue;
      const emailKey = email.toLowerCase();
      const teamName = teamNames.get(tm.teamId);

      const existing = members.get(emailKey);
      if (existing) {
        // Already staff by another route. Keep that row — its id is the one the
        // role change needs — and just note the teams next to their name.
        if (teamName) existing.teams = [...(existing.teams ?? []), teamName];
        if (!existing.name && tm.name) existing.name = tm.name;
        continue;
      }

      members.set(emailKey, {
        id: tm.id,
        orgId: accountId,
        userId: tm.userId || undefined,
        email,
        name: tm.name,
        // TeamManagerRole ('manager' | 'coach') has no exact OrgRole; both run a
        // team, which is what 'coach' means on this screen.
        role: 'coach',
        // No linked account yet means the invite is still outstanding — the
        // same distinction the guardian rows draw.
        status: tm.userId ? 'active' : 'pending',
        createdAt: tm.createdAt,
        source: 'teamManager',
        teams: teamName ? [teamName] : [],
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
          source: 'guardian',
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

  /**
   * Remove someone from the organization — staff, assessor or guardian.
   *
   * Routes through a SECURITY DEFINER RPC for the same reason
   * updateOrgMemberRole does. The direct deletes this replaced were subject to
   * RLS: when the policy filtered the row out, PostgREST removed nothing and
   * still answered 204 with no error, so this resolved successfully and the
   * person was back as soon as the list refetched.
   *
   * The RPC also removes by identity rather than by the one row id the list
   * surfaced. An assessor holds a tryout_assessors row per assessment but
   * listOrgMembers() dedupes them to a single entry, so deleting that entry's
   * row used to leave every other assessment's row behind.
   */
  async removeOrgMember(memberId: string): Promise<void> {
    // Resolved up front because the removal is what destroys the rows the
    // identity is read from — and the identity is what the team-manager
    // revocation below matches on.
    const identity = await this.resolveOrgMemberIdentity(memberId);

    // A delegated manager has nothing in memberships/tryout_assessors/athletes,
    // so the RPC below would only report "Member not found" — giving up the
    // team *is* the removal.
    if (identity?.kind === 'teamManager') {
      await this.revokeTeamManagerAccess(identity);
      return;
    }

    const { supabase } = await this.ctx();
    const { error } = await supabase.rpc('remove_org_member', { member_id: memberId });

    if (error) {
      // Projects that haven't run 20260831000000_remove_org_member_rpc.sql yet
      // answer PGRST202 ("Could not find the function"); anything else is a
      // real failure — an authorization refusal from inside the function
      // included — and belongs in front of the user unchanged.
      const missingFunction = error.code === 'PGRST202' || error.code === '42883';
      if (!missingFunction) throw new Error(error.message);
      console.warn('remove_org_member() not deployed — falling back to direct deletes.');

      await this.removeOrgMemberDirect(memberId, identity);
    }

    // A delegated team (CLUB mode) is a grant of its own: `team_managers` rows
    // are not memberships and nothing above touches them, so a coach removed
    // from the organization kept the team they had been handed and stayed on
    // its Managers list. Guardians are left alone — "Revoke" there clears a
    // guardian contact on an athlete, which says nothing about a coaching role
    // the same person may hold.
    if (identity && identity.kind !== 'guardian') {
      await this.revokeTeamManagerAccess(identity);
    }
  }

  /**
   * Who a Manage Organization row actually is. The list surfaces three
   * different kinds of row under one `id`, so every removal has to work out
   * which table the id came from before it can do anything with it.
   */
  private async resolveOrgMemberIdentity(memberId: string): Promise<OrgMemberIdentity | null> {
    const { supabase } = await this.ctx();

    const { data: membership } = await supabase
      .from('memberships')
      .select('id, user_id, role, account_id, profiles(email)')
      .eq('id', memberId)
      .maybeSingle();

    if (membership) {
      const profiles = membership.profiles;
      const profile = Array.isArray(profiles) ? profiles[0] : profiles;
      return {
        kind: 'membership',
        accountId: (membership.account_id as string) ?? null,
        userId: (membership.user_id as string) ?? undefined,
        email: (profile?.email as string) ?? undefined,
        role: (membership.role as string) ?? undefined,
      };
    }

    const { data: assessor } = await supabase
      .from('tryout_assessors')
      .select('id, user_id, email, tryout_id')
      .eq('id', memberId)
      .maybeSingle();

    if (assessor) {
      // Read the owning account off the tryout rather than embedding it: the
      // embed makes RLS run over the parent for a row we already hold, and a
      // relationship PostgREST can't resolve would fail the whole lookup.
      const { data: tryout } = await supabase
        .from('tryouts')
        .select('account_id')
        .eq('id', assessor.tryout_id)
        .maybeSingle();
      return {
        kind: 'assessor',
        accountId: (tryout?.account_id as string) ?? null,
        userId: (assessor.user_id as string) ?? undefined,
        email: (assessor.email as string) ?? undefined,
        tryoutId: (assessor.tryout_id as string) ?? undefined,
      };
    }

    const { data: athlete } = await supabase
      .from('athletes')
      .select('id, guardian_email, guardian_user_id, account_id')
      .eq('id', memberId)
      .maybeSingle();

    if (athlete?.guardian_email) {
      return {
        kind: 'guardian',
        accountId: (athlete.account_id as string) ?? null,
        userId: (athlete.guardian_user_id as string) ?? undefined,
        email: athlete.guardian_email as string,
      };
    }

    // Last, and only once the cheap lookups have missed: a row that is on the
    // list purely because a team was delegated to them. Finding it costs a read
    // per team, which is why nothing above it pays for the search.
    const { accountId } = await this.ctx();
    const { data: teams } = await supabase.from('teams').select('id').eq('account_id', accountId);
    const managers = await this.fetchTeamManagers(((teams ?? []) as Row[]).map((t) => t.id as string));
    const manager = managers.find((m) => m.id === memberId);
    if (manager) {
      return {
        kind: 'teamManager',
        accountId,
        userId: manager.userId || undefined,
        email: manager.email,
      };
    }

    return null;
  }

  /**
   * Give up the delegated teams a person holds under this account.
   *
   * Goes through the deployed list_team_managers/remove_team_manager RPCs
   * rather than deleting `team_managers` directly, so the club-owner check the
   * backend already enforces is the one that runs.
   */
  private async revokeTeamManagerAccess(identity: OrgMemberIdentity): Promise<void> {
    const { supabase, accountId } = await this.ctx();

    const email = identity.email?.toLowerCase();
    if (!email && !identity.userId) return;

    // Archived teams included on purpose — an archived team can be restored,
    // and the delegation would come back with it.
    const { data: teams, error } = await supabase.from('teams').select('id').eq('account_id', accountId);
    if (error) throw new Error(error.message);

    const teamIds = ((teams ?? []) as Row[]).map((t) => t.id as string);
    if (teamIds.length === 0) return;

    const managers = (await Promise.all(teamIds.map((id) => this.listTeamManagers(id)))).flat();
    const theirs = managers.filter(
      (m) =>
        (!!email && m.email?.toLowerCase() === email) ||
        (!!identity.userId && m.userId === identity.userId),
    );

    for (const manager of theirs) {
      try {
        await this.removeTeamManager(manager.id);
      } catch (e) {
        // The organization row is already gone by now, so say which half failed
        // instead of letting a raw Postgres message read as "nothing happened".
        console.error('Failed to revoke delegated team access:', e);
        throw new Error(
          identity.kind === 'teamManager'
            ? 'Could not remove their access to the team. You may not have permission to change its managers.'
            : 'Removed from the organization, but their delegated team access could not be revoked. Remove them from the team’s Managers list.',
        );
      }
    }
  }

  /**
   * The pre-RPC removal path, kept for deployments without the function.
   *
   * It differs from the original in the two ways that made removals fail
   * silently. Each delete is followed by a read-back, so a row RLS refused to
   * touch raises instead of reporting a success the next refetch undoes; and
   * assessors are removed by identity across every assessment the account owns,
   * not just the single row id the deduped list happened to surface.
   */
  private async removeOrgMemberDirect(memberId: string, identity: OrgMemberIdentity | null): Promise<void> {
    const { supabase, accountId } = await this.ctx();

    if (!identity) throw new Error('Member not found.');
    if (identity.accountId !== accountId) throw new Error('Member not found in this organization.');

    const blocked = (what: string) => {
      console.error(`removeOrgMember: ${what} survived the delete — RLS most likely refused it.`);
      return new Error(
        'Could not remove this member. You may not have permission to remove them from this organization.',
      );
    };

    // 1. Staff, who hold a membership on the account.
    if (identity.kind === 'membership') {
      // The screen already hides the action for admins; this is the half of
      // that the RPC enforces server-side, so it holds here too.
      if (identity.role === 'owner' || identity.role === 'admin') {
        throw new Error('An organization admin cannot be removed here.');
      }

      const { error } = await supabase.from('memberships').delete().eq('id', memberId);
      if (error) throw new Error(error.message);

      const { data: left } = await supabase
        .from('memberships')
        .select('id')
        .eq('id', memberId)
        .maybeSingle();
      if (left) throw blocked('the membership');
      return;
    }

    // 2. Assessors, who exist only as rows against the account's assessments.
    if (identity.kind === 'assessor') {
      const { data: tryouts } = await supabase.from('tryouts').select('id').eq('account_id', accountId);
      const tryoutIds = ((tryouts ?? []) as Row[]).map((t) => t.id as string);
      if (tryoutIds.length === 0) throw new Error('Member not found in this organization.');

      // Two statements rather than one `or()` filter: the identity is a user id
      // *or* an e-mail, an unlinked invite carries only the latter, and an
      // e-mail interpolated into an or() string would have to be escaped.
      if (identity.userId) {
        const { error } = await supabase
          .from('tryout_assessors')
          .delete()
          .in('tryout_id', tryoutIds)
          .eq('user_id', identity.userId);
        if (error) throw new Error(error.message);
      }
      if (identity.email) {
        const { error } = await supabase
          .from('tryout_assessors')
          .delete()
          .in('tryout_id', tryoutIds)
          .eq('email', identity.email);
        if (error) throw new Error(error.message);
      }

      // Read back the whole identity, not just the row the list surfaced: a
      // policy that let one delete through and refused the rest would otherwise
      // look like a clean removal until the person reappeared.
      let remaining = 0;
      if (identity.userId) {
        const { data: left } = await supabase
          .from('tryout_assessors')
          .select('id')
          .in('tryout_id', tryoutIds)
          .eq('user_id', identity.userId)
          .limit(1);
        remaining += left?.length ?? 0;
      }
      if (identity.email) {
        const { data: left } = await supabase
          .from('tryout_assessors')
          .select('id')
          .in('tryout_id', tryoutIds)
          .eq('email', identity.email)
          .limit(1);
        remaining += left?.length ?? 0;
      }
      if (remaining > 0) throw blocked('an assessor row');
      return;
    }

    // 3. Guardians, who are not members at all — they are the guardian contact
    // on one or more of the account's athletes, so removal clears that contact.
    // Delegated managers never reach here: removeOrgMember() hands them to
    // revokeTeamManagerAccess() and returns.
    if (identity.kind !== 'guardian' || !identity.email) throw new Error('Member not found.');

    // guardian_email is citext, so eq() is already case-insensitive and still
    // uses the btree index on the column.
    const { error } = await supabase
      .from('athletes')
      .update({
        guardian_name: null,
        guardian_email: null,
        guardian_phone: null,
        guardian_user_id: null,
      })
      .eq('account_id', accountId)
      .eq('guardian_email', identity.email);
    if (error) throw new Error(error.message);

    const { data: left } = await supabase
      .from('athletes')
      .select('id')
      .eq('account_id', accountId)
      .eq('guardian_email', identity.email)
      .limit(1);
    if (left && left.length > 0) throw blocked('the guardian contact');
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

  // Detaches the guardian's login from this one athlete only — the
  // guardian_name/email/phone contact info is left in place so a coach can
  // re-link (or the guardian can be re-invited) without retyping it. Wider,
  // account-wide guardian removal goes through removeOrgMember instead.
  async unlinkGuardianFromAthlete(tryoutId: string, playerId: string): Promise<import('../types').Player> {
    const { supabase } = await this.ctx();

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
      .update({ guardian_user_id: null })
      .eq('id', athleteId);

    if (error) throw error;

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
    // Only the event's tombstone reaches a guardian: what it is called, the
    // sport, and when and where it is. Scores, session results and the
    // make/release recommendation are the coach's to share — they are dropped
    // here, at the one place every guardian screen reads its data from, rather
    // than hidden per screen, so no future page can render them by accident.
    // The fallback query below no longer asks for them either. get_guardian_rosters()
    // lives in the backend repo and may still return them in its payload —
    // dropping them from the function itself is the follow-up there.
    const tryoutsList = ((row.tryout_participants ?? []) as Row[])
      .map((tp) => {
        if (!tp.tryouts) return null;
        const t = tp.tryouts as Row;
        // Soft-deleted (tryouts.deleted_at) — only present on the fallback
        // query's row shape; get_guardian_rosters() already excludes these
        // server-side, so this is a no-op for that path.
        if (t.deleted_at) return null;
        // Taken off just this evaluation (removed_at) — same story, fallback only.
        if (tp.removed_at) return null;
        return {
          id: t.id,
          name: t.name,
          sport: t.sport,
          participantId: tp.id,
          date: t.tryout_date ?? undefined,
          startTime: t.start_time ?? undefined,
          endTime: t.end_time ?? undefined,
          location: t.location ?? undefined,
        };
      })
      .filter(Boolean);

    const seasonsList = ((row.season_roster ?? []) as Row[])
      .map((sr) => {
        if (!sr.seasons) return null;
        // Archived (team deleted, or the season itself deleted/archived) — only
        // present on the fallback query's row shape; get_guardian_rosters()
        // already excludes these server-side, so this is a no-op for that path.
        if ((sr.seasons as Row).archived) return null;

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
    // Through the RPC unconditionally, not as a fallback after a failed direct
    // read: RLS handles a read it rejects by filtering rows out, not by
    // erroring, so an assessor's SELECT here would come back an empty array —
    // identical to "this player genuinely has none" — with no signal to retry
    // on. list_athlete_family_contacts() re-applies the same authorization
    // add/removeFamilyContact() fall back to, so this is a superset read for a
    // coach too, not just the assessor path.
    const { data, error } = await supabase.rpc('list_athlete_family_contacts', { p_athlete_id: athleteId });
    if (!error) return ((data ?? []) as Row[]).map((r) => this.rowToFamilyContact(r));

    if (error.code !== 'PGRST202' && error.code !== '42883') throw unwrapError(error);
    console.warn('list_athlete_family_contacts() not deployed — falling back to a direct read (staff only).');

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
    assertNotViewingAs();
    const { supabase, userId } = await this.ctx();
    const res = await supabase
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
      .single();

    // '42501' is Postgres's own code for an INSERT that failed its RLS WITH
    // CHECK — unlike an UPDATE/DELETE the policy rejects (which silently
    // matches zero rows and looks like success), an insert violation is a real
    // error, thrown straight from the table. This is how an invited assessor —
    // reaching the athlete through a tryout_assessors row, not a membership —
    // hits the account-staff-only policy. add_athlete_family_contact() is the
    // same write behind a check that authorizes them explicitly.
    if (res.error?.code === '42501') {
      const { data, error } = await supabase.rpc('add_athlete_family_contact', {
        p_athlete_id: athleteId,
        p_name: contact.name,
        p_relationship: contact.relationship || null,
        p_email: contact.email || null,
        p_phone: contact.phone || null,
      });
      if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') {
          console.warn('add_athlete_family_contact() not deployed — an assessor cannot add a family contact.');
          throw new Error(
            'Your account does not have permission to add a family contact for this player. Ask the coach who owns this evaluation to add it.',
          );
        }
        throw unwrapError(error);
      }
      return this.rowToFamilyContact(data as Row);
    }

    return this.rowToFamilyContact(unwrap(res) as Row);
  }

  async linkFamilyContactGuardian(contactId: string, userId: string): Promise<boolean> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.rpc('link_family_contact_guardian', {
      p_contact_id: contactId,
      p_user_id: userId,
    });
    if (!error) return true;
    if (error.code === 'PGRST202' || error.code === '42883') {
      console.log('link_family_contact_guardian() not deployed, a family contact cannot be connected yet.');
      return false;
    }
    throw unwrapError(error);
  }

  async listConnectedFamilyContactIds(athleteId: string): Promise<string[]> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase
      .from('athlete_guardian_links')
      .select('contact_id')
      .eq('athlete_id', athleteId);
    // A badge, not a gate: where the table is missing or unreadable, show none.
    if (error) return [];
    return ((data ?? []) as Row[]).map((r) => r.contact_id as string).filter(Boolean);
  }

  async listTeamCalendarLinks(): Promise<{ viewerTeamId: string; sourceTeamId: string }[]> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.from('team_calendar_links').select('viewer_team_id, source_team_id');
    // An extra on top of each team's own calendar: where the table is missing or unreadable, show none.
    if (error) return [];
    return ((data ?? []) as Row[]).map((r) => ({
      viewerTeamId: r.viewer_team_id as string,
      sourceTeamId: r.source_team_id as string,
    }));
  }

  async setTeamCalendarLink(viewerTeamId: string, sourceTeamId: string, attached: boolean): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = attached
      ? await supabase
          .from('team_calendar_links')
          .upsert(
            { viewer_team_id: viewerTeamId, source_team_id: sourceTeamId },
            { onConflict: 'viewer_team_id,source_team_id', ignoreDuplicates: true },
          )
      : await supabase
          .from('team_calendar_links')
          .delete()
          .eq('viewer_team_id', viewerTeamId)
          .eq('source_team_id', sourceTeamId);
    if (error) throw new Error(error.message);
  }

  async removeFamilyContact(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    // .select().single() so a DELETE an RLS policy silently drops (matches zero
    // rows, which Postgres reports as an ordinary success) is told apart from
    // one that actually removed the row — see wroteRow().
    const wrote = await wroteRow(
      supabase.from('athlete_family_contacts').delete().eq('id', id).select().single(),
    );
    if (wrote) return;

    const { error } = await supabase.rpc('remove_athlete_family_contact', { p_contact_id: id });
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        console.warn('remove_athlete_family_contact() not deployed — an assessor cannot remove a family contact.');
        throw new Error(
          'Your account does not have permission to remove this family contact. Ask the coach who owns this evaluation to remove it.',
        );
      }
      throw unwrapError(error);
    }
  }

  async leaveSeason(seasonRosterId: string): Promise<void> {
    // Removes the team roster row as well as the season one — see the interface
    // doc and 20260902140000_guardian_leave_team_roster.sql.
    //
    // Not this.ctx() — that resolves a *staff* tenant account via memberships,
    // which a guardian doesn't have. A plain user-scoped client is enough; the
    // RPC does its own authorization against the roster row.
    const supabase = getSupabase();
    const { error } = await supabase.rpc('guardian_leave_season', { p_season_roster_id: seasonRosterId });
    // The RPC raises customer-facing wording ("Not authorized to leave this
    // team", "Could not leave this team"), so pass it straight through.
    if (error) throw new Error(error.message);
  }

  async removeGuardianAthlete(athleteId: string): Promise<void> {
    // User-scoped client, like leaveSeason: a guardian has no staff tenant, and the
    // RPC authorizes against the athlete itself.
    const supabase = getSupabase();
    const { error } = await supabase.rpc('guardian_remove_athlete', { p_athlete_id: athleteId });
    if (error) throw new Error(error.message);
  }

  async getGuardianAthleteInfo(athleteId: string): Promise<Athlete> {
    // User-scoped client: a guardian has no staff tenant for this.ctx() to resolve.
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('athletes')
      .select(
        'id, first_name, last_name, avatar_url, player_email, guardian_name, guardian_email, guardian_phone, year_of_birth, date_of_birth, medical_info, about',
      )
      .eq('id', athleteId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Athlete not found');
    const a = data as Row;
    return {
      id: a.id,
      first: a.first_name ?? '',
      last: a.last_name ?? '',
      yearOfBirth: a.year_of_birth != null ? String(a.year_of_birth) : undefined,
      dateOfBirth: a.date_of_birth ?? undefined,
      playerEmail: a.player_email ?? undefined,
      guardianName: a.guardian_name ?? undefined,
      guardianEmail: a.guardian_email ?? undefined,
      guardianPhone: a.guardian_phone ?? undefined,
      medicalInfo: a.medical_info ?? undefined,
      aboutChild: a.about ?? undefined,
      avatarUrl: a.avatar_url ?? undefined,
    };
  }

  async updateGuardianAthlete(
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
  ): Promise<void> {
    // User-scoped client, like removeGuardianAthlete: a guardian has no staff tenant.
    const supabase = getSupabase();
    // Only keys the caller set are sent; the RPC leaves absent keys alone and
    // treats an empty string as "clear this field".
    const payload: Row = {};
    if (patch.first !== undefined) payload.first_name = patch.first;
    if (patch.last !== undefined) payload.last_name = patch.last;
    if (patch.yearOfBirth !== undefined) payload.year_of_birth = patch.yearOfBirth;
    if (patch.dateOfBirth !== undefined) payload.date_of_birth = patch.dateOfBirth;
    if (patch.playerEmail !== undefined) payload.player_email = patch.playerEmail;
    if (patch.guardianName !== undefined) payload.guardian_name = patch.guardianName;
    if (patch.guardianPhone !== undefined) payload.guardian_phone = patch.guardianPhone;
    if (patch.medicalInfo !== undefined) payload.medical_info = patch.medicalInfo;
    if (patch.aboutChild !== undefined) payload.about = patch.aboutChild;
    const { error } = await supabase.rpc('guardian_update_athlete', { p_athlete_id: athleteId, p_patch: payload });
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        throw new Error('Editing a player is not available yet. Please try again later.');
      }
      throw new Error(error.message);
    }
  }

  // One statement, authorized per tryout/season instead of per leaf row — the nested
  // PostgREST embed this replaces made RLS run on every evaluation score and every
  // RSVP row, which blew the statement timeout (57014) for coaches and guardians
  // alike. See the shared backend's supabase/migrations/20260817130000_guardian_rosters_rpc.sql.
  async getGuardianRosters(): Promise<import('../types').GuardianRosterAthlete[]> {
    const { supabase, userId } = await this.userCtx();
    if (!userId) return [];

    // View as user: the RPC can only answer for auth.uid() (the founder), so
    // the nested read below is asked about the viewed person instead. The
    // founder reads it as a platform admin; it is one guardian's athletes.
    const viewedPerson = getViewedPerson();
    let userEmail: string | undefined;
    if (viewedPerson) {
      userEmail = viewedPerson.email?.toLowerCase();
    } else {
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_guardian_rosters');

      if (!rpcError) {
        return this.mergeGuardianRosterRows((rpcData as Row[]) ?? []);
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
      userEmail = userData?.user?.email?.toLowerCase();
    }

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
          removed_at,
          tryouts(id, name, sport, tryout_date, start_time, end_time, location, deleted_at)
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
            archived,
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

    return this.mergeGuardianRosterRows((data as Row[]) ?? []);
  }

  /**
   * get_guardian_rosters() joins athletes against tryout_participants and
   * season_roster without aggregating them back into arrays, so an athlete on
   * two teams (or a team plus an evaluation) comes back as separate partial
   * rows — one per team/evaluation, each missing the other's data. Re-merge
   * those into a single card per athlete here, keyed on athlete id, and drop
   * anyone left with neither an active team nor an evaluation: the guardian
   * link outlives the season_roster/tryout_participant row once a coach
   * deletes the team or tryout, and this list should never resurrect them.
   */
  private mergeGuardianRosterRows(rows: Row[]): import('../types').GuardianRosterAthlete[] {
    const byId = new Map<string, import('../types').GuardianRosterAthlete>();

    for (const row of rows) {
      const mapped = this.mapGuardianRosterRow(row);
      const existing = byId.get(mapped.id);
      if (!existing) {
        byId.set(mapped.id, mapped);
        continue;
      }
      for (const tryout of mapped.tryouts) {
        if (!existing.tryouts.some((t) => t.participantId === tryout.participantId)) {
          existing.tryouts.push(tryout);
        }
      }
      for (const season of mapped.seasons) {
        if (!existing.seasons.some((s) => s.seasonRosterId === season.seasonRosterId)) {
          existing.seasons.push(season);
        }
      }
    }

    return Array.from(byId.values()).filter((athlete) => athlete.tryouts.length > 0 || athlete.seasons.length > 0);
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

  async findCoachByEmail(email: string): Promise<import('../types').CoachDirectoryEntry[]> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase.rpc('find_coach_by_email', { p_email: email.trim() });
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


  // ─── Player selection letters ─────────────────────────────────────────────

  private rowToLetterTemplate(r: Row): LetterTemplate {
    return {
      id: r.id,
      name: r.name,
      kind: r.kind as LetterKind,
      subject: r.subject ?? '',
      body: r.body ?? '',
      tryoutId: r.tryout_id ?? undefined,
      createdAt: toMs(r.created_at),
      updatedAt: toMs(r.updated_at ?? r.created_at),
    };
  }

  private rowToPlayerLetter(r: Row): PlayerLetter {
    return {
      id: r.id,
      tryoutId: r.tryout_id,
      playerId: r.participant_id,
      athleteId: r.athlete_id ?? undefined,
      templateId: r.template_id ?? undefined,
      kind: r.kind as LetterKind,
      subject: r.subject ?? '',
      body: r.body ?? '',
      recipientEmail: r.recipient_email ?? undefined,
      status: (r.status ?? 'draft') as PlayerLetter['status'],
      error: r.error ?? undefined,
      sentAt: r.sent_at ? toMs(r.sent_at) : undefined,
      createdAt: toMs(r.created_at),
      updatedAt: toMs(r.updated_at ?? r.created_at),
    };
  }

  async listLetterTemplates(): Promise<LetterTemplate[]> {
    const { supabase, accountId } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('letter_templates')
        .select('*')
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false }),
    ) as Row[] | null;
    return (rows ?? []).map((r) => this.rowToLetterTemplate(r));
  }

  async createLetterTemplate(input: {
    name: string;
    kind: LetterKind;
    subject: string;
    body: string;
    tryoutId?: string;
  }): Promise<LetterTemplate> {
    const { supabase, userId, accountId } = await this.ctx();
    const row = unwrap(
      await supabase
        .from('letter_templates')
        .insert({
          account_id: accountId,
          name: input.name,
          kind: input.kind,
          subject: input.subject,
          body: input.body,
          tryout_id: input.tryoutId ?? null,
          created_by: userId,
        })
        .select()
        .single(),
    ) as Row;
    return this.rowToLetterTemplate(row);
  }

  async updateLetterTemplate(
    id: string,
    updates: Partial<{ name: string; kind: LetterKind; subject: string; body: string }>,
  ): Promise<LetterTemplate> {
    const { supabase } = await this.ctx();
    const patch: Row = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.kind !== undefined) patch.kind = updates.kind;
    if (updates.subject !== undefined) patch.subject = updates.subject;
    if (updates.body !== undefined) patch.body = updates.body;

    // .select().single() so an update RLS silently drops — zero rows matched,
    // which Postgres reports as an ordinary success — surfaces instead of
    // reporting a save that never happened. See wroteRow().
    const row = unwrap(
      await supabase.from('letter_templates').update(patch).eq('id', id).select().single(),
    ) as Row;
    return this.rowToLetterTemplate(row);
  }

  async deleteLetterTemplate(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('letter_templates').delete().eq('id', id).select().single());
  }

  async listPlayerLetters(tryoutId: string): Promise<PlayerLetter[]> {
    const { supabase } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('player_letters')
        .select('*')
        .eq('tryout_id', tryoutId)
        .order('created_at', { ascending: false }),
    ) as Row[] | null;
    return (rows ?? []).map((r) => this.rowToPlayerLetter(r));
  }

  /**
   * The send itself, shared by the bulk send and by a re-send of a stored copy.
   *
   * Returns the row as it now stands rather than throwing on a failed send: a
   * letter that could not be delivered is still a letter the coach authored,
   * and losing the copy would mean re-typing it to try again.
   */
  private async deliverLetter(
    supabase: SupabaseClient,
    userId: string,
    letterId: string,
    letter: { subject: string; body: string; recipientEmail?: string },
  ): Promise<PlayerLetter> {
    let error: string | null = null;
    if (!letter.recipientEmail) {
      error = 'No email address on file for this player.';
    } else {
      try {
        await this.sendEmail('tryout_letter', letter.recipientEmail, {
          subject: letter.subject,
          body: letter.body,
        });
      } catch (e) {
        error = e instanceof Error ? e.message : 'Failed to send the letter.';
      }
    }

    const row = unwrap(
      await supabase
        .from('player_letters')
        .update({
          status: error ? 'failed' : 'sent',
          error,
          sent_at: error ? null : new Date().toISOString(),
          sent_by: error ? null : userId,
        })
        .eq('id', letterId)
        .select()
        .single(),
    ) as Row;
    return this.rowToPlayerLetter(row);
  }

  async sendPlayerLetters(
    tryoutId: string,
    letters: {
      playerId: string;
      playerName: string;
      athleteId?: string;
      templateId?: string;
      kind: LetterKind;
      subject: string;
      body: string;
      recipientEmail?: string;
    }[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<PlayerLetterSendResult[]> {
    const { supabase, userId } = await this.ctx();
    const results: PlayerLetterSendResult[] = [];

    // Serially, not Promise.all: each letter is an edge-function invocation
    // that hands SendGrid one message, and firing forty of those at once is how
    // a club's domain gets rate-limited on the day it matters most. The
    // progress callback is what keeps the screen honest about the wait.
    let done = 0;
    for (const input of letters) {
      try {
        // Inserted before the send, so a copy exists on the player's card even
        // if the tab is closed mid-run — the alternative loses the wording of a
        // letter that may already be in someone's inbox.
        const created = unwrap(
          await supabase
            .from('player_letters')
            .insert({
              tryout_id: tryoutId,
              participant_id: input.playerId,
              athlete_id: input.athleteId ?? null,
              template_id: input.templateId ?? null,
              kind: input.kind,
              subject: input.subject,
              body: input.body,
              recipient_email: input.recipientEmail ?? null,
              status: 'draft',
            })
            .select()
            .single(),
        ) as Row;

        const letter = await this.deliverLetter(supabase, userId, created.id, input);
        results.push({
          playerId: input.playerId,
          playerName: input.playerName,
          letter,
          error: letter.status === 'failed' ? letter.error : undefined,
        });
      } catch (e) {
        // The insert itself failed — no copy was stored, so there is nothing to
        // retry against. Reported per player, like an import row.
        results.push({
          playerId: input.playerId,
          playerName: input.playerName,
          error: e instanceof Error ? e.message : 'Failed to save the letter.',
        });
      }
      onProgress?.(++done, letters.length);
    }

    return results;
  }

  async updatePlayerLetter(
    id: string,
    updates: Partial<{ subject: string; body: string; recipientEmail: string }>,
  ): Promise<PlayerLetter> {
    const { supabase } = await this.ctx();
    const patch: Row = {};
    if (updates.subject !== undefined) patch.subject = updates.subject;
    if (updates.body !== undefined) patch.body = updates.body;
    if (updates.recipientEmail !== undefined) patch.recipient_email = updates.recipientEmail || null;

    const row = unwrap(
      await supabase.from('player_letters').update(patch).eq('id', id).select().single(),
    ) as Row;
    return this.rowToPlayerLetter(row);
  }

  async resendPlayerLetter(id: string): Promise<PlayerLetter> {
    const { supabase, userId } = await this.ctx();
    const row = unwrap(
      await supabase.from('player_letters').select('*').eq('id', id).single(),
    ) as Row;
    const current = this.rowToPlayerLetter(row);
    return this.deliverLetter(supabase, userId, id, {
      subject: current.subject,
      body: current.body,
      recipientEmail: current.recipientEmail,
    });
  }

  async deletePlayerLetter(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('player_letters').delete().eq('id', id).select().single());
  }

}

export const supabaseDataSource = new SupabaseDataSource();
