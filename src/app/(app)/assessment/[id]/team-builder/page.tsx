'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Spinner,
  Textarea,
  useAlert,
} from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import {
  useTryoutQuery,
  useGenerateTeamBuilderMutation,
  useTeamBuilderResultsQuery,
  useSaveTeamBuilderResultMutation,
  useDeleteTeamBuilderResultMutation,
} from '@/features/queries';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { getPlayerNameMap, type TeamBuilderState } from '@/data/teamBuilder';
import { computePlayerResults } from '@/data/scoring';
import { playerDisplayName } from '@/data/rubrics';
import { canUseFeature, getPlanDefinition } from '@/data/plans';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';

const TB_LOADING_TEXTS = ['Analyzing players...', 'Balancing rosters...', 'Optimizing lines...', 'Finalizing teams...'];

export default function TeamBuilderPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const router = useRouter();
  const colors = useThemeColors();
  const { confirm } = useAlert();
  const tryoutQuery = useTryoutQuery(id);
  const generate = useGenerateTeamBuilderMutation(id!);
  const savedResultsQuery = useTeamBuilderResultsQuery(id!);
  const saveResult = useSaveTeamBuilderResultMutation(id!);
  const deleteResult = useDeleteTeamBuilderResultMutation(id!);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [textPrompt, setTextPrompt] = useState('');
  const [tbTextIndex, setTbTextIndex] = useState(0);
  // Set by "New" to hide the current live draft without touching the DB record —
  // the next successful Generate produces a fresh generatedAt that un-hides it.
  const [hiddenGeneratedAt, setHiddenGeneratedAt] = useState<number | null>(null);
  const [lastSavedGeneratedAt, setLastSavedGeneratedAt] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState<'xlsx' | 'pdf' | null>(null);

  const results = useMemo(
    () => (tryoutQuery.data ? computePlayerResults(tryoutQuery.data) : []),
    [tryoutQuery.data],
  );

  // Rebuilding these from a 1000-player roster is expensive; without memoizing
  // them here, typing in the prompt textarea below (which only changes local
  // `textPrompt` state) was re-deriving all three maps and re-rendering every
  // player row on each keystroke.
  const nameMap = useMemo(
    () => (tryoutQuery.data ? getPlayerNameMap(tryoutQuery.data) : {}),
    [tryoutQuery.data],
  );
  const playerById = useMemo(
    () => new Map((tryoutQuery.data?.roster ?? []).map((p) => [p.id, p])),
    [tryoutQuery.data],
  );
  const overallByPlayerId = useMemo(
    () => new Map(results.map((r) => [r.player.id, r.overall])),
    [results],
  );

  // The interval is a real external-system subscription (a timer), so it
  // stays an effect — but nothing in the effect body sets state synchronously
  // on mount/dependency-change; the index only advances inside the interval
  // callback, and the idle case is handled by deriving tbLoadingText below
  // instead of resetting state here.
  useEffect(() => {
    if (!generate.isPending) return;
    const int = setInterval(() => setTbTextIndex((i) => i + 1), 2500);
    return () => clearInterval(int);
  }, [generate.isPending]);

  const tbLoadingText = generate.isPending
    ? TB_LOADING_TEXTS[tbTextIndex % TB_LOADING_TEXTS.length]
    : TB_LOADING_TEXTS[0];

  // Hook, so it runs before the loading/error guards below — skipping it on
  // the loading render would change hook order. A delegated team's tryout
  // gates against the owning club's tier, not the viewer's own.
  const tier = useEffectivePlanTier(tryoutQuery.data?.teamId);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return (
      <>
        <PageHeader title="Team Builder" showBack />
        <ErrorState message="Could not load team builder." onRetry={() => tryoutQuery.refetch()} />
      </>
    );
  }

  const tryout = tryoutQuery.data;
  const liveTeamBuilder = tryout.teamBuilder as TeamBuilderState | undefined;
  const savedResults = savedResultsQuery.data ?? [];
  const selectedResult = selectedResultId ? savedResults.find((r) => r.id === selectedResultId) : undefined;
  const liveHidden = !!liveTeamBuilder && liveTeamBuilder.generatedAt === hiddenGeneratedAt;
  const teamBuilder: TeamBuilderState | undefined = selectedResult
    ? (selectedResult.state as TeamBuilderState)
    : liveHidden ? undefined : liveTeamBuilder;
  const isUnsaved = !selectedResult && !!teamBuilder && teamBuilder.generatedAt !== lastSavedGeneratedAt;

  const exportsAllowed = canUseFeature(tier, 'exports') || tier !== 'free';
  const allowedFormats = getPlanDefinition(tier).limits.exports;

  const handleGenerate = () => {
    setSelectedResultId(null);
    generate.mutate({
      prompt: textPrompt,
      // Defaults; the backend also parses the prompt for a team count.
      teamCount: 2,
      keepFriendPackages: true,
      splitGoalies: true,
    });
  };

  const handleNew = async () => {
    const proceed = () => {
      setTextPrompt('');
      setSelectedResultId(null);
      if (liveTeamBuilder) setHiddenGeneratedAt(liveTeamBuilder.generatedAt);
    };
    if (isUnsaved) {
      const ok = await confirm({
        title: 'Discard this team split?',
        message: "This team split hasn't been saved. Starting a new one will discard it unless you save it first.",
        confirmLabel: 'Discard',
        destructive: true,
      });
      if (ok) proceed();
    } else {
      proceed();
    }
  };

  const handleSave = () => {
    if (!teamBuilder) return;
    const label = window.prompt('Name this split (e.g. "Option A — friend packages kept")');
    if (!label?.trim()) return;
    const generatedAt = teamBuilder.generatedAt;
    saveResult.mutate(
      { label: label.trim(), state: teamBuilder },
      { onSuccess: () => setLastSavedGeneratedAt(generatedAt) },
    );
  };

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    if (!teamBuilder) return;
    setIsExporting(format);
    try {
      const { exportTeamBuilderData } = await import('@/lib/exportData');
      await exportTeamBuilderData(tryout, teamBuilder, format);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(null);
    }
  };

  const openPlayer = (playerId: string) => {
    router.push(href(`player/${playerId}`));
  };

  const renderPlayerRow = (playerId: string) => {
    const p = playerById.get(playerId);
    if (!p) return null;
    const overall = overallByPlayerId.get(playerId);
    return (
      <button
        type="button"
        key={playerId}
        onClick={() => openPlayer(playerId)}
        className="flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-transform hover:-translate-y-0.5"
        style={{ backgroundColor: colors.tile, borderColor: colors.border }}
      >
        <Avatar first={p.first} last={p.last} pos={p.pos} uri={p.avatarUrl} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold" style={{ color: colors.ink }}>
            {playerDisplayName(p)}
          </span>
          <span className="block text-xs" style={{ color: colors.inkMuted }}>
            #{p.jersey ?? '—'} · {p.pos ?? '—'}
          </span>
        </span>
        {overall != null ? <Badge label={overall.toFixed(1)} variant="success" /> : null}
      </button>
    );
  };

  // Computed once and reused by both the balance overview and the team cards
  // below, instead of re-filtering `results` against each team twice per render.
  const teamStats = (teamBuilder?.teams ?? []).map((team) => {
    const playerIds = new Set(team.players);
    const teamPlayerResults = results.filter((r) => playerIds.has(r.player.id) && r.evalCount > 0);
    const avgScore =
      teamPlayerResults.length > 0
        ? teamPlayerResults.reduce((sum, r) => sum + r.overall, 0) / teamPlayerResults.length
        : null;
    return { team, avgScore };
  });
  const teamAverages = teamStats.filter(
    (t): t is { team: (typeof teamStats)[number]['team']; avgScore: number } => t.avgScore != null,
  );

  const handleDeleteResult = async (resultId: string, label: string) => {
    const ok = await confirm({
      title: 'Delete saved teams?',
      message: `"${label}" will be permanently deleted.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    if (selectedResultId === resultId) setSelectedResultId(null);
    deleteResult.mutate(resultId);
  };

  return (
    <>
      <PageHeader
        title="Team Builder"
        subtitle="Sort Out — balanced teams"
        showBack
        backHref={href('results')}
      />

      <PlanGate feature="teamBuilder" title="Team Builder (Club+)">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,380px)_1fr] lg:items-start">
          <div className="flex flex-col gap-5">
          <Card accent className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                ⚙️ Configuration
              </span>
              <Badge label={`${tryout.roster.length} players`} variant="info" />
            </div>

            <Textarea
              rows={5}
              value={textPrompt}
              onChange={(e) => setTextPrompt(e.target.value)}
              placeholder="e.g. Build 4 teams, keep friend packages together, balance birth years..."
              disabled={generate.isPending}
            />

            {generate.isPending ? (
              <div
                className="flex flex-col items-center gap-2 rounded-xl border p-4"
                style={{ backgroundColor: colors.tile, borderColor: colors.border }}
              >
                <Spinner size={28} />
                <span className="text-sm font-medium" style={{ color: colors.ink }}>
                  {tbLoadingText}
                </span>
              </div>
            ) : (
              <Button label="✨ Generate Teams with AI" onClick={handleGenerate} />
            )}

            {generate.isError ? (
              <div
                className="mt-1 flex flex-col items-start gap-2 rounded-xl border p-3"
                style={{ backgroundColor: colors.danger + '12', borderColor: colors.danger + '30' }}
              >
                <p className="flex items-center gap-1.5 font-bold" style={{ color: colors.danger }}>
                  <span aria-hidden>⚠️</span> Generation failed
                </p>
                <p style={{ color: colors.inkMuted }}>
                  {generate.error?.message ||
                    'Team builder generation timed out. The server might be busy, please try again.'}
                </p>
                <Button label="Retry" size="sm" variant="secondary" onClick={handleGenerate} />
              </div>
            ) : null}
          </Card>

          <Card className="flex flex-col gap-3">
            <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
              💾 Saved Splits
            </span>
            {savedResults.length === 0 ? (
              <span className="text-sm" style={{ color: colors.inkMuted }}>
                Generate a split, then save it here to keep it from being lost the next time you regenerate.
              </span>
            ) : (
              <div className="flex flex-col gap-2">
                {savedResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedResultId(r.id)}
                    className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-left"
                    style={{
                      backgroundColor: r.id === selectedResultId ? colors.primary + '15' : colors.tile,
                      border: r.id === selectedResultId ? `1px solid ${colors.primary}` : '1px solid transparent',
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold" style={{ color: colors.ink }}>
                        {r.label}
                      </span>
                      <span className="block text-xs" style={{ color: colors.inkMuted }}>
                        {new Date(r.createdAt).toLocaleString()}
                      </span>
                    </span>
                    <Button
                      label="Delete"
                      size="sm"
                      variant="ghost"
                      loading={deleteResult.isPending && deleteResult.variables === r.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteResult(r.id, r.label);
                      }}
                    />
                  </button>
                ))}
              </div>
            )}
            {selectedResultId ? (
              <Button
                label="Back to Latest Generation"
                size="sm"
                variant="secondary"
                onClick={() => setSelectedResultId(null)}
              />
            ) : null}
          </Card>
          </div>

          <div className="flex flex-col gap-4">
            {teamBuilder ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm" style={{ color: colors.inkMuted }}>
                  {selectedResult ? `Viewing saved split: ${selectedResult.label}` : 'Latest generation'}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    label="Save this split"
                    size="sm"
                    variant="secondary"
                    loading={saveResult.isPending}
                    onClick={handleSave}
                  />
                  <Button label="New" size="sm" variant="secondary" onClick={handleNew} />
                  {exportsAllowed && allowedFormats.includes('xlsx') && (
                    <Button
                      label="XLSX"
                      size="sm"
                      variant="secondary"
                      loading={isExporting === 'xlsx'}
                      onClick={() => handleExport('xlsx')}
                    />
                  )}
                  {exportsAllowed && allowedFormats.includes('pdf') && (
                    <Button
                      label="PDF"
                      size="sm"
                      variant="secondary"
                      loading={isExporting === 'pdf'}
                      onClick={() => handleExport('pdf')}
                    />
                  )}
                </div>
              </div>
            ) : null}

            {!teamBuilder ? (
              <Card>
                <EmptyState
                  icon={<span style={{ fontSize: 40 }}>🧩</span>}
                  title="No teams generated yet"
                  message="Describe how you'd like the roster split on the left, then hit Generate — or pick a saved split to view it here."
                />
              </Card>
            ) : null}

            {teamAverages.length >= 2 ? (
              <Card className="flex flex-col gap-3">
                <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                  ⚖️ Team Balance
                </span>
                <div className="flex flex-col gap-2">
                  {teamAverages.map(({ team, avgScore }) => (
                    <div key={team.id} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-sm font-medium" style={{ color: colors.ink }}>
                        {team.name}
                      </span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: colors.tile }}>
                        <div
                          className="h-full rounded-full transition-[width] duration-500"
                          style={{ width: `${Math.min(100, (avgScore / 5) * 100)}%`, backgroundColor: colors.primary }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-sm font-bold" style={{ color: colors.inkMuted }}>
                        {avgScore.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {teamBuilder?.explanation ? (
              <Card style={{ borderColor: 'rgba(255,107,43,0.25)', backgroundColor: 'rgba(255,107,43,0.08)' }}>
                <p className="mb-1 font-bold" style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}>
                  ✨ AI Co-Coach Insight
                </p>
                <p style={{ color: colors.ink }}>{teamBuilder.explanation}</p>
              </Card>
            ) : null}

            {teamBuilder?.warnings?.length ? (
              <div className="flex flex-col gap-2">
                {teamBuilder.warnings.map((w, i) => {
                  // Strip UUIDs so player IDs never leak into the UI.
                  const cleanText = w
                    .replace(/\(?(ID: )?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\)?/gi, '')
                    .trim();
                  return (
                    <div
                      key={i}
                      className="rounded-xl border p-3 text-sm font-medium"
                      style={{
                        backgroundColor: colors.warning + '15',
                        borderColor: colors.warning + '30',
                        color: colors.warning,
                      }}
                    >
                      {cleanText}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {teamStats.map(({ team, avgScore }) => {
              return (
                <Card key={team.id} accent className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className="text-lg font-bold"
                      style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}
                    >
                      {team.name}
                    </span>
                    <span className="flex gap-2">
                      {avgScore != null ? <Badge label={`Avg: ${avgScore.toFixed(1)}`} variant="success" /> : null}
                      <Badge label={`${team.players.length} players`} />
                    </span>
                  </div>
                  {team.skaters.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
                        Skaters
                      </span>
                      {team.skaters.map(renderPlayerRow)}
                    </div>
                  ) : null}
                  {team.goalies.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
                        Goalies
                      </span>
                      {team.goalies.map(renderPlayerRow)}
                    </div>
                  ) : null}
                </Card>
              );
            })}

            {teamBuilder?.unassigned?.length ? (
              <Card
                className="flex flex-col gap-2"
                style={{ borderLeftWidth: 3, borderLeftColor: colors.warning }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className="text-lg font-bold"
                    style={{ color: colors.inkMuted, fontFamily: 'var(--font-space-grotesk)' }}
                  >
                    Unassigned
                  </span>
                  <Badge label={`${teamBuilder.unassigned.length} players`} />
                </div>
                <p className="text-sm" style={{ color: colors.inkMuted }}>
                  These players didn&apos;t fit within the requested team count and size, so they were left out instead of being added to a team.
                </p>
                <p className="text-sm" style={{ color: colors.ink }}>
                  {teamBuilder.unassigned.map((pid) => nameMap[pid] ?? pid).join(', ')}
                </p>
              </Card>
            ) : null}
          </div>
        </div>
      </PlanGate>
    </>
  );
}
