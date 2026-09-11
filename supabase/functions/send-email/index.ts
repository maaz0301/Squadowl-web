
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import {
  buildIcs,
  googleCalendarUrl,
  outlookCalendarUrl,
  toBase64,
  type IcsEvent,
} from '../_shared/ics.ts';
import { hasMappableLocation, mapUrl } from '../_shared/maps.ts';

const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY') || '';
const FROM_EMAIL = Deno.env.get('SENDGRID_FROM_EMAIL') || 'noreply@tryouthq.ca';
const FROM_NAME = Deno.env.get('SENDGRID_FROM_NAME') || 'TryoutHQ';
// The shield mark, served from the web app's /public. Every email header
// points at it, so it lives in one place and can be repointed with an env var
// if the app ever moves domains.
const LOGO_URL =
  Deno.env.get('EMAIL_LOGO_URL') || 'https://tryouthq.ca/images/tryouthq_t_logo_v2.png';
// Where RSVP links point. Owned by the function rather than taken from the
// request on purpose: these URLs go out in mail we sign for tryouthq.ca, and a
// caller-supplied base would let anyone with a coach's session mail out links to
// a domain of their choosing.
const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') || 'https://tryouthq.ca').replace(/\/+$/, '');

// ─── Shared dark-theme HTML wrapper ─────────────────────────────────────────
/** Minimal HTML escaping for user-controlled strings (team/role names) dropped into template markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrap(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0f0f13;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f13;padding:40px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:16px 16px 0 0;padding:40px 40px 32px;text-align:center;">
        <!-- The brand lockup, matching the app's own header: shield mark beside
             the TryoutHQ wordmark. The wordmark is live text rather than part
             of the image so the brand still reads in the many clients that
             block remote images by default (the alt text covers the mark). -->
        <div style="margin-bottom:18px;">
          <img src="${LOGO_URL}" alt="TryoutHQ" width="48" height="48"
               style="display:inline-block;vertical-align:middle;width:48px;height:48px;border:0;outline:none;text-decoration:none;"/>
          <span style="display:inline-block;vertical-align:middle;margin-left:12px;color:#fff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">TryoutHQ</span>
        </div>
        <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">${title}</h1>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#1a1a2e;padding:36px 40px;border-left:1px solid #2a2a4a;border-right:1px solid #2a2a4a;">
        ${body}
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#111128;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;border:1px solid #2a2a4a;border-top:none;">
        <p style="margin:0 0 6px;color:#6366f1;font-size:14px;font-weight:600;">TryoutHQ</p>
        <p style="margin:0;color:#4b5563;font-size:12px;">© ${new Date().getFullYear()} TryoutHQ. All rights reserved.</p>
        <p style="margin:6px 0 0;color:#374151;font-size:11px;">If you did not expect this email, you can safely ignore it.</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

// ─── Templates ───────────────────────────────────────────────────────────────
function tplOrgInvite(role: string, password?: string) {
  const pwBlock = password ? `
    <div style="background:#0f0f13;border:1px solid #6366f1;border-radius:12px;padding:24px;margin:24px 0;text-align:center;">
      <p style="margin:0 0 8px;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Temporary Password</p>
      <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:8px;color:#a78bfa;font-family:monospace;">${password}</p>
    </div>
    <p style="color:#f59e0b;font-size:13px;margin:0 0 24px;padding:12px 16px;background:#1c1200;border-radius:8px;border-left:3px solid #f59e0b;">
      ⚠️ Please change this password after your first login for security.
    </p>` : '';
  return {
    subject: `You've been invited to join an Organization on TryoutHQ`,
    html: wrap("You're Invited! 🎉", `
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 20px;">
        You've been invited to join an organization on <strong style="color:#a78bfa;">TryoutHQ</strong> as a
        <span style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:2px 14px;border-radius:20px;font-size:14px;font-weight:600;">${role}</span>.
      </p>
      ${pwBlock}
      <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 8px;">
        Log in (or sign up with this email) to accept the invite and get started.
      </p>
    `),
  };
}

function tplTeamManagerInvite(teamName: string, role: string, password?: string) {
  const safeTeam = escapeHtml(teamName);
  const roleLabel = role === 'coach' ? 'Coach' : 'Manager';
  const pwBlock = password ? `
    <div style="background:#0f0f13;border:1px solid #6366f1;border-radius:12px;padding:24px;margin:24px 0;text-align:center;">
      <p style="margin:0 0 8px;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;">Temporary Password</p>
      <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:8px;color:#a78bfa;font-family:monospace;">${password}</p>
    </div>
    <p style="color:#f59e0b;font-size:13px;margin:0 0 24px;padding:12px 16px;background:#1c1200;border-radius:8px;border-left:3px solid #f59e0b;">
      ⚠️ Please change this password after your first login for security.
    </p>` : '';
  return {
    subject: `You've been added to ${safeTeam} on TryoutHQ`,
    html: wrap("You've Been Added to a Team! 🏒", `
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 20px;">
        You've been given access to manage <strong style="color:#a78bfa;">${safeTeam}</strong> on
        <strong style="color:#a78bfa;">TryoutHQ</strong> as its
        <span style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:2px 14px;border-radius:20px;font-size:14px;font-weight:600;">${roleLabel}</span>.
      </p>
      ${pwBlock}
      <div style="background:#0f0f13;border-radius:12px;padding:20px 24px;margin:20px 0;border-left:4px solid #6366f1;">
        <p style="color:#9ca3af;font-size:13px;margin:0 0 4px;">What you can do</p>
        <p style="color:#fff;font-size:15px;line-height:1.6;margin:0;">
          View and manage this team's roster, schedule, chat, and assessments — no access to anything else on the club's account.
        </p>
      </div>
      <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0;">
        Log in (or sign up with this email) to get started.
      </p>
    `),
  };
}

function tplTryoutInvite(tryoutName?: string, inviteUrl?: string, email?: string) {
  const safeName = tryoutName ? escapeHtml(tryoutName) : '';
  // The invite is claimed by email address the moment an account with that
  // address exists (link_assessor_to_user / handle_new_user), so this link
  // carries no token and no identifying data — it only has to land them on the
  // sign-in screen, which explains the rest.
  const cta = inviteUrl ? `
      <p style="margin:28px 0 8px;">
        <a href="${inviteUrl}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">
          Accept Invitation
        </a>
      </p>` : '';
  return {
    subject: safeName ? `You've been invited to assess ${safeName}` : `You've been invited as an Assessor`,
    html: wrap('You&#39;re Invited to Assess 📋', `
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 20px;">
        You've been invited to assess players${safeName ? ` for <strong style="color:#a78bfa;">${safeName}</strong>` : ' for an upcoming tryout'}.
      </p>
      <div style="background:#0f0f13;border-radius:12px;padding:20px 24px;margin:20px 0;border-left:4px solid #6366f1;">
        <p style="color:#9ca3af;font-size:13px;margin:0 0 4px;">Your role</p>
        <p style="color:#fff;font-size:17px;font-weight:600;margin:0;">⚡ Assessor</p>
      </div>
      <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0;">
        No account yet? Creating one takes a minute — sign up with
        ${email ? `<strong style="color:#a78bfa;">${escapeHtml(email)}</strong>` : 'this email address'}
        and this invitation will be waiting for you. Already have one? Just sign in with that address.
      </p>
      ${cta}
      <p style="color:#6b7280;font-size:13px;line-height:1.7;margin:16px 0 0;">
        Once you accept, you can view player rosters, submit scores and complete evaluations.
      </p>
    `),
  };
}

/**
 * A season event, announced.
 *
 * This used to be a bare notice — "here is an event" — with no way to answer it.
 * A guardian who lives in their inbox never RSVP'd at all, so the coach's
 * Availability tab stayed on 'pending' for exactly the people least likely to
 * open the app. It now carries two things it didn't:
 *
 *  1. RSVP links, one set per player this address is responsible for. They point
 *     at /rsvp/<token>, which writes the same event_availability row the in-app
 *     buttons write — so an answer from email is indistinguishable from an
 *     answer in the portal, and the coach sees it immediately.
 *  2. The event itself, as an attached iCalendar invite plus Google/Outlook
 *     links. Accepting the attachment in Gmail/Outlook/Apple Mail files it in
 *     the recipient's own calendar, and because the UID is the event's row id
 *     with a rising SEQUENCE, a later edit updates that copy instead of adding a
 *     second one.
 *
 * Note the division of labour: the attachment is what gets the event into a
 * personal calendar, and *our* links are what get the answer into the database.
 * Native accept/decline replies go back to the organizer as email and never
 * touch us, so they are a bonus, not the mechanism.
 */
