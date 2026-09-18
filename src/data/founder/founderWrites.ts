/**
 * Founder console edits — founder@tryout.ca only.
 *
 * Every write here goes straight to the table by row id. No database change is
 * involved: the founder is in platform_admins, and every write policy these
 * tables carry (teams_rw, tryouts_write, participants_write, evaluations_write,
 * eval_scores_rw, seasons_write, season_events_write, team_roster_write,
 * athletes_write, tryout_assessors_write) goes through has_account_role() /
 * has_account_access(), both of which let a platform admin through.
 *
 * The coach app's own write methods are deliberately not used: they resolve
 * the signed-in user's working account through ctx(), so anything created
 * through them would land on the founder's personal account instead of the
 * organization's. Rows created here always carry the organization's id.
 *
 * An UPDATE or DELETE that RLS refuses isn't an error in Postgres — it just
 * matches no rows — so every write reads its rows back and fails loudly when
 * nothing changed.
 *
 * Every write also logs to founder_audit_log via logWrite() below, once the
 * table write itself has succeeded — see 20260918130000_founder_console_write_audit.sql.
 */
import { getSupabase } from '@/lib/supabase';
import type { EventType, Recommendation } from '@/data/types';
import type { FounderAuditAction } from './types';
import { founderError } from './errors';

type Patch = Record<string, unknown>;

const NOT_SAVED = 'Nothing was saved — the row no longer exists or the database refused the change.';

/**
 * Every write below lands straight in a table, under RLS — not through an
 * RPC — so unlike the rest of the founder console (which logs through
 * founder_write_audit() from inside a SECURITY DEFINER function) these had no
 * audit trail at all. founder_log_console_write() is the whitelisted,
 * is_founder()-gated wrapper that lets the client log one after the fact.
 *
 * Fire-and-forget, same as logFounderUserAction() below: a failed log entry
 * shouldn't turn a successful save into a reported failure, so this only
 * warns.
 */
async function logWrite(action: FounderAuditAction, accountId: string, details: Patch = {}): Promise<void> {
  const { error } = await getSupabase().rpc('founder_log_console_write', {
    p_action: action,
    p_account_id: accountId,
    p_details: details,
  });
  if (error) console.warn('Could not record audit entry:', error.message);
}

async function updateById(table: string, id: string, patch: Patch): Promise<void> {
  const { data, error } = await getSupabase().from(table).update(patch).eq('id', id).select('id');
  if (error) throw founderError(error);
  if (!data?.length) throw new Error(NOT_SAVED);
}

async function deleteById(table: string, id: string): Promise<void> {
  const { data, error } = await getSupabase().from(table).delete().eq('id', id).select('id');
  if (error) throw founderError(error);
  if (!data?.length) throw new Error(NOT_SAVED);
}

async function insertRow(table: string, row: Patch): Promise<string> {
  const { data, error } = await getSupabase().from(table).insert(row).select('id').single();
  if (error) throw founderError(error);
  return (data as { id: string }).id;
}

/** Blank form values become NULL rather than empty strings. */
const text = (v: string | undefined) => (v?.trim() ? v.trim() : null);
const int = (v: string | undefined) => {
  const n = Number(v);
  return v?.trim() && Number.isFinite(n) ? Math.round(n) : null;
};

/**
 * A column whose form field was dropped from a FounderField list (edited
 * elsewhere, or not editable at all): only touch it when the caller's values
 * actually carry that key, so a save from the pared-down form doesn't null
 * out data no longer shown in the UI.
 */
const ifPresent = <T extends object>(v: T, key: keyof T & string, column: string = key): Patch =>
  key in v ? { [column]: text((v as Record<string, unknown>)[key] as string | undefined) } : {};

const EVENT_TYPE_TO_DB: Record<EventType, string> = {
  Tryout: 'tryout',
  Assessment: 'assessment',
  'Sort Out': 'sort_out',
  Combine: 'combine',
};

// ─── Teams ───────────────────────────────────────────────────────────────────

export interface FounderTeamInput {
  name?: string;
  seasonLabel?: string;
  /** "#rrggbb", or blank for no team colour. */
  brandColor?: string;
  /** "yes" / "no", as the form's choice field sends it. */
  collectsFees?: string;
  /** Fee per player in dollars, as typed. */
  fee?: string;
}

