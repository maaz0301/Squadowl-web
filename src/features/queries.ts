import { getDataSource } from '@/data';
import type { DummyDataOptions, DummyTeamOptions } from '@/data/testDataGenerator';
import {
  getPlayerRubrics,
  type RubricCategory
} from '@/data/rubrics';
import type {
  AddPlayerForm,
  CreateAssessmentForm,
  GuardianRosterAthlete,
  Player,
  Registration,
  RegistrationSubmit,
  ScoreForm,
  Season,
  SeasonEvent,
  SeasonPlayer,
  Team,
  Tryout,
  UserProfile,
} from '@/data/types';
import { queryKeys, tryoutBulkWriteKey } from '@/lib/queryClient';
import { getSupabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * A note on `onSuccess: () => { void qc.invalidateQueries(...) }`.
 *
 * react-query awaits whatever `onSuccess` resolves to, so writing it as the
 * shorthand `onSuccess: () => qc.invalidateQueries(...)` implicitly returns the
 * invalidation promise and makes `mutateAsync` wait for a full refetch of the
 * list it just changed. On the create paths that refetch is the most expensive
 * query in the app (listTryouts pulls every participant, assessor, evaluation
 * and registration), and the user sits on a spinner for it before the screen
 * they asked for even starts loading. `void` fires the refetch and lets the
 * caller move on; the list updates itself when it lands.
 */

// ---- Auth ----
export function useProfileQuery() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => getDataSource().getProfile(),
  });
}

// ---- Teams ----
export function useTeamsQuery() {
  return useQuery({
    queryKey: queryKeys.teams,
    queryFn: () => getDataSource().listTeams(),
  });
}

/**
 * Just the number of teams, for plan-limit checks — see countTeams(). Keyed
 * under ['teams'] so the existing team invalidations refresh it for free.
 */
export function useTeamCountQuery() {
  return useQuery({
    queryKey: queryKeys.teamCount,
    queryFn: () => getDataSource().countTeams(),
  });
}

export function useCreateTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, season }: { name: string; season?: string }) =>
      withTimeout(getDataSource().createTeam(name, season), 15000),
    // Seeded synchronously so the team is already in the cache the instant
    // router.push lands on /team/[id] — that page derives `team` from this
    // list via `.find()`, and without this the invalidate below is still a
    // network round trip away, so the page briefly finds nothing and renders
    // its "Team not found" error before the refetch resolves.
    onSuccess: (team) => {
      qc.setQueryData<Team[]>(queryKeys.teams, (old) => (old ? [...old, team] : [team]));
      void qc.invalidateQueries({ queryKey: queryKeys.teams });
    },
  });
}

export function useUploadTeamLogoMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ teamId, fileUri, fileType }: { teamId: string; fileUri: string; fileType: string }) => {
      const logoUrl = await getDataSource().uploadTeamLogo(teamId, fileUri, fileType);
      await getDataSource().updateTeam(teamId, { logoUrl });
      return logoUrl;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.teams });
    },
  });
}

// ---- Team roster ----
// Lives on queryKeys so the prefetch layer can warm it without importing this
// module (which would close a cycle back through the auth store).
const teamRosterKey = queryKeys.teamRoster;

/**
 * Every team-roster write refreshes two reads: that team's roster, and the
 * Teams list's headcount for it. They can't share a key — the headcount read
 * covers every team at once, so it can't sit under one team's prefix — so
 * they're invalidated together here rather than leaving each write to
 * remember both.
 */
function invalidateTeamRoster(qc: QueryClient, teamId: string) {
  void qc.invalidateQueries({ queryKey: teamRosterKey(teamId) });
  void qc.invalidateQueries({ queryKey: queryKeys.teamPlayerCounts() });
}

/**
 * Players per team for the Teams list cards — see countTeamPlayers(). Separate
 * from useTeamRosterQuery because the list needs a number for every team and
 * none of the rows behind it.
 */
export function useTeamPlayerCountsQuery(teamIds: string[]) {
  // Sorted so the key is stable across list re-orders rather than refetching
  // the same counts under a new key.
  const ids = [...teamIds].sort();
  return useQuery({
    queryKey: queryKeys.teamPlayerCounts(ids),
    queryFn: () => getDataSource().countTeamPlayers(ids),
    enabled: ids.length > 0,
  });
}

export function useTeamRosterQuery(teamId: string | undefined) {
  return useQuery({
    queryKey: teamRosterKey(teamId ?? ''),
    queryFn: () => getDataSource().listTeamRoster(teamId!),
    enabled: !!teamId,
  });
}

export function useAddTeamRosterPlayersMutation(
  teamId: string,
  onProgress?: (done: number, total: number) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries: { athleteId: string; jersey?: string; pos?: string; sourceTryoutId?: string }[]) =>
      getDataSource().addTeamRosterPlayers(teamId, entries, onProgress),
    onSuccess: () => {
      invalidateTeamRoster(qc, teamId);
    },
  });
}

export function useAddManualTeamPlayerMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: AddPlayerForm) => getDataSource().addManualTeamPlayer(teamId, form),
    onSuccess: () => {
      invalidateTeamRoster(qc, teamId);
    },
  });
}

export function useUploadTeamPlayerPhotoMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ athleteId, fileUri, fileType }: { athleteId: string; fileUri: string; fileType: string }) =>
      getDataSource().uploadPlayerPhoto(athleteId, fileUri, fileType),
    onSuccess: () => {
      invalidateTeamRoster(qc, teamId);
    },
  });
}

export function useRemoveTeamRosterPlayerMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (athleteId: string) => getDataSource().removeTeamRosterPlayer(teamId, athleteId),
    onSuccess: () => {
      invalidateTeamRoster(qc, teamId);
    },
  });
}

/**
 * Invite a team's roster to the portal — each player's own email and their
 * guardian's. No invalidation: nothing the team screen renders is derived from
 * portal_invites, and the caller reports the per-address outcome it returns.
 */
export function useTeamRosterInvitesMutation(teamId: string) {
  return useMutation({
    mutationFn: (athleteIds?: string[]) => getDataSource().sendTeamRosterInvites(teamId, athleteIds),
  });
}

export function useTeamManagersQuery(teamId?: string) {
  return useQuery({
    queryKey: queryKeys.teamManagers(teamId),
    queryFn: () => getDataSource().listTeamManagers(teamId!),
    enabled: !!teamId,
  });
}

export function useInviteTeamManagerMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      email,
      role,
      name,
    }: {
      email: string;
      role: import('@/data/types').TeamManagerRole;
      name?: string;
    }) => getDataSource().inviteTeamManager(teamId, email, role, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.teamManagers(teamId) });
      // Manage Organization lists delegated managers too, so it goes stale here.
      void qc.invalidateQueries({ queryKey: queryKeys.orgMembers() });
    },
  });
}

