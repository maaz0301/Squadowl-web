import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthSession, UserProfile } from '@/data/types';
import { getDataSource } from '@/data';
import { zustandStorage } from '@/lib/storage';
import { queryClient } from '@/lib/queryClient';
import { warmAfterAuth } from '@/features/prefetch';
import { useSessionStore } from './sessionStore';
import { flushPendingReferralCode } from '@/lib/pendingReferral';

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
  /**
   * Re-read the signed-in user's profile from the server, discarding the
   * data source's cached copy. Role and plan tier decide which navigation a
   * user gets and whether billing is reachable at all, so a profile that has
   * gone stale doesn't just show an old number — it hands out the wrong app.
   */
  refreshProfile: () => Promise<void>;
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
        // The e-mail-confirmation path lands here: signup couldn't attach the
        // referral code because it had no session, so this is the first chance
        // to. No-ops when nothing is pending, and never throws.
        void flushPendingReferralCode();
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
          // Covers the user who verifies their e-mail in another tab and comes
          // back to a page that already holds a session, so login() never runs.
          if (session) void flushPendingReferralCode();
        } catch (e) {
          console.error('Failed to restore session:', e);
          set({ session: null, isHydrated: true, sessionExpired: hadSession });
        }
      },
      refreshProfile: async () => {
        if (!get().session) return;
        try {
          const profile = await getDataSource().getProfile(true);
          const current = get().session;
          // The session can be torn down while this read is in flight — a
          // sign-out mid-refresh must not write the old user back.
          if (!profile || !current || current.user.id !== profile.id) return;
          set({ session: { ...current, user: profile } });
        } catch (e) {
          // Keep whatever profile is already in hand; this is a background
          // reconciliation, not something the user asked for.
          console.warn('Could not refresh profile:', e);
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

import { useOrgMembersQuery, useTeamsQuery } from '@/features/queries';
import { getImpersonationTarget } from '@/state/impersonationStore';

export function usePermissions() {
  const user = useUser();
  const { data: members = [] } = useOrgMembersQuery();
  const impersonating = !!getImpersonationTarget();

  // For demo: if they are the primary coach@example.com account, default to admin if not found.
  // In production, everyone must be an org member.
  const isDemoAdmin = user?.email.toLowerCase() === 'coach@example.com';

  // Find user's staff membership (ignore guardian roster entries)
  const myStaffMember = user
    ? members.find(
        (m) => m.email.toLowerCase() === user.email.toLowerCase() && m.status === 'active' && m.role !== 'guardian'
      )
    : undefined;

  // A user with no memberships row and no guardian-linked athlete is exactly
  // what an assessor invited only through tryout_assessors looks like — the
  // comment above says "everyone must be an org member" but that invite path
  // never creates one. Falling back to 'coach' here (as this used to) handed
  // that account canManageTeam/canCreateAssessments — full coach-level access
  // to every team and evaluation on the account — everywhere in the app, not
  // just the one evaluation they were actually invited to score. 'assessor' is
  // this system's own least-privileged non-guardian role: canAssess still
  // holds, so scoring and roster edits keep working, but nothing account-wide
  // does.
  const rawRole = !user
    ? 'guardian'
    : (user.role && user.role !== 'guardian')
      ? user.role
      : (myStaffMember?.role ?? user.role ?? (isDemoAdmin ? 'admin' : 'assessor'));
  const membershipRole = rawRole === 'owner' ? 'admin' : rawRole;

  // …but a delegated team manager (CLUB mode) looks membership-wise exactly
  // like that bare assessor: the delegation lives in `team_managers` on the
  // club's account, not in a memberships row anywhere, so the fallback above
  // reads someone who has been handed a whole team as the least-privileged
  // role there is. They ran the team, created the evaluation on it and were
  // then shown the assessor's cut of it — no player profile, no evaluation
  // history, no team editing.
  //
  // listTeams() flags a delegated team `managed`, which is the same signal
  // team/[id] already trusts for its Edit gate, and holding one is exactly
  // what a real assessor never does. Only asked for when the answer can
  // change something — every role above 'assessor' already has these rights,
  // and a guardian's portal must not start pulling the coach's team list.
  const checkDelegation = !!user && membershipRole === 'assessor';
  const { data: teams } = useTeamsQuery({ enabled: checkDelegation });
  const managesDelegatedTeam = checkDelegation && (teams ?? []).some((t) => t.managed);

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

  // View As only ever gets set once founder_log_impersonation() has confirmed
  // the caller is the founder (see ViewAsButton.tsx / useImpersonation.ts), so
  // this never fires for a real member of some other account. The founder is
  // never a member of the org being viewed, so the fallback chain above
  // landed on the least-privileged 'assessor' and hid everything an admin
  // would see — team managers, assessor assignment — even though RLS already
  // lets a platform admin read all of it (has_account_role()'s
  // is_platform_admin() branch). Writes stay blocked regardless:
  // writableAccountId() refuses them outright while impersonating, so
  // granting the view here can't let anything actually change.
  if (impersonating) {
    return {
      role: 'admin',
      canManageOrganization: true,
      canManageTeam: true,
      canCreateAssessments: true,
      canAssess: true,
      isGuardian: false,
    };
  }

  // 'coach', not 'admin': running a team is what the delegation grants, and it
  // is the role Manage Organization already lists these people under. Nothing
  // org-wide (canManageOrganization) comes with it.
  const role = managesDelegatedTeam ? 'coach' : membershipRole;

  return {
    role,
    canManageOrganization: role === 'admin',
    canManageTeam: role === 'admin' || role === 'coach',
    canCreateAssessments: role === 'admin' || role === 'coach',
    canAssess: role === 'admin' || role === 'coach' || role === 'assessor',
    isGuardian: role === 'guardian',
  };
}