export async function updateTeam(accountId: string, teamId: string, v: FounderTeamInput) {
  if (!v.name?.trim()) throw new Error('A team needs a name.');
  const color = v.brandColor?.trim() || null;
  if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) throw new Error('Team colour must look like #1e3a8a.');
  const collectsFees = v.collectsFees === 'yes';
  const dollars = Number(v.fee);
  const feeCents =
    collectsFees && v.fee?.trim() && Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : 0;
  if (collectsFees && !feeCents) throw new Error('Enter the fee per player, or choose "No" for collecting fees.');

  // The team logo has no column of its own: it rides along in season_label as
  // "season|LOGO|url" (see SupabaseDataSource.updateTeam). Read the stored
  // value first so renaming the season never drops an uploaded logo.
  const { data: current, error: readError } = await getSupabase()
    .from('teams')
    .select('season_label')
    .eq('id', teamId)
    .maybeSingle();
  if (readError) throw founderError(readError);
  if (!current) throw new Error(NOT_SAVED);
  const logoUrl = String((current as { season_label?: string | null }).season_label ?? '').split('|LOGO|')[1];
  const season = v.seasonLabel?.trim() ?? '';

  await updateById('teams', teamId, {
    name: v.name.trim(),
    season_label: logoUrl ? `${season}|LOGO|${logoUrl}` : season || null,
    brand_color: color,
    collects_fees: collectsFees,
    // Same as the coach app: no fee is stored as NULL, not 0.
    registration_fee_cents: collectsFees ? feeCents : null,
  });
  await logWrite('update_team', accountId, { entity_name: v.name.trim() });
}

export async function setTeamArchived(accountId: string, teamId: string, archived: boolean, teamName?: string) {
  await updateById('teams', teamId, { archived });
  await logWrite(archived ? 'archive_team' : 'unarchive_team', accountId, { entity_name: teamName });
}

// ─── Players ─────────────────────────────────────────────────────────────────

export interface FounderAthleteInput {
  firstName?: string;
  lastName?: string;
  yearOfBirth?: string;
  defaultPosition?: string;
  playerEmail?: string;
  guardianName?: string;
  guardianEmail?: string;
  guardianPhone?: string;
  about?: string;
}

/**
 * Only the fields the form actually showed are written, so a form that leaves
 * one out (the player page has no "usual position") never blanks it.
 */
function athletePatch(v: FounderAthleteInput): Patch {
  if (!v.firstName?.trim() || !v.lastName?.trim()) throw new Error('A player needs a first and last name.');
  const columns: [keyof FounderAthleteInput, string, (x: string | undefined) => unknown][] = [
    ['yearOfBirth', 'year_of_birth', int],
    ['defaultPosition', 'default_position', text],
    ['playerEmail', 'player_email', text],
    ['guardianName', 'guardian_name', text],
    ['guardianEmail', 'guardian_email', text],
    ['guardianPhone', 'guardian_phone', text],
    ['about', 'about', text],
  ];
  const patch: Patch = { first_name: v.firstName.trim(), last_name: v.lastName.trim() };
  for (const [key, column, convert] of columns) {
    if (key in v) patch[column] = convert(v[key]);
  }
  return patch;
}

function playerName(v: FounderAthleteInput): string {
  return `${v.firstName ?? ''} ${v.lastName ?? ''}`.trim() || 'Unnamed player';
}

export async function updateAthlete(accountId: string, athleteId: string, v: FounderAthleteInput) {
  await updateById('athletes', athleteId, athletePatch(v));
  await logWrite('update_player', accountId, { entity_name: playerName(v) });
}

/** A new athlete filed under the organization — never under the founder's own account. */
function createAthlete(accountId: string, v: FounderAthleteInput) {
  return insertRow('athletes', { account_id: accountId, ...athletePatch(v) });
}

export async function updateTeamRosterEntry(
  accountId: string,
  rosterId: string,
  v: { jersey?: string; position?: string },
  playerLabel?: string,
) {
  await updateById('team_roster', rosterId, { jersey: text(v.jersey), position: text(v.position) });
  await logWrite('update_team_roster', accountId, { entity_name: playerLabel });
}

/** Takes the player off this team only; the athlete and their history stay. */
export async function removeTeamRosterEntry(accountId: string, rosterId: string, playerLabel?: string) {
  await deleteById('team_roster', rosterId);
  await logWrite('remove_player_from_team', accountId, { entity_name: playerLabel });
}

