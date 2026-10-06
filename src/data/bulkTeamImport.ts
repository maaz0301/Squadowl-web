import type { AddPlayerForm, PlayerImportResult } from './types';

/**
 * Importing a spreadsheet onto a team roster or an evaluation in a handful of
 * requests instead of a dozen per player.
 *
 * Kept free of any data-source code — everything it touches arrives as `deps` —
 * so the part that is easy to get subtly wrong (batching, and what happens to a
 * row when its batch fails) can be exercised without a database.
 *
 * The shape is: resolve every distinct guardian once, create the athletes a
 * batch per request, then put them all on the roster in one call. A batch or a
 * roster write that fails is not the end of the import: its rows are retried one
 * at a time through the slow path, which is what gives a failed row its own
 * message and lets the rest of the sheet land — the promise the one-at-a-time
 * import always made.
 */

/** Athletes created per request — the size the registration placement already runs at. */
export const IMPORT_CREATE_CHUNK = 20;

export interface BulkImportDeps {
  /** Guardian logins for these forms, resolved once each: lowercase email -> user id. Best effort. */
  resolveGuardians(forms: AddPlayerForm[]): Promise<Map<string, string>>;
  /** Create athletes in one request. Must answer with one id per payload, in order. */
  createAthletes(payloads: Record<string, unknown>[]): Promise<string[]>;
  /**
   * Put already-created athletes on the roster in one request. `form` is the
   * row they came from, for rosters that carry more than a jersey and position
   * (an evaluation's shoots / current team / friends). A roster keyed by its own
   * row id — an evaluation invites by `tryout_participants.id` — answers with
   * athleteId -> that id, so the caller can invite exactly what landed.
   */
  addToRoster(
    entries: { athleteId: string; jersey?: string; pos?: string; form: AddPlayerForm }[],
  ): Promise<void | Map<string, string>>;
  /**
   * Save full dates of birth for athletes just created. The create function
   * takes named columns and has no date of birth among them, so the date goes on
   * afterwards. Best effort: a failure costs the date, never the player.
   */
  saveDatesOfBirth?(entries: { athleteId: string; dateOfBirth: string }[]): Promise<void>;
  /** The one-player path (create + roster), used to isolate a failure. */
  addOne(form: AddPlayerForm): Promise<{ athleteId: string; participantId?: string }>;
  chunkSize?: number;
}

/** The athlete row an import form becomes. Mirrors what a manually added player is filed with. */
export function athletePayloadFromForm(
  form: AddPlayerForm,
  guardianIds: Map<string, string>,
): Record<string, unknown> {
  const guardianUserId = form.guardianEmail ? guardianIds.get(form.guardianEmail.toLowerCase()) : undefined;
  return {
    first_name: form.first,
    last_name: form.last,
    year_of_birth: form.yearOfBirth ? Number(form.yearOfBirth) : null,
    guardian_name: form.guardianName || null,
    guardian_email: form.guardianEmail || null,
    guardian_phone: form.guardianPhone || null,
    guardian_user_id: guardianUserId || null,
    player_email: form.playerEmail || null,
    medical_info: form.medicalInfo || null,
    about: form.aboutChild || null,
    avatar_url: form.avatarUrl || null,
  };
}

const messageOf = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const nameOf = (form: AddPlayerForm) => `${form.first} ${form.last}`.trim() || 'Unnamed player';