export function useRemoveTeamManagerMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (managerId: string) => getDataSource().removeTeamManager(managerId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.teamManagers(teamId) });
      void qc.invalidateQueries({ queryKey: queryKeys.teams });
      void qc.invalidateQueries({ queryKey: queryKeys.orgMembers() });
    },
  });
}

export function useAcceptAssignmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tryoutId: string) => {
      const ds = getDataSource();
      return ds.acceptAssignedTryout(tryoutId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assignedTryouts });
    },
  });
}

export function useRejectAssignmentMutation() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.session?.user);
  return useMutation({
    mutationFn: async (tryoutId: string) => {
      const ds = getDataSource();
      return ds.rejectAssignedTryout(tryoutId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assignedTryouts', user?.id, user?.email] });
      queryClient.invalidateQueries({ queryKey: queryKeys.assignedTryouts });
    },
  });
}

// ---- Tryouts ----
export function useTryoutsQuery(includeArchived = false, enabled = true) {
  return useQuery({
    queryKey: queryKeys.tryouts(includeArchived),
    queryFn: () => getDataSource().listTryouts(includeArchived),
    enabled,
  });
}

/**
 * The list screens' tryout read — names, dates and roster counts, without the
 * rosters, evaluations, scores and registrations behind them. See
 * `listTryoutSummaries()`; use `useTryoutsQuery` only where a screen genuinely
 * works with the full objects (search, combine, exports, a single assessment).
 */
export function useTryoutSummariesQuery(includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.tryoutSummaries(includeArchived),
    queryFn: () => getDataSource().listTryoutSummaries(includeArchived),
  });
}

/** Just the number of assessments, for plan-limit checks — see countAssessments(). */
export function useAssessmentCountQuery() {
  return useQuery({
    queryKey: queryKeys.assessmentCount,
    queryFn: () => getDataSource().countAssessments(),
  });
}

export function useAssignedTryoutsQuery() {
  return useQuery({
    queryKey: queryKeys.assignedTryouts,
    queryFn: () => getDataSource().listAssignedTryouts(),
  });
}

/** Light counterpart of useAssignedTryoutsQuery — see useTryoutSummariesQuery. */
export function useAssignedTryoutSummariesQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.assignedTryoutSummaries,
    queryFn: () => getDataSource().listAssignedTryoutSummaries(),
    enabled,
  });
}

export function useTryoutQuery(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.tryout(id ?? ''),
    queryFn: () => getDataSource().getTryout(id!),
    enabled: !!id,
  });
}

