'use client';

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useThemeColors } from '@/theme/ThemeProvider';
import { themeTokens } from '@/theme/tokens';
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
import { movePlayerToTeam, type TeamBuilderState, type TeamBuilderTeam } from '@/data/teamBuilder';
import { computePlayerResults } from '@/data/scoring';
import { getScoreHeatLevel, playerDisplayName } from '@/data/rubrics';
import { canUseFeature, getPlanDefinition } from '@/data/plans';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';

const TB_LOADING_TEXTS = ['Analyzing players...', 'Balancing rosters...', 'Optimizing lines...', 'Finalizing teams...'];

/** Drop-zone id for the "Unassigned" bucket, which has no team id of its own. */
const UNASSIGNED = 'unassigned';

/** How many teams sit side by side before the column grid wraps to a new row. */
const MAX_TEAM_COLUMNS = 10;

/** Position tints, matched to the ring colours Avatar already uses. */
const POS_TINTS: Record<string, string> = { FWD: '#ff6b2b', DEF: '#6366f1', GTL: '#f59e0b' };

function posTint(pos: string) {
  return POS_TINTS[pos.toUpperCase()] ?? '#8fa3c8';
}

/** Deepest undo history kept for manual drag edits. */
const MAX_HISTORY = 50;

/**
 * One accent per team column, cycled by team index. Ten of them, so a full row
 * of columns never repeats a colour — the colour is the thing a coach tracks a
 * player by while dragging, so neighbouring columns must never share one.
 */
const TEAM_ACCENTS = [
  '#ff6b2b',
  '#38bdf8',
  '#22c55e',
  '#a78bfa',
  '#f472b6',
  '#facc15',
  '#2dd4bf',
  '#fb7185',
  '#60a5fa',
  '#c084fc',
] as const;

/** One point in the undo history: the whole assignment, teams and leftovers. */
interface RosterSnapshot {
  teams: TeamBuilderTeam[];
  unassigned: string[];
}

/** Membership-only fingerprint, so manual drag edits count as unsaved changes too. */
function rosterSnapshot(state: TeamBuilderState) {
  return JSON.stringify({
    generatedAt: state.generatedAt,
    teams: state.teams.map((t) => [t.id, [...t.players].sort()]),
    unassigned: [...state.unassigned].sort(),
  });
}

