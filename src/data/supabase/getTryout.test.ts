import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake PostgREST: every chained call returns the same builder, awaiting it
// yields the rows seeded for the table, and every table read is recorded.
const h = vi.hoisted(() => {
  const state = { rows: {} as Record<string, unknown[]>, tables: [] as string[] };
  const builder = (table: string): unknown =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => resolve({ data: state.rows[table] ?? [], error: null });
          }
          if (prop === 'maybeSingle') return async () => ({ data: (state.rows[table] ?? [])[0] ?? null, error: null });
          return () => builder(table);
        },
      },
    );
  const client = {
    from: (table: string) => {
      state.tables.push(table);
      return builder(table);
    },
    rpc: async () => ({ data: [], error: null }),
  };
  return { state, client };
});

vi.mock('@/lib/supabase', () => ({ getSupabase: () => h.client }));

import { SupabaseDataSource } from './SupabaseDataSource';

function dataSource() {
  const ds = new SupabaseDataSource();
  (ds as unknown as { ctx: () => Promise<unknown> }).ctx = async () => ({
    supabase: h.client,
    accountId: 'a1',
    userId: 'u1',
  });
  return ds;
}

const tryoutRow = { id: 't1', account_id: 'a1', name: 'Fall', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' };
const registration = { id: 'r1', tryout_id: 't1', first_name: 'Ada', last_name: 'Lee', status: 'pending', created_at: '2026-10-02T00:00:00Z' };

describe('getTryout registrations', () => {
  beforeEach(() => {
    h.state.tables = [];
    h.state.rows = { tryouts: [tryoutRow], registrations: [registration] };
  });

  it('includes the registrations by default', async () => {
    const t = await dataSource().getTryout('t1');
    expect(h.state.tables).toContain('registrations');
    expect(t?.registrations).toHaveLength(1);
  });

  it('leaves the registrations out, without reading the table, when asked', async () => {
    const t = await dataSource().getTryout('t1', { registrations: false });
    expect(h.state.tables).not.toContain('registrations');
    expect(t?.registrations).toEqual([]);
    // Everything else is still read.
    expect(h.state.tables).toEqual(expect.arrayContaining(['tryouts', 'tryout_participants', 'tryout_assessors']));
  });

  it('listTryoutsForReports leaves the registrations out too', async () => {
    const ds = dataSource();
    (ds as unknown as { fetchVisibleTryoutRows: () => Promise<unknown[]> }).fetchVisibleTryoutRows = async () => [tryoutRow];
    const list = await ds.listTryoutsForReports();
    expect(h.state.tables).not.toContain('registrations');
    expect(list[0].registrations).toEqual([]);
  });
});