export async function addPlayerToTeam(
  accountId: string,
  teamId: string,
  v: FounderAthleteInput & { jersey?: string; position?: string },
) {
  const athleteId = await createAthlete(accountId, v);
  const rosterId = await insertRow('team_roster', {
    team_id: teamId,
    athlete_id: athleteId,
    jersey: text(v.jersey),
    position: text(v.position),
  });
  await logWrite('add_player_to_team', accountId, { entity_name: playerName(v) });
  return rosterId;
}

// ─── Seasons ─────────────────────────────────────────────────────────────────

export async function updateSeason(
  accountId: string,
  seasonId: string,
  v: { name?: string; year?: string; division?: string; coach?: string },
) {
  if (!v.name?.trim()) throw new Error('A season needs a name.');
  await updateById('seasons', seasonId, {
    name: v.name.trim(),
    year: text(v.year),
    ...ifPresent(v, 'division'),
    ...ifPresent(v, 'coach'),
  });
  await logWrite('update_season', accountId, { entity_name: v.name.trim() });
}

export async function setSeasonArchived(accountId: string, seasonId: string, archived: boolean, seasonName?: string) {
  await updateById('seasons', seasonId, { archived });
  await logWrite(archived ? 'archive_season' : 'unarchive_season', accountId, { entity_name: seasonName });
}

export interface FounderEventInput {
  kind?: string;
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  notes?: string;
}

function eventPatch(v: FounderEventInput): Patch {
  if (!v.title?.trim()) throw new Error('An event needs a title.');
  if (!v.date?.trim()) throw new Error('An event needs a date.');
  return {
    kind: v.kind || 'game',
    title: v.title.trim(),
    event_date: v.date,
    start_time: text(v.startTime),
    location: text(v.location),
    ...ifPresent(v, 'endTime', 'end_time'),
    ...ifPresent(v, 'notes'),
  };
}

export async function addSeasonEvent(accountId: string, seasonId: string, v: FounderEventInput) {
  const id = await insertRow('season_events', { season_id: seasonId, ...eventPatch(v) });
  await logWrite('add_season_event', accountId, { entity_name: v.title?.trim() });
  return id;
}

export async function updateSeasonEvent(accountId: string, eventId: string, v: FounderEventInput) {
  await updateById('season_events', eventId, eventPatch(v));
  await logWrite('update_season_event', accountId, { entity_name: v.title?.trim() });
}

export async function deleteSeasonEvent(accountId: string, eventId: string, eventLabel?: string) {
  await deleteById('season_events', eventId);
  await logWrite('delete_season_event', accountId, { entity_name: eventLabel });
}

// ─── Evaluations ─────────────────────────────────────────────────────────────

export interface FounderTryoutInput {
  name?: string;
  eventType?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  headCoach?: string;
  headAssessor?: string;
}

export async function updateTryout(accountId: string, tryoutId: string, v: FounderTryoutInput) {
  if (!v.name?.trim()) throw new Error('An evaluation needs a name.');
  await updateById('tryouts', tryoutId, {
    name: v.name.trim(),
    event_type: EVENT_TYPE_TO_DB[v.eventType as EventType] ?? 'tryout',
    tryout_date: text(v.date),
    start_time: text(v.startTime),
    end_time: text(v.endTime),
    location: text(v.location),
    head_coach: text(v.headCoach),
    head_assessor: text(v.headAssessor),
  });
  await logWrite('update_tryout', accountId, { entity_name: v.name.trim() });
}

export async function setTryoutArchived(accountId: string, tryoutId: string, archived: boolean, tryoutName?: string) {
  await updateById('tryouts', tryoutId, { archived });
  await logWrite(archived ? 'archive_tryout' : 'unarchive_tryout', accountId, { entity_name: tryoutName });
}

/** Soft delete, the same as the coach app's delete — restorable. */
export async function setTryoutDeleted(accountId: string, tryoutId: string, deleted: boolean, tryoutName?: string) {
  await updateById('tryouts', tryoutId, { deleted_at: deleted ? new Date().toISOString() : null });
  await logWrite(deleted ? 'delete_tryout' : 'restore_tryout', accountId, { entity_name: tryoutName });
}

export interface FounderParticipantInput {
  jersey?: string;
  position?: string;
  currentTeam?: string;
  currentLevel?: string;
}

export async function updateParticipant(
  accountId: string,
  participantId: string,
  v: FounderParticipantInput,
  playerLabel?: string,
) {
  await updateById('tryout_participants', participantId, {
    jersey: text(v.jersey),
    position: text(v.position),
    current_team: text(v.currentTeam),
    current_level: text(v.currentLevel),
  });
  await logWrite('update_participant', accountId, { entity_name: playerLabel });
}

