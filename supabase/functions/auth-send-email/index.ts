import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

type EmailActionType =
  | 'signup'
  | 'recovery'
  | 'invite'
  | 'magiclink'
  | 'email_change'
  | 'reauthentication';

type Copy = { subject: string; heading: string; intro: string; cta: string };

/**
 * Mirrors the "Confirm signup" template written in the Supabase dashboard
 * (Authentication -> Emails). That template is never sent while the Send Email
 * hook is enabled — Supabase hands the whole message off to this function and
 * never consults its own templates — so the design has to live here to reach
 * anyone. Keep the two in step if the dashboard copy is edited.
 */
const COPY: Record<EmailActionType, Copy> = {
  signup: {
    subject: 'Confirm your email address',
    heading: 'Verify Your Email 🚀',
    intro:
      'Welcome to the ultimate athlete evaluation platform! To activate your account and start building out your teams and rosters, please verify your email address.',
    cta: 'VERIFY MY ACCOUNT',
  },
  invite: {
    subject: "You've been invited to TryoutHQ",
    heading: "You're Invited! 🎉",
    intro:
      "You've been invited to join TryoutHQ. Accept the invite below to set up your account and get started.",
    cta: 'ACCEPT INVITE',
  },
  magiclink: {
    subject: 'Your TryoutHQ sign-in link',
    heading: 'Sign In to TryoutHQ',
    intro: 'Use the button below to sign in. The link works once and expires shortly.',
    cta: 'SIGN IN',
  },
  email_change: {
    subject: 'Confirm your new email address',
    heading: 'Confirm Your New Email',
    intro: 'Confirm this address to finish moving your TryoutHQ account over to it.',
    cta: 'CONFIRM EMAIL',
  },
  recovery: {
    subject: 'Reset your TryoutHQ password',
    heading: 'Reset Your Password 🔐',
    intro: 'Enter this 8-digit code in the app to choose a new password.',
    cta: '',
  },
  reauthentication: {
    subject: "Confirm it's you",
    heading: "Confirm It's You",
    intro: 'Enter this 8-digit code to confirm this action.',
    cta: '',
  },
};

// The web app verifies password resets with `verifyOtp({ type: 'recovery' })`
// and prompts for the 8-digit code, so those emails must carry `token` rather
// than a confirmation link. Signup/invite/magic-link flows send a link to the
// web app's own /auth/callback instead, so they keep the link.
const CODE_BASED: ReadonlySet<EmailActionType> = new Set(['recovery', 'reauthentication']);

/** Where confirmation links land when the auth event carries no usable web target. */
const DEFAULT_SITE_URL = 'https://www.tryouthq.ca';

/**
 * The confirmation link the email carries.
 *
 * It points straight at the web app's own /auth/callback with the token hash,
 * which that page verifies itself (`verifyOtp`). It deliberately does NOT go
 * through Supabase's `/auth/v1/verify?redirect_to=` hop, because that hop
 * re-resolves the destination against the project's redirect allow list and
 * both of its failure modes stranded real users:
 *
 *  - This Supabase project is shared with the mobile app, so `aastryout://`
 *    is an allowed redirect. Any confirmation carrying it sent the browser to
 *    a custom scheme, and an iPhone without the app installed answers that
 *    with "Safari cannot open the page because the address is invalid".
 *  - An origin that isn't matched by the allow list (the apex tryouthq.ca,
 *    say) silently falls back to the project Site URL *root*, dropping the
 *    token in a fragment that the home page never consumes — a blank tab.
 *
 * Landing on our own page removes the allow list, the Site URL and the custom
 * scheme from the path entirely: whatever else is misconfigured, the link
 * opens a real page that can explain itself.
 */
function buildConfirmUrl(siteUrl: string, actionType: EmailActionType, tokenHash: string, redirectTo?: string) {
  // Non-http(s) targets are the mobile app's deep link, which no browser
  // opening an email can be trusted to handle — fall back to the web origin.
  let base: URL;
  try {
    const candidate = new URL(redirectTo ?? '');
    base = /^https?:$/.test(candidate.protocol) ? candidate : new URL(siteUrl);
  } catch {
    base = new URL(siteUrl);
  }

  const url = new URL('/auth/callback', base.origin);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', actionType);

  // Preserve where the original link meant to end up, so an invite pointing at
  // a specific page still gets there once the token is verified.
  const next = `${base.pathname}${base.search}`;
  if (base.pathname !== '/' && base.pathname !== '/auth/callback') url.searchParams.set('next', next);

  return url.toString();
}