interface SchedulePayload {
  eventId?: string;
  eventName?: string;
  date?: string;
  time?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  notes?: string;
  teamName?: string;
  seasonName?: string;
  sequence?: number;
  rsvps?: { playerName?: string; token?: string }[];
}

/** YYYY-MM-DD. Anything else means a caller that isn't announcing a real date. */
function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** "2026-09-15" → "Tue, Sep 15, 2026", built without a timezone to shift it. */
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

/** "18:00" → "6:00 PM". Left alone if it isn't a bare 24-hour time. */
function prettyTime(v?: string): string | undefined {
  if (!v) return undefined;
  const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  if (!m) return v;
  const h = Number(m[1]);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

function rsvpButton(url: string, label: string, gradient: string): string {
  return `<a href="${url}" style="display:inline-block;padding:11px 22px;margin:0 4px 8px 0;background:${gradient};color:#fff;text-decoration:none;border-radius:9px;font-size:15px;font-weight:700;">${label}</a>`;
}

function tplScheduleUpdate(payload: SchedulePayload, recipient: string) {
  const eventName = payload.eventName ?? 'New Event';
  const safeName = escapeHtml(eventName);
  const startTime = payload.startTime ?? payload.time;
  const dateIsReal = isIsoDate(payload.date);

  const dateLabel = dateIsReal ? prettyDate(payload.date!) : payload.date;
  const timeLabel = dateIsReal ? prettyTime(startTime) : startTime;
  const endLabel = dateIsReal ? prettyTime(payload.endTime) : undefined;

  const row = (icon: string, label: string, value?: string) =>
    value
      ? `<tr><td style="color:#9ca3af;padding:8px 0;font-size:14px;width:100px;">${icon} ${label}</td><td style="color:#fff;font-weight:600;padding:8px 0;font-size:14px;">${escapeHtml(value)}</td></tr>`
      : '';

  // The location doubles as its own map link. A guardian reading this on a
  // phone the morning of the game wants navigation, not an address to retype —
  // and unlike the .ics attachment, which only some clients hand to a map app,
  // this works in every mail reader.
  const mappable = hasMappableLocation(payload.location);
  const directionsHref = mappable ? mapUrl(payload.location!) : '';
  const locationRow = mappable
    ? `<tr><td style="color:#9ca3af;padding:8px 0;font-size:14px;width:100px;">📍 Location</td><td style="padding:8px 0;font-size:14px;"><a href="${directionsHref}" style="color:#a78bfa;font-weight:600;text-decoration:underline;">${escapeHtml(payload.location!)}</a></td></tr>`
    : row('📍', 'Location', payload.location);

  const rows = [
    row('📅', 'Date', dateLabel),
    row('🕐', 'Time', endLabel ? `${timeLabel} – ${endLabel}` : timeLabel),
    locationRow,
    row('🏒', 'Team', payload.teamName),
  ].join('');

  // Repeated as a button under the details, because a link inside a table row
  // is easy to miss and this is the one thing most recipients come back to the
  // email for.
  const directionsBlock = mappable
    ? `<p style="margin:14px 0 0;"><a href="${directionsHref}" style="display:inline-block;padding:11px 22px;background:linear-gradient(135deg,#4338ca,#6366f1);color:#fff;text-decoration:none;border-radius:9px;font-size:15px;font-weight:700;">📍 Get directions</a></p>`
    : '';

  // The coach's own note about the event — kit, arrival time, directions. It
  // reaches the .ics description either way, but a guardian reading the email on
  // a phone shouldn't have to open a calendar entry to find out to bring gear.
  const notesBlock = payload.notes
    ? `<p style="color:#9ca3af;font-size:14px;line-height:1.7;margin:14px 0 0;padding-top:14px;border-top:1px solid #2a2a4a;white-space:pre-line;">${escapeHtml(payload.notes)}</p>`
    : '';

  // ── RSVP ──────────────────────────────────────────────────────────────────
  // One block per player at this address: a guardian with two kids on the team
  // gets one email and two questions, rather than two near-identical emails.
  const rsvps = (payload.rsvps ?? []).filter((r) => !!r.token);
  const rsvpBlock = rsvps.length
    ? `
      <div style="background:#0f0f13;border-radius:12px;padding:24px;margin:24px 0;border-left:4px solid #6366f1;">
        <p style="color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 16px;font-weight:600;">Can they make it?</p>
        ${rsvps
          .map((r) => {
            const base = `${APP_BASE_URL}/rsvp/${encodeURIComponent(r.token!)}`;
            const who = r.playerName ? escapeHtml(r.playerName) : 'your player';
            return `
        <p style="color:#fff;font-size:15px;font-weight:600;margin:0 0 10px;">${who}</p>
        <p style="margin:0 0 18px;">
          ${rsvpButton(`${base}?r=yes`, '✓ Yes', 'linear-gradient(135deg,#059669,#10b981)')}
          ${rsvpButton(`${base}?r=maybe`, '? Maybe', 'linear-gradient(135deg,#b45309,#f59e0b)')}
          ${rsvpButton(`${base}?r=no`, '✕ No', 'linear-gradient(135deg,#b91c1c,#ef4444)')}
        </p>`;
          })
          .join('')}
        <p style="color:#6b7280;font-size:12px;line-height:1.6;margin:4px 0 0;">
          One tap — no login needed. You can change your answer any time by tapping again.
        </p>
      </div>`
    : '';

  // ── Calendar ──────────────────────────────────────────────────────────────
  // Only for a real dated event; sendPublicSchedule reuses this template with
  // `date: 'View online'` to point at the season's share link, and there is no
  // single event there to put in anyone's calendar.
  let calendarBlock = '';
  let attachments: { content: string; filename: string; type: string; disposition: string }[] | undefined;

  if (dateIsReal) {
    const icsEvent: IcsEvent = {
      uid: `season-event-${payload.eventId ?? eventName}@tryouthq.ca`,
      title: payload.teamName ? `${eventName} (${payload.teamName})` : eventName,
      date: payload.date!,
      startTime: startTime || undefined,
      endTime: payload.endTime || undefined,
      location: payload.location || undefined,
      description: [payload.notes, payload.seasonName].filter(Boolean).join('\n'),
      sequence: payload.sequence ?? 0,
      organizer: { name: FROM_NAME, email: FROM_EMAIL },
      attendee: { email: recipient },
    };

    attachments = [
      {
        content: toBase64(buildIcs(icsEvent, 'REQUEST')),
        filename: 'invite.ics',
        // Bare MIME type only — no ';' — because SendGrid's v3 API rejects any
        // parameter on attachments[].type ("cannot contain ';'") and fails the
        // ENTIRE send with a 400, not just the attachment. That's how this got
        // broken: every schedule_update, RSVP buttons and all, silently stopped
        // going out the moment this carried `; method=REQUEST; charset=UTF-8`.
        // The one place `method=REQUEST` actually needs to appear is inside the
        // .ics body itself (`METHOD:REQUEST`, set via buildIcs above) — that's
        // the property RFC 5546-aware clients (Gmail, Apple Mail) read to offer
        // their own accept/decline UI; the outer Content-Type header is not
        // load-bearing for those two. Outlook desktop can be a partial
        // exception, but SendGrid's REST attachments endpoint gives no way to
        // add MIME parameters here, so a bare type is what's achievable.
        type: 'text/calendar',
        disposition: 'attachment',
      },
    ];

    calendarBlock = `
      <div style="background:#0f0f13;border-radius:12px;padding:20px 24px;margin:8px 0 0;border:1px solid #2a2a4a;">
        <p style="color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 14px;font-weight:600;">Add it to your calendar</p>
        <p style="margin:0 0 12px;">
          <a href="${googleCalendarUrl(icsEvent)}" style="display:inline-block;padding:9px 16px;margin:0 6px 8px 0;background:#1a1a2e;border:1px solid #6366f1;color:#a78bfa;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Google Calendar</a>
          <a href="${outlookCalendarUrl(icsEvent)}" style="display:inline-block;padding:9px 16px;margin:0 6px 8px 0;background:#1a1a2e;border:1px solid #6366f1;color:#a78bfa;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Outlook</a>
        </p>
        <p style="color:#6b7280;font-size:12px;line-height:1.6;margin:0;">
          Using Apple Calendar or Outlook on your desktop? Open the <strong style="color:#9ca3af;">invite.ics</strong> attached to this email.
        </p>
      </div>`;
  }

  return {
    subject: dateIsReal ? `${eventName} — ${dateLabel}` : `Schedule Update: ${eventName}`,
    attachments,
    html: wrap('New Event Scheduled 📅', `
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 20px;">A new event has been added to your schedule:</p>
      <div style="background:#0f0f13;border-radius:12px;padding:24px;margin:16px 0;border:1px solid #2a2a4a;">
        <p style="color:#a78bfa;font-size:20px;font-weight:700;margin:0 0 16px;">${safeName}</p>
        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        ${directionsBlock}
        ${notesBlock}
      </div>
      ${rsvpBlock}
      ${calendarBlock}
    `),
  };
}

function tplReminder(title: string, message: string) {
  return {
    subject: `Reminder: ${title}`,
    html: wrap(`⏰ ${title}`, `
      <div style="background:linear-gradient(135deg,#1c1200,#1a1a2e);border-radius:12px;padding:24px;margin-bottom:24px;border-left:4px solid #f59e0b;">
        <p style="color:#fbbf24;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px;font-weight:600;">Reminder</p>
        <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0;">${message}</p>
      </div>
    `),
  };
}

/**
 * A player selection letter — the offer / roster-decision letter a coach wrote
 * on the Letters screen, already rendered for one player.
 *
 * Unlike every other template here, the wording is entirely the coach's, so
 * this one supplies the chrome and nothing else. The body arrives as plain text
 * with the coach's own line breaks: escaped (it is user-authored text going
 * into markup) and then split on blank lines into paragraphs, so a letter reads
 * the way it was typed instead of collapsing into one block.
 */
function tplTryoutLetter(subject: string, body: string) {
  const paragraphs = escapeHtml(body)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 18px;">${p.replace(/\n/g, '<br/>')}</p>`,
    )
    .join('');

  return {
    // Raw for the SendGrid header, escaped for the markup: the subject carries
    // a player's name, which is user-authored like the body.
    subject,
    html: wrap(escapeHtml(subject), paragraphs || '<p style="color:#d1d5db;font-size:16px;">(No message)</p>'),
  };
}

