import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The organization the founder is currently viewing the app as.
 *
 * sessionStorage, not localStorage: it dies with the tab, so a forgotten
 * "view as" never follows the founder into tomorrow's session or a second tab.
 * The data source reads it synchronously when it resolves which account to act
 * as — see SupabaseDataSource.resolveAccount(). It grants nothing on its own:
 * reads still go through RLS as the founder (a platform admin), and every write
 * is refused while it is set (writableAccountId() and the query client's
 * mutation guard).
 */
export interface ImpersonationTarget {
  accountId: string;
  accountName: string;
  startedAt: number;
}

interface ImpersonationState {
  target: ImpersonationTarget | null;
  setTarget: (target: ImpersonationTarget | null) => void;
}

const sessionStore = createJSONStorage(() =>
  typeof window !== 'undefined'
    ? window.sessionStorage
    : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
);

export const useImpersonationStore = create<ImpersonationState>()(
  persist(
    (set) => ({
      target: null,
      setTarget: (target) => set({ target }),
    }),
    { name: 'aas-founder-impersonation', storage: sessionStore },
  ),
);

export function getImpersonationTarget(): ImpersonationTarget | null {
  return useImpersonationStore.getState().target;
}

export const VIEW_AS_READ_ONLY_MESSAGE = 'Viewing as an organization is read-only. Exit "view as" to make changes.';