export function useTryoutRealtimeSync(id: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!id) return;

    let timeoutId: NodeJS.Timeout | null = null;
    const triggerInvalidate = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        qc.invalidateQueries({ queryKey: queryKeys.tryout(id) });
      }, 1000);
    };

    // Subscribe to insert/update events on the evaluations table for this specific tryout
    const uniqueId = Math.random().toString(36).slice(2, 9);
    const channel = getSupabase()
      .channel(`realtime:tryout_${id}_${uniqueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'evaluations', filter: `tryout_id=eq.${id}` },
        () => triggerInvalidate()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'evaluation_scores' },
        () => triggerInvalidate()
      )
      .subscribe();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      getSupabase().removeChannel(channel);
    };
  }, [id, qc]);
}

export function useCreateTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: CreateAssessmentForm) => withTimeout(getDataSource().createTryout(form), 15000),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      void qc.invalidateQueries({ queryKey: queryKeys.assessmentCount });
      void qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useUpdateTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Tryout> }) =>
      withTimeout(getDataSource().updateTryout(id, updates), 15000),
    onSuccess: (tryout) => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryout.id) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
    },
  });
}

/**
 * Links an assessment to a team (or unlinks it with null).
 *
 * Deliberately not useUpdateTryoutMutation with `{ teamId }`: that path returns
 * the fully assembled Tryout, so the cheap one-column write is followed by a
 * read of the whole roster, its evaluations and scores. On a large assessment
 * that read blows the 15s timeout and the coach is told the request failed even
 * though the link is already saved. setTryoutTeam does the write and nothing
 * else; the lists below refetch the new state on their own.
 */
export function useSetTryoutTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, teamId }: { id: string; teamId: string | null }) =>
      withTimeout(getDataSource().setTryoutTeam(id, teamId), 15000),
    onSuccess: (_result, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.tryout(id) });
      // ['tryouts'] is the prefix both the full lists and the summary lists
      // hang off, archived and active — the attach modal reads the latter.
      void qc.invalidateQueries({ queryKey: ALL_TRYOUT_LISTS });
    },
  });
}

/**
 * Applies `update` to every cached tryout *list* under a key prefix, leaving
 * non-list entries under the same prefix (the ['tryouts','count'] number)
 * alone. Returning null from `update` drops the row.
 *
 * These run in `onSuccess`, after the server has confirmed the write — never
 * optimistically. A delete that fails must leave the row on screen, so the
 * screen keeps showing exactly what the backend still has.
 *
 * The point of touching the cache at all is that `invalidateQueries` only
 * *marks* a list stale: the row stays on screen for the whole refetch, which
 * on these lists is the slowest request in the app. Editing the cached array
 * is synchronous, so the card disappears on the same frame the delete lands,
 * and the invalidate that follows just reconciles anything else that moved.
 */
function patchCachedTryoutLists<T extends { id: string }>(
  qc: QueryClient,
  prefix: readonly unknown[],
  id: string,
  update: (row: T) => T | null,
): void {
  qc.setQueriesData({ queryKey: prefix }, (old: unknown) => {
    if (!Array.isArray(old)) return old;
    const rows = old as T[];
    if (!rows.some((r) => r?.id === id)) return old;
    return rows.flatMap((r) => {
      if (r?.id !== id) return [r];
      const next = update(r);
      return next ? [next] : [];
    });
  });
}

/** Both the full-tryout lists and the summary lists, archived and active. */
const ALL_TRYOUT_LISTS = ['tryouts'] as const;

export function useArchiveTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().archiveTryout(id),
    onSuccess: (_result, id) => {
      // Flip the flag wherever the row is cached, so the archived list (which
      // fetches with includeArchived and filters on the flag) shows it right
      // away too...
      patchCachedTryoutLists<{ id: string; archived?: boolean }>(qc, ALL_TRYOUT_LISTS, id, (t) => ({
        ...t,
        archived: true,
      }));
      // ...then drop it from the lists that by definition only hold active
      // assessments, which is what the dashboard renders from.
      patchCachedTryoutLists(qc, queryKeys.tryouts(false), id, () => null);
      void qc.invalidateQueries({ queryKey: ALL_TRYOUT_LISTS });
    },
  });
}

export function useDeleteTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().deleteTryout(id),
    onSuccess: (_result, id) => {
      patchCachedTryoutLists(qc, ALL_TRYOUT_LISTS, id, () => null);
      // The plan-limit count is a number under the same prefix, so it needs
      // its own nudge rather than a list edit.
      qc.setQueryData<number>(queryKeys.assessmentCount, (n) =>
        typeof n === 'number' ? Math.max(0, n - 1) : n,
      );
      // Nothing can navigate to it any more; keeping the detail entry around
      // would only hand a stale tryout to a bookmarked /assessment/[id] URL.
      qc.removeQueries({ queryKey: queryKeys.tryout(id) });
      void qc.invalidateQueries({ queryKey: ALL_TRYOUT_LISTS });
    },
  });
}

// ---- Utility ----
const withTimeout = <T>(promise: Promise<T>, ms: number = 15000, msg: string = 'Request timed out. Please check your network connection.'): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
  ]);
};

// ---- Players ----
export function useAddPlayerMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: AddPlayerForm) => withTimeout(getDataSource().addPlayer(tryoutId, form), 15000, 'Adding player timed out. Please check your connection.'),
    onSuccess: (newPlayer) => {
      patchTryoutRosterCaches(qc, tryoutId, [newPlayer]);
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useUpdatePlayerMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playerId, updates }: { playerId: string; updates: Partial<import('@/data/types').Player> }) =>
      withTimeout(getDataSource().updatePlayer(tryoutId, playerId, updates), 15000),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
    },
  });
}

export function useDeletePlayerMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerId: string) => getDataSource().deletePlayer(tryoutId, playerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
    },
  });
}

// ---- Evaluations ----
export function useSaveEvaluationMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      playerId,
      form,
      evalId,
    }: {
      playerId: string;
      form: ScoreForm;
      evalId?: string;
    }) => {
      const activeAssessor = useSessionStore.getState().activeAssessor;
      return withTimeout(
        getDataSource().saveEvaluation(tryoutId, playerId, form, evalId, activeAssessor),
        5000,
        'Saving evaluation timed out. Please check your connection.'
      );
    },
    onSuccess: (newEval) => {
      qc.setQueryData<Tryout | undefined>(queryKeys.tryout(tryoutId), (oldData) => {
        if (!oldData) return oldData;
        const evals = [...oldData.evals];
        const idx = evals.findIndex((e) => e.id === newEval.id);
        if (idx >= 0) {
          evals[idx] = newEval;
        } else {
          evals.push(newEval);
        }
        return { ...oldData, evals };
      });
      // Mark related queries as stale but don't block onSubmit with immediate refetches.
      // They will re-fetch in the background when their components are next focused.
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId), refetchType: 'none' });
      qc.invalidateQueries({ queryKey: queryKeys.results(tryoutId), refetchType: 'none' });
      qc.invalidateQueries({ queryKey: queryKeys.profile, refetchType: 'none' });
    },
  });
}

// ---- Registration ----
export function useRegistrationsQuery(tryoutId: string) {
  return useQuery({
    queryKey: queryKeys.registrations(tryoutId),
    queryFn: () => getDataSource().listRegistrations(tryoutId),
    enabled: !!tryoutId,
    refetchInterval: 20_000,
  });
}

export function useEnsureCloudSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tryoutId: string) => getDataSource().ensureCloudSession(tryoutId),
    onSuccess: (tryout) => {
      qc.setQueryData(queryKeys.tryout(tryout.id), tryout);
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryout.id) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
    },
  });
}

export function useSubmitRegistrationMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: RegistrationSubmit) => getDataSource().submitRegistration(tryoutId, form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
    },
  });
}

export function useAddRegistrationToRosterMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: string) =>
      getDataSource().addRegistrationToRoster(tryoutId, registrationId),
    onSuccess: (newPlayer) => {
      patchTryoutRosterCaches(qc, tryoutId, [newPlayer]);
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useAddRegistrationToTeamMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, registrationId }: { teamId: string; registrationId: string }) =>
      getDataSource().addRegistrationToTeam(teamId, registrationId),
    onSuccess: (_data, { teamId }) => {
      invalidateTeamRoster(qc, teamId);
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

/**
 * Bump a tryout's roster in every cached shape — the single-tryout query and
 * both archived/unarchived list queries — so list badges (the dashboard's
 * "N players" chip, most visibly) reflect a bulk add immediately instead of
 * waiting on a background refetch of a potentially large assessment.
 */
function patchTryoutRosterCaches(qc: QueryClient, tryoutId: string, extraPlayers: Player[]) {
  if (extraPlayers.length === 0) return;
  const appendTo = (t: Tryout): Tryout => ({ ...t, roster: [...t.roster, ...extraPlayers] });
  qc.setQueryData<Tryout | null>(queryKeys.tryout(tryoutId), (old) => (old ? appendTo(old) : old));
  for (const archived of [false, true] as const) {
    qc.setQueryData<Tryout[]>(queryKeys.tryouts(archived), (old) =>
      old ? old.map((t) => (t.id === tryoutId ? appendTo(t) : t)) : old,
    );
  }
}

/** Bulk placement of selected registrations into either an assessment roster or a team roster. */
export function usePlaceRegistrationsMutation(tryoutId: string, onProgress?: (done: number, total: number) => void) {
  const qc = useQueryClient();
  return useMutation({
    // Keyed on the source assessment — the roster/[id] page uses this key with
    // useIsMutating to tell "empty roster" apart from "a bulk write from
    // another screen (Registrations' dummy-data flow, most often) is still
    // running", since this mutation can run for minutes without the roster's
    // own query ever refetching.
    mutationKey: tryoutBulkWriteKey(tryoutId),
    mutationFn: ({
      destination,
      registrationIds,
    }: {
      destination: { kind: 'assessment' | 'team'; id: string };
      registrationIds: string[];
    }) =>
      destination.kind === 'team'
        ? getDataSource().addRegistrationsToTeam(destination.id, registrationIds, onProgress)
        : getDataSource().addRegistrationsToRoster(destination.id, registrationIds, onProgress),
    onSuccess: (_count, { destination, registrationIds }) => {
      if (destination.kind === 'assessment') {
        // Placing a large selection means the roster page would otherwise sit
        // on the *previous* cached tryout — Card-heavy, evals/registrations
        // included — until a full assembleTryouts() refetch lands, which for a
        // few hundred participants is the slow part the user actually waits
        // on. Patch in stand-in Player rows from data already in the
        // registrations cache so the roster updates immediately; the
        // invalidation below still runs to reconcile real ids/athleteIds in
        // the background.
        const regs = qc.getQueryData<Registration[]>(queryKeys.registrations(tryoutId)) ?? [];
        const regById = new Map(regs.map((r) => [r.id, r]));
        const stubs: Player[] = registrationIds
          .map((id) => regById.get(id))
          .filter((r): r is Registration => !!r)
          .map((r) => ({
            id: `reg-${r.id}`,
            first: r.firstName,
            last: r.lastName,
            yearOfBirth: r.yearOfBirth,
            pos: r.positionTryingOutFor,
            positionTryingOutFor: r.positionTryingOutFor,
            currentTeam: r.currentTeam,
            currentLevel: r.currentLevel,
            guardianName: r.guardianName,
            guardianEmail: r.guardianEmail,
            guardianPhone: r.guardianPhone,
            medicalInfo: r.medicalInfo,
            friend1Name: r.friend1Name,
            friend2Name: r.friend2Name,
            registrationSource: 'qr',
            createdAt: Date.now(),
          }));
        patchTryoutRosterCaches(qc, destination.id, stubs);
        if (destination.id !== tryoutId) patchTryoutRosterCaches(qc, tryoutId, stubs);
        qc.invalidateQueries({ queryKey: queryKeys.tryout(destination.id) });
        if (destination.id !== tryoutId) {
          qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
        }
      } else {
        invalidateTeamRoster(qc, destination.id);
      }
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
    },
  });
}

export function useDismissRegistrationMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: string) =>
      getDataSource().dismissRegistration(tryoutId, registrationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
    },
  });
}

export function useGenerateTestDataMutation(tryoutId: string, onProgress?: (done: number, total: number) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: tryoutBulkWriteKey(tryoutId),
    mutationFn: (options: DummyDataOptions) => getDataSource().generateTestData(tryoutId, options, onProgress),
    // onSuccess intentionally omitted: the previous optimistic stub patch
    // inserted placeholder rows with empty first/last names that rendered as
    // "Unknown Player" until the real refetch landed. The onSettled
    // invalidation below already triggers an immediate background refetch, so
    // the brief empty-name flash adds no user value.
    // onSettled, not onSuccess: generateTestData writes incrementally, so a
    // failure mid-batch still leaves real rows behind. Refetch either way.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.results(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
    },
  });
}

export function useClearTestDataMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => getDataSource().clearTestData(tryoutId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.results(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
    },
  });
}

export function useGenerateDummyTeamsMutation(onProgress?: (done: number, total: number) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: DummyTeamOptions) => getDataSource().generateDummyTeams(options, onProgress),
    // onSettled, not onSuccess: generateDummyTeams creates its teams one at a
    // time, so a failure partway through still leaves real teams and
    // assessments behind. Refetching only on success left those rows invisible
    // until the user manually reloaded the page.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.teams });
      // Prefix match — invalidates every archived/unarchived tryout list.
      qc.invalidateQueries({ queryKey: ['tryouts'] });
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useClearDummyTeamsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => getDataSource().clearDummyTeams(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.teams });
      qc.invalidateQueries({ queryKey: ['tryouts'] });
    },
  });
}

import { computeAssessorProgress, computePlayerResults } from '@/data/scoring';

export { computeAssessorProgress, computePlayerResults } from '@/data/scoring';

export function useResultsQuery(tryoutId: string | undefined) {
  const tryoutQuery = useTryoutQuery(tryoutId);
  return {
    ...tryoutQuery,
    results: tryoutQuery.data ? computePlayerResults(tryoutQuery.data) : [],
    assessorProgress: tryoutQuery.data ? computeAssessorProgress(tryoutQuery.data) : [],
    rubrics: tryoutQuery.data
      ? getPlayerRubrics(
        tryoutQuery.data.sport,
        undefined,
        tryoutQuery.data.settings.customRubrics,
      )
      : ([] as RubricCategory[]),
  };
}

export function useUpdateProfileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: Partial<UserProfile>) => useAuthStore.getState().updateProfile(updates),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useUploadCoachPhotoMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, fileUri, fileType }: { userId: string; fileUri: string; fileType: string }) => {
      const publicUrl = await getDataSource().uploadCoachPhoto(userId, fileUri, fileType);
      const currentProfile = useAuthStore.getState().session?.user;
      if (currentProfile) {
        await useAuthStore.getState().updateProfile({ ...currentProfile, avatarUrl: publicUrl });
      }
      return publicUrl;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useUpdatePasswordMutation() {
  return useMutation({
    mutationFn: (password: string) => getDataSource().updatePassword(password),
  });
}

// ---- Phase 2: Team Builder, AI, Export ----
export function useGenerateTeamBuilderMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: import('@/data/teamBuilder').TeamBuilderConfig) => {
      // Claude has to enumerate every roster player in its response, so generation
      // time scales with roster size — a flat 60s cap only ever worked up to
      // roughly 100 players. Scale the client-side timeout with roster size instead,
      // capped at 5 minutes (large rosters can legitimately take that long to stream).
      const rosterSize = qc.getQueryData<Tryout>(queryKeys.tryout(tryoutId))?.roster.length ?? 0;
      const timeoutMs = Math.min(300000, Math.max(60000, 20000 + rosterSize * 300));
      return withTimeout(
        getDataSource().generateTeamBuilder(tryoutId, config),
        timeoutMs,
        'Team builder generation timed out. Claude AI might be taking longer than usual, please try again.'
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
    },
  });
}

export function useTeamBuilderResultsQuery(tryoutId: string) {
  return useQuery({
    queryKey: queryKeys.teamBuilderResults(tryoutId),
    queryFn: () => getDataSource().listTeamBuilderResults(tryoutId),
  });
}

export function useSaveTeamBuilderResultMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ label, state }: { label: string; state: import('@/data/teamBuilder').TeamBuilderState }) =>
      getDataSource().saveTeamBuilderResult(tryoutId, label, state),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.teamBuilderResults(tryoutId) });
    },
  });
}

export function useDeleteTeamBuilderResultMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().deleteTeamBuilderResult(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.teamBuilderResults(tryoutId) });
    },
  });
}

export function useAiPlayerSummaryMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerId: string) => 
      withTimeout(
        getDataSource().getAiPlayerSummary(tryoutId, playerId), 
        90000, 
        'Generation is taking longer than expected.'
      ),
    onSuccess: (summary, playerId) => {
      // Write the AI result directly into the cached tryout so the UI updates
      // immediately — even if the DB save failed (e.g. RLS blocks the update for
      // assessor-role users). Without this, invalidateQueries would refetch from
      // DB which has no ai_assessments, and the summary would never appear.
      qc.setQueryData<Tryout | undefined>(queryKeys.tryout(tryoutId), (old) => {
        if (!old) return old;
        return {
          ...old,
          aiAssessments: {
            ...(old.aiAssessments ?? {}),
            [playerId]: summary,
          },
        };
      });
      // Also invalidate so owners/admins (who can write to DB) see the persisted result.
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
    },
  });
}

export function useUploadPlayerPhotoMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ athleteId, fileUri, fileType }: { athleteId: string; fileUri: string; fileType: string }) =>
      withTimeout(getDataSource().uploadPlayerPhoto(athleteId, fileUri, fileType), 15000, 'Uploading photo timed out. Please check your connection.'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
    },
  });
}

export function useAiCompareMutation(tryoutId: string) {
  return useMutation({
    mutationFn: (playerIds: string[]) => getDataSource().getAiCompare(tryoutId, playerIds),
  });
}

export function useExportTryoutMutation(tryoutId: string) {
  return useMutation({
    mutationFn: (format: import('@/data/types').ExportFormat) =>
      getDataSource().exportTryout(tryoutId, format),
  });
}

export function useShareLinkMutation(tryoutId: string) {
  return useMutation({
    mutationFn: (label?: string) => getDataSource().createShareLink(tryoutId, label),
  });
}

// ---- Phase 3: Seasons ----
export function useSeasonsQuery() {
  return useQuery({
    queryKey: queryKeys.seasons,
    queryFn: () => getDataSource().listSeasons(),
  });
}

/**
 * The Teams list's read — player and event counts only, without every
 * roster entry's joined athlete row, RSVP availability or portal invite. See
 * `listSeasonSummaries()`; use `useSeasonsQuery` only where a screen genuinely
 * works with the full season (schedule, roster, RSVPs).
 */
export function useSeasonSummariesQuery() {
  return useQuery({
    queryKey: queryKeys.seasonSummaries,
    queryFn: () => getDataSource().listSeasonSummaries(),
  });
}

export function useSeasonQuery(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.season(id ?? ''),
    queryFn: () => getDataSource().getSeason(id!),
    enabled: !!id,
  });
}

export function useSeasonRealtimeSync(id: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!id) return;

    let timeoutId: NodeJS.Timeout | null = null;
    const triggerInvalidate = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        qc.invalidateQueries({ queryKey: queryKeys.season(id) });
        // A guardian viewing the same season (e.g. via a shared device) sees it too.
        qc.invalidateQueries({ queryKey: queryKeys.guardianRosters() });
      }, 1000);
    };

    const uniqueId = Math.random().toString(36).slice(2, 9);
    const channel = getSupabase()
      .channel(`realtime:season_${id}_${uniqueId}`)
      .on(
        // A coach deleting the season itself — the case this was missing.
        // Without it a guardian's cached roster/season data only went stale
        // whenever something else happened to touch season_events/
        // event_availability on a season they still (per the cache) belonged to.
        'postgres_changes',
        { event: '*', schema: 'public', table: 'seasons', filter: `id=eq.${id}` },
        () => triggerInvalidate()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'season_events', filter: `season_id=eq.${id}` },
        () => triggerInvalidate()
      )
      .on(
        // event_availability has no season_id column of its own (it keys off
        // season_event_id + roster_id), so this can't be filtered server-side.
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_availability' },
        () => triggerInvalidate()
      )
      .subscribe();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      getSupabase().removeChannel(channel);
    };
  }, [id, qc]);
}

export function useCreateSeasonMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: import('@/data/types').CreateSeasonForm) => withTimeout(getDataSource().createSeason(form), 15000),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.seasons });
    },
  });
}

export function useUpdateSeasonMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<import('@/data/types').Season> }) =>
      getDataSource().updateSeason(id, updates),
    onSuccess: (season) => {
      qc.invalidateQueries({ queryKey: queryKeys.season(season.id) });
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
    },
  });
}

export function useDeleteSeasonMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().deleteSeason(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.seasons });
    },
  });
}

/**
 * Bounded worker pool, mirroring the one inside SupabaseDataSource — kept as
 * its own small copy here rather than exported across the module boundary for
 * this one caller (syncSeasonRosterFromTeam).
 */
async function mapPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Math.max(1, Math.min(items.length, limit));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let i = next++; i < items.length; i = next++) {
        await task(items[i]);
      }
    }),
  );
}

/** onProgress reports guardian-email invite fanout as the event's roster is notified. */
export function useAddSeasonEventMutation(seasonId: string, onProgress?: (done: number, total: number) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: import('@/data/types').CreateEventForm) =>
      getDataSource().addSeasonEvent(seasonId, form, onProgress),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) });
    },
  });
}

/**
 * Copies any team-roster player missing from the season roster across, then
 * returns the season-roster entries for the team's *current* players.
 * Availability (and therefore guardian portal visibility) is keyed on season
 * roster entries, so this is what makes a team player actually receive events.
 *
 * The return is deliberately narrower than the season roster. A season roster
 * is not team membership: `createSeason()` seeds it from every participant of
 * every tryout linked to the team, this function tops it up, and nothing ever
 * deletes from it — `removeTeamRosterPlayer()` only touches `team_roster`. So
 * the full roster carries athletes who tried out but never made the team, plus
 * everyone since cut from it. Inviting that set is what made a new event's RSVP
 * tally disagree with the team's own player count on the same screen. Team
 * membership is `team_roster` (the same table `countTeamPlayers()` counts), so
 * that's what an event's invite list is built from.
 */
const SEASON_ROSTER_SYNC_CONCURRENCY = 8;

async function syncSeasonRosterFromTeam(
  teamId: string,
  seasonId: string,
  onProgress?: (done: number, total: number) => void,
) {
  const ds = getDataSource();
  const [teamRoster, season] = await Promise.all([
    ds.listTeamRoster(teamId),
    ds.getSeason(seasonId),
  ]);
  const alreadyOnSeason = new Set((season?.roster ?? []).map((p) => p.athleteId).filter(Boolean));
  const missing = teamRoster.filter((p) => p.athleteId && !alreadyOnSeason.has(p.athleteId));
  // Keyed on athlete rather than season-roster id: the two rosters are separate
  // tables joined only by athlete_id.
  const onTeam = new Set(teamRoster.map((p) => p.athleteId).filter(Boolean));
  const teamEntries = (roster: SeasonPlayer[]) => roster.filter((p) => p.athleteId && onTeam.has(p.athleteId));
  if (missing.length === 0) return teamEntries(season?.roster ?? []);

  // One insert per missing player, run through a bounded pool rather than in
  // series — a large team otherwise stalls here, one round trip per player,
  // before the event (and its invites) is even created.
  onProgress?.(0, missing.length);
  let done = 0;
  await mapPool(missing, SEASON_ROSTER_SYNC_CONCURRENCY, async (p) => {
    try {
      await ds.addSeasonPlayer(seasonId, {
        athleteId: p.athleteId,
        firstName: p.first,
        lastName: p.last,
        jersey: p.jersey,
      });
    } catch (e) {
      // Already on the season roster (unique athlete-per-season constraint) —
      // that's the state we wanted, so don't fail the event that triggered this.
      const err = e as { code?: string; message?: string } | undefined;
      const duplicate =
        err?.code === '23505' || /duplicate key value/i.test(err?.message ?? '');
      if (!duplicate) throw e;
    } finally {
      onProgress?.(++done, missing.length);
    }
  });
  const refreshed = await ds.getSeason(seasonId);
  return teamEntries(refreshed?.roster ?? []);
}

/**
 * Events belong to a season, but the UI only exposes them at the team level —
 * coaches add practices and games from the team screen and never see the season
 * machinery. A team that has no season yet gets one silently on its first event,
 * which also covers teams created before seasons were auto-provisioned.
 */
/**
 * onProgress covers the two serial phases a team's first event can spend real
 * time in for a large roster: syncing missing players onto the season roster,
 * then sending each guardian their invite email. `phase` tells the caller
 * which one a given (done, total) belongs to, since they're different totals.
 */
export function useAddTeamEventMutation(
  teamId: string,
  teamName: string,
  seasonId: string | undefined,
  onProgress?: (phase: 'roster' | 'invites', done: number, total: number) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: import('@/data/types').CreateEventForm) => {
      let sid = seasonId;
      if (!sid) {
        const season = await getDataSource().createSeason({
          name: `${teamName} Season`,
          teamName,
          sport: 'Hockey',
          teamId,
        });
        sid = season.id;
      }
      // Everyone on the team's Players list is invited, so a player added to the
      // team after the season existed still gets the event (and their guardian
      // sees it in the portal).
      const roster = await syncSeasonRosterFromTeam(teamId, sid, (done, total) => onProgress?.('roster', done, total));
      await getDataSource().addSeasonEvent(sid, { ...form, playerIds: roster.map((p) => p.id) }, (done, total) =>
        onProgress?.('invites', done, total),
      );
      return sid;
    },
    onSuccess: (sid) => {
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
      qc.invalidateQueries({ queryKey: queryKeys.season(sid) });
    },
  });
}

export function useUpdateSeasonEventMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      eventId,
      updates,
    }: {
      eventId: string;
      updates: Partial<import('@/data/types').SeasonEvent>;
    }) => getDataSource().updateSeasonEvent(seasonId, eventId, updates),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) });
    },
  });
}

export function useDeleteSeasonEventMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => getDataSource().deleteSeasonEvent(seasonId, eventId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) });
    },
  });
}

export function usePortalInviteMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playerId, email }: { playerId: string; email: string }) =>
      getDataSource().sendPortalInvite(seasonId, playerId, email),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) });
    },
  });
}

export function useSetAvailabilityMutation(seasonId: string) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useMutation({
    mutationFn: ({
      eventId,
      playerId,
      response,
    }: {
      eventId: string;
      playerId: string;
      response: 'yes' | 'maybe' | 'no';
    }) => getDataSource().setEventAvailability(seasonId, eventId, playerId, response),
    onMutate: async ({ eventId, playerId, response }) => {
      await qc.cancelQueries({ queryKey: queryKeys.seasons });
      await qc.cancelQueries({ queryKey: queryKeys.season(seasonId) });
      if (userId) {
        await qc.cancelQueries({ queryKey: queryKeys.guardianRosters(userId) });
      }

      const previousSeasons = qc.getQueryData<Season[]>(queryKeys.seasons);
      if (previousSeasons) {
        qc.setQueryData(
          queryKeys.seasons,
          previousSeasons.map((season) => {
            if (season.id === seasonId) {
              return {
                ...season,
                events: (season.events || []).map((event: SeasonEvent) => {
                  if (event.id === eventId) {
                    return {
                      ...event,
                      availability: {
                        ...(event.availability || {}),
                        [playerId]: response,
                      },
                    };
                  }
                  return event;
                }),
              };
            }
            return season;
          })
        );
      }

      const previousSeason = qc.getQueryData<Season>(queryKeys.season(seasonId));
      if (previousSeason) {
        qc.setQueryData(queryKeys.season(seasonId), {
          ...previousSeason,
          events: (previousSeason.events || []).map((event: SeasonEvent) => {
            if (event.id === eventId) {
              return {
                ...event,
                availability: {
                  ...(event.availability || {}),
                  [playerId]: response,
                },
              };
            }
            return event;
          }),
        });
      }

      const previousRosters = userId ? qc.getQueryData<GuardianRosterAthlete[]>(queryKeys.guardianRosters(userId)) : undefined;
      if (userId && previousRosters) {
        qc.setQueryData(
          queryKeys.guardianRosters(userId),
          previousRosters.map((athlete) => {
            if (athlete.id === playerId) {
              return {
                ...athlete,
                seasons: (athlete.seasons || []).map((season: GuardianRosterAthlete['seasons'][number]) => {
                  if (season.id === seasonId) {
                    return {
                      ...season,
                      events: (season.events || []).map((event: SeasonEvent) => {
                        if (event.id === eventId) {
                          return {
                            ...event,
                            availability: {
                              ...(event.availability || {}),
                              [playerId]: response,
                            },
                          };
                        }
                        return event;
                      }),
                    };
                  }
                  return season;
                }),
              };
            }
            return athlete;
          })
        );
      }

      return { previousSeasons, previousSeason, previousRosters };
    },
    onError: (err, variables, context) => {
      if (context?.previousSeasons) {
        qc.setQueryData(queryKeys.seasons, context.previousSeasons);
      }
      if (context?.previousSeason) {
        qc.setQueryData(queryKeys.season(seasonId), context.previousSeason);
      }
      if (userId && context?.previousRosters) {
        qc.setQueryData(queryKeys.guardianRosters(userId), context.previousRosters);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) });
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
      qc.invalidateQueries({ queryKey: queryKeys.guardianRosters() });
    },
  });
}

export function useAthleteHistoryQuery(athleteId?: string) {
  return useQuery({
    queryKey: ['athleteHistory', athleteId],
    queryFn: () => getDataSource().getAthleteHistory(athleteId!),
    enabled: !!athleteId,
  });
}

export function usePlayerProfileQuery(athleteId?: string) {
  return useQuery({
    queryKey: ['playerProfile', athleteId],
    queryFn: () => getDataSource().getPlayerProfile(athleteId!),
    enabled: !!athleteId,
  });
}

// ---- Guardian -> Coach athlete profile sharing ----

export function useCoachDirectoryQuery() {
  return useQuery({
    queryKey: queryKeys.coachDirectory,
    queryFn: () => getDataSource().getCoachDirectory(),
  });
}

export function useAthleteSharesQuery(athleteId?: string) {
  return useQuery({
    queryKey: queryKeys.athleteShares(athleteId ?? ''),
    queryFn: () => getDataSource().getMyAthleteShares(athleteId!),
    enabled: !!athleteId,
  });
}

export function useSharedAthletesForCoachQuery() {
  return useQuery({
    queryKey: queryKeys.sharedAthletes,
    queryFn: () => getDataSource().getSharedAthletesForCoach(),
  });
}

export function useAthleteShareQuery(shareId?: string) {
  return useQuery({
    queryKey: queryKeys.athleteShare(shareId ?? ''),
    queryFn: () => getDataSource().getAthleteShare(shareId!),
    enabled: !!shareId,
    // Scores on a share are a live overlay on top of the frozen snapshot (see
    // liveAthleteShareAssessments) — poll while this page is open so a coach
    // watching a pending evaluation come in doesn't have to manually refresh.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useShareAthleteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      athleteId,
      coachUserId,
      coachAccountId,
    }: {
      athleteId: string;
      coachUserId: string;
      coachAccountId: string;
    }) => getDataSource().shareAthleteWithCoach(athleteId, coachUserId, coachAccountId),
    onSuccess: (_, { athleteId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.athleteShares(athleteId) });
    },
  });
}

export function useAcceptAthleteShareMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, tryoutId }: { shareId: string; tryoutId: string }) =>
      getDataSource().acceptAthleteShare(shareId, tryoutId),
    onSuccess: (share) => {
      qc.invalidateQueries({ queryKey: queryKeys.athleteShare(share.id) });
      qc.invalidateQueries({ queryKey: queryKeys.sharedAthletes });
      qc.invalidateQueries({ queryKey: queryKeys.athleteShares(share.athleteId) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
      if (share.assignedTryoutId) {
        qc.invalidateQueries({ queryKey: queryKeys.tryout(share.assignedTryoutId) });
      }
    },
  });
}

export function useRejectAthleteShareMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => getDataSource().rejectAthleteShare(shareId),
    onSuccess: (share) => {
      qc.invalidateQueries({ queryKey: queryKeys.athleteShare(share.id) });
      qc.invalidateQueries({ queryKey: queryKeys.sharedAthletes });
    },
  });
}

export function useShareCommentsQuery(shareId?: string) {
  return useQuery({
    queryKey: queryKeys.shareComments(shareId ?? ''),
    queryFn: () => getDataSource().listShareComments(shareId!),
    enabled: !!shareId,
  });
}

export function useAddShareCommentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, body }: { shareId: string; body: string }) => getDataSource().addShareComment(shareId, body),
    onSuccess: (_, { shareId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.shareComments(shareId) });
    },
  });
}

// ---- Team chat ----
export function useTeamMessagesQuery(seasonId?: string) {
  return useQuery({
    queryKey: queryKeys.teamMessages(seasonId ?? ''),
    queryFn: () => getDataSource().listTeamMessages(seasonId!),
    enabled: !!seasonId,
  });
}

export function useSendTeamMessageMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seasonId, body }: { seasonId: string; body: string }) =>
      getDataSource().sendTeamMessage(seasonId, body),
    onSuccess: (_, { seasonId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.teamMessages(seasonId) });
    },
  });
}

export function useDeleteTeamMessageMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => getDataSource().deleteTeamMessage(messageId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.teamMessages(seasonId) });
    },
  });
}

// Unlike the other realtime hooks here, this one refetches immediately rather
// than on a debounce — a visible delay between sending and seeing a message is
// what makes a chat feel broken.
export function useTeamChatRealtimeSync(seasonId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!seasonId) return;

    const uniqueId = Math.random().toString(36).slice(2, 9);
    const channel = getSupabase()
      .channel(`realtime:season_chat_${seasonId}_${uniqueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'season_messages', filter: `season_id=eq.${seasonId}` },
        () => qc.invalidateQueries({ queryKey: queryKeys.teamMessages(seasonId) }),
      )
      .subscribe();

    return () => {
      getSupabase().removeChannel(channel);
    };
  }, [seasonId, qc]);
}

