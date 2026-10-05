/**
 * "Add to calendar" for a season event — Google/Outlook deep links and an
 * RFC 5545 iCalendar file.
 *
 * Times here are deliberately *floating*: `season_events` stores `event_date`
 * as a date and `start_time`/`end_time` as bare `HH:MM` text with no timezone
 * anywhere in the schema, and a 6pm practice is 6pm at the rink. Emitting
 * DTSTART without a `Z` or a TZID is exactly that — every calendar client reads
 * it in its own local time — so a copied event stays on the clock the coach
 * typed instead of being shifted by whatever timezone we guessed at.
 */

export interface CalendarEvent {
  /**
   * Stable across re-sends. Calendar clients treat UID as the identity of the
   * event, so reusing the season event's own id means a second invite updates
   * the copy already in someone's calendar rather than adding a duplicate.
   */
  uid: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM-DD, for a multi-day event. Defaults to `date`. */
  endDate?: string;
  /** HH:MM, 24-hour. Absent means an all-day event. */
  startTime?: string;
  /** HH:MM, 24-hour. Absent defaults to one hour after `startTime`. */
  endTime?: string;
  location?: string;
  description?: string;
  /**
   * Bumped on every re-send of an already-invited event. A client only accepts
   * an update whose SEQUENCE is higher than the copy it holds.
   */
  sequence?: number;
  organizer?: { name?: string; email: string };
  attendee?: { name?: string; email: string };
  /** Link back into the app, appended to the description. */
  url?: string;
}

const DEFAULT_DURATION_MINUTES = 60;

/** An event with no start time is an all-day entry. */
export function isAllDay(event: CalendarEvent): boolean {
  return !event.startTime;
}

function parseTime(time: string): { hours: number; minutes: number } | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD → YYYYMMDD. Anything unparseable comes back as-is, minus dashes. */
function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

/** Adds whole days to a YYYY-MM-DD string without going through a local Date. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * The event's end, resolved. Falls back to one hour after the start, rolling
 * into the following day when that crosses midnight — a 23:30 game must not
 * come out with an end time earlier than its start.
 */
export function resolveEnd(event: CalendarEvent): { date: string; time?: string } {
  const endDate = event.endDate || event.date;
  if (isAllDay(event)) return { date: endDate };

  if (event.endTime) {
    const parsed = parseTime(event.endTime);
    if (parsed) return { date: endDate, time: `${pad(parsed.hours)}:${pad(parsed.minutes)}` };
  }

  const start = parseTime(event.startTime!);
  if (!start) return { date: endDate };

  const total = start.hours * 60 + start.minutes + DEFAULT_DURATION_MINUTES;
  const dayShift = Math.floor(total / (24 * 60));
  const mins = total % (24 * 60);
  return {
    date: dayShift > 0 ? addDays(endDate, dayShift) : endDate,
    time: `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`,
  };
}

/** YYYY-MM-DD + HH:MM → YYYYMMDDTHHMMSS (floating local time, no Z). */
function icsStamp(date: string, time?: string): string {
  if (!time) return compactDate(date);
  const parsed = parseTime(time);
  if (!parsed) return compactDate(date);
  return `${compactDate(date)}T${pad(parsed.hours)}${pad(parsed.minutes)}00`;
}

/** RFC 5545 text escaping: backslash, semicolon, comma and newlines. */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 requires content lines to be folded at 75 octets. Long locations and
 * coach notes routinely exceed that, and an unfolded line is a parse error in
 * strict clients (Outlook desktop among them).
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(` ${rest}`);
  return parts.join('\r\n');
}

function describe(event: CalendarEvent): string | undefined {
  const parts = [event.description, event.url].filter(Boolean) as string[];
  return parts.length ? parts.join('\n\n') : undefined;
}

export type IcsMethod = 'PUBLISH' | 'REQUEST' | 'CANCEL';

/**
 * Build the .ics body.
 *
 * `METHOD:REQUEST` (with an ORGANIZER and an ATTENDEE carrying RSVP=TRUE) is
 * what makes Gmail, Outlook and Apple Mail render their own Yes/Maybe/No
 * buttons on the message and file the event on accept. `PUBLISH` is the plain
 * "here is an event" form used by the in-app download button, where there is
 * nobody to reply to.
 */
