import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { zustandStorage } from '@/lib/storage';

/**
 * The founder console's "Show archived & deleted" switch. Off by default, so
 * the console looks like what an organization sees; on, it also lists archived
 * teams, seasons and evaluations, soft-deleted evaluations, and players removed
 * from an evaluation's roster. Remembered across founder pages and visits.
 */
interface FounderArchiveState {
  showArchived: boolean;
  setShowArchived: (show: boolean) => void;
}

export const useFounderArchiveStore = create<FounderArchiveState>()(
  persist(
    (set) => ({
      showArchived: false,
      setShowArchived: (showArchived) => set({ showArchived }),
    }),
    { name: 'aas-founder-show-archived', storage: zustandStorage },
  ),
);
