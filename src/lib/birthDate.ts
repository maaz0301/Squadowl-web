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

const MONTH_BY_NAME: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** "11" -> 2011, "98" -> 1998: a two-digit year is this century up to now, the last one after. */
function fullYear(value: string): number {
  if (value.length === 4) return Number(value);
  const n = Number(value);
  return n <= new Date().getFullYear() % 100 ? 2000 + n : 1900 + n;
}

export interface ParsedBirth {
  /** "2011", or '' when the cell holds no year. */
  yearOfBirth: string;
  /** "2011-04-02" when the cell holds a whole, real date; otherwise ''. */
  dateOfBirth: string;
}

/**
 * A birthday out of a spreadsheet cell, however it is written: "2011-04-02",
 * "04/02/2011", "4/2/11" (what Excel shows for a date cell with no set format),
 * "2-Apr-11", "April 2, 2011", an Excel serial number, or just "2011".
 *
 * A day/month pair that could be either way round is read month first, as Excel
 * shows it; one with a part above 12 settles itself. Whatever cannot be read as
 * a whole date still gives its year when it carries one.
 */
export function parseBirth(value: string): ParsedBirth {
  const text = value.trim();
  const whole = (y: number, m: number, d: number): ParsedBirth | null => {
    const dateOfBirth = buildDateOfBirth(String(y), String(m), String(d));
    return dateOfBirth ? { yearOfBirth: String(y), dateOfBirth } : null;
  };
  let match: RegExpExecArray | null;
  let found: ParsedBirth | null = null;

  if (/^\d{5}$/.test(text)) {
    // Excel counts days from 30 Dec 1899.
    const date = new Date(Date.UTC(1899, 11, 30) + Number(text) * 86400000);
    found = whole(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  } else if ((match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D.*)?$/.exec(text))) {
    found = whole(Number(match[1]), Number(match[2]), Number(match[3]));
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(text))) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const [month, day] = a > 12 ? [b, a] : [a, b];
    found = whole(fullYear(match[3]), month, day);
  } else if ((match = /^(\d{1,2})[\s./-]*([A-Za-z]{3,9})\.?,?[\s./-]*(\d{4}|\d{2})$/.exec(text))) {
    const month = MONTH_BY_NAME[match[2].toLowerCase().slice(0, 4)] ?? MONTH_BY_NAME[match[2].toLowerCase().slice(0, 3)];
    if (month) found = whole(fullYear(match[3]), month, Number(match[1]));
  } else if ((match = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}|\d{2})$/.exec(text))) {
    const month = MONTH_BY_NAME[match[1].toLowerCase().slice(0, 4)] ?? MONTH_BY_NAME[match[1].toLowerCase().slice(0, 3)];
    if (month) found = whole(fullYear(match[3]), month, Number(match[2]));
  }
  if (found) return found;

  const year = /(19|20)\d{2}/.exec(text);
  return { yearOfBirth: year ? year[0] : '', dateOfBirth: '' };
}
