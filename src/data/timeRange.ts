/**
 * The rule every form with a start and an end time shares: when both are
 * filled in, the end has to come after the start. Equal is not after.
 *
 * Times are the 24-hour "HH:MM" strings the time picker produces, so they
 * compare as plain minutes. A blank or unreadable value means there is nothing
 * to compare yet, and passes — a form may legitimately have only one of them.
 */
export const END_BEFORE_START_MESSAGE = 'End time must be after the start time';

function minutesOf(value?: string): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function isEndAfterStart(start?: string, end?: string): boolean {
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s === null || e === null) return true;
  return e > s;
}

/**
 * Events are entered as a start plus a duration rather than an end clock time,
 * so a late start that runs past midnight needs no second date/time juggling.
 * Durations run in 15-minute steps up to six hours.
 */
export const DURATION_STEP_MIN = 15;
export const MAX_DURATION_MIN = 360;
export const DURATION_OPTIONS: number[] = Array.from(
  { length: MAX_DURATION_MIN / DURATION_STEP_MIN },
  (_, i) => (i + 1) * DURATION_STEP_MIN,
);

export function formatDuration(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  const hours = `${h} ${h === 1 ? 'hr' : 'hrs'}`;
  return m === 0 ? hours : `${hours} ${m} min`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcMinutes(date: string, time: string): number | null {
  const d = DATE_RE.exec(date);
  const t = minutesOf(time);
  if (!d || t === null) return null;
  return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])) / 60000 + t;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The end date and time for an event that starts at `date` `startTime` and lasts `durationMin`. */
export function endFromDuration(
  date: string,
  startTime: string,
  durationMin: number,
): { endDate: string; endTime: string } | null {
  const start = utcMinutes(date, startTime);
  if (start === null) return null;
  const end = new Date((start + durationMin) * 60000);
  return {
    endDate: `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`,
    endTime: `${pad2(end.getUTCHours())}:${pad2(end.getUTCMinutes())}`,
  };
}

/**
 * The duration an existing event already has, when it fits the picker's steps;
 * null for an event with no end, or one saved before durations existed whose
 * length isn't one of the options (its end time is then left untouched).
 */
export function durationOf(
  date: string,
  startTime?: string,
  endDate?: string,
  endTime?: string,
): number | null {
  if (!startTime || !endTime) return null;
  const start = utcMinutes(date, startTime);
  const end = utcMinutes(endDate || date, endTime);
  if (start === null || end === null) return null;
  const diff = end - start;
  return DURATION_OPTIONS.includes(diff) ? diff : null;
}