export function buildIcs(event: CalendarEvent, method: IcsMethod = 'PUBLISH'): string {
  const end = resolveEnd(event);
  const allDay = isAllDay(event);
  const stampNow = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TryoutHQ//Season Schedule//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stampNow}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    allDay
      ? `DTSTART;VALUE=DATE:${icsStamp(event.date)}`
      : `DTSTART:${icsStamp(event.date, event.startTime)}`,
    // An all-day DTEND is exclusive, so a single-day event ends the next day.
    allDay
      ? `DTEND;VALUE=DATE:${compactDate(addDays(end.date, 1))}`
      : `DTEND:${icsStamp(end.date, end.time)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];

  const description = describe(event);
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.url) lines.push(`URL:${event.url}`);

  if (event.organizer) {
    const cn = event.organizer.name ? `;CN=${escapeIcsText(event.organizer.name)}` : '';
    lines.push(`ORGANIZER${cn}:mailto:${event.organizer.email}`);
  }
  if (event.attendee) {
    const cn = event.attendee.name ? `;CN=${escapeIcsText(event.attendee.name)}` : '';
    lines.push(
      `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE${cn}:mailto:${event.attendee.email}`,
    );
  }

  lines.push('STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR');

  return lines.map(foldLine).join('\r\n');
}

/**
 * Google Calendar's event-template URL. `dates` is given without a trailing Z
 * so Google places it in the viewer's own calendar timezone — the floating
 * behaviour described at the top of this file.
 */
export function googleCalendarUrl(event: CalendarEvent): string {
  const end = resolveEnd(event);
  const allDay = isAllDay(event);
  const dates = allDay
    ? `${compactDate(event.date)}/${compactDate(addDays(end.date, 1))}`
    : `${icsStamp(event.date, event.startTime)}/${icsStamp(end.date, end.time)}`;

  const params = new URLSearchParams({ action: 'TEMPLATE', text: event.title, dates });
  const description = describe(event);
  if (description) params.set('details', description);
  if (event.location) params.set('location', event.location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook on the web (outlook.live.com for personal, office.com for work). */
export function outlookCalendarUrl(
  event: CalendarEvent,
  flavor: 'live' | 'office' = 'live',
): string {
  const end = resolveEnd(event);
  const allDay = isAllDay(event);
  const host = flavor === 'office' ? 'https://outlook.office.com' : 'https://outlook.live.com';

  const params = new URLSearchParams({
    rru: 'addevent',
    path: '/calendar/action/compose',
    subject: event.title,
    startdt: allDay ? event.date : `${event.date}T${event.startTime}:00`,
    enddt: allDay ? addDays(end.date, 1) : `${end.date}T${end.time}:00`,
  });
  if (allDay) params.set('allday', 'true');
  const description = describe(event);
  if (description) params.set('body', description);
  if (event.location) params.set('location', event.location);

  return `${host}/calendar/0/action/compose?${params.toString()}`;
}

/** A filename-safe .ics name derived from the event title. */
export function icsFilename(event: CalendarEvent): string {
  const slug = event.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${slug || 'event'}-${event.date}.ics`;
}

/**
 * Hand the .ics to the browser as a download. Apple Calendar, Outlook desktop
 * and every other client import it; only Google and Outlook Web get their own
 * deep links above.
 */
export function downloadIcs(event: CalendarEvent): void {
  const blob = new Blob([buildIcs(event, 'PUBLISH')], {
    type: 'text/calendar;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = icsFilename(event);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: revoking synchronously races the click in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ---------------------------------------------------------------------------
// Whole-season subscription
//
// A single-event copy is a snapshot. Subscribing to the season's feed is what
// keeps a personal calendar in step: the calendar app re-reads the feed on its
// own schedule, so events the coach adds, moves or deletes later show up (or
// disappear) for players, guardians and coaches alike with nothing re-sent.
// ---------------------------------------------------------------------------

/** https feed URL → webcal://, which Apple Calendar and most desktop clients treat as "subscribe". */
export function webcalUrl(feedUrl: string): string {
  return feedUrl.replace(/^https?:/i, 'webcal:');
}

/** Google Calendar's "add by URL" screen, prefilled with the feed. */
export function googleSubscribeUrl(feedUrl: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(feedUrl))}`;
}

/** Outlook on the web's "subscribe from web" screen, prefilled with the feed. */
export function outlookSubscribeUrl(
  feedUrl: string,
  name: string,
  flavor: 'live' | 'office' = 'live',
): string {
  const host = flavor === 'office' ? 'https://outlook.office.com' : 'https://outlook.live.com';
  return `${host}/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${encodeURIComponent(name)}`;
}
