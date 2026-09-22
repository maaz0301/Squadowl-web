import { describe, expect, it } from 'vitest';

import { athletePayloadFromForm, bulkImportPlayers, type BulkImportDeps } from './bulkTeamImport';
import type { AddPlayerForm } from './types';

const mkRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    line: i + 2,
    form: {
      first: `F${i + 1}`,
      last: `L${i + 1}`,
      jersey: String(i + 1),
      pos: 'F',
      yearOfBirth: '2011',
      playerEmail: '',
      guardianName: `G${i + 1}`,
      guardianEmail: `g${i % 10}@x.com`,
      guardianPhone: '',
      medicalInfo: '',
    } as AddPlayerForm,
  }));

function deps(over: Partial<BulkImportDeps> = {}) {
  const calls = { resolve: 0, create: [] as unknown[][], roster: [] as { athleteId: string; jersey?: string; pos?: string }[][], one: [] as string[] };
  let seq = 0;
  const d: BulkImportDeps = {
    resolveGuardians: async () => {
      calls.resolve++;
      return new Map([['g0@x.com', 'user-0']]);
    },
    createAthletes: async (payloads) => {
      calls.create.push(payloads);
      return payloads.map(() => `ath-${++seq}`);
    },
    addToRoster: async (entries) => {
      calls.roster.push(entries);
    },
    addOne: async (form) => {
      calls.one.push(form.first);
      return { athleteId: `one-${form.first}` };
    },
    ...over,
  };
  return { d, calls };
}

describe('bulkImportPlayers', () => {
  it('imports 20 rows with one guardian lookup, one create and one roster write', async () => {
    const { d, calls } = deps();
    const progress: number[] = [];
    const r = await bulkImportPlayers(mkRows(20), d, (n) => progress.push(n));
    expect([calls.resolve, calls.create.length, calls.roster.length, calls.one.length]).toEqual([1, 1, 1, 0]);
    expect(r.added).toBe(20);
    expect(r.athleteIds).toHaveLength(20);
    expect(r.failed).toHaveLength(0);
    expect(progress).toEqual([20]);
    expect(calls.roster[0][0]).toEqual({ athleteId: 'ath-1', jersey: '1', pos: 'F' });
  });

  it('batches 45 rows as 20/20/5 and keeps order', async () => {
    const { d, calls } = deps();
    const progress: number[] = [];
    const r = await bulkImportPlayers(mkRows(45), d, (n) => progress.push(n));
    expect(calls.create.map((c) => c.length)).toEqual([20, 20, 5]);
    expect(progress).toEqual([20, 40, 45]);
    expect(r.added).toBe(45);
    expect(calls.roster[0][44].athleteId).toBe('ath-45');
  });

  it('attaches the guardian id by lowercase email', async () => {
    const { d, calls } = deps();
    await bulkImportPlayers(mkRows(11).map((r) => ({ ...r, form: { ...r.form, guardianEmail: (r.form.guardianEmail ?? '').toUpperCase() } })), d);
    const p = calls.create[0] as { guardian_user_id: string | null }[];
    expect(p[0].guardian_user_id).toBe('user-0');
    expect(p[10].guardian_user_id).toBe('user-0');
    expect(p[1].guardian_user_id).toBeNull();
  });

  it('turns empty strings into nulls', () => {
    const pl = athletePayloadFromForm({ first: 'A', last: 'B' } as AddPlayerForm, new Map());
    expect(pl.year_of_birth).toBeNull();
    expect(pl.guardian_email).toBeNull();
    expect(pl.medical_info).toBeNull();
    expect(pl.guardian_user_id).toBeNull();
  });

  it('carries on when the guardian lookup throws', async () => {
    const { d } = deps({ resolveGuardians: async () => { throw new Error('rpc down'); } });
    expect((await bulkImportPlayers(mkRows(5), d)).added).toBe(5);
  });

  it('falls back to per-row adds when a create batch fails and reports only the bad row', async () => {
    const { d, calls } = deps({
      createAthletes: async () => { throw new Error('batch boom'); },
      addOne: async (form) => {
        calls.one.push(form.first);
        if (form.first === 'F3') throw new Error('bad row');
        return { athleteId: `one-${form.first}` };
      },
    });
    const r = await bulkImportPlayers(mkRows(5), d);
    expect(r.added).toBe(4);
    expect(r.failed).toEqual([{ line: 4, name: 'F3 L3', message: 'bad row' }]);
    expect(calls.roster).toHaveLength(0);
  });

  it('does not lose the first batch when the second fails', async () => {
    let call = 0;
    const { d, calls } = deps({ createAthletes: async (p) => { if (++call === 2) throw new Error('x'); return p.map((_, i) => `a${call}-${i}`); } });
    const r = await bulkImportPlayers(mkRows(30), d);
    expect(r.added).toBe(30);
    expect(calls.one).toHaveLength(10);
    expect(calls.roster[0]).toHaveLength(20);
  });

  it('does not trust a short or holey id list from the server', async () => {
    const short = deps({ createAthletes: async (p) => p.slice(1).map((_, i) => `a${i}`) });
    expect((await bulkImportPlayers(mkRows(3), short.d)).added).toBe(3);
    expect(short.calls.one).toHaveLength(3);
    const holey = deps({ createAthletes: async (p) => p.map(() => undefined as unknown as string) });
    expect((await bulkImportPlayers(mkRows(3), holey.d)).added).toBe(3);
    expect(holey.calls.one).toHaveLength(3);
  });

  it('retries each player when the roster batch fails and reports a persistent failure by line', async () => {
    let first = true;
    const { d } = deps({
      addToRoster: async (entries) => {
        if (first) { first = false; throw new Error('timeout'); }
        if (entries[0].jersey === '2') throw new Error('rls');
      },
    });
    const r = await bulkImportPlayers(mkRows(3), d);
    expect(r.added).toBe(2);
    expect(r.failed).toEqual([{ line: 3, name: 'F2 L2', message: 'rls' }]);
    expect(r.athleteIds).toHaveLength(2);
  });

  it('does nothing for empty input and sorts failures by line', async () => {
    const { d, calls } = deps();
    expect((await bulkImportPlayers([], d)).added).toBe(0);
    expect(calls.resolve).toBe(0);
    const bad = deps({ createAthletes: async () => { throw new Error('x'); }, addOne: async () => { throw new Error('y'); } });
    expect((await bulkImportPlayers(mkRows(3), bad.d)).failed.map((f) => f.line)).toEqual([2, 3, 4]);
  });
});
