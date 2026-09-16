import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';

/** Mirrors is_founder() in 20260916120000_founder_org_management.sql. */
export const FOUNDER_EMAIL = 'founder@tryout.ca';

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Resolves the caller from their own JWT and requires the confirmed founder
 * address — never a client-supplied identity. Returns the caller plus a
 * service-role client, or the Response to send back.
 */
export async function requireFounder(
  req: Request,
): Promise<{ caller: User; admin: SupabaseClient } | { response: Response }> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return { response: json({ error: 'server misconfigured' }, 500) };
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return { response: json({ error: 'Not authorized' }, 401) };

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await callerClient.auth.getUser(jwt);
  const caller = data?.user;
  if (error || !caller || caller.email?.toLowerCase() !== FOUNDER_EMAIL || !caller.email_confirmed_at) {
    return { response: json({ error: 'Only founder@tryout.ca can do this.' }, 403) };
  }

  return { caller, admin: createClient(SUPABASE_URL, SERVICE_ROLE_KEY) };
}
