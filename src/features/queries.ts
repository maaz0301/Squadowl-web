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

export function useCreateTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, season }: { name: string; season?: string }) =>
      withTimeout(getDataSource().createTeam(name, season), 15000),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teams }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teams }),
  });
}

// ---- Team roster ----
const teamRosterKey = (teamId: string) => ['teams', teamId, 'roster'] as const;

export function useTeamRosterQuery(teamId: string | undefined) {
  return useQuery({
    queryKey: teamRosterKey(teamId ?? ''),
    queryFn: () => getDataSource().listTeamRoster(teamId!),
    enabled: !!teamId,
  });
}

export function useAddTeamRosterPlayersMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries: { athleteId: string; jersey?: string; pos?: string; sourceTryoutId?: string }[]) =>
      getDataSource().addTeamRosterPlayers(teamId, entries),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamRosterKey(teamId) }),
  });
}

export function useRemoveTeamRosterPlayerMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (athleteId: string) => getDataSource().removeTeamRosterPlayer(teamId, athleteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamRosterKey(teamId) }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teamManagers(teamId) }),
  });
}

export function useRemoveTeamManagerMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (managerId: string) => getDataSource().removeTeamManager(managerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teamManagers(teamId) }),
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
export function useTryoutsQuery(includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.tryouts(includeArchived),
    queryFn: () => getDataSource().listTryouts(includeArchived),
  });
}

export function useAssignedTryoutsQuery() {
  return useQuery({
    queryKey: queryKeys.assignedTryouts,
    queryFn: () => getDataSource().listAssignedTryouts(),
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
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
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

export function useArchiveTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().archiveTryout(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
    },
  });
}

export function useDeleteTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().deleteTryout(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) }),
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
      qc.invalidateQueries({ queryKey: teamRosterKey(teamId) });
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
        qc.invalidateQueries({ queryKey: teamRosterKey(destination.id) });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) }),
  });
}

export function useGenerateTestDataMutation(tryoutId: string, onProgress?: (done: number, total: number) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: tryoutBulkWriteKey(tryoutId),
    mutationFn: (options: DummyDataOptions) => getDataSource().generateTestData(tryoutId, options, onProgress),
    onSuccess: (res) => {
      // Same reasoning as usePlaceRegistrationsMutation: bump cached roster
      // lengths immediately (placeholder rows, since generateTestData only
      // returns a count) rather than leaving list badges — the dashboard's
      // "N players" chip — stale until the background refetch below lands.
      if (res.players > 0) {
        const stubs: Player[] = Array.from({ length: res.players }, (_, i) => ({
          id: `dummy-${Date.now()}-${i}`,
          first: '',
          last: '',
          createdAt: Date.now(),
        }));
        patchTryoutRosterCaches(qc, tryoutId, stubs);
      }
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.teams });
      // Prefix match — invalidates every archived/unarchived tryout list.
      qc.invalidateQueries({ queryKey: ['tryouts'] });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.profile }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.profile }),
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
    mutationFn: (config: import('@/data/teamBuilder').TeamBuilderConfig) =>
      withTimeout(
        getDataSource().generateTeamBuilder(tryoutId, config),
        60000,
        'Team builder generation timed out. Claude AI might be taking longer than usual, please try again.'
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teamBuilderResults(tryoutId) }),
  });
}

export function useDeleteTeamBuilderResultMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().deleteTeamBuilderResult(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teamBuilderResults(tryoutId) }),
  });
}

export function useAiPlayerSummaryMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerId: string) => 
      withTimeout(
        getDataSource().getAiPlayerSummary(tryoutId, playerId), 
        20000, 
        'Generation timed out. The server might be busy, please try again.'
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) }),
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

export function useSeasonQuery(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.season(id ?? ''),
    queryFn: () => getDataSource().getSeason(id!),
    enabled: !!id,
  });
}

export function useCreateSeasonMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: import('@/data/types').CreateSeasonForm) => withTimeout(getDataSource().createSeason(form), 15000),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.seasons }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.seasons }),
  });
}

export function useAddSeasonEventMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: import('@/data/types').CreateEventForm) =>
      getDataSource().addSeasonEvent(seasonId, form),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) }),
  });
}

/**
 * Copies any team-roster player missing from the season roster across, then
 * returns the season roster. Availability (and therefore guardian portal
 * visibility) is keyed on season roster entries, so this is what makes a team
 * player actually receive events.
 */
async function syncSeasonRosterFromTeam(teamId: string, seasonId: string) {
  const ds = getDataSource();
  const [teamRoster, season] = await Promise.all([
    ds.listTeamRoster(teamId),
    ds.getSeason(seasonId),
  ]);
  const alreadyOnSeason = new Set((season?.roster ?? []).map((p) => p.athleteId).filter(Boolean));
  const missing = teamRoster.filter((p) => p.athleteId && !alreadyOnSeason.has(p.athleteId));
  if (missing.length === 0) return season?.roster ?? [];

  for (const p of missing) {
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
    }
  }
  const refreshed = await ds.getSeason(seasonId);
  return refreshed?.roster ?? [];
}

/**
 * Events belong to a season, but the UI only exposes them at the team level —
 * coaches add practices and games from the team screen and never see the season
 * machinery. A team that has no season yet gets one silently on its first event,
 * which also covers teams created before seasons were auto-provisioned.
 */
export function useAddTeamEventMutation(
  teamId: string,
  teamName: string,
  seasonId: string | undefined,
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
      const roster = await syncSeasonRosterFromTeam(teamId, sid);
      await getDataSource().addSeasonEvent(sid, { ...form, playerIds: roster.map((p) => p.id) });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) }),
  });
}

export function useDeleteSeasonEventMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => getDataSource().deleteSeasonEvent(seasonId, eventId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) }),
  });
}

export function usePortalInviteMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playerId, email }: { playerId: string; email: string }) =>
      getDataSource().sendPortalInvite(seasonId, playerId, email),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teamMessages(seasonId) }),
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

export function useOrgMembersQuery() {
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useQuery({
    queryKey: queryKeys.orgMembers(userId),
    queryFn: () => getDataSource().listOrgMembers(),
    enabled: !!userId,
  });
}

export function useInviteMemberMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: import('@/data/types').OrgRole }) =>
      getDataSource().inviteOrgMember(email, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers() }),
  });
}

export function useResendInviteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, email, role }: { userId: string; email: string; role: import('@/data/types').OrgRole }) =>
      getDataSource().resendGuardianInvite(userId, email, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers() }),
  });
}

export function useCreateAndInviteMemberMutation() {
  const qc = useQueryClient();
  return useMutation<import('@/data/types').OrgMember, Error, { email: string; password: string; name: string; role: import('@/data/types').OrgRole }>({
    mutationFn: ({ email, password, name, role }) =>
      getDataSource().createAndInviteUser(email, password, name, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers() }),
  });
}

export function useUpdateMemberRoleMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: import('@/data/types').OrgRole }) =>
      getDataSource().updateOrgMemberRole(memberId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers() }),
  });
}

export function useRemoveMemberMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => getDataSource().removeOrgMember(memberId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers() }),
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

export function useGuardianRostersQuery() {
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useQuery({
    queryKey: queryKeys.guardianRosters(userId),
    queryFn: () => getDataSource().getGuardianRosters(),
    enabled: !!userId,
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tryouts'] });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teams }),
  });
}

export function useDeleteTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().deleteTeam(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.teams });
      // Deleting a team detaches its assessments and retires its season.
      qc.invalidateQueries({ queryKey: ['tryouts'] });
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
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