export async function bulkImportPlayers(
  rows: { line: number; form: AddPlayerForm }[],
  deps: BulkImportDeps,
  onProgress?: (done: number) => void,
): Promise<PlayerImportResult> {
  const result: PlayerImportResult = { added: 0, failed: [], athleteIds: [], participantIds: [] };
  if (rows.length === 0) return result;
  const size = Math.max(1, deps.chunkSize ?? IMPORT_CREATE_CHUNK);

  const landed = (athleteId: string | undefined, participantId?: string) => {
    result.added++;
    if (athleteId) result.athleteIds!.push(athleteId);
    if (participantId) result.participantIds!.push(participantId);
  };
  const failed = (line: number, form: AddPlayerForm, e: unknown) =>
    result.failed.push({ line, name: nameOf(form), message: messageOf(e, 'Could not add this player.') });

  // A guardian lookup that fails only costs the link between an athlete and a
  // login; the athletes themselves are still valid.
  let guardianIds = new Map<string, string>();
  try {
    guardianIds = await deps.resolveGuardians(rows.map((r) => r.form));
  } catch {
    // best effort
  }

  const created: { line: number; form: AddPlayerForm; athleteId: string }[] = [];
  let done = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    try {
      const ids = await deps.createAthletes(chunk.map((r) => athletePayloadFromForm(r.form, guardianIds)));
      // The zip below is by position; a short or holey answer can't be trusted.
      if (ids.length !== chunk.length || ids.some((id) => !id)) {
        throw new Error('The server did not create every player in this batch.');
      }
      chunk.forEach((r, j) => created.push({ ...r, athleteId: ids[j] }));
      const dates = chunk.flatMap((r, j) => (r.form.dateOfBirth ? [{ athleteId: ids[j], dateOfBirth: r.form.dateOfBirth }] : []));
      if (dates.length > 0 && deps.saveDatesOfBirth) {
        try {
          await deps.saveDatesOfBirth(dates);
        } catch {
          // See the dep: the date is optional, the player is not.
        }
      }
    } catch {
      // Find out which rows are the problem by adding them one at a time.
      for (const { line, form } of chunk) {
        try {
          const one = await deps.addOne(form);
          landed(one.athleteId, one.participantId);
        } catch (e) {
          failed(line, form, e);
        }
      }
    }
    done += chunk.length;
    onProgress?.(done);
  }

  if (created.length > 0) {
    const entry = (c: (typeof created)[number]) => ({
      athleteId: c.athleteId,
      jersey: c.form.jersey,
      pos: c.form.pos,
      form: c.form,
    });
    try {
      const ids = await deps.addToRoster(created.map(entry));
      for (const c of created) landed(c.athleteId, ids?.get(c.athleteId));
    } catch {
      // The upsert is idempotent, so retrying players that did make it is harmless.
      for (const c of created) {
        try {
          const ids = await deps.addToRoster([entry(c)]);
          landed(c.athleteId, ids?.get(c.athleteId));
        } catch (e) {
          failed(c.line, c.form, e);
        }
      }
    }
  }

  result.failed.sort((a, b) => a.line - b.line);
  return result;
}

/**
 * Plan player cap for a spreadsheet import. A spreadsheet is a faster way onto a
 * roster, not a way around the cap, so only the first `room` rows go through and
 * the rest come back as "not added" for the import summary to list — the same
 * shape a row the server rejected has.
 */
export function capImportRows<T extends { line: number; form: AddPlayerForm }>(
  rows: T[],
  room: number,
): { allowed: T[]; skipped: PlayerImportResult['failed'] } {
  if (!(room < rows.length)) return { allowed: rows, skipped: [] };
  const keep = Math.max(0, Math.floor(room));
  return {
    allowed: rows.slice(0, keep),
    skipped: rows.slice(keep).map(({ line, form }) => ({
      line,
      name: nameOf(form),
      message: "Not added: your plan's player limit was reached.",
    })),
  };
}

/** Folds the rows capImportRows held back into an import's own result. */
export function withSkippedRows(
  result: PlayerImportResult,
  skipped: PlayerImportResult['failed'],
): PlayerImportResult {
  if (skipped.length === 0) return result;
  return { ...result, failed: [...result.failed, ...skipped].sort((a, b) => a.line - b.line) };
}

/** The bits of a player already on a roster that decide whether an import row is the same person. */
export interface ExistingPlayer {
  first: string;
  last: string;
  yearOfBirth?: string | number;
  guardianEmail?: string;
}

const norm = (v: string | number | null | undefined) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Same name, and birth year / guardian email agree wherever both sides have one. */
function isSamePlayer(form: AddPlayerForm, p: ExistingPlayer): boolean {
  if (norm(form.first) !== norm(p.first) || norm(form.last) !== norm(p.last)) return false;
  const yobA = norm(form.yearOfBirth);
  const yobB = norm(p.yearOfBirth);
  if (yobA && yobB && yobA !== yobB) return false;
  const gA = norm(form.guardianEmail);
  const gB = norm(p.guardianEmail);
  if (gA && gB && gA !== gB) return false;
  return true;
}

/**
 * Sets aside the import rows that are already on the roster, so a re-import
 * neither files a second copy of them nor spends the plan's player cap on people
 * who wouldn't add anyone. Only what is on screen can be compared, so a roster
 * that has not fully loaded lets a few through rather than dropping a real new
 * player.
 */
export function dropExistingPlayers<T extends { line: number; form: AddPlayerForm }>(
  rows: T[],
  existing: ExistingPlayer[],
): { fresh: T[]; duplicates: PlayerImportResult['failed'] } {
  if (existing.length === 0) return { fresh: rows, duplicates: [] };
  const byName = new Map<string, ExistingPlayer[]>();
  for (const p of existing) {
    const key = `${norm(p.first)}|${norm(p.last)}`;
    const list = byName.get(key);
    if (list) list.push(p);
    else byName.set(key, [p]);
  }
  const fresh: T[] = [];
  const duplicates: PlayerImportResult['failed'] = [];
  for (const row of rows) {
    const candidates = byName.get(`${norm(row.form.first)}|${norm(row.form.last)}`) ?? [];
    if (candidates.some((c) => isSamePlayer(row.form, c))) {
      duplicates.push({ line: row.line, name: nameOf(row.form), message: 'Already on this roster.' });
    } else {
      fresh.push(row);
    }
  }
  return { fresh, duplicates };
}
