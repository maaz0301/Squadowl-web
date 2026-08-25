import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { queryKeys } from './queryClient';

/**
 * The light list reads (`tryoutSummaries`, `assignedTryoutSummaries`) are keyed
 * as supersets of the full-read keys they sit beside, so that every write path
 * that already invalidates `tryouts(...)` refreshes them too without knowing
 * they exist. That only works because react-query matches object segments of a
 * query key *partially* — an implementation detail worth pinning down, since
 * nothing in the app would fail loudly if it changed. It would just quietly
 * start serving stale lists after a create or a delete.
 */
describe('tryout query key matching', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient();
    qc.setQueryData(queryKeys.tryouts(false), [{ id: 'a' }, { id: 'b' }]);
    qc.setQueryData(queryKeys.tryouts(true), [{ id: 'a' }, { id: 'b' }, { id: 'z', archived: true }]);
    qc.setQueryData(queryKeys.tryoutSummaries(false), [{ id: 'a' }, { id: 'b' }]);
    qc.setQueryData(queryKeys.tryoutSummaries(true), [{ id: 'a' }, { id: 'b' }, { id: 'z', archived: true }]);
    qc.setQueryData(queryKeys.assignedTryoutSummaries, [{ id: 'q' }]);
    qc.setQueryData(queryKeys.assessmentCount, 2);
  });

  const keysMatching = (queryKey: readonly unknown[]) =>
    qc
      .getQueryCache()
      .findAll({ queryKey })
      .map((q) => JSON.stringify(q.queryKey))
      .sort();

  it('invalidating the active list also reaches its summary key', () => {
    expect(keysMatching(queryKeys.tryouts(false))).toEqual([
      '["tryouts",{"archived":false,"view":"summary"}]',
      '["tryouts",{"archived":false}]',
    ]);
  });

  it('does not reach across the archived boundary', () => {
    expect(keysMatching(queryKeys.tryouts(false)).join()).not.toContain('"archived":true');
  });

  it('invalidating assigned tryouts reaches the assigned summaries', () => {
    expect(keysMatching(queryKeys.assignedTryouts)).toEqual([
      '["tryouts","assigned",{"view":"summary"}]',
    ]);
  });

  it('a delete patch clears every list but leaves the count number intact', () => {
    // Mirrors patchCachedTryoutLists(): non-array entries under the same prefix
    // (the plan-limit count) must pass through untouched.
    qc.setQueriesData({ queryKey: ['tryouts'] }, (old: unknown) =>
      Array.isArray(old) ? old.filter((r) => (r as { id: string })?.id !== 'a') : old,
    );

    for (const key of [
      queryKeys.tryouts(false),
      queryKeys.tryouts(true),
      queryKeys.tryoutSummaries(false),
      queryKeys.tryoutSummaries(true),
    ]) {
      expect(qc.getQueryData<{ id: string }[]>(key)?.some((r) => r.id === 'a')).toBe(false);
    }
    expect(qc.getQueryData(queryKeys.assessmentCount)).toBe(2);
  });

  it('an archive patch flags the row everywhere and drops it from the active lists', () => {
    qc.setQueriesData({ queryKey: ['tryouts'] }, (old: unknown) =>
      Array.isArray(old)
        ? old.map((r) => ((r as { id: string })?.id === 'b' ? { ...(r as object), archived: true } : r))
        : old,
    );
    qc.setQueriesData({ queryKey: queryKeys.tryouts(false) }, (old: unknown) =>
      Array.isArray(old) ? old.filter((r) => (r as { id: string })?.id !== 'b') : old,
    );

    // Gone from what the dashboard renders...
    for (const key of [queryKeys.tryouts(false), queryKeys.tryoutSummaries(false)]) {
      expect(qc.getQueryData<{ id: string }[]>(key)?.map((r) => r.id)).toEqual(['a']);
    }
    // ...and flagged in what the archived screen filters on.
    for (const key of [queryKeys.tryouts(true), queryKeys.tryoutSummaries(true)]) {
      const row = qc.getQueryData<{ id: string; archived?: boolean }[]>(key)?.find((r) => r.id === 'b');
      expect(row?.archived).toBe(true);
    }
  });
});