export function useAthletesQuery() {
  return useQuery({
    queryKey: ['athletes'],
    queryFn: () => getDataSource().listAthletes(),
  });
}

// ---- Phase 4: Enterprise & Admin ----
export function useOrgQuery() {
  return useQuery({
    queryKey: queryKeys.org,
    queryFn: () => getDataSource().getOrg(),
  });
}

/**
 * Loyalty code, credit balance and ledger. Guardians have no tenant account, so
 * the underlying RPC would raise for them — the screen is coach-only and the
 * query stays disabled rather than surfacing that as an error.
 */
export function useReferralSummaryQuery(enabled = true) {
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useQuery({
    queryKey: queryKeys.referralSummary,
    queryFn: () => getDataSource().getReferralSummary(),
    enabled: !!userId && enabled,
  });
}

export function useApplyReferralCodeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => getDataSource().applyReferralCode(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.referralSummary }),
  });
}

/**
 * @param includeTeamManagers  Adds the coaches a club has delegated a team to.
 *   Manage Organization asks for them; the every-route permission read does
 *   not, because they cost a read per team — see listOrgMembers().
 */
export function useOrgMembersQuery(includeTeamManagers = false) {
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useQuery({
    queryKey: queryKeys.orgMembers(userId, includeTeamManagers),
    queryFn: () => getDataSource().listOrgMembers(includeTeamManagers),
    enabled: !!userId,
  });
}