/** `&` inside an href has to be escaped, or a client may swallow the params after it. */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Table-based rather than div-based, and every gradient sits on top of a solid
 * `background-color`: Outlook drops CSS gradients entirely, so without the
 * solid underneath the header and the button would render as white-on-white.
 */
function wrap(heading: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${heading}</title></head>
<body style="margin:0;padding:0;background:#0f0f13;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f13;padding:40px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <tr><td align="center" style="background-color:#16213e;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:16px 16px 0 0;padding:44px 40px 36px;text-align:center;">
        <div style="display:inline-block;background-color:#7c5cf0;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:12px;padding:14px 28px;margin-bottom:22px;">
          <span style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">⚡ Tryout HQ</span>
        </div>
        <h1 style="margin:0;color:#fff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">${heading}</h1>
      </td></tr>

      <tr><td style="background:#141430;padding:40px;border-left:1px solid #2a2a4a;border-right:1px solid #2a2a4a;text-align:center;">
        ${body}
      </td></tr>

      <tr><td style="background:#111128;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;border:1px solid #2a2a4a;border-top:none;">
        <p style="margin:0 0 6px;color:#6366f1;font-size:14px;font-weight:600;">TryoutHQ</p>
        <p style="margin:0;color:#4b5563;font-size:12px;">© ${new Date().getFullYear()} TryoutHQ. All rights reserved.</p>
        <p style="margin:6px 0 0;color:#374151;font-size:11px;">If you didn't request this, you can safely ignore this email.</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

function renderEmail(actionType: EmailActionType, token: string, confirmUrl: string) {
  const { subject, heading, intro, cta } = COPY[actionType];

  if (CODE_BASED.has(actionType)) {
    return {
      subject,
      html: wrap(
        heading,
        `<p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 24px;">${intro}</p>
         <div style="background:#0f0f13;border:1px solid #6366f1;border-radius:12px;padding:24px;margin:0 0 8px;">
           <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:8px;color:#a78bfa;font-family:monospace;">${token}</p>
         </div>`,
      ),
    };
  }

  const href = escapeAttr(confirmUrl);
  return {
    subject,
    html: wrap(
      heading,
      `<p style="color:#d1d5db;font-size:16px;line-height:1.7;margin:0 0 30px;">${intro}</p>
       <p style="margin:0 0 28px;">
         <a href="${href}" style="display:inline-block;background-color:#7c5cf0;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;padding:18px 40px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:0.5px;">${cta}</a>
       </p>
       <p style="color:#6b7280;font-size:12px;line-height:1.6;margin:0 0 6px;">If the button doesn't work, copy and paste this address into your browser:</p>
       <p style="font-size:12px;word-break:break-all;margin:0;"><a href="${href}" style="color:#818cf8;">${href}</a></p>`,
    ),
  };
}

Deno.serve(async (req) => {
  try {
    const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
    const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET');
    const SITE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? DEFAULT_SITE_URL;
    const FROM_EMAIL = Deno.env.get('SENDGRID_FROM_EMAIL') ?? 'noreply@tryouthq.ca';
    const FROM_NAME = Deno.env.get('SENDGRID_FROM_NAME') ?? 'TryoutHQ';

    if (!SENDGRID_API_KEY || !HOOK_SECRET) {
      return new Response(JSON.stringify({ error: 'server misconfigured' }), { status: 500 });
    }

    const wh = new Webhook(HOOK_SECRET.replace(/^v1,/, ''));

    const payload = await req.text();
    const headers = Object.fromEntries(req.headers);

    let event: {
      user: { email: string };
      email_data: {
        token: string;
        token_hash: string;
        redirect_to: string;
        email_action_type: EmailActionType;
      };
    };
    try {
      event = wh.verify(payload, headers) as typeof event;
    } catch {
      return new Response(JSON.stringify({ error: 'invalid webhook signature' }), { status: 401 });
    }

    const { user, email_data } = event;
    const confirmUrl = buildConfirmUrl(
      SITE_URL,
      email_data.email_action_type,
      email_data.token_hash,
      email_data.redirect_to,
    );

    const { subject, html } = renderEmail(email_data.email_action_type, email_data.token, confirmUrl);

    const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: user.email }] }],
        from: { email: FROM_EMAIL, name: FROM_NAME },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });

    if (!sgRes.ok) {
      const errText = await sgRes.text();
      console.error('SendGrid rejected the send', sgRes.status, errText);
      return new Response(JSON.stringify({ error: `SendGrid error: ${errText}` }), { status: 500 });
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('auth-send-email failed', e);
    return new Response(JSON.stringify({ error: 'unhandled' }), { status: 500 });
  }
});
