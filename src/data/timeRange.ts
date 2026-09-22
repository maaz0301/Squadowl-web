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
