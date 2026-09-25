import { describe, expect, it } from 'vitest';

import {
  athletePayloadFromForm,
  bulkImportPlayers,
  capImportRows,
  dropExistingPlayers,
  withSkippedRows,
  type BulkImportDeps,
} from './bulkTeamImport';
import { isAtPlayerLimit, playerRoom } from './plans';
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
  const calls = { resolve: 0, create: [] as unknown[][], roster: [] as { athleteId: string; jersey?: string; pos?: string; form: AddPlayerForm }[][], one: [] as string[] };
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
    expect(calls.roster[0][0]).toMatchObject({ athleteId: 'ath-1', jersey: '1', pos: 'F' });
    // The source row rides along for rosters that store more than jersey/position.
    expect(calls.roster[0][0].form.first).toBe('F1');
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

  describe('rosters keyed by their own row id (evaluations)', () => {
    const withIds = (over: Partial<BulkImportDeps> = {}) =>
      deps({
        addToRoster: async (entries) => new Map(entries.map((e) => [e.athleteId, `part-${e.athleteId}`])),
        ...over,
      });

    it('reports the participant rows it landed, alongside the athletes', async () => {
      const { d } = withIds();
      const r = await bulkImportPlayers(mkRows(3), d);
      expect(r.athleteIds).toEqual(['ath-1', 'ath-2', 'ath-3']);
      expect(r.participantIds).toEqual(['part-ath-1', 'part-ath-2', 'part-ath-3']);
    });

    it('leaves participantIds empty when the roster write answers with nothing (teams)', async () => {
      const { d } = deps();
      const r = await bulkImportPlayers(mkRows(3), d);
      expect(r.added).toBe(3);
      expect(r.participantIds).toEqual([]);
    });

    it('keeps the participant id of a row landed through the one-at-a-time fallback', async () => {
      const { d } = withIds({
        createAthletes: async () => { throw new Error('boom'); },
        addOne: async (form) => {
          if (form.first === 'F2') throw new Error('bad row');
          return { athleteId: `one-${form.first}`, participantId: `part-one-${form.first}` };
        },
      });
      const r = await bulkImportPlayers(mkRows(2), d);
      expect(r.participantIds).toEqual(['part-one-F1']);
      expect(r.failed).toEqual([{ line: 3, name: 'F2 L2', message: 'bad row' }]);
    });

    it('keeps participant ids when the batched roster write fails and each row is retried', async () => {
      let first = true;
      const { d } = withIds({
        addToRoster: async (entries) => {
          if (first) { first = false; throw new Error('timeout'); }
          return new Map(entries.map((e) => [e.athleteId, `part-${e.athleteId}`]));
        },
      });
      const r = await bulkImportPlayers(mkRows(2), d);
      expect(r.added).toBe(2);
      expect(r.participantIds).toEqual(['part-ath-1', 'part-ath-2']);
    });
  });
});

describe('capImportRows / withSkippedRows (plan player cap)', () => {
  it('lets everything through when the plan has room, or is unlimited', () => {
    const rows = mkRows(5);
    expect(capImportRows(rows, 5).allowed).toHaveLength(5);
    expect(capImportRows(rows, 100).skipped).toEqual([]);
    expect(capImportRows(rows, Number.POSITIVE_INFINITY).allowed).toHaveLength(5);
  });

  it('keeps the first rows that fit and reports the rest by line', () => {
    const { allowed, skipped } = capImportRows(mkRows(20), 15);
    expect(allowed).toHaveLength(15);
    expect(allowed[14].line).toBe(16);
    expect(skipped).toHaveLength(5);
    expect(skipped[0]).toEqual({
      line: 17,
      name: 'F16 L16',
      message: "Not added: your plan's player limit was reached.",
    });
  });

  it('adds nothing when the roster is already full', () => {
    const { allowed, skipped } = capImportRows(mkRows(3), 0);
    expect(allowed).toEqual([]);
    expect(skipped.map((s) => s.line)).toEqual([2, 3, 4]);
  });

  it('merges skipped rows into a result, in line order, without touching the counts', () => {
    const base = { added: 2, failed: [{ line: 9, name: 'X', message: 'bad' }], athleteIds: ['a'], participantIds: [] };
    const { skipped } = capImportRows(mkRows(4), 2);
    const merged = withSkippedRows(base, skipped);
    expect(merged.added).toBe(2);
    expect(merged.failed.map((f) => f.line)).toEqual([4, 5, 9]);
    expect(withSkippedRows(base, [])).toBe(base);
  });
});