function tplRegistrationConfirm(playerName: string) {
  return {
    subject: `Registration Confirmed: ${playerName}`,
    html: wrap('Registration Confirmed ✓', `
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#065f46,#059669);border-radius:50%;width:64px;height:64px;font-size:30px;">✓</div>
      </div>
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 20px;text-align:center;">
        <strong style="color:#34d399;">${playerName}</strong> has been successfully registered!
      </p>
      <div style="background:#0f0f13;border-radius:12px;padding:20px 24px;margin:16px 0;border-left:4px solid #34d399;">
        <p style="color:#9ca3af;font-size:13px;margin:0 0 4px;">Registered Athlete</p>
        <p style="color:#fff;font-size:18px;font-weight:700;margin:0;">${playerName}</p>
      </div>
      <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:20px 0 0;">
        We've received all information and look forward to seeing them at the event. You'll be notified of any updates.
      </p>
    `),
  };
}

function tplPasswordReset(code: string) {
  return {
    subject: `Reset Your Password — TryoutHQ`,
    html: wrap('Reset Your Password 🔐', `
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 24px;">
        We received a request to reset your password. Use the verification code below — it expires shortly.
      </p>
      <div style="background:#0f0f13;border:1px solid #6366f1;border-radius:16px;padding:32px;margin:24px 0;text-align:center;">
        <p style="color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;font-weight:600;">Verification Code</p>
        <p style="margin:0;font-size:44px;font-weight:700;letter-spacing:10px;color:#a78bfa;font-family:monospace;">${code}</p>
      </div>
      <p style="color:#ef4444;font-size:13px;margin:0;padding:12px 16px;background:#1c0505;border-radius:8px;border-left:3px solid #ef4444;">
        🔒 If you did not request this reset, please ignore this email — your account remains secure.
      </p>
    `),
  };
}

