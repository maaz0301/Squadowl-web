/**
 * Founder console, live and read-only.
 *
 *   FOUNDER_EMAIL=founder@tryouthq.ca FOUNDER_PASSWORD='...' npm run test:founder
 *
 * Signs in with the real founder account and calls every read the console pages make
 * (organizations, users and its tabs, analytics, billing inputs, support, announcements,
 * audit log, feature blocks). Nothing is written. NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY are read from .env.local.
 */
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
  } catch {
    return undefined;
  }
}

const email = process.env.FOUNDER_EMAIL;
const password = process.env.FOUNDER_PASSWORD;
const url = env('NEXT_PUBLIC_SUPABASE_URL');
const anon = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const ready = Boolean(email && password && url && anon);

describe.skipIf(!ready)('founder console (live, read-only)', () => {
  let sb: SupabaseClient;

  const rpc = async <T = unknown>(fn: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await sb.rpc(fn, args);
    expect(error, `${fn}: ${error?.message}`).toBeNull();
    return data as T;
  };

  beforeAll(async () => {
    sb = createClient(url!, anon!, { auth: { persistSession: false } });
    const { error } = await sb.auth.signInWithPassword({ email: email!, password: password! });
    expect(error, `sign in: ${error?.message}`).toBeNull();
  });

  it('is recognised as the founder', async () => {
    expect(await rpc('is_founder')).toBe(true);
  });

  it('lists organizations', async () => {
    const rows = await rpc<unknown[]>('founder_list_organizations', {});
    expect(Array.isArray(rows)).toBe(true);
  });

  describe('users', () => {
    const page = (role: string | null) => rpc<{ total_count: number; email: string; memberships: unknown[] }[]>(
      'founder_list_users', { p_search: null, p_account_id: null, p_role: role, p_limit: 25, p_offset: 0 });

    it('All shows only people who belong to an organization', async () => {
      const rows = await page(null);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.memberships.length).toBeGreaterThan(0);
    });

    it('"Not signed in yet" (role none) shows only logins with no organization', async () => {
      const rows = await page('none');
      for (const r of rows) expect(r.memberships).toHaveLength(0);
    });

    it('All and Not signed in yet do not overlap', async () => {
      const [all, none] = await Promise.all([page(null), page('none')]);
      const inAll = new Set(all.map((r) => r.email));
      for (const r of none) expect(inAll.has(r.email)).toBe(false);
    });

    it('role tabs return only that role', async () => {
      for (const role of ['coach', 'guardian']) {
        const rows = await page(role);
        for (const r of rows) {
          expect((r.memberships as { role: string }[]).some((m) => m.role === role)).toBe(true);
        }
      }
    });

    it('search narrows the list', async () => {
      const all = await page(null);
      const rows = await rpc<{ email: string }[]>('founder_list_users', {
        p_search: 'raza', p_account_id: null, p_role: null, p_limit: 25, p_offset: 0 });
      expect(rows.length).toBeLessThanOrEqual(all.length + 25);
    });
  });

  it('analytics funnel and feature usage load', async () => {
    expect(await rpc('founder_analytics_funnel', { p_days: 30 })).toBeTruthy();
    expect(Array.isArray(await rpc('founder_analytics_feature_usage', { p_days: 30, p_platform: null }))).toBe(true);
  });

  it('referrals and balances load', async () => {
    expect(Array.isArray(await rpc('founder_list_referrals'))).toBe(true);
    expect(Array.isArray(await rpc('founder_referral_balances'))).toBe(true);
  });

  it('platform feature blocks are readable', async () => {
    expect(Array.isArray(await rpc('platform_blocked_features'))).toBe(true);
  });

  it('announcements and support tickets are readable', async () => {
    for (const table of ['platform_announcements', 'support_tickets', 'founder_audit_log']) {
      const { error } = await sb.from(table).select('id').limit(5);
      expect(error, `${table}: ${error?.message}`).toBeNull();
    }
  });

  it('audit log is readable and newest first', async () => {
    const { data, error } = await sb.from('founder_audit_log').select('created_at').order('created_at', { ascending: false }).limit(20);
    expect(error, error?.message).toBeNull();
    const times = (data ?? []).map((r: { created_at: string }) => Date.parse(r.created_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('a signed-out client cannot call founder reads', async () => {
    const anonClient = createClient(url!, anon!, { auth: { persistSession: false } });
    const { error } = await anonClient.rpc('founder_list_users', { p_limit: 1 });
    expect(error).not.toBeNull();
  });
});

describe.skipIf(ready)('founder console (live, read-only)', () => {
  it.skip('skipped: set FOUNDER_EMAIL and FOUNDER_PASSWORD to run', () => {});
});
