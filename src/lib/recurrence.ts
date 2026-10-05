/**
 * Repeating events: expands "every Tuesday and Thursday until Dec 15" into the
 * list of dates a coach would otherwise have typed in one at a time.
 *
 * Works on YYYY-MM-DD strings through UTC arithmetic so a daylight-saving
 * change or the device's timezone can never shift an event onto the wrong day.
 */

/** Most events one save may create, so a mistyped end date cannot create thousands. */
export const MAX_RECURRING_EVENTS = 100;

/** 0 = Sunday ... 6 = Saturday, matching Date#getUTCDay. */
export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function parse(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function format(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Day of the week for a YYYY-MM-DD date, 0 = Sunday. */
export function weekdayOf(date: string): number | null {
  return parse(date)?.getUTCDay() ?? null;
}

/** Whole days from `a` to `b`. */
export function daysBetween(a: string, b: string): number {
  const da = parse(a);
  const db = parse(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

export function addDaysIso(date: string, days: number): string {
  const d = parse(date);
  if (!d) return date;
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

/**
 * Every date from `start` through `until` that falls on one of `weekdays`.
 * `start` is always included, even when its weekday was not ticked, because the
 * coach chose that date explicitly. Returns just `[start]` when there is no
 * usable repeat, and never more than MAX_RECURRING_EVENTS dates.
 */
export function expandRecurrence(
  start: string,
  weekdays: number[] | undefined,
  until: string | undefined,
): string[] {
  const first = parse(start);
  const last = until ? parse(until) : null;
  if (!first || !last || !weekdays?.length || last < first) return [start];

  const days = new Set(weekdays);
  const dates = [start];
  const cursor = new Date(first);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= last && dates.length < MAX_RECURRING_EVENTS) {
    if (days.has(cursor.getUTCDay())) dates.push(format(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

interface RepeatableForm {
  date: string;
  endDate?: string;
  repeatWeekdays?: number[];
  repeatUntil?: string;
}

/**
 * One form per date the event repeats on. A multi-day event keeps its length on
 * every repeat (its end date moves with its start), and the repeat fields are
 * dropped so what is saved is a plain event.
 */
export function expandEventForms<T extends RepeatableForm>(form: T): Omit<T, 'repeatWeekdays' | 'repeatUntil'>[] {
  const { repeatWeekdays, repeatUntil, ...base } = form;
  const dates = expandRecurrence(form.date, repeatWeekdays, repeatUntil);
  const spanDays = form.endDate ? daysBetween(form.date, form.endDate) : 0;
  return dates.map((date) => ({
    ...base,
    date,
    ...(form.endDate ? { endDate: addDaysIso(date, spanDays) } : {}),
  }));
}