function tplSubscriptionUpgraded(planTier: string) {
  const planName = planTier.charAt(0).toUpperCase() + planTier.slice(1);
  return {
    subject: `Welcome to ${planName} — TryoutHQ`,
    html: wrap('Subscription Upgraded 🚀', `
      <div style="background:#0f0f13;border:1px solid #10b981;border-radius:16px;padding:24px;margin-bottom:32px;text-align:center;">
        <p style="margin:0;color:#10b981;font-size:18px;font-weight:700;">✅ Successfully Upgraded to ${planName}</p>
      </div>
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 24px;">
        Thank you for upgrading! Your account has been instantly unlocked with all the premium features of the <strong>${planName}</strong> plan.
      </p>
      <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 24px;">
        You can now return to the app and start using your new features immediately. If you have any questions or need help setting up your new tools, our support team is always here for you.
      </p>
    `),
  };
}

function tplSubscriptionCanceled() {
  return {
    subject: `Subscription Canceled — TryoutHQ`,
    html: wrap('Subscription Canceled 😔', `
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 24px;">
        We've successfully processed your subscription cancellation. Your account has been downgraded to the Free plan.
      </p>
      <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 24px;">
        You will no longer be billed, but you can continue using all the features of the Free plan. If you ever change your mind, we'd love to have you back on a premium plan!
      </p>
      <div style="background:#1c0505;border-left:4px solid #ef4444;border-radius:0 8px 8px 0;padding:16px 20px;margin-top:12px;">
        <p style="color:#fca5a5;font-size:13px;line-height:1.5;margin:0;">
          If you did not request this cancellation, please contact our support team immediately to restore your account.
        </p>
      </div>
    `),
  };
}

