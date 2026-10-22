/**
 * iCalendar (RFC 5545) builder for the schedule email's invite attachment.
 *
 * Mirrors src/lib/calendarLinks.ts in the web app — same floating-time rule
 * (season_events has no timezone anywhere in the schema, and a 6pm practice is
 * 6pm at the rink), same UID convention, so an event added from a screen and
 * the same event arriving by email are one entry in the recipient's calendar
 * rather than two.
 *
 * Attaching this with METHOD:REQUEST is what makes Gmail, Outlook and Apple
 * Mail render their own Yes/Maybe/No buttons and file the event on accept.
 * Whether they do is entirely up to the client, which is why the email also
 * carries our own RSVP links — those are the path that reliably reaches the
 * database.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM-DD, for a multi-day event. Defaults to `date`. */
  endDate?: string;
  /** HH:MM, 24-hour. Absent means all-day. */
  startTime?: string;
  endTime?: string;
  location?: string;
  description?: string;
  url?: string;
  sequence?: number;
  organizer?: { name?: string; email: string };
  attendee?: { name?: string; email: string };
}

const DEFAULT_DURATION_MINUTES = 60;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parseTime(time: string): { hours: number; minutes: number } | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** End of the event: explicit end time, else an hour on, rolling past midnight. */
function resolveEnd(event: IcsEvent): { date: string; time?: string } {
  const lastDay = event.endDate && event.endDate > event.date ? event.endDate : event.date;
  if (!event.startTime) return { date: lastDay };
  if (lastDay !== event.date) {
    // A multi-day event ends on its last day, at its end time if it has one
    // (a timed start needs a timed end, so the end of that day otherwise).
    const parsed = event.endTime ? parseTime(event.endTime) : null;
    return { date: lastDay, time: parsed ? `${pad(parsed.hours)}:${pad(parsed.minutes)}` : '23:59' };
  }
  if (event.endTime) {
    const parsed = parseTime(event.endTime);
    const start = parseTime(event.startTime);
    if (parsed) {
      // An end at or before the start is an overnight event: it ends the next day.
      const overnight = !!start && parsed.hours * 60 + parsed.minutes <= start.hours * 60 + start.minutes;
      return {
        date: overnight ? addDays(event.date, 1) : event.date,
        time: `${pad(parsed.hours)}:${pad(parsed.minutes)}`,
      };
    }
  }
  const start = parseTime(event.startTime);
  if (!start) return { date: event.date };
  const total = start.hours * 60 + start.minutes + DEFAULT_DURATION_MINUTES;
  const dayShift = Math.floor(total / (24 * 60));
  const mins = total % (24 * 60);
  return {
    date: dayShift > 0 ? addDays(event.date, dayShift) : event.date,
    time: `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`,
  };
}

function stamp(date: string, time?: string): string {
  if (!time) return compactDate(date);
  const parsed = parseTime(time);
  if (!parsed) return compactDate(date);
  return `${compactDate(date)}T${pad(parsed.hours)}${pad(parsed.minutes)}00`;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** RFC 5545 caps content lines at 75 octets; Outlook desktop enforces it. */
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

/** The VEVENT block for one event, without the surrounding VCALENDAR. */
function eventLines(event: IcsEvent, extra: { cancelled?: boolean } = {}): string[] {
  const end = resolveEnd(event);
  const allDay = !event.startTime;
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const lines: string[] = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${now}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    allDay ? `DTSTART;VALUE=DATE:${stamp(event.date)}` : `DTSTART:${stamp(event.date, event.startTime)}`,
    allDay
      ? `DTEND;VALUE=DATE:${compactDate(addDays(end.date, 1))}`
      : `DTEND:${stamp(end.date, end.time)}`,
    `SUMMARY:${escapeText(event.title)}`,
  ];

  const description = [event.description, event.url].filter(Boolean).join('\n\n');
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.url) lines.push(`URL:${event.url}`);

  if (event.organizer) {
    const cn = event.organizer.name ? `;CN=${escapeText(event.organizer.name)}` : '';
    lines.push(`ORGANIZER${cn}:mailto:${event.organizer.email}`);
  }
  if (event.attendee) {
    const cn = event.attendee.name ? `;CN=${escapeText(event.attendee.name)}` : '';
    lines.push(
      `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE${cn}:mailto:${event.attendee.email}`,
    );
  }

  lines.push(extra.cancelled ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED', 'END:VEVENT');
  return lines;
}

export function buildIcs(event: IcsEvent, method: 'PUBLISH' | 'REQUEST' | 'CANCEL' = 'REQUEST'): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SquadOwl//Season Schedule//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    ...eventLines(event, { cancelled: method === 'CANCEL' }),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n');
}

/**
 * A whole season as one calendar. Served from the season-calendar-feed function
 * for subscribers (a subscribed calendar re-reads it on a schedule, which is
 * how an added, edited or deleted event reaches everyone) and attached to the
 * one digest email for people who would rather import than subscribe.
 */
export function buildIcsCalendar(events: IcsEvent[], name: string, method: 'PUBLISH' | 'REQUEST' = 'PUBLISH'): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SquadOwl//Season Schedule//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    `X-WR-CALNAME:${escapeText(name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...events.flatMap((e) => eventLines(e)),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n');
}

/** Google Calendar template URL — no trailing Z, so it lands in the viewer's own timezone. */
export function googleCalendarUrl(event: IcsEvent): string {
  const end = resolveEnd(event);
  const allDay = !event.startTime;
  const dates = allDay
    ? `${compactDate(event.date)}/${compactDate(addDays(end.date, 1))}`
    : `${stamp(event.date, event.startTime)}/${stamp(end.date, end.time)}`;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: event.title, dates });
  if (event.location) params.set('location', event.location);
  const description = [event.description, event.url].filter(Boolean).join('\n\n');
  if (description) params.set('details', description);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook on the web. */
export function outlookCalendarUrl(event: IcsEvent): string {
  const end = resolveEnd(event);
  const allDay = !event.startTime;
  const params = new URLSearchParams({
    rru: 'addevent',
    path: '/calendar/action/compose',
    subject: event.title,
    startdt: allDay ? event.date : `${event.date}T${event.startTime}:00`,
    enddt: allDay ? addDays(end.date, 1) : `${end.date}T${end.time}:00`,
  });
  if (allDay) params.set('allday', 'true');
  if (event.location) params.set('location', event.location);
  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
}

/** Base64 for the SendGrid attachment, UTF-8 safe. */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
