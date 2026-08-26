import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthSession, UserProfile } from '@/data/types';
import { getDataSource } from '@/data';
import { zustandStorage } from '@/lib/storage';
import { queryClient } from '@/lib/queryClient';
import { warmAfterAuth } from '@/features/prefetch';
import { useSessionStore } from './sessionStore';

/**
 * Set while logout() tears the session down. The SDK fires SIGNED_OUT during
 * that teardown, and the listener watching for a session dying on its own
 * would otherwise read a deliberate sign-out as an expiry and toast the user
 * on their way out the door.
 */
let deliberateSignOut = false;

interface AuthState {
  session: AuthSession | null;
  isHydrated: boolean;
  /**
   * The last sign-out was not the user's doing — their refresh token was gone
   * or revoked. Drives the "session expired" notice on the way to /login; not
   * persisted, so a fresh page load starts clean.
   */
  sessionExpired: boolean;
  setSession: (session: AuthSession | null) => void;
  setHydrated: (v: boolean) => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (displayName: string, email: string, password: string, accountType: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Sign out because the session died on its own — see the action's comment. */
  expireSession: () => Promise<void>;
  clearSessionExpired: () => void;
  restoreSession: (forceRefresh?: boolean) => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  verifyPasswordResetOtp: (email: string, token: string) => Promise<void>;
  resetPasswordWithOtp: (email: string, token: string, newPassword: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  resendVerificationEmail: (email: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      isHydrated: false,
      sessionExpired: false,
      setSession: (session) => {
        queryClient.clear();
        set({ session });
        // Signing in routes straight to /dashboard, and the cache was just
        // emptied. Starting the landing screen's reads here runs them against
        // the router transition and the page's JS chunk rather than after
        // both, which is most of the wait a coach used to sit through on the
        // first screen after signing up.
        warmAfterAuth(session?.user);
      },
      setHydrated: (v) => set({ isHydrated: v }),
      login: async (email, password) => {
        const session = await getDataSource().login(email, password);
        get().setSession(session);
      },
      signup: async (displayName, email, password, accountType) => {
        const session = await getDataSource().signup(displayName, email, password, accountType);
        get().setSession(session);
      },
      logout: async () => {
        deliberateSignOut = true;
        set({ sessionExpired: false });
        try {
          await getDataSource().logout();
        } catch (e) {
          console.error('Error during data source logout:', e);
        } finally {
          queryClient.clear();
          useSessionStore.setState({
            currentTryoutId: null,
            currentPlayerId: null,
            currentEvalId: null,
            workingScores: {},
            rosterFilter: 'all',
            rinksideIndex: 0,
            activeAssessor: null,
            combineTryoutIds: [],
            completedSessions: {},
          });
          get().setSession(null);
          deliberateSignOut = false;
        }
      },
      /**
       * Sign out because the session ended on its own — an expired or revoked
       * refresh token — rather than because the user asked to. Same teardown as
       * logout(), plus a flag so the UI can say *why* instead of dropping the
       * user on /login with no explanation.
       *
       * A no-op when there is nothing to expire: a stray auth error arriving
       * after a deliberate sign-out must not claim the session ran out.
       */
      expireSession: async () => {
        if (deliberateSignOut || !get().session) return;
        await get().logout();
        set({ sessionExpired: true });
      },
      clearSessionExpired: () => set({ sessionExpired: false }),
      restoreSession: async (forceRefresh?: boolean) => {
        // A session we believed in that the SDK can no longer produce is the
        // cold-boot face of the same expiry: the persisted store rehydrates the
        // old session, then the refresh behind getSession() comes back empty.
        const hadSession = !!get().session;
        try {
          const session = await getDataSource().getSession(forceRefresh);
          const currentSession = get().session;
          if (session?.user?.id !== currentSession?.user?.id) {
            queryClient.clear();
          }
          set({ session, isHydrated: true, sessionExpired: hadSession && !session });
          // Boot path, same reasoning as setSession(): on a cold load the
          // cache starts empty, and this fires while the screen behind
          // AuthGate is still being mounted rather than after it.
          warmAfterAuth(session?.user);
        } catch (e) {
          console.error('Failed to restore session:', e);
          set({ session: null, isHydrated: true, sessionExpired: hadSession });
        }
      },
      updateProfile: async (updates) => {
        const profile = await getDataSource().updateProfile(updates);
        const session = get().session;
        if (session) set({ session: { ...session, user: profile } });
      },
      requestPasswordReset: async (email) => {
        await getDataSource().requestPasswordReset(email);
      },
      verifyPasswordResetOtp: async (email, token) => {
        await getDataSource().verifyPasswordResetOtp(email, token);
        const session = await getDataSource().getSession();
        const currentSession = get().session;
        if (session?.user?.id !== currentSession?.user?.id) {
          queryClient.clear();
        }
        set({ session, isHydrated: true });
      },
      resetPasswordWithOtp: async (email, token, newPassword) => {
        await getDataSource().resetPasswordWithOtp(email, token, newPassword);
        const session = await getDataSource().getSession();
        const currentSession = get().session;
        if (session?.user?.id !== currentSession?.user?.id) {
          queryClient.clear();
        }
        set({ session, isHydrated: true });
      },
      updatePassword: async (password) => {
        await getDataSource().updatePassword(password);
        const session = await getDataSource().getSession();
        const currentSession = get().session;
        if (session?.user?.id !== currentSession?.user?.id) {
          queryClient.clear();
        }
        set({ session });
      },
      resendVerificationEmail: async (email) => {
        await getDataSource().resendVerificationEmail(email);
      },
    }),
    {
      name: 'aas-auth-store',
      storage: zustandStorage,
      partialize: (s) => ({ session: s.session }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);

export function useUser(): UserProfile | null {
  return useAuthStore((s) => s.session?.user ?? null);
}

export function useIsAuthenticated(): boolean {
  return useAuthStore((s) => !!s.session);
}

import { useOrgMembersQuery } from '@/features/queries';

export function usePermissions() {
  const user = useUser();
  const { data: members = [] } = useOrgMembersQuery();
  
  if (!user) {
    return {
      role: 'guardian',
      canManageOrganization: false,
      canManageTeam: false,
      canCreateAssessments: false,
      canAssess: false,
      isGuardian: true,
    };
  }

  // For demo: if they are the primary coach@example.com account, default to admin if not found.
  // In production, everyone must be an org member.
  const isDemoAdmin = user.email.toLowerCase() === 'coach@example.com';

  // Find user's staff membership (ignore guardian roster entries)
  const myStaffMember = members.find(
    (m) => m.email.toLowerCase() === user.email.toLowerCase() && m.status === 'active' && m.role !== 'guardian'
  );

  const rawRole = (user.role && user.role !== 'guardian')
    ? user.role
    : (myStaffMember?.role ?? user.role ?? (isDemoAdmin ? 'admin' : 'coach'));
  const role = rawRole === 'owner' ? 'admin' : rawRole;

  return {
    role,
    canManageOrganization: role === 'admin',
    canManageTeam: role === 'admin' || role === 'coach',
    canCreateAssessments: role === 'admin' || role === 'coach',
    canAssess: role === 'admin' || role === 'coach' || role === 'assessor',
    isGuardian: role === 'guardian',
  };
}