export function useInviteMemberMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: import('@/data/types').OrgRole }) =>
      getDataSource().inviteOrgMember(email, role),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.orgMembers() });
    },
  });
}

export function useResendInviteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, email, role }: { userId: string; email: string; role: import('@/data/types').OrgRole }) =>
      getDataSource().resendGuardianInvite(userId, email, role),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.orgMembers() });
    },
  });
}

export function useCreateAndInviteMemberMutation() {
  const qc = useQueryClient();
  return useMutation<import('@/data/types').OrgMember, Error, { email: string; password: string; name: string; role: import('@/data/types').OrgRole }>({
    mutationFn: ({ email, password, name, role }) =>
      getDataSource().createAndInviteUser(email, password, name, role),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.orgMembers() });
    },
  });
}

export function useUpdateMemberRoleMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: import('@/data/types').OrgRole }) =>
      getDataSource().updateOrgMemberRole(memberId, role),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.orgMembers() });
    },
  });
}

export function useRemoveMemberMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => getDataSource().removeOrgMember(memberId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.orgMembers() });
      // Removal also gives up any team the person had been delegated, and the
      // manager lists are keyed per team (['team', id, 'managers']) — there is
      // no prefix that reaches them all, so match on the shape.
      void qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === 'team' && q.queryKey[2] === 'managers',
      });
      void qc.invalidateQueries({ queryKey: queryKeys.teams });
    },
  });
}

