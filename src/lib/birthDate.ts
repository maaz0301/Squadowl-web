/**
 * Dates of birth. A player has always had a year of birth; the full date is
 * optional on top of it, kept as "YYYY-MM-DD" and never without its year.
 */

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const pad = (n: number) => String(n).padStart(2, '0');

/** How many days a month has, leap years included. `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export interface BirthDateParts {
  year: string;
  /** "1"-"12", or ''. */
  month: string;
  /** "1"-"31", or ''. */
  day: string;
}

/** "2012-03-04" -> { year: '2012', month: '3', day: '4' }; anything else -> all empty. */
export function splitDateOfBirth(value?: string | null): BirthDateParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? '').trim());
  if (!m) return { year: '', month: '', day: '' };
  return { year: m[1], month: String(Number(m[2])), day: String(Number(m[3])) };
}

/**
 * The "YYYY-MM-DD" for a year, month and day, or '' while any of them is missing
 * or the date does not exist (31 February, 29 February in a non-leap year).
 */
export function buildDateOfBirth(year: string, month: string, day: string): string {
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  if (!year || !month || !day || !Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return '';
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return '';
  return `${String(y).padStart(4, '0')}-${pad(mo)}-${pad(d)}`;
}

/** What to show for a birth: "Mar 4, 2012" with a full date, else just the year, else ''. */
export function formatBirth(dateOfBirth?: string | null, yearOfBirth?: string | null): string {
  const { year, month, day } = splitDateOfBirth(dateOfBirth);
  if (year && month && day) return `${MONTHS[Number(month) - 1].slice(0, 3)} ${day}, ${year}`;
  return yearOfBirth ?? '';
}

/**
 * Keeps the year and the full date agreeing: when the year changes, a day that no
 * longer exists (29 Feb after moving to a non-leap year) is cleared rather than kept.
 */
export function withYear(parts: BirthDateParts, year: string): BirthDateParts {
  const next = { ...parts, year };
  if (next.month && next.day && year && Number(next.day) > daysInMonth(Number(year), Number(next.month))) {
    next.day = '';
  }
  return next;
}
