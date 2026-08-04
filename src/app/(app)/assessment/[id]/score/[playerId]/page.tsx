'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  Button,
  Chip,
  ErrorState,
  LoadingState,
  PageHeader,
  ScorePad,
  SectionLabel,
  Textarea,
  useAlert,
} from '@/components/ui';
import {
  categoryAverage,
  getPlayerCategories,
  isGoaliePosition,
  mapLegacyScores,
  playerDisplayName,
  weightedOverall,
} from '@/data/rubrics';
import { RECOMMENDATIONS, ScoreFormSchema, type ScoreForm } from '@/data/types';
import { useAthleteHistoryQuery, useSaveEvaluationMutation, useTryoutQuery } from '@/features/queries';
import { useAssessmentHref, useAssessmentId, useAssessorMode } from '@/features/useAssessmentId';
import { useSessionStore } from '@/state/sessionStore';
import { useThemeColors } from '@/theme/ThemeProvider';

export default function ScorePage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const assessorMode = useAssessorMode();
  const routeParams = useParams();
  const playerId = Array.isArray(routeParams?.playerId)
    ? routeParams.playerId[0]
    : (routeParams?.playerId as string);
  const search = useSearchParams();
  const evalId = search.get('evalId') || undefined;
  const routeSession = search.get('session') || undefined;

  const colors = useThemeColors();
  const router = useRouter();
  const { alert } = useAlert();
  const [saving, setSaving] = useState(false);
  const tryoutQuery = useTryoutQuery(id);
  const saveEval = useSaveEvaluationMutation(id!);
  const workingScores = useSessionStore((s) => s.workingScores);
  const setWorkingScores = useSessionStore((s) => s.setWorkingScores);
  const clearWorkingScores = useSessionStore((s) => s.clearWorkingScores);
  const activeAssessor = useSessionStore((s) => s.activeAssessor);
  const setActiveAssessor = useSessionStore((s) => s.setActiveAssessor);
  const completedSessions = useSessionStore((s) => s.completedSessions);
  const markSessionCompleted = useSessionStore((s) => s.markSessionCompleted);
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeMutationRef = useRef<Promise<{ id: string }> | null>(null);

  /** Web stand-in for navigation.setParams — rewrites the query without a reload. */
  const setParams = useCallback(
    (next: { evalId?: string | null; session?: string }) => {
      const params = new URLSearchParams(search.toString());
      if ('evalId' in next) {
        if (next.evalId) params.set('evalId', next.evalId);
        else params.delete('evalId');
      }
      if (next.session) params.set('session', next.session);
      if (assessorMode) params.set('assessor', '1');
      router.replace(`/assessment/${id}/score/${playerId}?${params.toString()}`, { scroll: false });
    },
    [search, router, id, playerId, assessorMode],
  );

  const player = tryoutQuery.data?.roster.find((p) => p.id === playerId);
  const historyQuery = useAthleteHistoryQuery(player?.athleteId);
  const existingEval = evalId ? tryoutQuery.data?.evals.find((e) => e.id === evalId) : undefined;

  const scoredSessions = useMemo(
    () =>
      new Map(
        (tryoutQuery.data?.evals.filter((e) => e.playerId === playerId) || []).map((e) => [e.session, e.id]),
      ),
    [tryoutQuery.data?.evals, playerId],
  );

  const baseHighestSessionNum = useMemo(
    () =>
      (tryoutQuery.data?.evals || []).reduce((max, ev) => {
        if (!ev.session) return max;
        const hasScores = ev.scores && Object.values(ev.scores).some((val) => val != null && val > 0);
        if (!hasScores) return max;
        const match = ev.session.match(/^Session (\d+)$/);
        return match ? Math.max(max, parseInt(match[1], 10)) : max;
      }, 0),
    [tryoutQuery.data?.evals],
  );

  const highestSessionNum = useMemo(() => {
    let maxNum = baseHighestSessionNum;
    const match = routeSession?.match(/^Session (\d+)$/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    return maxNum;
  }, [baseHighestSessionNum, routeSession]);

  const SESSIONS = useMemo(() => {
    const count = Math.max(5, highestSessionNum + 1);
    const sessions = Array.from({ length: count }, (_, i) => `Session ${i + 1}`);
    sessions.push('Extra View');
    return sessions;
  }, [highestSessionNum]);

  const completedSessionsForPlayer = useMemo(
    () => completedSessions?.[playerId || ''] || [],
    [completedSessions, playerId],
  );

  const nextSession =
    existingEval?.session ??
    SESSIONS.find((s) => !completedSessionsForPlayer.includes(s) && !scoredSessions.has(s) && s !== 'Extra View') ??
    'Session 1';
  const currentSession = routeSession ?? nextSession;

  const categories = useMemo(() => {
    if (!tryoutQuery.data || !player) return [];
    return getPlayerCategories(tryoutQuery.data.sport, player.pos, tryoutQuery.data.settings.customRubrics);
  }, [tryoutQuery.data, player]);

  const weights = useMemo(() => {
    if (!tryoutQuery.data || !player) return {};
    return isGoaliePosition(player.pos)
      ? tryoutQuery.data.settings.goalieWeights
      : tryoutQuery.data.settings.skaterWeights;
  }, [tryoutQuery.data, player]);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = useForm<ScoreForm>({
    resolver: zodResolver(ScoreFormSchema),
    defaultValues: {
      session: currentSession,
      strengths: existingEval?.strengths ?? '',
      improve: existingEval?.improve ?? '',
      recommendation: existingEval?.recommendation ?? '',
      scores: mapLegacyScores(existingEval?.scores ?? {}, categories),
    },
  });

  const scores = watch('scores');
  const formData = watch();
  const previousFormRef = useRef<string>('');
  const lastLoadedRef = useRef<{ playerId: string; evalId?: string; session?: string } | null>(null);

  const loadEvalData = (targetEvalId?: string | null, targetSession?: string, preserveWorkingScores = false) => {
    activeMutationRef.current = null;
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }

    const currentSess = targetSession ?? currentSession;
    if (playerId) {
      lastLoadedRef.current = { playerId, evalId: targetEvalId ?? undefined, session: currentSess };
    }

    const targetEval = targetEvalId
      ? tryoutQuery.data?.evals.find((e) => e.id === targetEvalId && e.session === currentSess)
      : undefined;

    const scoresToSet = targetEval
      ? mapLegacyScores(targetEval.scores ?? {}, categories)
      : preserveWorkingScores && Object.keys(workingScores).length > 0
        ? workingScores
        : mapLegacyScores({}, categories);

    setWorkingScores(scoresToSet);

    const currentValues = getValues();
    const newValues: ScoreForm = {
      session: targetEval?.session ?? currentSess,
      strengths: preserveWorkingScores ? currentValues.strengths : (targetEval?.strengths ?? ''),
      improve: preserveWorkingScores ? currentValues.improve : (targetEval?.improve ?? ''),
      recommendation: preserveWorkingScores ? currentValues.recommendation : (targetEval?.recommendation ?? ''),
      scores: scoresToSet,
    };

    reset(newValues);
    previousFormRef.current = JSON.stringify(newValues);
  };

  useEffect(() => {
    if (!tryoutQuery.data || !playerId) return;

    const lastPlayerId = lastLoadedRef.current?.playerId;
    const lastEvalId = lastLoadedRef.current?.evalId;
    const lastSession = lastLoadedRef.current?.session;

    const isPlayerChanged = lastPlayerId && lastPlayerId !== playerId;
    const isSessionChanged = lastPlayerId && lastSession !== currentSession;
    // Only reload when switching between two distinct saved evaluations; going
    // from "no id" to "id" is just the autosave landing and must not reset.
    const isEvalSwitched = lastPlayerId && lastEvalId && evalId && lastEvalId !== evalId;

    if (isPlayerChanged || isSessionChanged || isEvalSwitched) {
      const currentFormVal = getValues();
      const hasUnsaved = previousFormRef.current && previousFormRef.current !== JSON.stringify(currentFormVal);

      if (hasUnsaved) {
        const hasScores = currentFormVal.scores && Object.values(currentFormVal.scores).some((v) => v != null && v > 0);
        if (hasScores && currentFormVal.recommendation) {
          saveEval.mutate({
            playerId: lastPlayerId || playerId,
            form: { ...currentFormVal, session: lastSession || currentFormVal.session },
            evalId: lastEvalId ?? undefined,
          });
        }
      }

      const shouldPreserve = !isPlayerChanged && !isSessionChanged;
      lastLoadedRef.current = { playerId, evalId: evalId ?? undefined, session: currentSession };
      loadEvalData(evalId, currentSession, shouldPreserve);
    } else {
      lastLoadedRef.current = { playerId, evalId: evalId ?? undefined, session: currentSession };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tryoutQuery.data, playerId, evalId, currentSession]);

  useEffect(() => {
    setValue('scores', workingScores);
  }, [workingScores, setValue]);

  const currentFormRef = useRef<{
    form: ScoreForm;
    playerId: string;
    evalId?: string | null;
    session: string;
  } | null>(null);

  useEffect(() => {
    currentFormRef.current = { form: formData, playerId, evalId: evalId ?? null, session: currentSession };
  }, [formData, playerId, evalId, currentSession]);

  // Flush unsaved work when leaving the screen.
  useEffect(() => {
    return () => {
      if (!currentFormRef.current) return;
      const { form, playerId: pId, evalId: eId, session: sName } = currentFormRef.current;
      const hasUnsaved = previousFormRef.current && previousFormRef.current !== JSON.stringify(form);
      if (!hasUnsaved) return;
      const hasScores = form.scores && Object.values(form.scores).some((v) => v != null && v > 0);
      if (hasScores && form.recommendation) {
        saveEval.mutate({ playerId: pId, form: { ...form, session: sName }, evalId: eId ?? undefined });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autosave.
  useEffect(() => {
    const currentFormStr = JSON.stringify(formData);
    if (previousFormRef.current === currentFormStr || previousFormRef.current === '') {
      if (previousFormRef.current === '') previousFormRef.current = currentFormStr;
      return;
    }

    const hasScores = formData.scores && Object.values(formData.scores).some((v) => v != null && v > 0);
    if (!hasScores || !formData.recommendation) return;

    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);

    autoSaveTimeoutRef.current = setTimeout(async () => {
      const mutationPromise = saveEval.mutateAsync({
        playerId: playerId!,
        form: formData,
        evalId: evalId ?? undefined,
      });
      activeMutationRef.current = mutationPromise;

      try {
        const result = await mutationPromise;
        if (activeMutationRef.current === mutationPromise) {
          if (!evalId && result.id) setParams({ evalId: result.id, session: currentSession });
          previousFormRef.current = JSON.stringify(formData);
        }
      } catch (err) {
        console.warn('Auto-save failed', err);
      } finally {
        if (activeMutationRef.current === mutationPromise) activeMutationRef.current = null;
      }
    }, 1500);

    return () => {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, evalId, playerId]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutQuery.isError) {
    return <ErrorState message="Could not load required data." onRetry={() => tryoutQuery.refetch()} />;
  }
  if (!player || !tryoutQuery.data) {
    return <ErrorState message="Player not found." onRetry={() => tryoutQuery.refetch()} />;
  }

  const overall = weightedOverall(scores ?? {}, categories, weights);
  const isEditing = !!evalId;
  const firstUnscoredIdx = SESSIONS.findIndex((s) => !scoredSessions.has(s));

  const onSubmit = handleSubmit(async (data) => {
    try {
      setSaving(true);
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }

      if (activeMutationRef.current) {
        try {
          const result = await activeMutationRef.current;
          if (!evalId && result?.id) setParams({ evalId: result.id, session: currentSession });
        } catch (e) {
          console.warn('Pre-submit auto-save await failed', e);
        }
      }

      const currentFormStr = JSON.stringify(data);
      if (previousFormRef.current !== currentFormStr) {
        const hasScores = data.scores && Object.values(data.scores).some((v) => v != null && v > 0);
        if (!hasScores) {
          await alert('No scores entered', 'Please grade at least one subskill before saving.');
          setSaving(false);
          return;
        }

        await saveEval.mutateAsync({ playerId: playerId!, form: data, evalId: evalId ?? undefined });
        previousFormRef.current = currentFormStr;
      }

      if (playerId) markSessionCompleted(playerId, data.session);

      const currentIdx = SESSIONS.indexOf(data.session);
      if (currentIdx !== -1 && currentIdx < SESSIONS.length - 1) {
        const nextSess = SESSIONS[currentIdx + 1];
        setParams({ evalId: scoredSessions.get(nextSess) || null, session: nextSess });
      } else {
        clearWorkingScores();
        router.push(href(`player/${playerId}`));
      }
    } catch (err) {
      await alert('Error', err instanceof Error ? err.message : 'Failed to save evaluation.');
    } finally {
      setSaving(false);
    }
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Score: ${playerDisplayName(player)}`}
        subtitle={`Overall: ${overall > 0 ? overall.toFixed(1) : '—'}`}
        showBack
        backHref={href('roster')}
      />

      {tryoutQuery.data.assessors.length > 0 ? (
        <div className="mb-5">
          <SectionLabel className="mb-1.5">Scoring as</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {tryoutQuery.data.assessors.map((a, i) => {
              const isActive = activeAssessor?.name === a.name && activeAssessor?.email === a.email;
              return (
                <Chip
                  key={`${a.name}-${a.email}-${i}`}
                  label={a.name}
                  active={isActive}
                  onClick={() => setActiveAssessor(isActive ? null : a)}
                />
              );
            })}
          </div>
          {activeAssessor ? (
            <p className="mt-1 text-sm" style={{ color: colors.inkFaint }}>
              Evaluations tagged to {activeAssessor.name}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
        {SESSIONS.map((s, idx) => {
          const isScored = scoredSessions.has(s);
          const disabled = !isScored && firstUnscoredIdx !== -1 && idx > firstUnscoredIdx;
          return (
            <Chip
              key={s}
              label={s}
              active={currentSession === s}
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                setParams({ evalId: scoredSessions.get(s) ?? null, session: s });
              }}
            />
          );
        })}
      </div>

      {categories.map((cat) => {
        const catAvg = categoryAverage(scores ?? {}, cat.subskills);
        return (
          <div key={cat.key} className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <span
                className="text-base font-bold"
                style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
              >
                {cat.label}
              </span>
              <span className="text-sm font-bold" style={{ color: colors.primary }}>
                {catAvg !== null ? catAvg.toFixed(1) : '—'}
              </span>
            </div>
            {cat.subskills.map((s) => (
              <ScorePad
                key={s.key}
                rubricKey={s.key}
                label={s.label}
                scale={s.scale}
                scoringType={s.scoringType}
                unit={s.unit}
                minVal={s.minVal}
                maxVal={s.maxVal}
                rankingDirection={s.rankingDirection}
                value={scores?.[s.key]}
                onChange={(v) => {
                  const newScores = { ...workingScores, [s.key]: v };
                  setWorkingScores(newScores);
                  setValue('scores', newScores, { shouldDirty: true });
                }}
              />
            ))}
          </div>
        );
      })}

      <div className="mb-2 flex items-center justify-between">
        <SectionLabel>Recommendation *</SectionLabel>
        {errors.recommendation ? (
          <span className="text-sm font-medium" style={{ color: colors.danger }}>
            {errors.recommendation.message}
          </span>
        ) : null}
      </div>
      <Controller
        control={control}
        name="recommendation"
        render={({ field: { value, onChange } }) => (
          <div className="mb-5 flex flex-wrap gap-2">
            {RECOMMENDATIONS.filter(Boolean).map((rec) => (
              <Chip key={rec} label={rec} active={value === rec} onClick={() => onChange(value === rec ? '' : rec)} />
            ))}
          </div>
        )}
      />

      <div className="flex flex-col gap-4">
        <Controller
          control={control}
          name="strengths"
          render={({ field }) => <Textarea label="Strengths" rows={3} {...field} value={field.value ?? ''} />}
        />
        <Controller
          control={control}
          name="improve"
          render={({ field }) => <Textarea label="Areas to Improve" rows={3} {...field} value={field.value ?? ''} />}
        />
      </div>

      <div
        className="sticky bottom-0 mt-6 flex flex-col gap-2 border-t py-4"
        style={{ borderColor: colors.border, backgroundColor: colors.bg }}
      >
        <p
          className="text-center text-2xl font-bold"
          style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}
        >
          Overall: {overall > 0 ? overall.toFixed(1) : '—'}
        </p>
        <Button label={isEditing ? 'Save & Continue' : 'Done'} onClick={onSubmit} loading={saving} size="lg" />
      </div>
    </div>
  );
}