export function useLinkGuardianMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ guardianId, tryoutId, playerId }: { guardianId: string; tryoutId: string; playerId: string }) =>
      getDataSource().linkGuardianToAthlete(guardianId, tryoutId, playerId),
    onSuccess: (_, { tryoutId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.guardianRosters() });
    },
  });
}

/**
 * `enabled` so the coach-facing dashboard, which shares a component with the
 * guardian portal, doesn't fire a guardian-only read it will never render.
 */
export function useGuardianRostersQuery(enabled = true) {
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useQuery({
    queryKey: queryKeys.guardianRosters(userId),
    queryFn: () => getDataSource().getGuardianRosters(),
    enabled: enabled && !!userId,
  });
}

/** Removes the guardian's athlete from a season's roster (guardian_leave_season RPC). */
export function useLeaveSeasonMutation() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useMutation({
    mutationFn: (seasonRosterId: string) => getDataSource().leaveSeason(seasonRosterId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.guardianRosters(userId) }),
  });
}

const familyContactsKey = (athleteId: string) => ['athletes', athleteId, 'familyContacts'] as const;

export function useFamilyContactsQuery(athleteId: string | undefined) {
  return useQuery({
    queryKey: familyContactsKey(athleteId ?? ''),
    queryFn: () => getDataSource().listFamilyContacts(athleteId!),
    enabled: !!athleteId,
  });
}

