'use client';

import { useMemo, useState } from 'react';

import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  SectionLabel,
  Select,
  Textarea,
  useAlert,
} from '@/components/ui';
import { CoachOnlyState } from '@/components/assessment/CoachOnlyState';
import {
  BUILT_IN_LETTER_TEMPLATES,
  LETTER_KINDS,
  LETTER_KIND_DESCRIPTIONS,
  LETTER_KIND_LABELS,
  LETTER_PLACEHOLDERS,
  buildLetterVars,
  letterRecipient,
  renderLetter,
  unfilledTokens,
  type LetterKind,
} from '@/data/letters';
import { playerDisplayName } from '@/data/rubrics';
import type { LetterTemplate, Player, PlayerLetter } from '@/data/types';
import {
  useCreateLetterTemplateMutation,
  useDeleteLetterTemplateMutation,
  useDeletePlayerLetterMutation,
  useLetterTemplatesQuery,
  usePlayerLettersQuery,
  useResendPlayerLetterMutation,
  useSendPlayerLettersMutation,
  useTeamsQuery,
  useTryoutQuery,
  useUpdateLetterTemplateMutation,
} from '@/features/queries';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';

/** The template editor's working copy — a new template until it has an id. */
interface TemplateDraft {
  id?: string;
  name: string;
  kind: LetterKind;
  subject: string;
  body: string;
}

const STATUS_VARIANT = { sent: 'success', failed: 'danger', draft: 'warning' } as const;