export default function TeamBuilderPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const router = useRouter();
  const colors = useThemeColors();
  const { confirm, alert, toast } = useAlert();
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
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<'xlsx' | 'pdf' | null>(null);
  // Collapsed by default: a big roster generates a stack of notes that pushed
  // the teams themselves below the fold.
  const [showWarnings, setShowWarnings] = useState(false);

  const results = useMemo(
    () => (tryoutQuery.data ? computePlayerResults(tryoutQuery.data) : []),
    [tryoutQuery.data],
  );

  // Rebuilding these from a 1000-player roster is expensive; without memoizing
  // them here, typing in the prompt textarea below (which only changes local
  // `textPrompt` state) was re-deriving both maps and re-rendering every
  // player row on each keystroke.
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

  // Which split the drag edits below belong to. Derived here rather than from
  // `teamBuilder` further down because the state that tracks it has to be
  // declared above the loading/error guards to keep hook order stable.
  const liveForKey = tryoutQuery.data?.teamBuilder as TeamBuilderState | undefined;
  const selectedForKey = selectedResultId
    ? (savedResultsQuery.data ?? []).find((r) => r.id === selectedResultId)
    : undefined;
  const splitKey = selectedForKey
    ? `saved:${selectedForKey.id}`
    : liveForKey && liveForKey.generatedAt !== hiddenGeneratedAt
      ? `live:${liveForKey.generatedAt}`
      : 'none';

  const [editedTeams, setEditedTeams] = useState<TeamBuilderTeam[] | null>(null);
  const [editedUnassigned, setEditedUnassigned] = useState<string[] | null>(null);
  const [draggedPlayer, setDraggedPlayer] = useState<{ id: string; from: string } | null>(null);
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);
  // Undo/redo over manual drag edits only — each entry is the roster as it was
  // *before* one move, so a mis-drop is one click to take back instead of a
  // hunt for which player came from where.
  const [undoStack, setUndoStack] = useState<RosterSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<RosterSnapshot[]>([]);
  const [lastSplitKey, setLastSplitKey] = useState(splitKey);
  // Regenerating or switching splits drops the manual edits, since they belong
  // to the split they were made on.
  if (splitKey !== lastSplitKey) {
    setLastSplitKey(splitKey);
    setEditedTeams(null);
    setEditedUnassigned(null);
    setDraggedPlayer(null);
    setDragOverZone(null);
    setUndoStack([]);
    setRedoStack([]);
  }

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
  const effectiveTeams = editedTeams ?? teamBuilder?.teams ?? [];
  const effectiveUnassigned = editedUnassigned ?? teamBuilder?.unassigned ?? [];
  const editedTeamBuilder: TeamBuilderState | undefined = teamBuilder
    ? { ...teamBuilder, teams: effectiveTeams, unassigned: effectiveUnassigned }
    : undefined;
  // Called on demand rather than derived per render — fingerprinting a
  // 1000-player split on every keystroke in the prompt box isn't free.
  const isUnsaved = () =>
    !selectedResult && !!editedTeamBuilder && rosterSnapshot(editedTeamBuilder) !== lastSavedSnapshot;

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
    if (isUnsaved()) {
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
    if (!editedTeamBuilder) return;
    const label = window.prompt('Name this split (e.g. "Option A — friend packages kept")');
    if (!label?.trim()) return;
    const snapshot = rosterSnapshot(editedTeamBuilder);
    saveResult.mutate(
      { label: label.trim(), state: editedTeamBuilder },
      { onSuccess: () => setLastSavedSnapshot(snapshot) },
    );
  };

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    if (!editedTeamBuilder) return;
    setIsExporting(format);
    try {
      const { exportTeamBuilderData } = await import('@/lib/exportData');
      await exportTeamBuilderData(tryout, editedTeamBuilder, format);
      toast(`${format.toUpperCase()} downloaded`, 'success');
    } catch (e) {
      await alert('Export failed', e instanceof Error ? e.message : 'Could not build the export file.');
    } finally {
      setIsExporting(null);
    }
  };

  const openPlayer = (playerId: string) => {
    router.push(href(`player/${playerId}`));
  };

  const canReorder = !!editedTeamBuilder;

  const movePlayer = (playerId: string, from: string, to: string) => {
    if (from === to || !editedTeamBuilder) return;
    const isGoalie = playerById.get(playerId)?.pos?.toUpperCase() === 'GTL';
    const next = movePlayerToTeam(editedTeamBuilder, playerId, to === UNASSIGNED ? null : to, isGoalie);
    setUndoStack((stack) =>
      [...stack, { teams: effectiveTeams, unassigned: effectiveUnassigned }].slice(-MAX_HISTORY),
    );
    // A fresh move forks the history, so anything undone past this point is gone.
    setRedoStack([]);
    setEditedTeams(next.teams);
    setEditedUnassigned(next.unassigned);
  };

  const canUndo = canReorder && undoStack.length > 0;
  const canRedo = canReorder && redoStack.length > 0;

  const handleUndo = () => {
    if (!canUndo) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack([...redoStack, { teams: effectiveTeams, unassigned: effectiveUnassigned }]);
    setEditedTeams(prev.teams);
    setEditedUnassigned(prev.unassigned);
  };

  const handleRedo = () => {
    if (!canRedo) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack([...undoStack, { teams: effectiveTeams, unassigned: effectiveUnassigned }]);
    setEditedTeams(next.teams);
    setEditedUnassigned(next.unassigned);
  };

  const dropZoneProps = (zoneId: string) =>
    canReorder
      ? {
          onDragOver: (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDragOverZone(zoneId);
          },
          onDragLeave: (e: DragEvent<HTMLDivElement>) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDragOverZone((z) => (z === zoneId ? null : z));
          },
          onDrop: (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setDragOverZone(null);
            if (!draggedPlayer) return;
            movePlayer(draggedPlayer.id, draggedPlayer.from, zoneId);
            setDraggedPlayer(null);
          },
          // A lit-up column reads at a glance from across a wide grid; the old
          // dashed outline disappeared among ten neighbours.
          style:
            dragOverZone === zoneId && draggedPlayer?.from !== zoneId
              ? {
                  outline: `2px solid ${colors.primary}`,
                  outlineOffset: -2,
                  boxShadow: `0 0 0 6px ${colors.primary}22, 0 10px 30px ${colors.primary}33`,
                  transform: 'translateY(-2px)',
                }
              : undefined,
        }
      : {};

  const renderPlayerRow = (playerId: string, zoneId: string, accent?: string) => {
    const p = playerById.get(playerId);
    if (!p) return null;
    const overall = overallByPlayerId.get(playerId);
    const heatColor = overall != null ? themeTokens.scoreColors[getScoreHeatLevel(overall)] : colors.inkMuted;
    const isDragging = draggedPlayer?.id === playerId;
    return (
      <button
        type="button"
        key={playerId}
        draggable={canReorder}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', playerId);
          setDraggedPlayer({ id: playerId, from: zoneId });
        }}
        onDragEnd={() => {
          setDraggedPlayer(null);
          setDragOverZone(null);
        }}
        onClick={() => openPlayer(playerId)}
        className={cn(
          'relative flex w-full shrink-0 items-center gap-2 overflow-hidden rounded-xl border p-2 pl-3 text-left',
          'transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:shadow-lg',
          canReorder && 'cursor-grab active:cursor-grabbing',
          isDragging && 'rotate-1 scale-[0.98]',
        )}
        style={{
          backgroundColor: colors.tile,
          borderColor: isDragging ? colors.primary : colors.border,
          opacity: isDragging ? 0.5 : 1,
        }}
      >
        {/* Colour rail: which column a row belongs to stays readable even
            mid-drag, when the row is detached from its header. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1 rounded-r"
          style={{ backgroundColor: accent ?? colors.border }}
        />
        <Avatar first={p.first} last={p.last} pos={p.pos} uri={p.avatarUrl} size={32} />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span
            className="truncate text-[13px] font-bold"
            style={{ color: colors.ink }}
            title={playerDisplayName(p)}
          >
            {playerDisplayName(p)}
          </span>
          <span className="flex items-center gap-1 text-[11px]" style={{ color: colors.inkMuted }}>
            <span className="tabular-nums">#{p.jersey ?? '—'}</span>
            {p.pos ? (
              <span
                className="rounded px-1 font-bold uppercase"
                style={{ color: posTint(p.pos), backgroundColor: `${posTint(p.pos)}1f` }}
              >
                {p.pos}
              </span>
            ) : null}
          </span>
        </span>
        {overall != null ? (
          <span
            className="shrink-0 rounded-lg px-1.5 py-0.5 text-xs font-bold tabular-nums"
            style={{ color: heatColor, backgroundColor: `${heatColor}1f`, border: `1px solid ${heatColor}33` }}
          >
            {overall.toFixed(1)}
          </span>
        ) : null}
      </button>
    );
  };

  // Computed once and reused by both the balance overview and the team cards
  // below, instead of re-filtering `results` against each team twice per render.
  // `overall > 0` as well as having evaluations: a player scored only against
  // rubrics that no longer exist comes back with evaluations and an overall of
  // 0, and 0 is the absence of a rating rather than a very low one. Counting
  // those zeros pulled a team's average toward nothing — a band of genuine
  // 3-rated players reading 0.2 — and made the bar disagree with the split
  // buildTeams() had actually produced.
  const averageFor = (memberIds: string[]) => {
    const playerIds = new Set(memberIds);
    const rated = results.filter((r) => playerIds.has(r.player.id) && r.evalCount > 0 && r.overall > 0);
    return rated.length > 0 ? rated.reduce((sum, r) => sum + r.overall, 0) / rated.length : null;
  };

  const spreadOf = (averages: number[]) =>
    averages.length >= 2 ? Math.max(...averages) - Math.min(...averages) : null;

  // Averages of the split as it was generated (or last loaded), so a drag can be
  // shown as a delta against it. Only worth computing once a drag has happened.
  const baselineAverageById = editedTeams
    ? new Map((teamBuilder?.teams ?? []).map((t) => [t.id, averageFor(t.players)]))
    : null;

  const teamStats = effectiveTeams.map((team, teamIndex) => {
    const avgScore = averageFor(team.players);
    const baseline = baselineAverageById?.get(team.id) ?? null;
    // Below a tenth the bar hasn't visibly moved, so an arrow would be noise.
    const delta = avgScore != null && baseline != null && Math.abs(avgScore - baseline) >= 0.05
      ? avgScore - baseline
      : null;
    return { team, avgScore, delta, accent: TEAM_ACCENTS[teamIndex % TEAM_ACCENTS.length] };
  });
  const teamAverages = teamStats.filter(
    (t): t is (typeof teamStats)[number] & { avgScore: number } => t.avgScore != null,
  );
  // The headline number on the balance card: how far apart the strongest and
  // weakest teams are, which is the one figure that says whether a split worked.
  const balanceSpread = spreadOf(teamAverages.map((t) => t.avgScore));
  const baselineSpread = baselineAverageById
    ? spreadOf([...baselineAverageById.values()].filter((v): v is number => v != null))
    : null;
  // Did the coach's own moves make the split more even, or less?
  const spreadDelta =
    balanceSpread != null && baselineSpread != null && Math.abs(balanceSpread - baselineSpread) >= 0.005
      ? balanceSpread - baselineSpread
      : null;

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
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
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

          <div className="flex min-w-0 flex-col gap-4">
            {teamBuilder ? (
              <div
                // Sticky: with ten columns of players below, the split's own
                // controls would otherwise scroll away the moment you start
                // dragging near the bottom of a column.
                className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2 backdrop-blur"
                style={{ backgroundColor: colors.cardGlass, borderColor: colors.border }}
              >
                <span className="text-sm" style={{ color: colors.inkMuted }}>
                  <span className="font-bold" style={{ color: colors.ink }}>
                    {selectedResult ? selectedResult.label : 'Latest generation'}
                  </span>
                  <span className="block text-xs">
                    Drag a player onto another team to move them — Undo and Redo take a mis-drop back.
                  </span>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="flex overflow-hidden rounded-xl border"
                    style={{ borderColor: colors.border, backgroundColor: colors.tile }}
                  >
                    <Button
                      label="↶ Undo"
                      size="sm"
                      variant="ghost"
                      className="rounded-none"
                      title={canUndo ? `Undo last move (${undoStack.length})` : 'Nothing to undo'}
                      disabled={!canUndo}
                      onClick={handleUndo}
                    />
                    <span aria-hidden style={{ width: 1, backgroundColor: colors.border }} />
                    <Button
                      label="Redo ↷"
                      size="sm"
                      variant="ghost"
                      className="rounded-none"
                      title={canRedo ? `Redo (${redoStack.length})` : 'Nothing to redo'}
                      disabled={!canRedo}
                      onClick={handleRedo}
                    />
                  </span>
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                    ⚖️ Team Balance
                  </span>
                  <span className="flex items-center gap-2">
                    {spreadDelta != null ? (
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-bold tabular-nums"
                        style={{
                          // A smaller spread after a move is a tighter split, so
                          // a negative delta is the good direction here.
                          color: spreadDelta < 0 ? colors.success : colors.danger,
                          backgroundColor: `${spreadDelta < 0 ? colors.success : colors.danger}1a`,
                        }}
                        title="Change in spread since this split was generated"
                      >
                        {spreadDelta < 0 ? 'Tighter' : 'Wider'} {spreadDelta > 0 ? '+' : '−'}
                        {Math.abs(spreadDelta).toFixed(2)} after your moves
                      </span>
                    ) : null}
                    {balanceSpread != null ? (
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-bold tabular-nums"
                        style={{
                          color: balanceSpread <= 0.2 ? colors.success : colors.warning,
                          backgroundColor: `${balanceSpread <= 0.2 ? colors.success : colors.warning}1a`,
                        }}
                      >
                        {balanceSpread <= 0.2 ? 'Even split' : 'Spread'} · {balanceSpread.toFixed(2)}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {teamAverages.map(({ team, avgScore, accent, delta }) => (
                    <div key={team.id} className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className="h-6 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: accent }}
                      />
                      <span className="w-24 shrink-0 truncate text-sm font-medium" style={{ color: colors.ink }}>
                        {team.name}
                      </span>
                      <div
                        className="h-2 min-w-0 flex-1 overflow-hidden rounded-full"
                        style={{ backgroundColor: colors.tile }}
                      >
                        <div
                          className="h-full rounded-full transition-[width] duration-700"
                          style={{
                            width: `${Math.min(100, (avgScore / 5) * 100)}%`,
                            backgroundImage: `linear-gradient(90deg, ${accent}66, ${accent})`,
                          }}
                        />
                      </div>
                      <span
                        className="w-8 shrink-0 text-right text-sm font-bold tabular-nums"
                        style={{ color: colors.ink }}
                      >
                        {avgScore.toFixed(1)}
                      </span>
                      <span
                        className="w-10 shrink-0 text-right text-[11px] font-bold tabular-nums"
                        style={{ color: delta == null ? 'transparent' : delta > 0 ? colors.success : colors.danger }}
                        title={delta == null ? undefined : 'Change since this split was generated'}
                      >
                        {delta == null ? '' : `${delta > 0 ? '▲ +' : '▼ −'}${Math.abs(delta).toFixed(1)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {teamBuilder?.explanation ? (
              <Card
                className="flex items-start gap-3"
                style={{
                  borderColor: 'rgba(255,107,43,0.25)',
                  backgroundImage: `linear-gradient(120deg, ${colors.primary}1f, transparent 60%)`,
                }}
              >
                <span aria-hidden className="text-xl leading-none">
                  ✨
                </span>
                <span className="min-w-0">
                  <span
                    className="block text-xs font-bold uppercase tracking-wider"
                    style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}
                  >
                    AI Co-Coach Insight
                  </span>
                  <span className="block text-sm" style={{ color: colors.ink }}>
                    {teamBuilder.explanation}
                  </span>
                </span>
              </Card>
            ) : null}

            {teamBuilder?.warnings?.length ? (
              <Card
                padded={false}
                className="overflow-hidden"
                style={{ borderColor: colors.warning + '30', backgroundColor: colors.warning + '0f' }}
              >
                <button
                  type="button"
                  onClick={() => setShowWarnings((v) => !v)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm font-bold" style={{ color: colors.warning }}>
                    <span aria-hidden>⚠️</span>
                    {teamBuilder.warnings.length} note{teamBuilder.warnings.length === 1 ? '' : 's'} on this split
                  </span>
                  <span className="shrink-0 text-xs font-bold uppercase tracking-wider" style={{ color: colors.warning }}>
                    {showWarnings ? 'Hide' : 'Show'}
                  </span>
                </button>
                {showWarnings ? (
                  <ul className="flex flex-col gap-2 px-4 pb-4">
                    {teamBuilder.warnings.map((w, i) => {
                      // Strip UUIDs so player IDs never leak into the UI.
                      const cleanText = w
                        .replace(/\(?(ID: )?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\)?/gi, '')
                        .trim();
                      return (
                        <li
                          key={i}
                          className="flex gap-2 text-sm font-medium"
                          style={{ color: colors.warning }}
                        >
                          <span aria-hidden style={{ opacity: 0.6 }}>
                            •
                          </span>
                          <span className="min-w-0">{cleanText}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </Card>
            ) : null}

            {teamBuilder ? (
              <div
                className="grid items-start gap-3"
                style={{
                  // Column view: as many teams side by side as the pane fits,
                  // wrapping to a new row rather than scrolling sideways. The
                  // max width caps it at ten across — past that the columns get
                  // too narrow for a name and a rating to sit on one line.
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 215px), 1fr))',
                  maxWidth: Math.min(MAX_TEAM_COLUMNS, teamStats.length + 1) * 320,
                }}
              >
                {teamStats.map(({ team, avgScore, accent, delta }) => {
                  // Split apart, because spreading the drop-zone props whole
                  // would hand `style: undefined` back over the accent border.
                  const { style: dropStyle, ...dropHandlers } = dropZoneProps(team.id);
                  return (
                  <Card
                    key={team.id}
                    padded={false}
                    className="flex flex-col overflow-hidden"
                    style={{ borderTop: `3px solid ${accent}`, ...dropStyle }}
                    {...dropHandlers}
                  >
                    <div
                      className="flex flex-col gap-1.5 px-3 pb-2.5 pt-3"
                      style={{ backgroundImage: `linear-gradient(180deg, ${accent}1f, transparent)` }}
                    >
                      <span
                        className="truncate text-base font-bold"
                        style={{ color: accent, fontFamily: 'var(--font-space-grotesk)' }}
                        title={team.name}
                      >
                        {team.name}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {avgScore != null ? (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums"
                            style={{ color: accent, backgroundColor: `${accent}1f` }}
                          >
                            Avg {avgScore.toFixed(1)}
                          </span>
                        ) : null}
                        {delta != null ? (
                          <span
                            className="text-xs font-bold tabular-nums"
                            style={{ color: delta > 0 ? colors.success : colors.danger }}
                            title="Change since this split was generated"
                          >
                            {delta > 0 ? '▲ +' : '▼ −'}
                            {Math.abs(delta).toFixed(1)}
                          </span>
                        ) : null}
                        <span className="text-xs font-medium" style={{ color: colors.inkMuted }}>
                          {team.players.length} player{team.players.length === 1 ? '' : 's'}
                        </span>
                      </span>
                    </div>
                    <div className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto px-3 pb-3">
                      {team.skaters.length > 0 ? (
                        <>
                          <span
                            className="sticky top-0 z-10 -mx-3 shrink-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur"
                            style={{ color: colors.inkMuted, backgroundColor: colors.cardGlass }}
                          >
                            Skaters · {team.skaters.length}
                          </span>
                          {team.skaters.map((pid) => renderPlayerRow(pid, team.id, accent))}
                        </>
                      ) : null}
                      {team.goalies.length > 0 ? (
                        <>
                          <span
                            className="sticky top-0 z-10 -mx-3 shrink-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur"
                            style={{ color: colors.inkMuted, backgroundColor: colors.cardGlass }}
                          >
                            Goalies · {team.goalies.length}
                          </span>
                          {team.goalies.map((pid) => renderPlayerRow(pid, team.id, accent))}
                        </>
                      ) : null}
                      {team.players.length === 0 ? (
                        <span
                          className="shrink-0 rounded-xl border border-dashed p-3 text-center text-xs"
                          style={{ color: colors.inkMuted, borderColor: colors.border }}
                        >
                          {canReorder ? 'Drop players here' : 'No players.'}
                        </span>
                      ) : null}
                    </div>
                  </Card>
                  );
                })}

                {(() => {
                  const { style: dropStyle, ...dropHandlers } = dropZoneProps(UNASSIGNED);
                  return (
                    <Card
                      padded={false}
                      className="flex flex-col overflow-hidden"
                      style={{ borderTop: `3px dashed ${colors.warning}`, ...dropStyle }}
                      {...dropHandlers}
                    >
                      <div className="flex flex-col gap-1.5 px-3 pb-2.5 pt-3">
                        <span
                          className="truncate text-base font-bold"
                          style={{ color: colors.inkMuted, fontFamily: 'var(--font-space-grotesk)' }}
                        >
                          Unassigned
                        </span>
                        <span className="text-xs font-medium" style={{ color: colors.inkMuted }}>
                          {effectiveUnassigned.length} player{effectiveUnassigned.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto px-3 pb-3">
                        <p className="shrink-0 text-xs" style={{ color: colors.inkMuted }}>
                          {effectiveUnassigned.length > 0
                            ? "Didn't fit within the requested team count and size, so they were left out instead of being added to a team."
                            : 'Drop players here to leave them off every team.'}
                        </p>
                        {effectiveUnassigned.map((pid) => renderPlayerRow(pid, UNASSIGNED))}
                      </div>
                    </Card>
                  );
                })()}
              </div>
            ) : null}
          </div>
        </div>
      </PlanGate>
    </>
  );
}