export function useAddFamilyContactMutation(athleteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contact: { name: string; relationship?: string; email?: string; phone?: string }) =>
      getDataSource().addFamilyContact(athleteId, contact),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: familyContactsKey(athleteId) });
    },
  });
}

export function useRemoveFamilyContactMutation(athleteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().removeFamilyContact(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: familyContactsKey(athleteId) });
    },
  });
}

export function useCreateTeamFeePaymentMutation() {
  return useMutation({
    mutationFn: ({ seasonRosterId, successUrl, cancelUrl }: { seasonRosterId: string; successUrl?: string; cancelUrl?: string }) =>
      getDataSource().createTeamFeePayment(seasonRosterId, successUrl, cancelUrl),
  });
}

// A guardian's portal spans every season/tryout their linked athletes are on,
// not a single season id, so this subscribes broadly rather than per-season.
export function useGuardianRealtimeSync() {
  const qc = useQueryClient();

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    const triggerInvalidate = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        qc.invalidateQueries({ queryKey: queryKeys.guardianRosters() });
      }, 1000);
    };

    const uniqueId = Math.random().toString(36).slice(2, 9);
    const channel = getSupabase()
      .channel(`realtime:guardian_${uniqueId}`)
      // No season_id filter possible here — a guardian's portal spans every
      // season across every linked athlete, not one id — so this catches a
      // coach deleting ANY season, not just the one currently on screen.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seasons' }, () => triggerInvalidate())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'season_events' }, () => triggerInvalidate())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_availability' }, () => triggerInvalidate())
      .subscribe();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      getSupabase().removeChannel(channel);
    };
  }, [qc]);
}

