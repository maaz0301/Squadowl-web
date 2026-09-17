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
 */
import { getSupabase } from '@/lib/supabase';
import type { EventType, Recommendation } from '@/data/types';
import { founderError } from './errors';

type Patch = Record<string, unknown>;

const NOT_SAVED = 'Nothing was saved — the row no longer exists or the database refused the change.';

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

export async function updateTeam(teamId: string, v: FounderTeamInput) {
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

  return updateById('teams', teamId, {
    name: v.name.trim(),
    season_label: logoUrl ? `${season}|LOGO|${logoUrl}` : season || null,
    brand_color: color,
    collects_fees: collectsFees,
    // Same as the coach app: no fee is stored as NULL, not 0.
    registration_fee_cents: collectsFees ? feeCents : null,
  });
}

export function setTeamArchived(teamId: string, archived: boolean) {
  return updateById('teams', teamId, { archived });
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

export function updateAthlete(athleteId: string, v: FounderAthleteInput) {
  return updateById('athletes', athleteId, athletePatch(v));
}

/** A new athlete filed under the organization — never under the founder's own account. */
function createAthlete(accountId: string, v: FounderAthleteInput) {
  return insertRow('athletes', { account_id: accountId, ...athletePatch(v) });
}

export function updateTeamRosterEntry(rosterId: string, v: { jersey?: string; position?: string }) {
  return updateById('team_roster', rosterId, { jersey: text(v.jersey), position: text(v.position) });
}

/** Takes the player off this team only; the athlete and their history stay. */
export function removeTeamRosterEntry(rosterId: string) {
  return deleteById('team_roster', rosterId);
}

export async function addPlayerToTeam(
  accountId: string,
  teamId: string,
  v: FounderAthleteInput & { jersey?: string; position?: string },
) {
  const athleteId = await createAthlete(accountId, v);
  return insertRow('team_roster', {
    team_id: teamId,
    athlete_id: athleteId,
    jersey: text(v.jersey),
    position: text(v.position),
  });
}

// ─── Seasons ─────────────────────────────────────────────────────────────────

export function updateSeason(seasonId: string, v: { name?: string; year?: string; division?: string; coach?: string }) {
  if (!v.name?.trim()) throw new Error('A season needs a name.');
  return updateById('seasons', seasonId, {
    name: v.name.trim(),
    year: text(v.year),
    division: text(v.division),
    coach: text(v.coach),
  });
}

export function setSeasonArchived(seasonId: string, archived: boolean) {
  return updateById('seasons', seasonId, { archived });
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
    end_time: text(v.endTime),
    location: text(v.location),
    notes: text(v.notes),
  };
}

export function addSeasonEvent(seasonId: string, v: FounderEventInput) {
  return insertRow('season_events', { season_id: seasonId, ...eventPatch(v) });
}

export function updateSeasonEvent(eventId: string, v: FounderEventInput) {
  return updateById('season_events', eventId, eventPatch(v));
}

export function deleteSeasonEvent(eventId: string) {
  return deleteById('season_events', eventId);
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

export function updateTryout(tryoutId: string, v: FounderTryoutInput) {
  if (!v.name?.trim()) throw new Error('An evaluation needs a name.');
  return updateById('tryouts', tryoutId, {
    name: v.name.trim(),
    event_type: EVENT_TYPE_TO_DB[v.eventType as EventType] ?? 'tryout',
    tryout_date: text(v.date),
    start_time: text(v.startTime),
    end_time: text(v.endTime),
    location: text(v.location),
    head_coach: text(v.headCoach),
    head_assessor: text(v.headAssessor),
  });
}

export function setTryoutArchived(tryoutId: string, archived: boolean) {
  return updateById('tryouts', tryoutId, { archived });
}

/** Soft delete, the same as the coach app's delete — restorable. */
export function setTryoutDeleted(tryoutId: string, deleted: boolean) {
  return updateById('tryouts', tryoutId, { deleted_at: deleted ? new Date().toISOString() : null });
}

export interface FounderParticipantInput {
  jersey?: string;
  position?: string;
  currentTeam?: string;
  currentLevel?: string;
}

export function updateParticipant(participantId: string, v: FounderParticipantInput) {
  return updateById('tryout_participants', participantId, {
    jersey: text(v.jersey),
    position: text(v.position),
    current_team: text(v.currentTeam),
    current_level: text(v.currentLevel),
  });
}

/** Soft removal, the same as the coach app's — the player's evaluations are kept and it can be undone. */
export function setParticipantRemoved(participantId: string, removed: boolean) {
  return updateById('tryout_participants', participantId, {
    removed_at: removed ? new Date().toISOString() : null,
  });
}

export async function addPlayerToTryout(
  accountId: string,
  tryoutId: string,
  v: FounderAthleteInput & FounderParticipantInput,
) {
  const athleteId = await createAthlete(accountId, v);
  return insertRow('tryout_participants', {
    tryout_id: tryoutId,
    athlete_id: athleteId,
    jersey: text(v.jersey),
    position: text(v.position),
    current_team: text(v.currentTeam),
    current_level: text(v.currentLevel),
  });
}

/**
 * Assessors are addressed by (tryout, email) — the table's unique key — or by
 * name when an assessor has no email, since the evaluation read doesn't carry
 * their row id.
 */
type AssessorKey = { email?: string; name?: string };

export async function updateAssessor(
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
}

export async function removeAssessor(tryoutId: string, who: AssessorKey) {
  const base = getSupabase().from('tryout_assessors').delete().eq('tryout_id', tryoutId);
  const { data, error } = await (who.email ? base.eq('email', who.email) : base.eq('name', who.name ?? '')).select(
    'id',
  );
  if (error) throw founderError(error);
  if (!data?.length) throw new Error(NOT_SAVED);
}

export interface FounderEvaluationInput {
  session?: string;
  recommendation?: Recommendation | string;
  strengths?: string;
  improve?: string;
  /** rubric_key → value as typed; blank removes that score. */
  scores: Record<string, string>;
}

export async function updateEvaluation(evaluationId: string, v: FounderEvaluationInput) {
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
}

/** Permanent, as it is in the coach app: the evaluation and its scores are removed. */
export function deleteEvaluation(evaluationId: string) {
  return deleteById('evaluations', evaluationId);
}
