/**
 * Helpers for entering a timed result as hours, minutes, seconds and tenths
 * instead of one decimal number. A rubric keeps its own unit ("sec", "min"),
 * so the entry is converted into that unit before it is stored.
 * Kept identical in both repos (src/lib/timeEntry.ts).
 */

export interface TimeParts {
  h: number;
  m: number;
  s: number;
  /** Tenths of a second, 0 to 9. */
  t: number;
}

export type TimeField = keyof TimeParts;

/** How many seconds one of a rubric's unit is: minutes and hours are recognised, anything else counts as seconds. */
export function unitSeconds(unit?: string): number {
  const u = (unit ?? '').trim().toLowerCase();
  if (['h', 'hr', 'hrs', 'hour', 'hours'].includes(u)) return 3600;
  if (['min', 'mins', 'minute', 'minutes'].includes(u)) return 60;
  return 1;
}

/** The value, in the rubric's unit, that these parts add up to. */
export function partsToValue(parts: TimeParts, unit?: string): number {
  const seconds = parts.h * 3600 + parts.m * 60 + parts.s + parts.t / 10;
  return Math.round((seconds / unitSeconds(unit)) * 100000) / 100000;
}

/** Splits a stored value (in the rubric's unit) back into hours, minutes, seconds and tenths. */
export function valueToParts(value: number | undefined, unit?: string): TimeParts {
  if (value == null || !isFinite(value) || value < 0) return { h: 0, m: 0, s: 0, t: 0 };
  const tenths = Math.round(value * unitSeconds(unit) * 10);
  const whole = Math.floor(tenths / 10);
  return { h: Math.floor(whole / 3600), m: Math.floor((whole % 3600) / 60), s: whole % 60, t: tenths % 10 };
}

/** "0:23.4" or "1:02:03.4": how a coach reads a time off a stopwatch. */
export function formatClock(value: number | undefined, unit?: string): string {
  const p = valueToParts(value, unit);
  const pad = (n: number) => String(n).padStart(2, '0');
  const tail = `${pad(p.s)}.${p.t}`;
  return p.h > 0 ? `${p.h}:${pad(p.m)}:${tail}` : `${p.m}:${tail}`;
}

/** Reads one typed field into a whole number within its range, ignoring anything that is not a digit. */
export function parseTimeField(text: string, field: TimeField): number {
  const n = parseInt(text.replace(/\D/g, ''), 10);
  if (isNaN(n)) return 0;
  return Math.min(field === 't' ? 9 : field === 'h' ? 99 : 59, n);
}

/**
 * Reads a typed time into the rubric's unit. Plain numbers are already in that
 * unit ("45" with sec, "1.5" with min); a clock reading such as "1:30" or
 * "0:15.5" is turned into seconds first, so a coach can type a range or a
 * benchmark the way a stopwatch shows it. NaN when it cannot be read.
 */
export function parseTimeText(text: string, unit?: string): number {
  const t = text.trim();
  if (!t.includes(':')) return parseFloat(t);
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p.trim()))) return NaN;
  const seconds = parts.reduce((total, p) => total * 60 + parseFloat(p), 0);
  return Math.round((seconds / unitSeconds(unit)) * 100000) / 100000;
}
