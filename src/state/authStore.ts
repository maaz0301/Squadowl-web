import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthSession, UserProfile } from '@/data/types';
import { getDataSource } from '@/data';
import { zustandStorage } from '@/lib/storage';
import { queryClient } from '@/lib/queryClient';
import { useSessionStore } from './sessionStore';

interface AuthState {
  session: AuthSession | null;
  isHydrated: boolean;
  setSession: (session: AuthSession | null) => void;
  setHydrated: (v: boolean) => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (displayName: string, email: string, password: string, accountType: string) => Promise<void>;
  logout: () => Promise<void>;
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
      setSession: (session) => {
        queryClient.clear();
        set({ session });
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
        }
      },
      restoreSession: async (forceRefresh?: boolean) => {
        try {
          const session = await getDataSource().getSession(forceRefresh);
          const currentSession = get().session;
          if (session?.user?.id !== currentSession?.user?.id) {
            queryClient.clear();
          }
          set({ session, isHydrated: true });
        } catch (e) {
          console.error('Failed to restore session:', e);
          set({ session: null, isHydrated: true });
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
  
  const myMember = members.find(
    (m) => m.email.toLowerCase() === user.email.toLowerCase() && m.status === 'active'
  );

  const role = user.role ?? myMember?.role ?? (isDemoAdmin ? 'admin' : 'guardian');

  return {
    role,
    canManageOrganization: role === 'admin',
    canManageTeam: role === 'admin' || role === 'coach',
    canCreateAssessments: role === 'admin' || role === 'coach',
    canAssess: role === 'admin' || role === 'coach' || role === 'assessor',
    isGuardian: role === 'guardian',
  };
}
