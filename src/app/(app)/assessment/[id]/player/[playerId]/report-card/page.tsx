'use client';

import { useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { usePermissions } from '@/state/authStore';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  SectionLabel,
  Textarea,
  useAlert,
} from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import {
  useDeletePlayerReportCardMutation,
  useGenerateReportCardCommentsMutation,
  usePlayerReportCardsQuery,
  useSavePlayerReportCardMutation,
  useTeamsQuery,
  useTryoutQuery,
} from '@/features/queries';
import { useAssessmentHref, useAssessmentId, useIsAssessorOnly } from '@/features/useAssessmentId';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { buildPlayerFullResults } from '@/data/resultsExport';
import { playerDisplayName } from '@/data/rubrics';
import type { PlayerReportCard, ReportCardAttachment } from '@/data/types';
import { formatAiComments } from '@/lib/reportCardText';
import { formatFileSize, safeExternalUrl } from '@/lib/libraryMedia';
import { useTerms } from '@/lib/terms';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export default function PlayerReportCardPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const params = useParams();
  const playerId = Array.isArray(params?.playerId) ? params.playerId[0] : (params?.playerId as string);
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const { canManageTeam } = usePermissions();

  const tryoutQuery = useTryoutQuery(id);
  const terms = useTerms(tryoutQuery.data?.settings.customLabels);
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
  const [files, setFiles] = useState<File[]>([]);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkIsVideo, setLinkIsVideo] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);

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
    setSelected(new Set(c.evalIds));
    setCoachComments(c.coachComments);
    setAiComments(c.aiComments);
    setKept(c.attachments);
    setFiles([]);
  };
  const newCard = () => {
    setEditingId(undefined);
    setTitle('Player Report Card');
    setSelected(null);
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

  const addFiles = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
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
          evalIds: Array.from(chosen),
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
      await exportPlayerReportCard({
        title,
        subtitle: [team?.name, tryout.name].filter(Boolean).join(' | '),
        card: reportCard,
        coachComments,
        aiComments,
        attachments: [
          ...kept.map((a) => ({ kind: a.kind, name: a.name, url: a.url })),
          ...files.map((f) => ({ kind: (f.type.startsWith('video/') ? 'video' : 'file') as 'video' | 'file', name: f.name })),
        ],
        logoUrls: tier === 'club' && team?.logoUrl ? [team.logoUrl] : [],
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
                  {new Date(c.updatedAt).toLocaleDateString()} · {c.evalIds.length} evaluation
                  {c.evalIds.length === 1 ? '' : 's'}
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

      {reportCard && reportCard.evalCount > 0 ? (
        <Card className="flex flex-col gap-2">
          <SectionLabel>Scores from the chosen evaluations</SectionLabel>
          <div className="text-sm" style={{ color: colors.ink }}>
            <div className="flex justify-between border-b py-1 font-bold" style={{ borderColor: colors.border, color: colors.primary }}>
              <span>Overall</span>
              <span>
                {reportCard.overallScore} · {reportCard.overallRank}
              </span>
            </div>
            {reportCard.metrics.map((m) => (
              <div key={m.label} className="flex justify-between border-b py-1" style={{ borderColor: colors.border }}>
                <span>{m.label}</span>
                <span>
                  {m.score} · {m.rank}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

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
                  {a.kind === 'video' ? 'Video' : a.kind === 'link' ? 'Link' : 'File'}: {a.signedUrl || a.url ? (
                    <a
                      href={a.signedUrl ?? a.url}
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
          <Button label="Upload a file or video" variant="secondary" onClick={() => fileInput.current?.click()} />
          <p className="mt-1 text-xs" style={{ color: colors.inkMuted }}>
            Up to 50 MB each. For longer videos, add a link below.
          </p>
        </div>
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

      <div className="flex flex-wrap gap-3 pb-6">
        <Button label={editingId ? 'Save changes' : 'Save report card'} onClick={saveCard} loading={save.isPending} />
        <Button label="Download PDF" variant="secondary" onClick={exportPdf} loading={exporting} disabled={!reportCard} />
      </div>
    </div>
  );
}