/** Soft removal, the same as the coach app's — the player's evaluations are kept and it can be undone. */
export async function setParticipantRemoved(
  accountId: string,
  participantId: string,
  removed: boolean,
  playerLabel?: string,
) {
  await updateById('tryout_participants', participantId, {
    removed_at: removed ? new Date().toISOString() : null,
  });
  await logWrite(removed ? 'remove_participant' : 'restore_participant', accountId, { entity_name: playerLabel });
}

export async function addPlayerToTryout(
  accountId: string,
  tryoutId: string,
  v: FounderAthleteInput & FounderParticipantInput,
) {
  const athleteId = await createAthlete(accountId, v);
  const id = await insertRow('tryout_participants', {
    tryout_id: tryoutId,
    athlete_id: athleteId,
    jersey: text(v.jersey),
    position: text(v.position),
    current_team: text(v.currentTeam),
    current_level: text(v.currentLevel),
  });
  await logWrite('add_player_to_tryout', accountId, { entity_name: playerName(v) });
  return id;
}

/**
 * Assessors are addressed by (tryout, email) — the table's unique key — or by
 * name when an assessor has no email, since the evaluation read doesn't carry
 * their row id.
 */
type AssessorKey = { email?: string; name?: string };

export async function updateAssessor(
  accountId: string,
  tryoutId: string,
  who: AssessorKey,
  v: { name?: string; role?: string; status?: string },
) {
  if (!v.name?.trim()) throw new Error('An assessor needs a name.');
  const base = getSupabase()
    .from('tryout_assessors')
    .update({ name: v.name.trim(), role: v.role || 'assessor', status: v.status || 'pending' })
    .eq('tryout_id', tryoutId);
  const { data, error } = await (who.email ? base.eq('email', who.email) : base.eq('name', who.name ?? '')).select(
    'id',
  );
  if (error) throw founderError(error);
  if (!data?.length) throw new Error(NOT_SAVED);
  await logWrite('update_assessor', accountId, { entity_name: v.name.trim() });
}

export async function removeAssessor(accountId: string, tryoutId: string, who: AssessorKey) {
  const base = getSupabase().from('tryout_assessors').delete().eq('tryout_id', tryoutId);
  const { data, error } = await (who.email ? base.eq('email', who.email) : base.eq('name', who.name ?? '')).select(
    'id',
  );
  if (error) throw founderError(error);
  if (!data?.length) throw new Error(NOT_SAVED);
  await logWrite('remove_assessor', accountId, { entity_name: who.name || who.email });
}

export interface FounderEvaluationInput {
  session?: string;
  recommendation?: Recommendation | string;
  strengths?: string;
  improve?: string;
  /** rubric_key → value as typed; blank removes that score. */
  scores: Record<string, string>;
}

export async function updateEvaluation(
  accountId: string,
  evaluationId: string,
  v: FounderEvaluationInput,
  entityLabel?: string,
) {
  await updateById('evaluations', evaluationId, {
    session: v.session?.trim() || 'Session 1',
    recommendation: v.recommendation ? String(v.recommendation).toLowerCase() : null,
    strengths: text(v.strengths),
    improve: text(v.improve),
  });

  const supabase = getSupabase();
  const upserts: { evaluation_id: string; rubric_key: string; value: number }[] = [];
  const cleared: string[] = [];
  for (const [key, raw] of Object.entries(v.scores)) {
    if (!raw?.trim()) {
      cleared.push(key);
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`"${raw}" isn't a valid score.`);
    upserts.push({ evaluation_id: evaluationId, rubric_key: key, value });
  }
  if (upserts.length) {
    const { error } = await supabase
      .from('evaluation_scores')
      .upsert(upserts, { onConflict: 'evaluation_id,rubric_key' });
    if (error) throw founderError(error);
  }
  if (cleared.length) {
    const { error } = await supabase
      .from('evaluation_scores')
      .delete()
      .eq('evaluation_id', evaluationId)
      .in('rubric_key', cleared);
    if (error) throw founderError(error);
  }
  await logWrite('update_evaluation', accountId, { entity_name: entityLabel });
}

/** Permanent, as it is in the coach app: the evaluation and its scores are removed. */
export async function deleteEvaluation(accountId: string, evaluationId: string, entityLabel?: string) {
  await deleteById('evaluations', evaluationId);
  await logWrite('delete_evaluation', accountId, { entity_name: entityLabel });
}
