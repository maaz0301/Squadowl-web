import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const FOUNDER_EMAIL = 'founder@tryout.ca';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Self-service "Delete Account" from the Profile page. Deleting an auth user
 * needs the Admin API (service role), so this can't be a plain RPC — same
 * reason founder-user-admin's delete action exists, but scoped to the
 * caller's own id from their own JWT rather than an admin-selected target.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
      return json({ error: 'server misconfigured' }, 500);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Not authorized' }, 401);

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await callerClient.auth.getUser(jwt);
    const caller = data?.user;
    if (error || !caller) return json({ error: 'Not authorized' }, 401);

    // The founder account runs the platform — deleting it here would strand
    // every founder-only tool with no way back in.
    if (caller.email?.toLowerCase() === FOUNDER_EMAIL) {
      return json({ error: 'The founder account cannot be deleted this way.' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error: deleteError } = await admin.auth.admin.deleteUser(caller.id);
    if (deleteError) return json({ error: deleteError.message }, 500);

    // auth.users no longer has this row once deleteUser() returns — this is
    // the only place left that can tell "wrong password" apart from
    // "this account was deleted" on the next login attempt.
    if (caller.email) {
      const { error: tombstoneError } = await admin
        .from('deleted_accounts')
        .upsert({ email: caller.email.toLowerCase(), deleted_at: new Date().toISOString() });
      if (tombstoneError) console.error('delete-account: tombstone insert failed', tombstoneError);
    }

    return json({ ok: true });
  } catch (e) {
    console.error('delete-account failed', e);
    return json({ error: 'unhandled' }, 500);
  }
});
