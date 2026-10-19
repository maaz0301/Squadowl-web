import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { zustandStorage } from '@/lib/storage';

/** Which end of the age range comes first: youngest (default) or oldest. */
export type AgeSortDir = 'youngest' | 'oldest';

interface AgeSortState {
  ageSortDir: AgeSortDir;
  setAgeSortDir: (dir: AgeSortDir) => void;
  toggleAgeSortDir: () => void;
}

/** The coach's age-sort choice, shared by every screen that lists athletes and remembered between sessions. */
export const useAgeSortStore = create<AgeSortState>()(
  persist(
    (set) => ({
      ageSortDir: 'youngest',
      setAgeSortDir: (dir) => set({ ageSortDir: dir }),
      toggleAgeSortDir: () => set((s) => ({ ageSortDir: s.ageSortDir === 'youngest' ? 'oldest' : 'youngest' })),
    }),
    { name: 'aas-age-sort', storage: zustandStorage },
  ),
);

export const AGE_SORT_LABEL: Record<AgeSortDir, string> = {
  youngest: 'Age: Youngest to Oldest',
  oldest: 'Age: Oldest to Youngest',
};