describe('dropExistingPlayers (re-imports)', () => {
  const row = (line: number, first: string, last: string, extra: Partial<AddPlayerForm> = {}) => ({
    line,
    form: { first, last, ...extra } as AddPlayerForm,
  });

  it('sets aside rows already on the roster and keeps the new ones', () => {
    const { fresh, duplicates } = dropExistingPlayers(
      [row(2, 'Sam', 'Lee'), row(3, 'Ana', 'Ray')],
      [{ first: 'Sam', last: 'Lee' }],
    );
    expect(fresh.map((r) => r.line)).toEqual([3]);
    expect(duplicates).toEqual([{ line: 2, name: 'Sam Lee', message: 'Already on this roster.' }]);
  });

  it('ignores case and spacing in names', () => {
    const { duplicates } = dropExistingPlayers([row(2, ' sam ', 'LEE')], [{ first: 'Sam', last: 'Lee' }]);
    expect(duplicates).toHaveLength(1);
  });

  it('does not merge same-name players whose birth year or guardian differ', () => {
    const existing = [{ first: 'Sam', last: 'Lee', yearOfBirth: 2011, guardianEmail: 'a@x.com' }];
    expect(dropExistingPlayers([row(2, 'Sam', 'Lee', { yearOfBirth: '2012' })], existing).fresh).toHaveLength(1);
    expect(dropExistingPlayers([row(2, 'Sam', 'Lee', { guardianEmail: 'b@x.com' })], existing).fresh).toHaveLength(1);
  });

  it('treats a missing birth year or guardian on either side as not a difference', () => {
    const existing = [{ first: 'Sam', last: 'Lee', yearOfBirth: 2011 }];
    expect(dropExistingPlayers([row(2, 'Sam', 'Lee')], existing).duplicates).toHaveLength(1);
    expect(dropExistingPlayers([row(2, 'Sam', 'Lee', { yearOfBirth: '2011' })], existing).duplicates).toHaveLength(1);
  });

  it('passes everything through for an empty roster', () => {
    const rows = [row(2, 'Sam', 'Lee')];
    expect(dropExistingPlayers(rows, []).fresh).toBe(rows);
  });

  it('spends no cap on players who are already there', () => {
    const rows = [row(2, 'Sam', 'Lee'), row(3, 'Ana', 'Ray'), row(4, 'Bo', 'Kim')];
    const { fresh } = dropExistingPlayers(rows, [{ first: 'Sam', last: 'Lee' }]);
    const { allowed, skipped } = capImportRows(fresh, 2);
    expect(allowed.map((r) => r.line)).toEqual([3, 4]);
    expect(skipped).toEqual([]);
  });
});

describe('Free plan import scenario: 20 rows in, then again', () => {
  const sheet = (n: number) => mkRows(n);

  it('adds 15 of 20 the first time, then is blocked before the picker opens', async () => {
    const roster: { first: string; last: string }[] = [];

    // First import into an empty roster: the screen's own gate lets it open.
    expect(isAtPlayerLimit('free', roster.length)).toBe(false);
    const { fresh, duplicates } = dropExistingPlayers(sheet(20), roster);
    const capped = capImportRows(fresh, playerRoom('free', roster.length));
    const { d } = deps();
    const result = withSkippedRows(await bulkImportPlayers(capped.allowed, d), [...duplicates, ...capped.skipped]);

    expect(result.added).toBe(15);
    expect(result.failed).toHaveLength(5);
    expect(result.failed.every((f) => f.message.includes('plan'))).toBe(true);
    for (const r of capped.allowed) roster.push({ first: r.form.first, last: r.form.last });

    // "Import more" / opening it again: the roster is now full, so the limit
    // message shows instead of the picker.
    expect(roster).toHaveLength(15);
    expect(isAtPlayerLimit('free', roster.length)).toBe(true);
  });

  it('does not let a second file sneak past the cap if the gate were skipped', () => {
    const roster = Array.from({ length: 15 }, (_, i) => ({ first: `F${i + 1}`, last: `L${i + 1}` }));
    const { fresh, duplicates } = dropExistingPlayers(sheet(20), roster);
    const capped = capImportRows(fresh, playerRoom('free', roster.length));
    expect(duplicates).toHaveLength(15); // the same first 15 are already there
    expect(capped.allowed).toHaveLength(0); // and the 5 new ones have no room
    expect(capped.skipped).toHaveLength(5);
  });

  it('a paid plan keeps its own, larger room', () => {
    expect(capImportRows(sheet(20), playerRoom('coach', 10)).allowed).toHaveLength(20);
    expect(capImportRows(sheet(50), playerRoom('coach', 10)).allowed).toHaveLength(20);
  });
});
