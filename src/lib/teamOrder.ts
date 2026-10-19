import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { zustandStorage } from '@/lib/storage';
import { moveItem } from '@/lib/reorder';

/**
 * Teams in the coach's own order. Teams the order has never seen (a team just
 * created) go after the ones it has, in their usual order, so a new team lands at
 * the bottom until the coach moves it. Ids in the order that no longer exist are ignored.
 */
export function applyTeamOrder<T extends { id: string }>(teams: readonly T[], order: readonly string[] | undefined): T[] {
  if (!order?.length) return [...teams];
  const rank = new Map(order.map((id, i) => [id, i]));
  const known = teams.filter((t) => rank.has(t.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const fresh = teams.filter((t) => !rank.has(t.id));
  return [...known, ...fresh];
}

/** The ids after moving the team at `from` to `to` in the list the coach is looking at. */
export function reorderedTeamIds<T extends { id: string }>(teams: readonly T[], from: number, to: number): string[] {
  return moveItem(teams, from, to).map((t) => t.id);
}

interface TeamOrderState {
  /** Custom team order per signed-in user, so two coaches on one device keep their own. */
  orders: Record<string, string[]>;
  setOrder: (userId: string, ids: string[]) => void;
}

export const useTeamOrderStore = create<TeamOrderState>()(
  persist(
    (set) => ({
      orders: {},
      setOrder: (userId, ids) => set((s) => ({ orders: { ...s.orders, [userId]: ids } })),
    }),
    { name: 'aas-team-order', storage: zustandStorage },
  ),
);
