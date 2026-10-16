'use client';

import { ContextVideos } from '@/components/video/ContextVideos';
import { TaggedVideos } from '@/components/video/TaggedVideos';

import { useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { reportLogoUrls } from '@/lib/reportPdf';
import { usePermissions, useUser } from '@/state/authStore';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  RefreshButton,
  SectionLabel,
  Textarea,
  useAlert,
} from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import {
  useCombinedTryoutsQueries,
  useDeletePlayerReportCardMutation,
  useEvaluationCandidatesQuery,
  useGenerateReportCardCommentsMutation,
  useLibraryQuery,
  usePlayerReportCardsQuery,
  useSavePlayerReportCardMutation,
  useTeamsQuery,
  useTryoutQuery,
} from '@/features/queries';
import { useAssessmentHref, useAssessmentId, useIsAssessorOnly } from '@/features/useAssessmentId';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { getDataSource } from '@/data';
import { buildPlayerFullResults, type PlayerFullResults } from '@/data/resultsExport';
import { benchmarkLines, type BenchmarkLine } from '@/data/benchmarks';
import { playerDisplayName } from '@/data/rubrics';
import { extraMarker, matchPlayerAcrossEvaluations, splitSavedEvalIds } from '@/data/otherEvaluations';
import type { PlayerReportCard, ReportCardAttachment } from '@/data/types';
import { formatAiComments } from '@/lib/reportCardText';
import { addLibraryVideos } from '@/lib/reportCardLibrary';
import { formatFileSize, safeExternalUrl } from '@/lib/libraryMedia';
import { useTerms } from '@/lib/terms';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** One evaluation's scores for the player: rubric results, benchmarks and the rank within that evaluation alone. */
function ScoreTable({ card: reportCard, benchmarks }: { card: PlayerFullResults; benchmarks: BenchmarkLine[] }) {
  const colors = useThemeColors();
  return (
    <>
      <div className="text-sm" style={{ color: colors.ink }}>
        <div
          className="grid grid-cols-[1fr_5.5rem_5.5rem_3.5rem] gap-2 border-b py-1 text-xs font-bold"
          style={{ borderColor: colors.border, color: colors.inkMuted }}
        >
          <span>MEASURE</span>
          <span className="text-right">RESULT</span>
          <span className="text-right">BENCHMARK</span>
          <span className="text-right">RANK</span>
        </div>
        <div
          className="grid grid-cols-[1fr_5.5rem_5.5rem_3.5rem] gap-2 border-b py-1 font-bold"
          style={{ borderColor: colors.border, color: colors.primary }}
        >
          <span>Overall</span>
          <span className="text-right">{reportCard.overallScore || '-'}</span>
          <span className="text-right" style={{ color: colors.inkMuted }}>
            -
          </span>
          <span className="text-right">{reportCard.overallRank || '-'}</span>
        </div>
        {reportCard.metrics.flatMap((m) => [{ ...m, indent: false }, ...(m.children ?? []).map((c) => ({ ...c, indent: true }))]).map((m) => {
          const note = benchmarks.find((b) => b.label === m.label)?.note;
          return (
            <div key={`${m.indent ? 'drill' : 'cat'}:${m.label}`} className="border-b py-1" style={{ borderColor: colors.border }}>
              <div className="grid grid-cols-[1fr_5.5rem_5.5rem_3.5rem] gap-2">
                <span className={m.indent ? 'pl-3 text-sm' : undefined} style={m.indent ? { color: colors.inkMuted } : undefined}>{m.label}</span>
                <span className="text-right font-bold" style={{ color: m.met ? colors.success : colors.ink }}>
                  {m.actual || m.score}
                </span>
                <span className="text-right" style={{ color: colors.inkMuted }}>
                  {m.benchmark || '-'}
                </span>
                <span className="text-right">{m.rank || '-'}</span>
              </div>
              {note ? (
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  {note}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="text-xs" style={{ color: colors.inkMuted }}>
        Result is the player&apos;s average in the measure&apos;s own units. Rank is against the roster. Overall is the weighted score out of 5.
      </p>
    </>
  );
}

export default function PlayerReportCardPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const params = useParams();
  const playerId = Array.isArray(params?.playerId) ? params.playerId[0] : (params?.playerId as string);
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const { canManageTeam } = usePermissions();
  const user = useUser();

  const tryoutQuery = useTryoutQuery(id);
  const terms = useTerms(tryoutQuery.data?.settings.customLabels, tryoutQuery.data?.sport);
  const isAssessorOnly = useIsAssessorOnly(tryoutQuery.data?.viewerIsOwner);
  const tier = useEffectivePlanTier(tryoutQuery.data?.teamId);
  const teamsQuery = useTeamsQuery();

  const player = tryoutQuery.data?.roster.find((p) => p.athleteId === playerId || p.id === playerId);
  const cardsQuery = usePlayerReportCardsQuery(player?.athleteId);
  const save = useSavePlayerReportCardMutation(player?.athleteId ?? '');
  const remove = useDeletePlayerReportCardMutation(player?.athleteId ?? '');
  const generate = useGenerateReportCardCommentsMutation(id!);

  const [editingId, setEditingId] = useState<string | undefined>();
  const [title, setTitle] = useState('Player Report Card');
  // null = "every evaluation", so a card opened before new evaluations were
  // scored picks them up until the coach makes an explicit choice.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [coachComments, setCoachComments] = useState('');
  const [aiComments, setAiComments] = useState('');
  const [kept, setKept] = useState<ReportCardAttachment[]>([]);
  const [pickingLibrary, setPickingLibrary] = useState(false);
  const [libraryPick, setLibraryPick] = useState<Set<string>>(new Set());
  const library = useLibraryQuery({ enabled: pickingLibrary || kept.some((a) => a.libraryItemId) });
  const [files, setFiles] = useState<File[]>([]);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkIsVideo, setLinkIsVideo] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  // Other evaluations combined onto this card. `picked` null means every evaluation of the player in it.
  const [extras, setExtras] = useState<{ tryoutId: string; playerId: string; picked: Set<string> | null }[]>([]);
  const [addingEval, setAddingEval] = useState(false);
  const [evalSearch, setEvalSearch] = useState('');
  const [evalPick, setEvalPick] = useState<Set<string>>(new Set());
  const [printAppLogo, setPrintAppLogo] = useState(true);

  // Coming back to the builder reopens the card saved last, so it does not look
  // as though the card vanished. "New" still starts a blank one.
  const [reopened, setReopened] = useState(false);
  const applySavedEvalIds = (saved: string[]) => {
    const { evalIds, extras: marked } = splitSavedEvalIds(saved);
    setSelected(new Set(evalIds));
    setExtras(marked.map((m) => ({ ...m, picked: new Set(evalIds) })));
  };
  if (!reopened && cardsQuery.data) {
    setReopened(true);
    const latest = cardsQuery.data.filter((c) => !c.tryoutId || c.tryoutId === id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (latest) {
      setEditingId(latest.id);
      setTitle(latest.title);
      applySavedEvalIds(latest.evalIds);
      setCoachComments(latest.coachComments);
      setAiComments(latest.aiComments);
      setKept(latest.attachments);
    }
  }

  const tryout = tryoutQuery.data;
  const playerEvals = useMemo(
    () => (tryout && player ? tryout.evals.filter((e) => e.playerId === player.id).sort((a, b) => a.createdAt - b.createdAt) : []),
    [tryout, player],
  );
  const chosen = useMemo(
    () => new Set(selected ?? playerEvals.map((e) => e.id)),
    [selected, playerEvals],
  );

  // Scores for the evaluations chosen, worked out exactly as the results
  // report works them out, with only this player's evaluations narrowed down.
  const reportCard = useMemo(() => {
    if (!tryout || !player) return null;
    const scoped = { ...tryout, evals: tryout.evals.filter((e) => e.playerId !== player.id || chosen.has(e.id)) };
    return buildPlayerFullResults(scoped).find((c) => c.playerId === player.id) ?? null;
  }, [tryout, player, chosen]);

  // The rubrics' benchmarks beside this player's average over the chosen evaluations.
  const benchmarks = useMemo(() => {
    if (!tryout || !player) return [];
    const scoped = { ...tryout, evals: tryout.evals.filter((e) => e.playerId !== player.id || chosen.has(e.id)) };
    return benchmarkLines(scoped, player);
  }, [tryout, player, chosen]);

  // Each combined evaluation is worked out on its own, with its own ranks, never blended with the others.
  const extraQueries = useCombinedTryoutsQueries(extras.map((x) => x.tryoutId));
  const extraSections = useMemo(
    () =>
      extras.map((x, i) => {
        const q = extraQueries[i];
        const t = q?.data;
        const row = t?.roster.find((r) => r.id === x.playerId);
        const evals = t && row ? t.evals.filter((e) => e.playerId === row.id).sort((a, b) => a.createdAt - b.createdAt) : [];
        const chosenIds = new Set(x.picked ?? evals.map((e) => e.id));
        const scoped = t && row ? { ...t, evals: t.evals.filter((e) => e.playerId !== row.id || chosenIds.has(e.id)) } : null;
        return {
          tryoutId: x.tryoutId,
          playerId: x.playerId,
          name: t?.name ?? 'Evaluation',
          loading: !!q?.isLoading,
          error: !!q?.isError || (!!t && !row),
          evals,
          chosen: new Set(evals.filter((e) => chosenIds.has(e.id)).map((e) => e.id)),
          card: scoped && row ? (buildPlayerFullResults(scoped).find((c) => c.playerId === row.id) ?? null) : null,
          benchmarks: scoped && row ? benchmarkLines(scoped, row) : [],
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extras, extraQueries.map((q) => q.dataUpdatedAt).join(',')],
  );

  const who = useMemo(
    () =>
      player
        ? {
            athleteIds: [player.athleteId].filter((x): x is string => !!x),
            first: player.first,
            last: player.last,
          }
        : undefined,
    [player],
  );
  const candidatesQuery = useEvaluationCandidatesQuery(id, who, addingEval);
  const evalMatches = useMemo(() => {
    if (!player || !candidatesQuery.data) return [];
    const taken = new Set(extras.map((x) => x.tryoutId));
    return matchPlayerAcrossEvaluations(
      { athleteIds: who?.athleteIds ?? [], first: player.first, last: player.last, yearOfBirth: player.yearOfBirth, playerEmail: player.playerEmail },
      candidatesQuery.data,
    ).filter((m) => !taken.has(m.tryoutId));
  }, [player, who, candidatesQuery.data, extras]);
  const shownMatches = evalMatches.filter((m) => m.tryoutName.toLowerCase().includes(evalSearch.trim().toLowerCase()));

  if (tryoutQuery.isLoading) return <LoadingState />;
  if (tryoutQuery.isError || !tryout) {
    return <ErrorState message={terms.t('Player not found.')} onRetry={() => tryoutQuery.refetch()} />;
  }
  if (!player) return <EmptyState title={terms.t('Player not found')} />;
  if (!canManageTeam || isAssessorOnly) {
    return (
      <>
        <PageHeader title="Report Card" showBack backHref={href(`player/${playerId}`)} />
        <EmptyState title="Coaches only" message="Report cards are built by the coaching staff." />
      </>
    );
  }

  const team = teamsQuery.data?.find((t) => t.id === tryout.teamId);
  const name = playerDisplayName(player);
  const savedCards = cardsQuery.data ?? [];

  const openCard = (c: PlayerReportCard) => {
    setEditingId(c.id);
    setTitle(c.title);
    applySavedEvalIds(c.evalIds);
    setCoachComments(c.coachComments);
    setAiComments(c.aiComments);
    setKept(c.attachments);
    setFiles([]);
  };
  const newCard = () => {
    setEditingId(undefined);
    setTitle('Player Report Card');
    setSelected(null);
    setExtras([]);
    setCoachComments('');
    setAiComments('');
    setKept([]);
    setFiles([]);
  };

  const toggleEval = (evalId: string) =>
    setSelected((prev) => {
      const next = new Set(prev ?? playerEvals.map((e) => e.id));
      if (next.has(evalId)) next.delete(evalId);
      else next.add(evalId);
      return next;
    });

  const removeExtra = (tryoutId: string) => setExtras((prev) => prev.filter((x) => x.tryoutId !== tryoutId));
  const toggleExtraEval = (tryoutId: string, evalId: string) =>
    setExtras((prev) =>
      prev.map((x) => {
        if (x.tryoutId !== tryoutId) return x;
        const sec = extraSections.find((e) => e.tryoutId === tryoutId);
        const next = new Set(x.picked ?? sec?.evals.map((e) => e.id) ?? []);
        if (next.has(evalId)) next.delete(evalId);
        else next.add(evalId);
        return { ...x, picked: next };
      }),
    );

  const addPickedEvaluations = async () => {
    const chosenMatches = evalMatches.filter((m) => evalPick.has(m.tryoutId));
    const added: typeof extras = [];
    for (const m of chosenMatches) {
      if (m.uncertain) {
        const ok = await confirm({
          title: 'Is this the same athlete?',
          message: `${m.tryoutName} has "${m.playerName}", who ${m.why}. Is that ${name}? Only combine them if it is the same person.`,
          confirmLabel: 'Same athlete',
        });
        if (!ok) continue;
      }
      added.push({ tryoutId: m.tryoutId, playerId: m.playerId, picked: null });
    }
    if (added.length) setExtras((prev) => [...prev, ...added]);
    setEvalPick(new Set());
    setAddingEval(false);
    setEvalSearch('');
  };

  const addFiles = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    // Videos go through account video storage (compressed and counted against the quota).
    if (picked.some((f) => f.type.startsWith('video/'))) {
      await alert('Add videos below', 'Save the report card, then use Add video under Stored videos. Videos are compressed and kept in your video storage.');
      return;
    }
    const tooBig = picked.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig) {
      await alert('File too large', `${tooBig.name} is over 50 MB. For a longer video, add a link instead.`);
      return;
    }
    setFiles((prev) => [...prev, ...picked]);
  };

  const addLink = async () => {
    const url = safeExternalUrl(linkUrl.trim());
    if (!url) {
      await alert('Check the link', 'Enter a full web address starting with http:// or https://.');
      return;
    }
    setKept((prev) => [...prev, { kind: linkIsVideo ? 'video' : 'link', name: linkName.trim() || url, url }]);
    setLinkName('');
    setLinkUrl('');
  };

  const libraryVideos = (library.data ?? []).filter((i) => i.kind === 'video');

  /** Where a saved attachment opens; a stored Library video plays from the Library's own signed address. */
  const openHref = (a: ReportCardAttachment) =>
    a.signedUrl ?? a.url ?? (a.libraryItemId ? (library.data ?? []).find((i) => i.id === a.libraryItemId)?.video?.url : undefined);

  const addFromLibrary = async () => {
    const r = addLibraryVideos(kept, libraryVideos.filter((i) => libraryPick.has(i.id)));
    setKept(r.next);
    setLibraryPick(new Set());
    setPickingLibrary(false);
    if (r.unplayable) await alert('Some videos were skipped', `${r.unplayable} chosen video${r.unplayable === 1 ? ' has' : 's have'} nothing to play yet.`);
  };

  const runAi = async () => {
    if (chosen.size === 0) {
      await alert('Select evaluations', 'Choose at least one evaluation for the AI to read.');
      return;
    }
    if (aiComments.trim()) {
      const ok = await confirm({
        title: 'Replace the AI comments?',
        message: 'This writes new AI comments over the ones above, including any edits you made.',
        confirmLabel: 'Replace',
      });
      if (!ok) return;
    }
    try {
      const summary = await generate.mutateAsync({ playerId: player.id, evalIds: Array.from(chosen) });
      setAiComments(formatAiComments(summary));
    } catch (e) {
      await alert('AI comments unavailable', e instanceof Error ? e.message : 'Could not generate comments.');
    }
  };

  // The player's own evaluations here, then each combined evaluation as a marker plus the ones ticked in it.
  const savedEvalIds = [
    ...Array.from(chosen),
    ...extraSections.flatMap((x) => [extraMarker(x.tryoutId, x.playerId), ...Array.from(x.chosen)]),
  ];
  const stillLoadingExtras = extraSections.some((x) => x.loading);

  const saveCard = async () => {
    if (!player.athleteId) {
      await alert('Cannot save', 'This player has no athlete record yet.');
      return;
    }
    try {
      const saved = await save.mutateAsync({
        input: {
          id: editingId,
          athleteId: player.athleteId,
          tryoutId: id!,
          title,
          evalIds: savedEvalIds,
          coachComments,
          aiComments,
          attachments: kept,
        },
        files,
      });
      openCard(saved);
      toast('Report card saved', 'success');
    } catch (e) {
      await alert('Could not save', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const exportPdf = async () => {
    if (!reportCard) return;
    setExporting(true);
    try {
      const { exportPlayerReportCard } = await import('@/lib/exportData');
      // Saved uploads get a long-lived address so the exported PDF can open them.
      const fileLinks = await getDataSource().getReportCardFileLinks(kept.map((a) => a.path).filter((x): x is string => !!x));
      await exportPlayerReportCard({
        title,
        subtitle: [team?.name, tryout.name].filter(Boolean).join(' | '),
        card: reportCard,
        benchmarks,
        evaluationName: tryout.name,
        extras: extraSections
          .filter((x) => x.card && x.card.evalCount > 0)
          .map((x) => ({ name: x.name, card: x.card!, benchmarks: x.benchmarks })),
        coachComments,
        aiComments,
        attachments: [
          ...kept.map((a) => ({ kind: a.kind, name: a.name, url: a.url ?? (a.path ? fileLinks[a.path] : undefined) })),
          ...files.map((f) => ({ kind: (f.type.startsWith('video/') ? 'video' : 'file') as 'video' | 'file', name: f.name })),
        ],
        logoUrls: reportLogoUrls({ club: tier === 'club', organizationLogoUrl: user?.organizationLogoUrl, teamLogoUrl: team?.logoUrl, appLogo: printAppLogo }),
      });
    } catch (e) {
      await alert('Export failed', e instanceof Error ? e.message : 'Could not build the PDF.');
    } finally {
      setExporting(false);
    }
  };

  const deleteCard = async (c: PlayerReportCard) => {
    const ok = await confirm({
      title: 'Delete report card',
      message: `Delete "${c.title}"? Its attached files are deleted too.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(c);
      if (editingId === c.id) newCard();
      toast('Deleted', 'success');
    } catch (e) {
      await alert('Could not delete', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        title="Report Card"
        subtitle={`${name} | ${tryout.name}`}
        showBack
        backHref={href(`player/${playerId}`)}
        right={
          <RefreshButton onRefresh={() => Promise.all([tryoutQuery.refetch(), cardsQuery.refetch(), teamsQuery.refetch()])} />
        }
      />

      {savedCards.length > 0 ? (
        <Card className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Saved report cards</SectionLabel>
            <Button label="New" size="sm" variant="ghost" onClick={newCard} />
          </div>
          {savedCards.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0"
              style={{ borderColor: colors.border }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" style={{ color: colors.ink }}>
                  {c.title}
                  {editingId === c.id ? (
                    <span className="ml-2 align-middle">
                      <Badge label="Open" variant="info" />
                    </span>
                  ) : null}
                </p>
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  {new Date(c.updatedAt).toLocaleDateString()} · {splitSavedEvalIds(c.evalIds).evalIds.length} evaluation
                  {splitSavedEvalIds(c.evalIds).evalIds.length === 1 ? '' : 's'}
                </p>
              </div>
              <Button label="Open" size="sm" variant="secondary" onClick={() => openCard(c)} />
              <Button label="Delete" size="sm" variant="danger" onClick={() => deleteCard(c)} />
            </div>
          ))}
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div>
          <SectionLabel>Evaluations to include</SectionLabel>
          {playerEvals.length === 0 ? (
            <p className="mt-1 text-sm" style={{ color: colors.inkMuted }}>
              {name} has no evaluations yet. Score them first to put results on a report card.
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-1.5">
              <div className="flex gap-2">
                <Button label="Select all" size="sm" variant="ghost" onClick={() => setSelected(null)} />
                <Button label="Clear" size="sm" variant="ghost" onClick={() => setSelected(new Set())} />
              </div>
              {playerEvals.map((e, i) => (
                <label key={e.id} className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: colors.ink }}>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={chosen.has(e.id)}
                    onChange={() => toggleEval(e.id)}
                  />
                  <span>
                    Evaluation {i + 1}: {e.date} · {e.evaluator} · {e.session}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <SectionLabel>Other evaluations</SectionLabel>
            <p className="text-xs" style={{ color: colors.inkMuted }}>
              Combine {name}&apos;s scores from other evaluations. Each stays in its own section with its own ranking.
            </p>
          </div>
          <Button label="+ Add Evaluation" size="sm" variant="secondary" onClick={() => setAddingEval((v) => !v)} />
        </div>
        {addingEval ? (
          <div className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: colors.border }}>
            <Input placeholder="Search evaluations" value={evalSearch} onChange={(e) => setEvalSearch(e.target.value)} />
            {candidatesQuery.isLoading ? (
              <p className="text-sm" style={{ color: colors.inkMuted }}>Looking for {name} in your other evaluations...</p>
            ) : candidatesQuery.isError ? (
              <p className="text-sm" style={{ color: colors.inkMuted }}>Could not search your evaluations. Try again in a moment.</p>
            ) : shownMatches.length === 0 ? (
              <p className="text-sm" style={{ color: colors.inkMuted }}>
                {evalMatches.length === 0 ? (extras.length ? `Every other evaluation with ${name} is already added.` : `${name} is not in any other evaluation.`) : 'No evaluation matches that search.'}
              </p>
            ) : (
              shownMatches.map((m) => (
                <label key={m.tryoutId} className="flex items-center gap-2 text-sm" style={{ color: colors.ink }}>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={evalPick.has(m.tryoutId)}
                    onChange={(e) =>
                      setEvalPick((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(m.tryoutId);
                        else next.delete(m.tryoutId);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {m.tryoutName}
                    {m.playerName && m.playerName !== name ? <span style={{ color: colors.inkMuted }}> as {m.playerName}</span> : null}
                  </span>
                  {m.uncertain ? <Badge label="Confirm name" variant="warning" /> : null}
                </label>
              ))
            )}
            <div className="flex gap-2">
              <Button
                label={evalPick.size ? `Add ${evalPick.size} evaluation${evalPick.size === 1 ? '' : 's'}` : 'Add evaluations'}
                size="sm"
                onClick={addPickedEvaluations}
                disabled={evalPick.size === 0}
              />
              <Button label="Cancel" size="sm" variant="ghost" onClick={() => { setAddingEval(false); setEvalPick(new Set()); setEvalSearch(''); }} />
            </div>
          </div>
        ) : null}
      </Card>

      {reportCard && (reportCard.evalCount > 0 || reportCard.metrics.length > 0) ? (
        <Card className="flex flex-col gap-2">
          <SectionLabel>{extraSections.length ? `Report card: ${tryout.name}` : 'Report card'}</SectionLabel>
          <ScoreTable card={reportCard} benchmarks={benchmarks} />
        </Card>
      ) : null}

      {extraSections.map((x) => (
        <Card key={x.tryoutId} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>{`Report card: ${x.name}`}</SectionLabel>
            <Button label="Remove" size="sm" variant="ghost" onClick={() => removeExtra(x.tryoutId)} />
          </div>
          {x.loading ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>Loading...</p>
          ) : x.error || !x.card ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>Could not load this evaluation.</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                {x.evals.map((e, i) => (
                  <label key={e.id} className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: colors.ink }}>
                    <input type="checkbox" className="h-4 w-4" checked={x.chosen.has(e.id)} onChange={() => toggleExtraEval(x.tryoutId, e.id)} />
                    <span>
                      Evaluation {i + 1}: {e.date} · {e.evaluator} · {e.session}
                    </span>
                  </label>
                ))}
              </div>
              {x.card.evalCount > 0 ? <ScoreTable card={x.card} benchmarks={x.benchmarks} /> : (
                <p className="text-sm" style={{ color: colors.inkMuted }}>{x.evals.length === 0 ? 'No scores for this player in this evaluation yet.' : 'No evaluations ticked for this one.'}</p>
              )}
            </>
          )}
        </Card>
      ))}

      <Card className="flex flex-col gap-3">
        <Textarea
          label="Coach comments"
          rows={6}
          value={coachComments}
          onChange={(e) => setCoachComments(e.target.value)}
          placeholder="What to tell the family: strengths, what to work on, next steps."
        />
        <PlanGate feature="aiReportComments" title="AI comments (Club plan)" tierOverride={tier}>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>AI comments</SectionLabel>
              <Button
                label={aiComments.trim() ? 'Regenerate' : 'Generate with AI'}
                size="sm"
                variant="secondary"
                onClick={runAi}
                loading={generate.isPending}
              />
            </div>
            <Textarea
              rows={8}
              value={aiComments}
              onChange={(e) => setAiComments(e.target.value)}
              placeholder="Generate comments from the chosen evaluations, then edit them freely."
              hint="A draft from the evaluations you chose. Read and edit it before sharing: it is printed as AI-assisted."
            />
          </div>
        </PlanGate>
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel>Videos, files and links</SectionLabel>
        {kept.length === 0 && files.length === 0 ? (
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            Add game video, drill sheets or any link worth showing the family.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {kept.map((a, i) => (
              <div key={`k-${i}`} className="flex items-center justify-between gap-2 text-sm" style={{ color: colors.ink }}>
                <span className="min-w-0 flex-1 truncate">
                  {a.kind === 'video' ? 'Video' : a.kind === 'link' ? 'Link' : 'File'}: {openHref(a) ? (
                    <a
                      href={openHref(a)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                      style={{ color: colors.primary }}
                    >
                      {a.name}
                    </a>
                  ) : (
                    a.name
                  )}
                  {a.libraryItemId && !a.url ? (
                    <span style={{ color: colors.inkMuted }}> (from your Library, plays in the app, not linked in the PDF)</span>
                  ) : null}
                </span>
                <Button label="Remove" size="sm" variant="ghost" onClick={() => setKept((p) => p.filter((_, j) => j !== i))} />
              </div>
            ))}
            {files.map((f, i) => (
              <div key={`f-${i}`} className="flex items-center justify-between gap-2 text-sm" style={{ color: colors.ink }}>
                <span className="min-w-0 flex-1 truncate">
                  {f.type.startsWith('video/') ? 'Video' : 'File'}: {f.name} ({formatFileSize(f.size)}){' '}
                  <span style={{ color: colors.inkMuted }}>(uploads when you save)</span>
                </span>
                <Button label="Remove" size="sm" variant="ghost" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div>
          <div className="flex flex-wrap gap-2">
            <Button label="Upload a file" variant="secondary" onClick={() => fileInput.current?.click()} />
            <Button label="Add from your Library" variant="secondary" onClick={() => setPickingLibrary((v) => !v)} />
          </div>
          <p className="mt-1 text-xs" style={{ color: colors.inkMuted }}>
            Files up to 50 MB each. Videos are added under Stored videos once the card is saved, or add a link below.
          </p>
        </div>
        {pickingLibrary ? (
          <div className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: colors.border }}>
            <SectionLabel>Library videos</SectionLabel>
            {library.isLoading ? (
              <p className="text-sm" style={{ color: colors.inkMuted }}>Loading your Library...</p>
            ) : libraryVideos.length === 0 ? (
              <p className="text-sm" style={{ color: colors.inkMuted }}>No videos in your Library yet.</p>
            ) : (
              libraryVideos.map((v) => {
                const already = kept.some((a) => a.libraryItemId === v.id);
                return (
                  <label key={v.id} className="flex items-center gap-2 text-sm" style={{ color: already ? colors.inkMuted : colors.ink }}>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      disabled={already}
                      checked={already || libraryPick.has(v.id)}
                      onChange={(e) =>
                        setLibraryPick((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(v.id);
                          else next.delete(v.id);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{v.title}</span>
                    {already ? <span className="text-xs">Added</span> : null}
                  </label>
                );
              })
            )}
            <div className="flex gap-2">
              <Button label={libraryPick.size ? `Add ${libraryPick.size} video${libraryPick.size === 1 ? '' : 's'}` : 'Add videos'} size="sm" onClick={addFromLibrary} disabled={libraryPick.size === 0} />
              <Button label="Cancel" size="sm" variant="ghost" onClick={() => { setPickingLibrary(false); setLibraryPick(new Set()); }} />
            </div>
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input label="Link name" value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="Game 3 highlights" />
          <Input
            label="Link address"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://"
            inputMode="url"
            autoCapitalize="none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm" style={{ color: colors.ink }}>
            <input type="checkbox" className="h-4 w-4" checked={linkIsVideo} onChange={(e) => setLinkIsVideo(e.target.checked)} />
            This link is a video
          </label>
          <Button label="Add link" variant="secondary" size="sm" onClick={addLink} disabled={!linkUrl.trim()} />
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <TaggedVideos athleteId={player.athleteId} person={{ first: player.first, last: player.last }} />
        {editingId ? (
          <ContextVideos
            context="report_card"
            contextId={editingId}
            accountId={savedCards.find((c) => c.id === editingId)?.accountId}
            title="Stored videos"
          />
        ) : (
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            Save the report card first, then you can add videos from your video storage.
          </p>
        )}
      </Card>

      {(tier === 'club' && user?.organizationLogoUrl) || team?.logoUrl ? (
        <label className="flex items-center gap-2 pb-3 text-sm" style={{ color: colors.ink }}>
          <input type="checkbox" checked={printAppLogo} onChange={(e) => setPrintAppLogo(e.target.checked)} className="h-4 w-4" />
          Also print the SquadOwl logo beside your team logo
        </label>
      ) : null}

      <div className="flex flex-wrap gap-3 pb-6">
        <Button label={editingId ? 'Save changes' : 'Save report card'} onClick={saveCard} loading={save.isPending} disabled={stillLoadingExtras} />
        <Button label="Download PDF" variant="secondary" onClick={exportPdf} loading={exporting} disabled={!reportCard} />
      </div>
    </div>
  );
}
