/** A birth-year window typed by the coach; either end may be blank for "no limit". */
export interface BirthYearRange {
  from: string;
  to: string;
}

interface HasBirth {
  yearOfBirth?: string | number | null;
  dateOfBirth?: string | null;
}

/** The year a player was born, from the full date when known; null when neither is on file. */
export function birthYearOf(p: HasBirth): number | null {
  const dob = /^(\d{4})-\d{2}-\d{2}$/.exec((p.dateOfBirth ?? '').trim());
  if (dob) return Number(dob[1]);
  const y = typeof p.yearOfBirth === 'number' ? p.yearOfBirth : parseInt(String(p.yearOfBirth ?? ''), 10);
  return Number.isFinite(y) ? y : null;
}

function bound(value: string): number | null {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export function isBirthYearRangeActive(range: BirthYearRange): boolean {
  return bound(range.from) != null || bound(range.to) != null;
}

/**
 * The ids whose player was born inside the range (ends included). A player with
 * no birth year on file is dropped once a limit is set, since they cannot be placed
 * in an age group; clearing the range brings them back.
 */
export function filterIdsByBirthYear<T extends HasBirth>(
  ids: readonly string[],
  playerById: ReadonlyMap<string, T>,
  range: BirthYearRange,
): string[] {
  if (!isBirthYearRangeActive(range)) return [...ids];
  const from = bound(range.from);
  const to = bound(range.to);
  return ids.filter((id) => {
    const p = playerById.get(id);
    const y = p ? birthYearOf(p) : null;
    if (y == null) return false;
    return (from == null || y >= from) && (to == null || y <= to);
  });
}