export function useEnterprisePaymentsQuery() {
  return useQuery({
    queryKey: queryKeys.enterprisePayments,
    queryFn: () => getDataSource().getEnterprisePayments(),
  });
}

export function useConnectAccountStatusQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.connectAccountStatus,
    queryFn: () => getDataSource().getConnectAccountStatus(),
    enabled,
    // Each run is a live Stripe accounts.retrieve, and onboarding state barely
    // ever changes — well past the global 30s default. The post-onboarding poll
    // calls refetch() directly, which ignores this.
    staleTime: 5 * 60_000,
  });
}

export function useAdminStatsQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminStats,
    queryFn: () => getDataSource().getAdminStats(),
    enabled,
  });
}

export function useAdminUsersQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminUsers,
    queryFn: () => getDataSource().listAdminUsers(),
    enabled,
  });
}

export function useOverridePlanMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, planTier }: { userId: string; planTier: UserProfile['planTier'] }) =>
      getDataSource().overrideUserPlan(userId, planTier),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminUsers });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useCopyTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().copyTryout(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tryouts'] });
    },
  });
}

export function useRestoreTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().restoreTryout(id),
    onSuccess: (_result, id) => {
      // Mirror of the archive path: clearing the flag drops it out of the
      // archived screen's filter immediately, and the invalidate below brings
      // it back onto the dashboard's active list.
      patchCachedTryoutLists<{ id: string; archived?: boolean }>(qc, ALL_TRYOUT_LISTS, id, (t) => ({
        ...t,
        archived: false,
      }));
      void qc.invalidateQueries({ queryKey: ALL_TRYOUT_LISTS });
    },
  });
}

export function useImportLibraryPlayersMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tryoutId,
      entries,
    }: {
      tryoutId: string;
      entries: { first: string; last: string; jersey?: string; pos?: string }[];
    }) => getDataSource().importLibraryPlayers(tryoutId, entries),
    onSuccess: (_, { tryoutId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
    },
  });
}

export function useSubmitFeedbackMutation() {
  return useMutation({
    mutationFn: (submission: import('../data/extras').FeedbackSubmission) =>
      getDataSource().submitFeedback(submission),
  });
}

export function useAddSeasonPlayerMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      seasonId,
      player,
    }: {
      seasonId: string;
      player: Omit<import('../data/types').SeasonPlayer, 'id'>;
    }) => withTimeout(getDataSource().addSeasonPlayer(seasonId, player), 15000),
    onSuccess: (_, { seasonId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) });
    },
  });
}

export function useImportSeasonPlayersFromTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seasonId: string) => getDataSource().importSeasonPlayersFromTeam(seasonId),
    onSuccess: (_, seasonId) => {
      qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) });
    },
  });
}

export function useEmailScheduleMutation() {
  return useMutation({
    mutationFn: (seasonId: string) => getDataSource().emailScheduleToPlayers(seasonId),
  });
}

export function useUpdateTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Team> }) =>
      getDataSource().updateTeam(id, updates),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.teams });
    },
  });
}

export function useDeleteTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().deleteTeam(id),
    // onSuccess, not onMutate: a delete the server rejects has to leave the
    // team on screen for the caller's error alert to make sense.
    onSuccess: (_result, id) => {
      qc.setQueryData<Team[]>(queryKeys.teams, (old) => old?.filter((t) => t.id !== id));
      qc.setQueryData<number>(queryKeys.teamCount, (n) =>
        typeof n === 'number' ? Math.max(0, n - 1) : n,
      );
      qc.removeQueries({ queryKey: queryKeys.teamRoster(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.teams });
      // Deleting a team detaches its assessments and retires its season.
      void qc.invalidateQueries({ queryKey: ALL_TRYOUT_LISTS });
      void qc.invalidateQueries({ queryKey: queryKeys.seasons });
    },
  });
}

export function useImportScanScoresMutation() { 
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tryoutId,
      scores,
    }: {
      tryoutId: string;
      scores: { playerId: string; rubricKey: string; value: number }[];
    }) => getDataSource().importScanScores(tryoutId, scores),
    onSuccess: (_, { tryoutId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.results(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
    },
  });
}
