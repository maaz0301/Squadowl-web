import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { FOUNDER_EMAIL, json, requireFounder } from '../_shared/founder.ts';

/**
 * Founder console — ban / unban / delete a user. founder@tryout.ca only.
 *
 * The only founder user-management actions that can't be a plain RPC:
 * banning and deleting go through the Auth Admin API, which needs the service
 * role key. Role changes, password resets and verification resends stay as
 * RPCs (see 20260916130000_founder_user_management.sql).
 */

type Action = 'ban' | 'unban' | 'delete';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const auth = await requireFounder(req);
    if ('response' in auth) return auth.response;
    const { caller, admin } = auth;

    const { action, userId, reason } = (await req.json().catch(() => ({}))) as {
      action?: Action;
      userId?: string;
      reason?: string;
    };
    if (!userId || (action !== 'ban' && action !== 'unban' && action !== 'delete')) {
      return json({ error: 'Missing or invalid action/userId' }, 400);
    }
    if (userId === caller.id) {
      return json({ error: 'You cannot do that to your own account.' }, 400);
    }

    const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(userId);
    if (targetError || !targetData?.user) return json({ error: 'User not found.' }, 404);
    const target = targetData.user;
    if (target.email?.toLowerCase() === FOUNDER_EMAIL) {
      return json({ error: 'The founder account cannot be banned or deleted.' }, 400);
    }

    if (action === 'ban') {
      // GoTrue has no "permanent" ban — 100 years is the documented way to
      // get one in practice.
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
      if (error) return json({ error: error.message }, 500);
    } else if (action === 'unban') {
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
      if (error) return json({ error: error.message }, 500);
    } else {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 500);
    }

    // Inserted directly: founder_write_audit() is internal to SECURITY DEFINER
    // functions, and the service role bypasses RLS, so this lands even though
    // founder_audit_log has no INSERT policy.
    const auditAction = action === 'ban' ? 'ban_user' : action === 'unban' ? 'unban_user' : 'delete_user';
    const { error: auditError } = await admin.from('founder_audit_log').insert({
      actor_id: caller.id,
      actor_email: caller.email,
      action: auditAction,
      account_id: null,
      account_name: target.email ?? userId,
      reason: reason?.trim() || null,
      details: { user_id: userId },
    });
    if (auditError) console.error('founder-user-admin: audit insert failed', auditError);

    return json({ ok: true });
  } catch (e) {
    console.error('founder-user-admin failed', e);
    return json({ error: 'unhandled' }, 500);
  }
});
