import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

type EmailActionType =
  | 'signup'
  | 'recovery'
  | 'invite'
  | 'magiclink'
  | 'email_change'
  | 'reauthentication';

const COPY: Record<EmailActionType, { subject: string; heading: string; cta: string }> = {
  signup: { subject: 'Confirm your TryoutHQ account', heading: 'Confirm your email', cta: 'Confirm email' },
  recovery: { subject: 'Reset your TryoutHQ password', heading: 'Reset your password', cta: 'Reset password' },
  invite: { subject: "You've been invited to TryoutHQ", heading: "You're invited", cta: 'Accept invite' },
  magiclink: { subject: 'Your TryoutHQ sign-in link', heading: 'Sign in to TryoutHQ', cta: 'Sign in' },
  email_change: { subject: 'Confirm your new email', heading: 'Confirm your new email', cta: 'Confirm email' },
  reauthentication: { subject: "Confirm it's you", heading: "Confirm it's you", cta: 'Confirm' },
};

// The web app verifies password resets with `verifyOtp({ type: 'recovery' })`
// and prompts for the 6-digit code, so those emails must carry `token` rather
// than a confirmation link. Signup/invite/magic-link flows redirect through
// Supabase's verify endpoint instead, so they keep the link.
const CODE_BASED: ReadonlySet<EmailActionType> = new Set(['recovery', 'reauthentication']);

const SHELL = (inner: string) =>
  `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">${inner}
     <p style="color:#666;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
   </div>`;

function renderEmail(actionType: EmailActionType, token: string, confirmUrl: string) {
  const { subject, heading, cta } = COPY[actionType];

  if (CODE_BASED.has(actionType)) {
    return {
      subject,
      html: SHELL(`
        <h2>${heading}</h2>
        <p>Enter this 6-digit code to continue:</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:24px 0">${token}</p>
      `),
    };
  }

  return {
    subject,
    html: SHELL(`
      <h2>${heading}</h2>
      <p>Click the button below to continue.</p>
      <p>
        <a href="${confirmUrl}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;text-decoration:none;border-radius:6px">
          ${cta}
        </a>
      </p>
    `),
  };
}

Deno.serve(async (req) => {
  try {
    const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
    const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const FROM_EMAIL = Deno.env.get('SENDGRID_FROM_EMAIL') ?? 'noreply@tryouthq.ca';
    const FROM_NAME = Deno.env.get('SENDGRID_FROM_NAME') ?? 'TryoutHQ';

    if (!SENDGRID_API_KEY || !HOOK_SECRET || !SUPABASE_URL) {
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
    const confirmUrl =
      `${SUPABASE_URL}/auth/v1/verify?token=${email_data.token_hash}` +
      `&type=${email_data.email_action_type}&redirect_to=${email_data.redirect_to}`;

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
      return new Response(JSON.stringify({ error: `SendGrid error: ${errText}` }), { status: 500 });
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'unhandled' }), { status: 500 });
  }
});
