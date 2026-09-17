import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { json, requireFounder } from '../_shared/founder.ts';

/**
 * Founder console — Support & Content. founder@tryout.ca only.
 *
 *   send_support_email     reply on a support ticket, or start a new one
 *   broadcast_announcement email an announcement to every org's owners/admins
 *   email_activity         SendGrid Email Activity: what went out, delivered or not
 *   email_activity_detail  one message's event timeline (bounce reasons etc.)
 *
 * Everything that needs the SendGrid key lives here; ticket and announcement
 * bookkeeping that doesn't is RPCs (20260916140000_founder_support_content.sql).
 *
 * Email Activity needs SendGrid's "Additional Email Activity History" add-on on
 * the account; without it the API answers 400/403 and the page says so.
 */

const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY') || '';
const SUPPORT_EMAIL = Deno.env.get('SUPPORT_FROM_EMAIL') || 'support@tryouthq.ca';
const FROM_NAME = Deno.env.get('SENDGRID_FROM_NAME') || 'TryoutHQ';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const BROADCAST_BATCH = 500;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain text → simple HTML, paragraphs and line breaks kept. */
function renderHtml(heading: string, body: string, footer: string): string {
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:24px;background:#f5f5f7;font-family:'Segoe UI',Arial,sans-serif;color:#1f2937;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;">
<tr><td style="padding:32px;">
<h1 style="margin:0 0 20px;font-size:20px;">${escapeHtml(heading)}</h1>
${paragraphs}
<p style="margin:24px 0 0;color:#6b7280;font-size:13px;">${escapeHtml(footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

async function sendGrid(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok ? null : `SendGrid ${res.status}: ${await res.text()}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const auth = await requireFounder(req);
    if ('response' in auth) return auth.response;
    const { caller, admin } = auth;
    if (!SENDGRID_API_KEY) return json({ error: 'SENDGRID_API_KEY is not set for this function.' }, 500);

    const input = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '');

    switch (input.action) {
      // ─── Support reply / new outbound ticket ───────────────────────────
      case 'send_support_email': {
        const body = str('body');
        if (!body) return json({ error: 'Message is required.' }, 400);

        let ticketId = str('ticketId');
        let email: string;
        let subject: string;

        if (ticketId) {
          const { data: ticket, error } = await admin
            .from('support_tickets')
            .select('id, email, subject')
            .eq('id', ticketId)
            .maybeSingle();
          if (error) return json({ error: error.message }, 500);
          if (!ticket) return json({ error: 'Ticket not found.' }, 404);
          email = ticket.email;
          subject = /^re:/i.test(ticket.subject) ? ticket.subject : `Re: ${ticket.subject}`;
        } else {
          email = str('email').toLowerCase();
          subject = str('subject');
          if (!EMAIL_RE.test(email)) return json({ error: 'A valid email is required.' }, 400);
          if (!subject) return json({ error: 'Subject is required.' }, 400);
          const { data: profile } = await admin
            .from('profiles')
            .select('id')
            .ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`))
            .limit(1)
            .maybeSingle();
          const { data: created, error } = await admin
            .from('support_tickets')
            .insert({ email, subject, user_id: profile?.id ?? null })
            .select('id')
            .single();
          if (error) return json({ error: error.message }, 500);
          ticketId = created.id;
        }

        const deliveryError = await sendGrid({
          personalizations: [{ to: [{ email }] }],
          from: { email: SUPPORT_EMAIL, name: `${FROM_NAME} Support` },
          reply_to: { email: SUPPORT_EMAIL, name: `${FROM_NAME} Support` },
          subject,
          content: [
            { type: 'text/plain', value: body },
            { type: 'text/html', value: renderHtml(subject, body, `${FROM_NAME} Support · ${SUPPORT_EMAIL}`) },
          ],
          custom_args: { support_ticket_id: ticketId },
        });

        // Kept even when the send failed, so the founder sees what didn't go out.
        const { error: msgError } = await admin.from('support_messages').insert({
          ticket_id: ticketId,
          direction: 'outbound',
          body,
          author_email: caller.email,
          delivery_error: deliveryError,
        });
        if (msgError) console.error('founder-support: message insert failed', msgError);
        await admin.from('support_tickets').update({ updated_at: new Date().toISOString() }).eq('id', ticketId);

        if (deliveryError) return json({ error: deliveryError, ticketId }, 502);
        return json({ ok: true, ticketId });
      }

      // ─── Announcement email ────────────────────────────────────────────
      case 'broadcast_announcement': {
        const id = str('announcementId');
        const { data: announcement, error } = await admin
          .from('platform_announcements')
          .select('id, title, message, emailed_at')
          .eq('id', id)
          .maybeSingle();
        if (error) return json({ error: error.message }, 500);
        if (!announcement) return json({ error: 'Announcement not found.' }, 404);
        // One blast per announcement; a second click must not mail everyone twice.
        if (announcement.emailed_at) return json({ error: 'This announcement has already been emailed.' }, 409);

        const { data: rows, error: recipientsError } = await admin.rpc('founder_announcement_recipients');
        if (recipientsError) return json({ error: recipientsError.message }, 500);
        const recipients = ((rows ?? []) as { email: string }[]).map((r) => r.email).filter((e) => EMAIL_RE.test(e));
        if (!recipients.length) return json({ error: 'No organization owners or admins to email.' }, 400);

        // Claimed before sending so a concurrent request sees emailed_at set.
        const { data: claimed } = await admin
          .from('platform_announcements')
          .update({ emailed_at: new Date().toISOString(), email_recipient_count: recipients.length })
          .eq('id', id)
          .is('emailed_at', null)
          .select('id');
        if (!claimed?.length) return json({ error: 'This announcement has already been emailed.' }, 409);

        const html = renderHtml(announcement.title, announcement.message, `You're receiving this as an owner or admin of an organization on ${FROM_NAME}.`);
        let sent = 0;
        const failures: string[] = [];
        for (let i = 0; i < recipients.length; i += BROADCAST_BATCH) {
          const batch = recipients.slice(i, i + BROADCAST_BATCH);
          // One personalization per recipient, so nobody sees anyone else's address.
          const err = await sendGrid({
            personalizations: batch.map((email) => ({ to: [{ email }] })),
            from: { email: SUPPORT_EMAIL, name: FROM_NAME },
            reply_to: { email: SUPPORT_EMAIL, name: `${FROM_NAME} Support` },
            subject: announcement.title,
            content: [
              { type: 'text/plain', value: announcement.message },
              { type: 'text/html', value: html },
            ],
          });
          if (err) failures.push(err);
          else sent += batch.length;
        }

        await admin.from('platform_announcements').update({ email_recipient_count: sent }).eq('id', id);
        await admin.from('founder_audit_log').insert({
          actor_id: caller.id,
          actor_email: caller.email,
          action: 'broadcast_email',
          account_id: null,
          account_name: announcement.title,
          details: { announcement_id: id, recipient_count: sent, failed_batches: failures.length },
        });

        if (failures.length) {
          return json({ error: `Sent to ${sent} of ${recipients.length}. ${failures[0]}`, sent }, 502);
        }
        return json({ ok: true, sent });
      }

      // ─── Email log ─────────────────────────────────────────────────────
      case 'email_activity': {
        // The query is built here from validated pieces, never passed through,
        // so nothing the page sends can reach SendGrid's query language raw.
        const clauses: string[] = [];
        const days = Math.min(30, Math.max(1, Number(input.days) || 7));
        const end = new Date();
        const start = new Date(end.getTime() - days * 86_400_000);
        const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
        clauses.push(`last_event_time BETWEEN TIMESTAMP "${iso(start)}" AND TIMESTAMP "${iso(end)}"`);

        const toEmail = str('toEmail').toLowerCase();
        if (toEmail) {
          if (!EMAIL_RE.test(toEmail) || /["\\]/.test(toEmail)) return json({ error: 'Enter a valid email.' }, 400);
          clauses.push(`to_email="${toEmail}"`);
        }
        const status = str('status');
        if (status) {
          if (!['processed', 'delivered', 'not_delivered'].includes(status)) {
            return json({ error: 'Invalid status filter.' }, 400);
          }
          clauses.push(`status="${status}"`);
        }
        const limit = Math.min(1000, Math.max(1, Number(input.limit) || 100));

        const url = `https://api.sendgrid.com/v3/messages?limit=${limit}&query=${encodeURIComponent(clauses.join(' AND '))}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${SENDGRID_API_KEY}` } });
        if (!res.ok) {
          const text = await res.text();
          if (res.status === 429) return json({ error: 'SendGrid rate limit — wait a minute and try again.' }, 429);
          if (res.status === 400 || res.status === 403) {
            return json({
              error: `SendGrid refused the Email Activity request (${res.status}). This API needs the "Additional Email Activity History" add-on and an API key with Email Activity access. ${text}`,
            }, 502);
          }
          return json({ error: `SendGrid ${res.status}: ${text}` }, 502);
        }
        const data = await res.json();
        return json({ messages: data.messages ?? [] });
      }

      case 'email_activity_detail': {
        const msgId = str('msgId');
        if (!/^[A-Za-z0-9._-]+$/.test(msgId)) return json({ error: 'Invalid message id.' }, 400);
        const res = await fetch(`https://api.sendgrid.com/v3/messages/${msgId}`, {
          headers: { Authorization: `Bearer ${SENDGRID_API_KEY}` },
        });
        if (!res.ok) return json({ error: `SendGrid ${res.status}: ${await res.text()}` }, 502);
        return json(await res.json());
      }

      default:
        return json({ error: 'Unknown action.' }, 400);
    }
  } catch (e) {
    console.error('founder-support failed', e);
    return json({ error: 'unhandled' }, 500);
  }
});
