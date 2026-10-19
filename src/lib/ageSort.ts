import type { AgeSortDir } from '@/state/ageSortStore';

interface HasBirth {
  yearOfBirth?: string | number | null;
  dateOfBirth?: string | null;
  first?: string;
  last?: string;
}

/** A sortable number for a birth: the full date when known, else the year. null when neither parses. */
function birthKey(p: HasBirth): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((p.dateOfBirth ?? '').trim());
  if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  const y = typeof p.yearOfBirth === 'number' ? p.yearOfBirth : parseInt(String(p.yearOfBirth ?? ''), 10);
  return Number.isFinite(y) ? y * 10000 + 701 : null;
}

/**
 * Comparator for sorting athletes by age. 'youngest' puts the latest birth first.
 * A player with no birth year sinks to the bottom in either direction rather than
 * being guessed at as oldest or youngest. Kept identical in both repos.
 */
export function compareByAge<T extends HasBirth>(dir: AgeSortDir): (a: T, b: T) => number {
  return (a, b) => {
    const ak = birthKey(a);
    const bk = birthKey(b);
    if (ak == null) return bk == null ? 0 : 1;
    if (bk == null) return -1;
    const diff = dir === 'youngest' ? bk - ak : ak - bk;
    return diff || `${a.last ?? ''}${a.first ?? ''}`.localeCompare(`${b.last ?? ''}${b.first ?? ''}`);
  };
}
