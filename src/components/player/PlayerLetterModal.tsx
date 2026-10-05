'use client';

import { useMemo, useState } from 'react';

import { Badge, Button, Input, Modal, Textarea, useAlert } from '@/components/ui';
import {
  LETTER_KIND_LABELS,
  buildLetterVars,
  letterRecipient,
  renderLetter,
  unfilledTokens,
} from '@/data/letters';
import { playerDisplayName } from '@/data/rubrics';
import type { LetterTemplate, Player, Tryout } from '@/data/types';
import { useLetterTemplatesQuery, useSendPlayerLettersMutation, useTeamsQuery } from '@/features/queries';
import { useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * Send an offer or roster decision letter to one player, from their own card.
 *
 * The same templates, substitutions and send path as the Letters tool, which is
 * built for sending to many players at once. Here the coach picks a template,
 * sees it already filled in for this player, can change the wording for just
 * this letter, and sends. A copy is attached to the player's card either way.
 */
export function PlayerLetterModal({
  tryout,
  player,
  visible,
  onClose,
  onOpenTool,
}: {
  tryout: Tryout;
  player: Player;
  visible: boolean;
  onClose: () => void;
  /** Opens the full Letters tool, for writing or editing templates. */
  onOpenTool: () => void;
}) {
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const user = useUser();
  const templatesQuery = useLetterTemplatesQuery({ enabled: visible });
  const teamsQuery = useTeamsQuery({ enabled: visible });
  const send = useSendPlayerLettersMutation(tryout.id);

  const [template, setTemplate] = useState<LetterTemplate | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [to, setTo] = useState(letterRecipient(player) ?? '');

  const team = teamsQuery.data?.find((t) => t.id === tryout.teamId);
  const vars = useMemo(
    () =>
      buildLetterVars({
        playerFirst: player.first,
        playerLast: player.last,
        guardianName: player.guardianName,
        teamName: team?.name || tryout.name,
        seasonName: team?.season || tryout.tryoutDate?.slice(0, 4),
        coachName: tryout.headCoach || tryout.headAssessor || user?.displayName,
        coachEmail: tryout.headAssessorEmail || user?.email,
      }),
    [player, team, tryout, user],
  );

  const pick = (t: LetterTemplate) => {
    setTemplate(t);
    setTo(letterRecipient(player) ?? '');
    setSubject(renderLetter(t.subject, vars));
    setBody(renderLetter(t.body, vars));
  };

  const close = () => {
    setTemplate(null);
    onClose();
  };

  const templates = templatesQuery.data ?? [];
  const leftover = unfilledTokens(`${subject}\n${body}`);

  const submit = async () => {
    if (!template) return;
    const address = to.trim();
    const ok = await confirm({
      title: 'Send letter?',
      message: [
        address
          ? `"${subject}" will be emailed to ${address}, and a copy attached to ${playerDisplayName(player)}'s card.`
          : `There is no email address, so this will be saved to ${playerDisplayName(player)}'s card as not sent.`,
        leftover.length
          ? `${leftover.map((t) => `{{${t}}}`).join(', ')} ${leftover.length === 1 ? 'has' : 'have'} not been filled in and will be sent as-is.`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      confirmLabel: 'Send',
    });
    if (!ok) return;
    try {
      const [result] = await send.mutateAsync([
        {
          playerId: player.id,
          playerName: playerDisplayName(player),
          athleteId: player.athleteId,
          templateId: template.id,
          kind: template.kind,
          subject,
          body,
          recipientEmail: address || undefined,
        },
      ]);
      if (result?.error) {
        await alert('Not sent', result.error);
      } else {
        toast('Letter sent', 'success');
        close();
      }
    } catch (e) {
      await alert('Send failed', e instanceof Error ? e.message : 'Could not send the letter.');
    }
  };

  return (
    <Modal visible={visible} title="Send a Letter" onClose={close} size="lg" hideDefaultFooter>
      {!template ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            Choose a letter for {playerDisplayName(player)}. It is filled in for them and kept on their card.
          </p>
          {templatesQuery.isLoading ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              Loading letters...
            </p>
          ) : templates.length === 0 ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              No letters written yet. Create an offer or roster decision letter in the Letters tool first.
            </p>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t)}
                className="flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left"
                style={{ backgroundColor: colors.tile, borderColor: colors.border }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold" style={{ color: colors.ink }}>
                    {t.name}
                  </span>
                  <span className="block truncate text-xs" style={{ color: colors.inkMuted }}>
                    {t.subject}
                  </span>
                </span>
                <Badge label={LETTER_KIND_LABELS[t.kind]} variant={t.kind === 'offer' ? 'success' : 'info'} />
              </button>
            ))
          )}
          <div className="flex justify-between pt-2">
            <Button label="Open Letters tool" variant="ghost" size="sm" onClick={onOpenTool} />
            <Button label="Cancel" variant="secondary" size="sm" onClick={close} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Input label="To" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Email address" inputMode="email" />
          <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <Textarea
            label="Letter"
            rows={14}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            hint="Changes here apply to this letter only, not the template."
          />
          {leftover.length ? (
            <p className="text-xs" style={{ color: colors.warning }}>
              Still to fill in: {leftover.map((t) => `{{${t}}}`).join(', ')}
            </p>
          ) : null}
          <div className="flex justify-between gap-2">
            <Button label="Back" variant="secondary" onClick={() => setTemplate(null)} />
            <Button label="Send letter" onClick={submit} loading={send.isPending} />
          </div>
        </div>
      )}
    </Modal>
  );
}