/**
 * Team/player portal invite, sent by "Send Invites" on a team roster.
 *
 * Distinct from tplOrgInvite, which is the generic "you've joined an
 * organization" note and can say nothing about who the invite is for. A
 * guardian receiving that had no way to tell which of their children it
 * concerned, which team, or which club sent it — so this names all three, plus
 * the address to sign up with, since the invite is bound to that address.
 */
function tplPlayerInvite(
  playerName: string,
  teamName: string,
  recipientRole: string,
  clubName?: string,
  jersey?: string,
  position?: string,
  email?: string,
) {
  const safePlayer = escapeHtml(playerName);
  const safeTeam = escapeHtml(teamName);
  const isGuardian = recipientRole === 'Guardian';
  const row = (label: string, value?: string) =>
    value
      ? `<tr><td style="color:#9ca3af;padding:8px 0;font-size:14px;width:110px;">${label}</td><td style="color:#fff;font-weight:600;padding:8px 0;font-size:14px;">${escapeHtml(value)}</td></tr>`
      : '';
  const rows = [
    row('👤 Player', playerName),
    row('🏒 Team', teamName),
    row('🏛️ Club', clubName),
    row('🔢 Jersey', jersey ? `#${jersey}` : undefined),
    row('📍 Position', position),
  ].join('');

  return {
    subject: `${safePlayer} has been invited to ${safeTeam} on TryoutHQ`,
    html: wrap("You're Invited to the Team Portal 🏒", `
      <p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 20px;">
        ${isGuardian
          ? `You've been invited as a guardian of <strong style="color:#a78bfa;">${safePlayer}</strong> to the team portal for <strong style="color:#a78bfa;">${safeTeam}</strong>.`
          : `You've been invited to your team portal for <strong style="color:#a78bfa;">${safeTeam}</strong>.`}
      </p>

      <div style="background:#0f0f13;border-radius:12px;padding:20px 24px;margin:20px 0;border:1px solid #2a2a4a;">
        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </div>

      <div style="background:#0f0f13;border-radius:12px;padding:20px 24px;margin:20px 0;border-left:4px solid #6366f1;">
        <p style="color:#9ca3af;font-size:13px;margin:0 0 10px;">What you can do in the portal</p>
        <p style="color:#fff;font-size:15px;line-height:1.8;margin:0;">
          📅 See the full schedule and RSVP to games and practices<br/>
          📝 Keep contact and medical details up to date<br/>
          💬 Stay in touch with the coaching staff
        </p>
      </div>

      <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0;">
        Log in${email ? `, or sign up with <strong style="color:#a78bfa;">${escapeHtml(email)}</strong>,` : ' (or sign up with this email)'} to accept the invite and get started.
      </p>
    `),
  };
}

// ─── Main handler ────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { type, to, payload } = await req.json();

    if (!to || !type) throw new Error('Missing required fields (to, type)');

    let subject = 'Notification from TryoutHQ';
    let html = '<p>You have a new notification.</p>';
    // Only the schedule email carries one (the iCalendar invite); every other
    // template leaves this undefined and the field is dropped from the send.
    let attachments: { content: string; filename: string; type: string; disposition: string }[] | undefined;

    if (type === 'org_invite') ({ subject, html } = tplOrgInvite(payload?.role ?? 'Member', payload?.password));
    else if (type === 'player_invite') ({ subject, html } = tplPlayerInvite(
      payload?.playerName ?? 'A player',
      payload?.teamName ?? 'their team',
      payload?.role ?? 'Guardian',
      payload?.clubName,
      payload?.jersey,
      payload?.position,
      to,
    ));
    else if (type === 'team_manager_invite') ({ subject, html } = tplTeamManagerInvite(payload?.teamName ?? 'a team', payload?.role ?? 'manager', payload?.password));
    else if (type === 'tryout_invite') ({ subject, html } = tplTryoutInvite(payload?.tryoutName, payload?.inviteUrl, to));
    else if (type === 'schedule_update') ({ subject, html, attachments } = tplScheduleUpdate(payload ?? {}, to));
    else if (type === 'reminder') ({ subject, html } = tplReminder(payload?.title ?? 'Upcoming Event', payload?.message ?? 'This is a reminder for an upcoming event.'));
    else if (type === 'registration_confirmation') ({ subject, html } = tplRegistrationConfirm(payload?.playerName ?? 'Athlete'));
    else if (type === 'tryout_letter') ({ subject, html } = tplTryoutLetter(
      payload?.subject ?? 'A message from your coaching staff',
      payload?.body ?? '',
    ));
    else if (type === 'password_reset') ({ subject, html } = tplPasswordReset(payload?.code ?? '------'));
    else if (type === 'subscription_upgraded') ({ subject, html } = tplSubscriptionUpgraded(payload?.planTier ?? 'Pro'));
    else if (type === 'subscription_canceled') ({ subject, html } = tplSubscriptionCanceled());

    // Send via SendGrid's v3 API. tryouthq.ca is DKIM/SPF-authenticated there,
    // so mail from noreply@tryouthq.ca is signed for the domain. Content parts
    // are ordered plain-then-html: SendGrid requires increasing preference.
    const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: FROM_EMAIL, name: FROM_NAME },
        subject,
        content: [
          { type: 'text/plain', value: 'Please view this in an HTML email client.' },
          { type: 'text/html', value: html },
        ],
        ...(attachments?.length ? { attachments } : {}),
      }),
    });

    // A send succeeds with 202 and an empty body; failures carry a JSON error
    // list, which the catch below reports back to the caller unchanged.
    if (!sgRes.ok) {
      throw new Error(`SendGrid ${sgRes.status}: ${await sgRes.text()}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error';

  console.error('Edge Function Error:', message);

  return new Response(JSON.stringify({ error: message }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 400,
  });
}
});
