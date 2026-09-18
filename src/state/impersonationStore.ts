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
  /** The organization the view was opened from — and the one the audit log records. */
  accountId: string;
  accountName: string;
  startedAt: number;
  /**
   * Set for "view as user": the app loads as this one person — their own
   * memberships, role, delegated (managed) teams, assessor assignments and
   * guardian athletes — instead of as the organization's admin. Absent for
   * "view as organization".
   */
  user?: ImpersonatedPerson;
  /**
   * View as organization only: the account's owner. Delegated (managed) teams,
   * assessor assignments and guardian links belong to a person, not an
   * account, so the org view shows the owner's — what the owner sees when they
   * sign in — while the account and admin rights stay the organization's.
   */
  owner?: ImpersonatedPerson;
  /**
   * View as organization only: every staff member of the account (guardians
   * excluded — they are parents here, and their own assignments and delegated
   * teams sit on other accounts). Teams delegated to any of them and
   * evaluations any of them is assigned to assess are listed too, so the org
   * view shows every managed team and assessed evaluation its users have —
   * not just the owner's.
   */
  memberIds?: string[];
}

export interface ImpersonatedPerson {
  id: string;
  email?: string;
  name?: string;
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

/** The person being viewed as, when the founder chose one user rather than a whole organization. */
export function getImpersonatedUser(): ImpersonatedPerson | null {
  return useImpersonationStore.getState().target?.user ?? null;
}

/**
 * Whose person-scoped rows (managed teams, assessor assignments, guardian
 * athletes) to read: the chosen user, or in org view the organization's owner.
 */
export function getViewedPerson(): ImpersonatedPerson | null {
  const target = useImpersonationStore.getState().target;
  return target?.user ?? target?.owner ?? null;
}

/**
 * Whose delegated teams and assessor assignments to list: the chosen user, or
 * in org view every member of the organization (the owner at least).
 */
export function getViewedPersonIds(): string[] {
  const target = useImpersonationStore.getState().target;
  if (!target) return [];
  if (target.user) return [target.user.id];
  const ids = new Set(target.memberIds ?? []);
  if (target.owner) ids.add(target.owner.id);
  return [...ids];
}

export const VIEW_AS_READ_ONLY_MESSAGE = 'Viewing as is read-only. Exit "view as" to make changes.';