export default function LettersPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const { alert, confirm } = useAlert();
  const user = useUser();

  const tryoutQuery = useTryoutQuery(id);
  const teamsQuery = useTeamsQuery();
  const templatesQuery = useLetterTemplatesQuery();
  const lettersQuery = usePlayerLettersQuery(id);

  const createTemplate = useCreateLetterTemplateMutation();
  const updateTemplate = useUpdateLetterTemplateMutation();
  const deleteTemplate = useDeleteLetterTemplateMutation();
  const [sendProgress, setSendProgress] = useState<{ done: number; total: number } | null>(null);
  const sendLetters = useSendPlayerLettersMutation(id!, (done, total) => setSendProgress({ done, total }));
  const resendLetter = useResendPlayerLetterMutation(id!);
  const deleteLetter = useDeletePlayerLetterMutation(id!);

  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [sendWith, setSendWith] = useState<LetterTemplate | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [playerSearch, setPlayerSearch] = useState('');
  const [previewFor, setPreviewFor] = useState<Player | null>(null);
  const [openLetter, setOpenLetter] = useState<PlayerLetter | null>(null);

  const tryout = tryoutQuery.data;
  const team = useMemo(
    () => teamsQuery.data?.find((t) => t.id === tryout?.teamId),
    [teamsQuery.data, tryout?.teamId],
  );

  // The context every letter is rendered against. The coach's own identity
  // stands in wherever the assessment does not name a head coach — a letter
  // signed by nobody is worse than one signed by the person sending it.
  const letterContext = useMemo(
    () => ({
      teamName: team?.name || tryout?.name,
      // Teams carry the season as free text; failing that, the year the
      // assessment was actually run is the closest true thing we hold.
      seasonName: team?.season || tryout?.tryoutDate?.slice(0, 4),
      coachName: tryout?.headCoach || tryout?.headAssessor || user?.displayName,
      coachEmail: tryout?.headAssessorEmail || user?.email,
    }),
    [team, tryout, user],
  );

  const renderFor = (player: Player, text: string) =>
    renderLetter(
      text,
      buildLetterVars({
        playerFirst: player.first,
        playerLast: player.last,
        guardianName: player.guardianName,
        ...letterContext,
      }),
    );

  const filteredRoster = useMemo(() => {
    const roster = tryout?.roster ?? [];
    const search = playerSearch.trim().toLowerCase();
    if (!search) return roster;
    return roster.filter((p) => `${p.first} ${p.last}`.toLowerCase().includes(search));
  }, [tryout?.roster, playerSearch]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading letters..." />;
  if (tryoutQuery.isError || !tryout) {
    return (
      <>
        <PageHeader title="Player Selection Letters" showBack backHref={href('roster')} />
        <ErrorState message="Could not load this evaluation." onRetry={() => tryoutQuery.refetch()} />
      </>
    );
  }
  if (!tryout.viewerIsOwner) return <CoachOnlyState what="send selection letters" />;

  const templates = templatesQuery.data ?? [];
  const letters = lettersQuery.data ?? [];
  const lettersByPlayer = new Map<string, PlayerLetter[]>();
  for (const l of letters) {
    lettersByPlayer.set(l.playerId, [...(lettersByPlayer.get(l.playerId) ?? []), l]);
  }

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      await alert('Name required', 'Give the template a name so you can find it again.');
      return;
    }
    try {
      if (draft.id) {
        await updateTemplate.mutateAsync({
          id: draft.id,
          updates: { name: draft.name, kind: draft.kind, subject: draft.subject, body: draft.body },
        });
      } else {
        await createTemplate.mutateAsync({
          name: draft.name,
          kind: draft.kind,
          subject: draft.subject,
          body: draft.body,
          tryoutId: id,
        });
      }
      setDraft(null);
    } catch (e) {
      await alert('Save Error', e instanceof Error ? e.message : 'Could not save the template.');
    }
  };

  const removeTemplate = async (t: LetterTemplate) => {
    const ok = await confirm({
      title: 'Delete template?',
      // Worth saying out loud: the copies are snapshots, so deleting the
      // stationery does not un-send anything.
      message: `"${t.name}" will be removed. Letters already sent from it stay on the players' cards.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTemplate.mutateAsync(t.id);
      if (sendWith?.id === t.id) setSendWith(null);
    } catch (e) {
      await alert('Delete Failed', e instanceof Error ? e.message : 'Could not delete the template.');
    }
  };

  const startSend = (t: LetterTemplate) => {
    setSendWith(t);
    setSelectedIds(new Set());
    setPlayerSearch('');
  };

  const togglePlayer = (playerId: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });

  const send = async () => {
    if (!sendWith) return;
    const chosen = tryout.roster.filter((p) => selectedIds.has(p.id));
    if (!chosen.length) return;

    const missingAddress = chosen.filter((p) => !letterRecipient(p));
    // Checked on the rendered body, not the template: {{player_name}} is
    // supposed to still be a token here, and only what survives rendering is
    // something a family would actually read.
    const leftover = unfilledTokens(
      `${renderFor(chosen[0], sendWith.subject)}\n${renderFor(chosen[0], sendWith.body)}`,
    );

    const warnings = [
      leftover.length
        ? `${leftover.map((t) => `{{${t}}}`).join(', ')} ${leftover.length === 1 ? 'has' : 'have'} not been filled in and will be sent as-is.`
        : null,
      missingAddress.length
        ? `${missingAddress.length} selected player${missingAddress.length === 1 ? ' has' : 's have'} no email address on file and will be saved as failed.`
        : null,
    ].filter(Boolean);

    const ok = await confirm({
      title: `Send to ${chosen.length} player${chosen.length === 1 ? '' : 's'}?`,
      message: [
        `"${sendWith.name}" will be emailed to the guardian on file for each selected player, and a copy attached to their card.`,
        ...warnings,
      ].join('\n\n'),
      confirmLabel: 'Send',
    });
    if (!ok) return;

    setSendProgress({ done: 0, total: chosen.length });
    try {
      const results = await sendLetters.mutateAsync(
        chosen.map((p) => ({
          playerId: p.id,
          playerName: playerDisplayName(p),
          athleteId: p.athleteId,
          templateId: sendWith.id,
          kind: sendWith.kind,
          subject: renderFor(p, sendWith.subject),
          body: renderFor(p, sendWith.body),
          recipientEmail: letterRecipient(p),
        })),
      );
      const failed = results.filter((r) => r.error);
      await alert(
        failed.length ? 'Sent with problems' : 'Letters sent',
        failed.length
          ? `${results.length - failed.length} of ${results.length} sent. These did not go out:\n\n${failed
              .map((r) => `${r.playerName}: ${r.error}`)
              .join('\n')}`
          : `${results.length} letter${results.length === 1 ? '' : 's'} sent.`,
      );
      setSelectedIds(new Set());
    } catch (e) {
      await alert('Send Failed', e instanceof Error ? e.message : 'Could not send the letters.');
    } finally {
      setSendProgress(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Player Selection Letters"
        subtitle="Write an offer or roster decision letter once, then send it to the players you choose"
        showBack
        backHref={href('roster')}
        right={
          <Button
            label="+ New Template"
            onClick={() => setDraft({ name: '', kind: 'custom', subject: '', body: '' })}
          />
        }
      />

      <SectionLabel className="mb-2">Templates</SectionLabel>
      {templatesQuery.isLoading ? (
        <LoadingState message="Loading templates..." />
      ) : templatesQuery.isError ? (
        <ErrorState message="Could not load your templates." onRetry={() => templatesQuery.refetch()} />
      ) : templates.length === 0 ? (
        <Card className="mb-6">
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            No templates yet. Start from one of the standard letters — you can edit every word of it
            before anything is sent.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {BUILT_IN_LETTER_TEMPLATES.map((t) => (
              <Button
                key={t.kind}
                label={`Start from ${LETTER_KIND_LABELS[t.kind]}`}
                variant="secondary"
                onClick={() => setDraft({ name: t.name, kind: t.kind, subject: t.subject, body: t.body })}
              />
            ))}
          </div>
        </Card>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {templates.map((t) => (
            <Card key={t.id} className={sendWith?.id === t.id ? 'ring-2' : undefined}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-base font-bold" style={{ color: colors.ink }}>
                    {t.name}
                  </p>
                  <p className="mt-0.5 truncate text-sm" style={{ color: colors.inkMuted }}>
                    {t.subject || 'No subject'}
                  </p>
                </div>
                <Badge label={LETTER_KIND_LABELS[t.kind]} variant={t.kind === 'offer' ? 'success' : 'info'} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button label={sendWith?.id === t.id ? 'Selected' : 'Select Players'} onClick={() => startSend(t)} />
                <Button
                  label="Edit"
                  variant="secondary"
                  onClick={() =>
                    setDraft({ id: t.id, name: t.name, kind: t.kind, subject: t.subject, body: t.body })
                  }
                />
                <Button label="Delete" variant="ghost" onClick={() => removeTemplate(t)} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {sendWith ? (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <SectionLabel>Send &ldquo;{sendWith.name}&rdquo;</SectionLabel>
              <p className="mt-0.5 text-sm" style={{ color: colors.inkMuted }}>
                Goes to each player&rsquo;s guardian email, falling back to the player&rsquo;s own.
              </p>
            </div>
            <Button label="Cancel" variant="ghost" onClick={() => setSendWith(null)} />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              label={selectedIds.size === filteredRoster.length ? 'Deselect All' : 'Select All'}
              variant="secondary"
              onClick={() =>
                setSelectedIds(
                  selectedIds.size === filteredRoster.length
                    ? new Set()
                    : new Set(filteredRoster.map((p) => p.id)),
                )
              }
            />
            <Button
              label={
                sendProgress
                  ? `Sending ${sendProgress.done}/${sendProgress.total}...`
                  : `Send to ${selectedIds.size} Player${selectedIds.size === 1 ? '' : 's'}`
              }
              disabled={selectedIds.size === 0}
              loading={sendLetters.isPending}
              onClick={send}
            />
          </div>

          <Input
            containerClassName="mt-3"
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
            placeholder="Search players by name"
          />

          {filteredRoster.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: colors.inkMuted }}>
              No players match.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filteredRoster.map((p) => {
                const isSelected = selectedIds.has(p.id);
                const to = letterRecipient(p);
                const already = lettersByPlayer.get(p.id) ?? [];
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-2xl border p-3"
                    style={{
                      backgroundColor: colors.card,
                      borderColor: isSelected ? colors.primary : colors.border,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => togglePlayer(p.id)}
                      aria-pressed={isSelected}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span
                        aria-hidden
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border text-[12px] font-bold text-white"
                        style={{
                          borderColor: isSelected ? colors.primary : colors.border,
                          backgroundColor: isSelected ? colors.primary : 'transparent',
                        }}
                      >
                        {isSelected ? '✓' : ''}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold" style={{ color: colors.ink }}>
                          {playerDisplayName(p)}
                        </span>
                        <span
                          className="block truncate text-xs"
                          style={{ color: to ? colors.inkMuted : colors.warning }}
                        >
                          {to ?? 'No email on file'}
                        </span>
                      </span>
                    </button>
                    {already.length ? <Badge label={`${already.length} sent`} variant="info" /> : null}
                    <Button label="Preview" variant="ghost" onClick={() => setPreviewFor(p)} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}

      <SectionLabel className="mb-2">Sent Letters</SectionLabel>
      {lettersQuery.isLoading ? (
        <LoadingState message="Loading sent letters..." />
      ) : letters.length === 0 ? (
        <EmptyState
          title="No letters sent yet"
          message="Pick a template above, choose the players it applies to, and send. Every copy shows up here and on the player's card."
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {letters.map((l) => {
            const player = tryout.roster.find((p) => p.id === l.playerId);
            return (
              <Card key={l.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold" style={{ color: colors.ink }}>
                      {player ? playerDisplayName(player) : 'Removed player'}
                    </p>
                    <p className="mt-0.5 truncate text-sm" style={{ color: colors.inkMuted }}>
                      {l.subject}
                    </p>
                    <p className="mt-0.5 truncate text-xs" style={{ color: colors.inkMuted }}>
                      {LETTER_KIND_LABELS[l.kind]}
                      {l.recipientEmail ? ` · ${l.recipientEmail}` : ''}
                      {l.sentAt ? ` · ${new Date(l.sentAt).toLocaleDateString()}` : ''}
                    </p>
                    {l.status === 'failed' && l.error ? (
                      <p className="mt-1 text-xs" style={{ color: colors.danger }}>
                        {l.error}
                      </p>
                    ) : null}
                  </div>
                  <Badge label={l.status} variant={STATUS_VARIANT[l.status]} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button label="View" variant="secondary" onClick={() => setOpenLetter(l)} />
                  <Button
                    label={l.status === 'sent' ? 'Re-send' : 'Retry'}
                    variant="secondary"
                    loading={resendLetter.isPending && resendLetter.variables === l.id}
                    onClick={async () => {
                      try {
                        const updated = await resendLetter.mutateAsync(l.id);
                        if (updated.status === 'failed') {
                          await alert('Not Sent', updated.error || 'The letter could not be sent.');
                        }
                      } catch (e) {
                        await alert('Send Failed', e instanceof Error ? e.message : 'Could not re-send.');
                      }
                    }}
                  />
                  <Button
                    label="Delete"
                    variant="ghost"
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Delete this copy?',
                        message: 'The record comes off the player’s card. It does not recall an email already delivered.',
                        confirmLabel: 'Delete',
                        destructive: true,
                      });
                      if (!ok) return;
                      try {
                        await deleteLetter.mutateAsync(l.id);
                      } catch (e) {
                        await alert('Delete Failed', e instanceof Error ? e.message : 'Could not delete.');
                      }
                    }}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <TemplateEditor
        draft={draft}
        saving={createTemplate.isPending || updateTemplate.isPending}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={saveDraft}
      />

      <Modal
        visible={!!previewFor && !!sendWith}
        title={previewFor ? `Preview — ${playerDisplayName(previewFor)}` : 'Preview'}
        size="lg"
        onClose={() => setPreviewFor(null)}
      >
        {previewFor && sendWith ? (
          <LetterBody
            subject={renderFor(previewFor, sendWith.subject)}
            body={renderFor(previewFor, sendWith.body)}
            to={letterRecipient(previewFor)}
          />
        ) : null}
      </Modal>

      <Modal
        visible={!!openLetter}
        title={openLetter?.subject || 'Letter'}
        size="lg"
        onClose={() => setOpenLetter(null)}
      >
        {openLetter ? (
          <LetterBody subject={openLetter.subject} body={openLetter.body} to={openLetter.recipientEmail} />
        ) : null}
      </Modal>
    </>
  );
}

/** The rendered letter, as the family will read it. */
function LetterBody({ subject, body, to }: { subject: string; body: string; to?: string }) {
  const colors = useThemeColors();
  const leftover = unfilledTokens(`${subject}\n${body}`);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <SectionLabel>To</SectionLabel>
        <p className="text-sm" style={{ color: to ? colors.ink : colors.warning }}>
          {to ?? 'No email address on file for this player'}
        </p>
      </div>
      <div>
        <SectionLabel>Subject</SectionLabel>
        <p className="text-sm font-bold" style={{ color: colors.ink }}>
          {subject}
        </p>
      </div>
      {leftover.length ? (
        <p className="text-sm" style={{ color: colors.warning }}>
          Still unfilled: {leftover.map((t) => `{{${t}}}`).join(', ')}
        </p>
      ) : null}
      {/* whitespace-pre-wrap, because the coach's own line breaks are the
          layout — the email keeps them too (see tplTryoutLetter). */}
      <p
        className="whitespace-pre-wrap rounded-2xl p-4 text-sm leading-relaxed"
        style={{ backgroundColor: colors.tile, color: colors.ink }}
      >
        {body}
      </p>
    </div>
  );
}

function TemplateEditor({
  draft,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  draft: TemplateDraft | null;
  saving: boolean;
  onChange: (d: TemplateDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Modal
      visible={!!draft}
      title={draft?.id ? 'Edit Template' : 'New Template'}
      size="lg"
      onClose={onClose}
      footer={
        <ModalFooter>
          <Button label="Save Template" loading={saving} onClick={onSave} />
        </ModalFooter>
      }
    >
      {draft ? (
        <div className="flex flex-col gap-3">
          <Input
            label="Template name"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="e.g. U15 AAA Offer Letter"
          />
          <Select
            label="Type"
            value={draft.kind}
            hint={LETTER_KIND_DESCRIPTIONS[draft.kind]}
            onChange={(e) => onChange({ ...draft, kind: e.target.value as LetterKind })}
            options={LETTER_KINDS.map((k) => ({ value: k, label: LETTER_KIND_LABELS[k] }))}
          />
          <Input
            label="Subject"
            value={draft.subject}
            onChange={(e) => onChange({ ...draft, subject: e.target.value })}
          />
          <Textarea
            label="Letter"
            rows={16}
            value={draft.body}
            onChange={(e) => onChange({ ...draft, body: e.target.value })}
            hint="Click a placeholder below to add it where the cursor last was, or type it yourself."
          />

          {/* Only the standard letters carry pre-written wording, so offering
              them here is what makes "start from the template" reachable when a
              coach is already halfway through writing their own. */}
          {!draft.id ? (
            <div>
              <SectionLabel className="mb-1.5">Start from a standard letter</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {BUILT_IN_LETTER_TEMPLATES.map((t) => (
                  <Chip
                    key={t.kind}
                    label={LETTER_KIND_LABELS[t.kind]}
                    onClick={() =>
                      onChange({
                        ...draft,
                        name: draft.name || t.name,
                        kind: t.kind,
                        subject: t.subject,
                        body: t.body,
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <SectionLabel className="mb-1.5">Placeholders</SectionLabel>
            <div className="flex flex-col gap-1">
              {LETTER_PLACEHOLDERS.map((p) => (
                <button
                  key={p.token}
                  type="button"
                  onClick={() => onChange({ ...draft, body: `${draft.body}{{${p.token}}}` })}
                  className="flex flex-wrap items-baseline gap-2 rounded-lg px-2 py-1 text-left hover:brightness-125"
                  style={{ backgroundColor: colors.tile }}
                >
                  <code className="text-xs font-bold" style={{ color: colors.primary }}>
                    {`{{${p.token}}}`}
                  </code>
                  <span className="text-xs" style={{ color: colors.inkMuted }}>
                    {p.auto ? p.hint : `${p.hint}`}
                  </span>
                  {!p.auto ? <Badge label="you write this" variant="warning" /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
