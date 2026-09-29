/**
 * Month-grid helpers for the season calendar. Dates are plain "YYYY-MM-DD"
 * strings throughout, never Date-parsed from a string, so a timezone can't
 * shift an event onto the neighbouring day.
 */

const pad = (n: number) => String(n).padStart(2, '0');

export const toDateKey = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

export const todayKey = () => {
  const d = new Date();
  return toDateKey(d.getFullYear(), d.getMonth(), d.getDate());
};

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weeks of a month, Sunday first; days outside the month are null. */
export function buildMonthGrid(year: number, month: number): (string | null)[][] {
  const leading = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array<null>(leading).fill(null),
    ...Array.from({ length: days }, (_, i) => toDateKey(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Shift a {year, month} by whole months. */
export function addMonths(year: number, month: number, delta: number) {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** Events keyed by every day they cover (multi-day events fill each day, capped at 62). */
export function eventsByDay<T extends { date: string; endDate?: string }>(events: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const ev of events) {
    const start = ev.date.slice(0, 10);
    const end = ev.endDate && ev.endDate.slice(0, 10) > start ? ev.endDate.slice(0, 10) : start;
    let [y, m, d] = start.split('-').map(Number);
    for (let i = 0; i < 62; i++) {
      const key = toDateKey(y, m - 1, d);
      (out[key] ??= []).push(ev);
      if (key >= end) break;
      const next = new Date(y, m - 1, d + 1);
      y = next.getFullYear();
      m = next.getMonth() + 1;
      d = next.getDate();
    }
  }
  return out;
}
