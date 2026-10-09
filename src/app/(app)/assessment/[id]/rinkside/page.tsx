'use client';

import { useTerms } from '@/lib/terms';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ScorePad,
  SectionLabel,
  useAlert,
} from '@/components/ui';
import {
  useTryoutQuery,
  useSaveEvaluationMutation,
  useAthleteHistoryQuery,
  useSessionProgressQuery,
} from '@/features/queries';
import { useAssessmentHref, useAssessmentId, useIsAssessorOnly } from '@/features/useAssessmentId';
import { useSessionStore } from '@/state/sessionStore';
import {
  categoryAverage,
  getPlayerCategories,
  isGoaliePosition,
  playerDisplayName,
  weightedOverall,
  mapLegacyScores,
} from '@/data/rubrics';
import type { Recommendation } from '@/data/types';

export default function RinksidePage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const router = useRouter();
  const { alert } = useAlert();
  const tryoutQuery = useTryoutQuery(id);
  const terms = useTerms(tryoutQuery.data?.settings.customLabels, tryoutQuery.data?.sport);
  const saveEval = useSaveEvaluationMutation(id!);
  const rinksideIndex = useSessionStore((s) => s.rinksideIndex);
  const setRinksideIndex = useSessionStore((s) => s.setRinksideIndex);
  const workingScores = useSessionStore((s) => s.workingScores);
  const setWorkingScores = useSessionStore((s) => s.setWorkingScores);
  const clearWorkingScores = useSessionStore((s) => s.clearWorkingScores);
  const completedSessions = useSessionStore((s) => s.completedSessions);
  const markSessionCompleted = useSessionStore((s) => s.markSessionCompleted);
  const [session, setSession] = useState('Session 1');
  const [recommendation, setRecommendation] = useState<Recommendation>('');
  const [isSaving, setIsSaving] = useState(false);
  const previousStateRef = useRef<string>('');
  const lastLoadedRef = useRef<{ playerId: string; session: string } | null>(null);
  const activeMutationRef = useRef<Promise<unknown> | null>(null);

  const roster = useMemo(() => tryoutQuery.data?.roster ?? [], [tryoutQuery.data?.roster]);
  const player = roster[rinksideIndex];

  // Same resolution as the layout's tab-hiding — see useIsAssessorOnly.
  const isAssessorOnly = useIsAssessorOnly(tryoutQuery.data?.viewerIsOwner);
  // Athlete history spans previous seasons, which an assessor may not see at
  // all — passing no id leaves the query disabled so it is never fetched.
  const historyQuery = useAthleteHistoryQuery(isAssessorOnly ? undefined : player?.athleteId);
  // Only an assessor needs this: a coach already has every evaluation loaded.
  const sessionProgressQuery = useSessionProgressQuery(id, isAssessorOnly);
  const sessionProgress = sessionProgressQuery.data;

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

  // Only this assessment's own evaluations may seed the score form. Session
  // labels ("Session 1") repeat across every season, so matching against the
  // athlete's history loaded last season's scores into this season's first
  // entry for a player — scoring them under the wrong season.
  const currentEvals = useMemo(
    () =>
      (tryoutQuery.data?.evals.filter((e) => e.playerId === player?.id) ?? [])
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt),
    [tryoutQuery.data?.evals, player?.id],
  );

  const highestSessionNum = useMemo(() => {
    let maxNum = (tryoutQuery.data?.evals || []).reduce((max, ev) => {
      if (!ev.session) return max;
      const hasScores = ev.scores && Object.values(ev.scores).some((val) => val != null && val > 0);
      if (!hasScores) return max;
      const match = ev.session.match(/^Session (\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);
    const currentMatch = session?.match(/^Session (\d+)$/);
    if (currentMatch) maxNum = Math.max(maxNum, parseInt(currentMatch[1], 10));
    return maxNum;
  }, [tryoutQuery.data?.evals, session]);

  const SESSIONS = useMemo(() => {
    const count = Math.max(5, highestSessionNum + 1);
    const sessions = Array.from({ length: count }, (_, i) => `Session ${i + 1}`);
    sessions.push('Extra View');
    return sessions;
  }, [highestSessionNum]);

  const scoredSessions = useMemo(() => {
    if (!tryoutQuery.data || !player) return new Set<string>();
    return new Set(
      (tryoutQuery.data.evals || []).filter((e) => e.playerId === player.id).map((e) => e.session),
    );
  }, [tryoutQuery.data, player]);

  // Highest session number this player already has scored/completed data for.
  const highestDoneSessionNum = useMemo(() => {
    const completedForPlayer = completedSessions?.[player?.id || ''] || [];
    const done = [...completedForPlayer, ...Array.from(scoredSessions)];
    const fromLoadedEvals = done.reduce((max, s) => {
      const match = s?.match(/^Session (\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);
    // An assessor reads back none of the assessment's evaluations, so the
    // labels above see only what they scored in this sitting — without this
    // their first save restarted a player at Session 1 alongside the coach's
    // Sessions 1-5. The server hands over the numbering and nothing else.
    const fromServer = sessionProgress?.[player?.id || ''] ?? 0;
    return Math.max(fromLoadedEvals, fromServer);
  }, [completedSessions, scoredSessions, sessionProgress, player?.id]);

  // Default to the session *after* the last completed one.
  const defaultSessionForPlayer = useMemo(
    () => `Session ${highestDoneSessionNum + 1}`,
    [highestDoneSessionNum],
  );

  // The strip scrolls horizontally, but a plain mouse wheel only reports
  // vertical delta — a trackpad's horizontal swipe translates on its own, a
  // wheel doesn't, so without this the strip reads as stuck.
  const sessionStripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sessionStripRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keeps whichever session is selected in view — otherwise a session late in
  // the list is picked (say, restored on player change) and the strip still
  // shows wherever it happened to be scrolled, with no hint of which chip is active.
  const activeSessionChipRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeSessionChipRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [session]);

  const lastPlayerIdRef = useRef<string | null>(null);

  // The default is applied once per player, so it has to wait for the session
  // numbering: settling for Session 1 and correcting afterwards would be
  // blocked by that same guard. Disabled for a coach, where it is never
  // loading and this is the old behaviour unchanged.
  const sessionNumberingReady = !sessionProgressQuery.isLoading;

  useEffect(() => {
    if (player?.id && sessionNumberingReady && lastPlayerIdRef.current !== player.id) {
      lastPlayerIdRef.current = player.id;
      setSession(defaultSessionForPlayer);
    }
  }, [player?.id, defaultSessionForPlayer, sessionNumberingReady]);

  // Opening the screen starts at the first player on a freshly-defaulted, empty
  // session. `recommendation` isn't reset here — its own useState initializer
  // already starts it at '', so resetting it again on mount would just be a
  // redundant synchronous setState.
  useEffect(() => {
    setRinksideIndex(0);
    lastPlayerIdRef.current = null;
    clearWorkingScores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!player) return;

    const lastPlayerId = lastLoadedRef.current?.playerId;
    const lastSession = lastLoadedRef.current?.session;

    if (lastPlayerId && lastSession && (lastPlayerId !== player.id || lastSession !== session)) {
      const currentStateStr = JSON.stringify({ scores: workingScores, recommendation });
      const hasUnsavedChanges = previousStateRef.current && previousStateRef.current !== currentStateStr;

      if (hasUnsavedChanges) {
        const prevPlayer = roster.find((p) => p.id === lastPlayerId);
        if (prevPlayer) {
          const hasScores = workingScores && Object.values(workingScores).some((val) => val != null && val > 0);
          if (hasScores) {
            const prevEval = tryoutQuery.data?.evals.find(
              (e) => e.playerId === lastPlayerId && e.session === lastSession,
            );
            const promise = saveEval.mutateAsync({
              playerId: prevPlayer.id,
              form: { session: lastSession, scores: workingScores, recommendation },
              evalId: prevEval?.id,
            });
            activeMutationRef.current = promise;
            promise
              .catch((err) => console.warn('Rinkside auto-save on player change failed', err))
              .finally(() => {
                if (activeMutationRef.current === promise) activeMutationRef.current = null;
              });
          }
        }
      }
    }

    const isPlayerChanged = lastPlayerId !== player.id;
    const isSessionChanged = lastSession !== session;

    if (isPlayerChanged || isSessionChanged || !lastLoadedRef.current) {
      const evalForSession = currentEvals.find((e) => e.session === session);
      const loadedScores = evalForSession
        ? mapLegacyScores(evalForSession.scores, categories)
        : mapLegacyScores({}, categories);
      const loadedRec = (evalForSession?.recommendation ?? '') as Recommendation;

      setWorkingScores(loadedScores);
      setRecommendation(loadedRec);
      previousStateRef.current = JSON.stringify({ scores: loadedScores, recommendation: loadedRec });
      lastLoadedRef.current = { playerId: player.id, session };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.id, session, currentEvals]);

  const goNext = () => {
    if (rinksideIndex < roster.length - 1) setRinksideIndex(rinksideIndex + 1);
  };
  const goPrev = () => {
    if (rinksideIndex > 0) setRinksideIndex(rinksideIndex - 1);
  };

  // Arrow keys stand in for the app's left/right swipe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const currentStateRef = useRef({ scores: workingScores, recommendation, player, session });
  useEffect(() => {
    currentStateRef.current = { scores: workingScores, recommendation, player, session };
  }, [workingScores, recommendation, player, session]);

  // Flush unsaved work when leaving the screen.
  useEffect(() => {
    return () => {
      const { scores, recommendation: rec, player: curPlayer, session: curSession } = currentStateRef.current;
      if (!curPlayer) return;

      const currentStateStr = JSON.stringify({ scores, recommendation: rec });
      const hasUnsavedChanges = previousStateRef.current && previousStateRef.current !== currentStateStr;
      if (!hasUnsavedChanges) return;

      const hasScores = scores && Object.values(scores).some((val) => val != null && val > 0);
      if (hasScores) {
        const prevEval = tryoutQuery.data?.evals.find(
          (e) => e.playerId === curPlayer.id && e.session === curSession,
        );
        saveEval.mutate({
          playerId: curPlayer.id,
          form: { session: curSession, scores, recommendation: rec },
          evalId: prevEval?.id,
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading rinkside mode..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load evaluation." onRetry={() => tryoutQuery.refetch()} />;
  }

  if (roster.length === 0) {
    return (
      <>
        <PageHeader title="Rinkside Scoring" showBack backHref={href('roster')} />
        <EmptyState title={terms.t('No players')} message={terms.t('Add players to the roster first.')} />
      </>
    );
  }

  const overall = weightedOverall(workingScores, categories, weights);
  const scoredSessionsMap = new Map(
    (tryoutQuery.data?.evals.filter((e) => e.playerId === player?.id) || []).map((e) => [e.session, e.id]),
  );

  const saveAndNext = async () => {
    if (!player) return;

    if (activeMutationRef.current) {
      try {
        await activeMutationRef.current;
      } catch (e) {
        console.warn('Pre-saveAndNext auto-save await failed', e);
      }
    }

    const currentStateStr = JSON.stringify({ scores: workingScores, recommendation });
    const hasUnsavedChanges = previousStateRef.current !== currentStateStr;

    const advance = async () => {
      if (rinksideIndex < roster.length - 1) {
        setRinksideIndex(rinksideIndex + 1);
      } else {
        await alert('Finished', 'You have reached the end of the roster.');
        router.push(href('roster'));
      }
    };

    if (!hasUnsavedChanges) {
      clearWorkingScores();
      setRecommendation('');
      await advance();
      return;
    }

    const hasScores = workingScores && Object.values(workingScores).some((val) => val != null && val > 0);
    if (!hasScores) {
      clearWorkingScores();
      setRecommendation('');
      await advance();
      return;
    }

    try {
      setIsSaving(true);
      const curEval = tryoutQuery.data?.evals.find(
        (e) => e.playerId === player.id && e.session === session,
      );
      await saveEval.mutateAsync({
        playerId: player.id,
        form: { session, scores: workingScores, recommendation },
        evalId: curEval?.id,
      });

      markSessionCompleted(player.id, session);
      previousStateRef.current = currentStateStr;
      clearWorkingScores();
      setRecommendation('');
      await advance();
    } catch (err) {
      await alert('Error Saving', err instanceof Error ? err.message : 'Failed to save evaluation. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const history = historyQuery.data;
  const uniquePastEvals = history
    ? Object.values(
        history.pastEvaluations.reduce<Record<string, (typeof history.pastEvaluations)[number]>>((acc, ev) => {
          const key = `${ev.session}-${ev.evaluator}`;
          if (!acc[key] || acc[key].createdAt < ev.createdAt) acc[key] = ev;
          return acc;
        }, {}),
      ).sort((a, b) => a.createdAt - b.createdAt)
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Rinkside Scoring"
        subtitle={`${rinksideIndex + 1} of ${roster.length}`}
        showBack
        backHref={href('roster')}
      />

      {/* edge-bleed runs the strip to the screen edge on phones so a
          half-visible last session reads as "scroll me" instead of a hard
          stop — same reasoning as the tab strip in the assessment layout. */}
      <div ref={sessionStripRef} className="no-scrollbar edge-bleed mb-5 flex gap-2 overflow-x-auto pb-1">
        {SESSIONS.map((s, idx) => {
          const isScored = scoredSessionsMap.has(s);
          // A session the server counts but this viewer can't read is an
          // assessor looking at the coach's work: opening it would start a
          // second evaluation beside one they never see.
          const sessionNum = Number(s.match(/^Session (\d+)$/)?.[1]);
          const isServerScored =
            Number.isFinite(sessionNum) && sessionNum <= (sessionProgress?.[player?.id || ''] ?? 0);
          const disabled = (isServerScored && !isScored) || (!isScored && idx > highestDoneSessionNum);
          const active = session === s;
          return (
            <Chip
              key={s}
              ref={active ? activeSessionChipRef : undefined}
              label={s}
              active={active}
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                setSession(s);
              }}
            />
          );
        })}
      </div>

      <Card className="mb-5 flex flex-col items-center gap-1 py-6">
        <span className="text-2xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          {player ? playerDisplayName(player) : '—'}
        </span>
        <span style={{ color: colors.inkMuted }}>
          #{player?.jersey ?? '—'} · {player?.pos ?? '—'}
        </span>
        <span
          className="mt-2 text-3xl font-bold"
          style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}
        >
          {overall > 0 ? overall.toFixed(1) : '—'}
        </span>
      </Card>

      {history && (history.pastSeasons.length > 0 || uniquePastEvals.length > 0) ? (
        <Card className="mb-5">
          <p className="mb-2 font-bold" style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}>
            Historical Data
          </p>
          <div className="max-h-[220px] overflow-y-auto pr-1">
            {history.pastSeasons.length > 0 ? (
              <div>
                <SectionLabel className="mb-1">Past Seasons</SectionLabel>
                {history.pastSeasons.map((s) => (
                  <div key={s.seasonId} className="mb-1 flex items-center gap-2">
                    <span className="font-bold" style={{ color: colors.primary }}>
                      {s.seasonName}
                    </span>
                    <span style={{ color: colors.ink }}>{s.teamName}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {uniquePastEvals.length > 0 ? (
              <div
                className={history.pastSeasons.length > 0 ? 'mt-2 border-t pt-2' : ''}
                style={{ borderColor: colors.border }}
              >
                <SectionLabel className="mb-1">Past Evals ({uniquePastEvals.length})</SectionLabel>
                {uniquePastEvals.map((ev) => (
                  <div key={ev.id} className="mb-1 border-b pb-1" style={{ borderColor: colors.border }}>
                    <p className="text-sm font-bold" style={{ color: colors.ink }}>
                      {ev.session} · {ev.recommendation || 'No Rec'}
                    </p>
                    {ev.strengths ? (
                      <p className="text-xs" style={{ color: colors.success }}>
                        + {ev.strengths}
                      </p>
                    ) : null}
                    {ev.improve ? (
                      <p className="text-xs" style={{ color: colors.inkMuted }}>
                        → {ev.improve}
                      </p>
                    ) : null}
                    {Object.keys(ev.scores || {}).length > 0 ? (
                      <p className="mt-1 text-xs font-bold" style={{ color: colors.primary }}>
                        {categories
                          .map((cat) => {
                            const avg = categoryAverage(ev.scores, cat.subskills);
                            return avg !== null ? `${cat.label} ${avg.toFixed(1)}` : null;
                          })
                          .filter(Boolean)
                          .join('  ·  ')}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {categories.map((cat) => {
        const catAvg = categoryAverage(workingScores, cat.subskills);
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
                benchmark={s.benchmark}
                benchmarkNote={s.benchmarkNote}
                rankingDirection={s.rankingDirection}
                value={workingScores[s.key]}
                onChange={(v) => setWorkingScores({ ...workingScores, [s.key]: v })}
              />
            ))}
          </div>
        );
      })}

      <SectionLabel className="mb-2 mt-4">Recommendation</SectionLabel>
      <div className="mb-5 flex flex-wrap gap-2">
        {(['Make', 'Keep', 'Bubble', 'Release'] as const).map((rec) => (
          <Chip
            key={rec}
            label={rec}
            active={recommendation === rec}
            onClick={() => setRecommendation(recommendation === rec ? '' : rec)}
          />
        ))}
      </div>

      <div
        className="sticky bottom-0 flex flex-col gap-2 border-t py-4"
        style={{ borderColor: colors.border, backgroundColor: colors.bg }}
      >
        <p className="text-center text-xs" style={{ color: colors.inkFaint }}>
          {terms.t('Use ← / → arrow keys to change players')}
        </p>
        <div className="flex gap-2">
          <Button
            label="← Prev"
            variant="secondary"
            fullWidth
            onClick={goPrev}
            disabled={rinksideIndex === 0 || isSaving}
          />
          <Button label="Save & Next →" fullWidth onClick={saveAndNext} loading={isSaving} />
        </div>
        <Button
          label="Full Score Form"
          variant="ghost"
          onClick={() => router.push(href(`score/${player?.id}`))}
        />
      </div>
    </div>
  );
}
