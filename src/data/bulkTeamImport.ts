import type { AddPlayerForm, PlayerImportResult } from './types';

/**
 * Importing a spreadsheet onto a team roster in a handful of requests instead of
 * a dozen per player.
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
  /** Put already-created athletes on the roster in one request. */
  addToRoster(entries: { athleteId: string; jersey?: string; pos?: string }[]): Promise<void>;
  /** The one-player path (create + roster), used to isolate a failure. */
  addOne(form: AddPlayerForm): Promise<{ athleteId: string }>;
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

  const landed = (athleteId: string | undefined) => {
    result.added++;
    if (athleteId) result.athleteIds!.push(athleteId);
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
    } catch {
      // Find out which rows are the problem by adding them one at a time.
      for (const { line, form } of chunk) {
        try {
          landed((await deps.addOne(form)).athleteId);
        } catch (e) {
          failed(line, form, e);
        }
      }
    }
    done += chunk.length;
    onProgress?.(done);
  }

  if (created.length > 0) {
    const entry = (c: (typeof created)[number]) => ({ athleteId: c.athleteId, jersey: c.form.jersey, pos: c.form.pos });
    try {
      await deps.addToRoster(created.map(entry));
      for (const c of created) landed(c.athleteId);
    } catch {
      // The upsert is idempotent, so retrying players that did make it is harmless.
      for (const c of created) {
        try {
          await deps.addToRoster([entry(c)]);
          landed(c.athleteId);
        } catch (e) {
          failed(c.line, c.form, e);
        }
      }
    }
  }

  result.failed.sort((a, b) => a.line - b.line);
  return result;
}
