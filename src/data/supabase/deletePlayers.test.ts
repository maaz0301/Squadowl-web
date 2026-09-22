import { describe, expect, it } from 'vitest';
import { SupabaseDataSource } from './SupabaseDataSource';

/**
 * A fake PostgREST for `tryout_participants` soft deletes. `refuse` ids come
 * back as zero rows (how RLS reports a refused UPDATE) and `failBatchesWith`
 * makes any statement carrying that id throw, to exercise the per-player fallback.
 */
function fakeSupabase(opts: { refuse?: Set<string>; failBatchesWith?: string } = {}) {
  const statements: string[][] = [];
  const singles: string[] = [];
  const client = {
    from: () => ({
      update: () => ({
        in: (_col: string, ids: string[]) => {
          statements.push(ids);
          return {
            select: async () => {
              if (opts.failBatchesWith && ids.includes(opts.failBatchesWith)) {
                return { data: null, error: new Error('batch failed') };
              }
              return { data: ids.filter((i) => !opts.refuse?.has(i)).map((id) => ({ id })), error: null };
            },
          };
        },
        eq: (_col: string, id: string) => ({
          select: () => ({
            maybeSingle: async () => {
              singles.push(id);
              return { data: null, error: null };
            },
          }),
        }),
      }),
    }),
  };
  return { client, statements, singles };
}

function dataSourceWith(client: unknown) {
  const ds = new SupabaseDataSource();
  (ds as unknown as { ctx: () => Promise<unknown> }).ctx = async () => ({ supabase: client });
  return ds;
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe('deletePlayers', () => {
  it('soft-deletes in batches instead of one request per player', async () => {
    const { client, statements } = fakeSupabase();
    const result = await dataSourceWith(client).deletePlayers('t1', ids(60));
    expect(result.deleted).toHaveLength(60);
    expect(result.failed).toEqual([]);
    expect(statements).toHaveLength(3);
    expect(Math.max(...statements.map((s) => s.length))).toBeLessThanOrEqual(25);
  });

  it('reports progress ending at the total, and dedupes ids', async () => {
    const { client } = fakeSupabase();
    const calls: [number, number][] = [];
    await dataSourceWith(client).deletePlayers('t1', [...ids(30), ...ids(30)], (d, t) => calls.push([d, t]));
    expect(calls[0]).toEqual([0, 30]);
    expect(calls[calls.length - 1]).toEqual([30, 30]);
    const done = calls.map(([d]) => d);
    expect([...done].sort((a, b) => a - b)).toEqual(done);
  });

  it('marks players a refused UPDATE did not touch as failed', async () => {
    const { client } = fakeSupabase({ refuse: new Set(['p3']) });
    const result = await dataSourceWith(client).deletePlayers('t1', ids(10));
    expect(result.deleted).toHaveLength(9);
    expect(result.failed.map((f) => f.id)).toEqual(['p3']);
  });

  it('falls back to one at a time when a whole batch fails', async () => {
    const { client, singles } = fakeSupabase({ failBatchesWith: 'p2' });
    const result = await dataSourceWith(client).deletePlayers('t1', ids(5));
    expect(singles.sort()).toEqual(ids(5).sort());
    expect(result.deleted).toHaveLength(5);
    expect(result.failed).toEqual([]);
  });

  it('does nothing for an empty selection', async () => {
    const { client, statements } = fakeSupabase();
    const result = await dataSourceWith(client).deletePlayers('t1', []);
    expect(result).toEqual({ deleted: [], failed: [] });
    expect(statements).toHaveLength(0);
  });
});
