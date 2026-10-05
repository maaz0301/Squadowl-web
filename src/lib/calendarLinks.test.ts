import { describe, expect, it } from 'vitest';

import {
  buildIcs,
  googleCalendarUrl,
  icsFilename,
  isAllDay,
  outlookCalendarUrl,
  resolveEnd,
  type CalendarEvent,
} from './calendarLinks';

const base: CalendarEvent = {
  uid: 'event-1@tryouthq.ca',
  title: 'Practice',
  date: '2026-09-15',
  startTime: '18:00',
  location: 'Main Rink',
};

/** ICS content lines, unfolded, for easy assertion. */
function lines(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n');
}

describe('resolveEnd', () => {
  it('uses the explicit end time when there is one', () => {
    expect(resolveEnd({ ...base, endTime: '19:30' })).toEqual({ date: '2026-09-15', time: '19:30' });
  });

  it('defaults to an hour after the start', () => {
    expect(resolveEnd(base)).toEqual({ date: '2026-09-15', time: '19:00' });
  });

  it('rolls into the next day when the default hour crosses midnight', () => {
    expect(resolveEnd({ ...base, startTime: '23:30' })).toEqual({
      date: '2026-09-16',
      time: '00:30',
    });
  });

  it('carries no time for an all-day event', () => {
    const allDay = { ...base, startTime: undefined };
    expect(isAllDay(allDay)).toBe(true);
    expect(resolveEnd(allDay)).toEqual({ date: '2026-09-15' });
  });
});

describe('buildIcs', () => {
  it('emits a floating DTSTART — no Z, no TZID', () => {
    const out = lines(buildIcs(base));
    expect(out).toContain('DTSTART:20260915T180000');
    expect(out).toContain('DTEND:20260915T190000');
    expect(out.some((l) => l.startsWith('DTSTART') && l.includes('Z'))).toBe(false);
  });

  it('writes an all-day event with an exclusive end date', () => {
    const out = lines(buildIcs({ ...base, startTime: undefined }));
    expect(out).toContain('DTSTART;VALUE=DATE:20260915');
    expect(out).toContain('DTEND;VALUE=DATE:20260916');
  });

  it('escapes commas, semicolons and newlines in text fields', () => {
    const out = lines(
      buildIcs({ ...base, title: 'Game; vs Kings, away', description: 'Line one\nLine two' }),
    );
    expect(out).toContain('SUMMARY:Game\\; vs Kings\\, away');
    expect(out).toContain('DESCRIPTION:Line one\\nLine two');
  });

  it('folds content lines longer than 75 octets', () => {
    const ics = buildIcs({ ...base, location: 'A'.repeat(200) });
    const raw = ics.split('\r\n');
    expect(raw.every((l) => l.length <= 75)).toBe(true);
    // Unfolding restores the original value.
    expect(lines(ics).some((l) => l === `LOCATION:${'A'.repeat(200)}`)).toBe(true);
  });

  it('carries organizer, attendee and RSVP=TRUE for a REQUEST', () => {
    const out = lines(
      buildIcs(
        {
          ...base,
          sequence: 2,
          organizer: { name: 'TryoutHQ', email: 'noreply@tryouthq.ca' },
          attendee: { name: 'Sam Guardian', email: 'sam@example.com' },
        },
        'REQUEST',
      ),
    );
    expect(out).toContain('METHOD:REQUEST');
    expect(out).toContain('SEQUENCE:2');
    expect(out).toContain('ORGANIZER;CN=TryoutHQ:mailto:noreply@tryouthq.ca');
    expect(out).toContain(
      'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Sam Guardian:mailto:sam@example.com',
    );
  });

  it('leaves out the attendee block entirely for a plain PUBLISH', () => {
    const out = lines(buildIcs(base, 'PUBLISH'));
    expect(out).toContain('METHOD:PUBLISH');
    expect(out.some((l) => l.startsWith('ATTENDEE'))).toBe(false);
  });

  it('reuses the event id as UID so a re-send updates rather than duplicates', () => {
    expect(lines(buildIcs(base))).toContain('UID:event-1@tryouthq.ca');
  });
});

describe('googleCalendarUrl', () => {
  it('passes a local-time range', () => {
    const url = new URL(googleCalendarUrl(base));
    expect(url.searchParams.get('dates')).toBe('20260915T180000/20260915T190000');
    expect(url.searchParams.get('text')).toBe('Practice');
    expect(url.searchParams.get('location')).toBe('Main Rink');
  });

  it('uses date-only, end-exclusive range for an all-day event', () => {
    const url = new URL(googleCalendarUrl({ ...base, startTime: undefined }));
    expect(url.searchParams.get('dates')).toBe('20260915/20260916');
  });
});

describe('outlookCalendarUrl', () => {
  it('formats ISO local datetimes', () => {
    const url = new URL(outlookCalendarUrl(base));
    expect(url.host).toBe('outlook.live.com');
    expect(url.searchParams.get('startdt')).toBe('2026-09-15T18:00:00');
    expect(url.searchParams.get('enddt')).toBe('2026-09-15T19:00:00');
  });

  it('targets office.com for the work flavour', () => {
    expect(new URL(outlookCalendarUrl(base, 'office')).host).toBe('outlook.office.com');
  });

  it('marks all-day events', () => {
    const url = new URL(outlookCalendarUrl({ ...base, startTime: undefined }));
    expect(url.searchParams.get('allday')).toBe('true');
  });
});

describe('icsFilename', () => {
  it('slugifies the title and appends the date', () => {
    expect(icsFilename({ ...base, title: 'Game vs. Kings!' })).toBe('game-vs-kings-2026-09-15.ics');
  });

  it('falls back when the title has nothing slug-worthy in it', () => {
    expect(icsFilename({ ...base, title: '!!!' })).toBe('event-2026-09-15.ics');
  });
});

describe('season subscription links', () => {
  const feed = 'https://abc.supabase.co/functions/v1/season-calendar-feed?token=sched_1234abcd';

  it('turns the feed into a webcal address', async () => {
    const { webcalUrl } = await import('./calendarLinks');
    expect(webcalUrl(feed)).toBe('webcal://abc.supabase.co/functions/v1/season-calendar-feed?token=sched_1234abcd');
  });

  it('prefills Google and Outlook with the feed', async () => {
    const { googleSubscribeUrl, outlookSubscribeUrl } = await import('./calendarLinks');
    expect(googleSubscribeUrl(feed)).toContain('calendar.google.com/calendar/r?cid=');
    expect(googleSubscribeUrl(feed)).toContain(encodeURIComponent('webcal://abc.supabase.co'));
    const outlook = outlookSubscribeUrl(feed, 'Wildcats schedule');
    expect(outlook).toContain('outlook.live.com/calendar/0/addfromweb?url=');
    expect(outlook).toContain(encodeURIComponent(feed));
    expect(outlook).toContain('name=Wildcats%20schedule');
  });
});
