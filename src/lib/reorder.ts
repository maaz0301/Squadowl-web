import { useMemo, useState } from 'react';

/** A copy of `items` with the entry at `from` moved to index `to`; out-of-range moves return the list unchanged. Kept identical in both repos. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * The list a reorder UI shows. A move appears at once and is saved in the
 * background: saving rewrites the whole assessment and reads it back, which on a
 * big roster takes long enough that waiting for it made dragging feel stuck. The
 * local order is dropped once the saved list matches it, or if the saved list's
 * members change underneath it (a rubric added or removed). Kept identical in both repos.
 */
export function useOptimisticOrder<T extends { key: string }>(server: readonly T[]) {
  const [local, setLocal] = useState<T[] | null>(null);
  const list = useMemo<readonly T[]>(() => {
    if (!local || local.length !== server.length) return server;
    const byKey = new Map(server.map((r) => [r.key, r]));
    if (!local.every((r) => byKey.has(r.key))) return server;
    return local.map((r) => byKey.get(r.key) as T);
  }, [local, server]);
  // Saved list caught up: stop overriding it. Set during render, the supported way to adjust state from props.
  if (local && local.length === server.length && local.every((r, i) => r.key === server[i]?.key)) setLocal(null);
  return [list, setLocal] as const;
}
