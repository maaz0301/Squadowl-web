import { getDataSource } from '@/data';
import type { DummyDataOptions, DummyTeamOptions } from '@/data/testDataGenerator';
import {
  getPlayerRubrics,
  type RubricCategory
} from '@/data/rubrics';
import type {
  AddPlayerForm,
  CreateAssessmentForm,
  RegistrationSubmit,
  ScoreForm,
  Team,
  Tryout,
  UserProfile,
} from '@/data/types';
import { queryKeys } from '@/lib/queryClient';
import { getSupabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) }),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
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

export function useGenerateTestDataMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: DummyDataOptions) => getDataSource().generateTestData(tryoutId, options),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.results(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
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

export function useGenerateDummyTeamsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: DummyTeamOptions) => getDataSource().generateDummyTeams(options),
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
    } catch (e: any) {
      // Already on the season roster (unique athlete-per-season constraint) —
      // that's the state we wanted, so don't fail the event that triggered this.
      const duplicate =
        e?.code === '23505' || /duplicate key value/i.test(e?.message ?? '');
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

      const previousSeasons = qc.getQueryData<any[]>(queryKeys.seasons);
      if (previousSeasons) {
        qc.setQueryData(
          queryKeys.seasons,
          previousSeasons.map((season) => {
            if (season.id === seasonId) {
              return {
                ...season,
                events: (season.events || []).map((event: any) => {
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

      const previousSeason = qc.getQueryData<any>(queryKeys.season(seasonId));
      if (previousSeason) {
        qc.setQueryData(queryKeys.season(seasonId), {
          ...previousSeason,
          events: (previousSeason.events || []).map((event: any) => {
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

      const previousRosters = userId ? qc.getQueryData<any[]>(queryKeys.guardianRosters(userId)) : undefined;
      if (userId && previousRosters) {
        qc.setQueryData(
          queryKeys.guardianRosters(userId),
          previousRosters.map((athlete) => {
            if (athlete.id === playerId) {
              return {
                ...athlete,
                seasons: (athlete.seasons || []).map((season: any) => {
                  if (season.id === seasonId) {
                    return {
                      ...season,
                      events: (season.events || []).map((event: any) => {
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
      (getDataSource() as any).resendGuardianInvite(userId, email, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers() }),
  });
}

export function useCreateAndInviteMemberMutation() {
  const qc = useQueryClient();
  return useMutation<import('@/data/types').OrgMember, Error, { email: string; password: string; name: string; role: import('@/data/types').OrgRole }>({
    mutationFn: ({ email, password, name, role }) =>
      (getDataSource() as any).createAndInviteUser(email, password, name, role),
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

export function useEnterprisePaymentsQuery() {
  return useQuery({
    queryKey: queryKeys.enterprisePayments,
    queryFn: () => getDataSource().getEnterprisePayments(),
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
