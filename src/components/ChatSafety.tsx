'use client';

import { useState, type ReactNode } from 'react';

import { Button, Modal, Textarea } from '@/components/ui';
import { useAlert } from '@/components/ui/Alert';
import {
  useBlockChatUserMutation,
  useBlockedChatUsersQuery,
  useReportTeamMessageMutation,
  useUnblockChatUserMutation,
} from '@/features/queries';
import type { ChatReportReason, TeamMessage } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';

const REASONS: { value: ChatReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'inappropriate', label: 'Inappropriate or unsafe content' },
  { value: 'other', label: 'Something else' },
];

/**
 * Report and block for team chat, kept out of TeamChat so the conversation's own
 * code stays about the conversation. `openActions(message)` is what a message's
 * menu button calls; `modals` has to be rendered once by the chat.
 *
 * Blocking only hides that person from the blocker, and is undone from "Blocked
 * people". Reporting sends the message to the platform operators for review; it
 * does not delete the message or tell the team.
 */
export function useChatSafety() {
  const colors = useThemeColors();
  const { alert: alertDialog, confirm: confirmDialog } = useAlert();
  const blockedQuery = useBlockedChatUsersQuery();
  const blockUser = useBlockChatUserMutation();
  const unblockUser = useUnblockChatUserMutation();
  const reportMessage = useReportTeamMessageMutation();

  const [actionsFor, setActionsFor] = useState<TeamMessage | null>(null);
  const [reportFor, setReportFor] = useState<TeamMessage | null>(null);
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [blockedOpen, setBlockedOpen] = useState(false);

  const blocked = blockedQuery.data ?? [];

  const startReport = (message: TeamMessage) => {
    setActionsFor(null);
    setReason(null);
    setDetails('');
    setReportFor(message);
  };

  const submitReport = async () => {
    if (!reportFor || !reason) return;
    try {
      await reportMessage.mutateAsync({ messageId: reportFor.id, reason, details });
      setReportFor(null);
      await alertDialog(
        'Report Sent',
        'Thank you. We will review this message. You can also block this person so you no longer see their messages.',
      );
    } catch (e) {
      await alertDialog('Could Not Send Report', (e as Error)?.message || 'Please try again.');
    }
  };

  const startBlock = async (message: TeamMessage) => {
    setActionsFor(null);
    const ok = await confirmDialog({
      title: `Block ${message.authorName}?`,
      message:
        'You will no longer see their messages or get notifications from them in team chat. They are not told, and nobody else is affected. You can unblock them any time from Blocked people.',
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return;
    try {
      await blockUser.mutateAsync(message.authorUserId);
    } catch (e) {
      await alertDialog('Could Not Block', (e as Error)?.message || 'Please try again.');
    }
  };

  const modals: ReactNode = (
    <>
      <Modal visible={!!actionsFor} title="Message" onClose={() => setActionsFor(null)} size="sm" hideDefaultFooter>
        {actionsFor ? (
          <div className="flex flex-col gap-2">
            <p className="line-clamp-3 text-sm" style={{ color: colors.inkMuted }}>
              {actionsFor.authorName}: {actionsFor.body}
            </p>
            <Button label="Report message" variant="secondary" fullWidth onClick={() => startReport(actionsFor)} />
            <Button
              label={`Block ${actionsFor.authorName}`}
              variant="danger"
              fullWidth
              onClick={() => startBlock(actionsFor)}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        visible={!!reportFor}
        title="Report Message"
        onClose={() => setReportFor(null)}
        size="sm"
        hideDefaultFooter
      >
        {reportFor ? (
          <div className="flex flex-col gap-3">
            <p className="line-clamp-3 rounded-lg p-3 text-sm" style={{ backgroundColor: colors.tile, color: colors.inkMuted }}>
              {reportFor.authorName}: {reportFor.body}
            </p>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-bold" style={{ color: colors.ink }}>
                What is wrong with it?
              </legend>
              {REASONS.map((r) => (
                <label
                  key={r.value}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm"
                  style={{
                    borderColor: reason === r.value ? colors.primary : colors.border,
                    backgroundColor: reason === r.value ? 'rgba(255,107,43,0.10)' : colors.tile,
                    color: colors.ink,
                  }}
                >
                  <input
                    type="radio"
                    name="chat-report-reason"
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                  />
                  {r.label}
                </label>
              ))}
            </fieldset>
            <Textarea
              label="Details (optional)"
              rows={3}
              maxLength={1000}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
            <Button
              label="Send report"
              fullWidth
              disabled={!reason}
              loading={reportMessage.isPending}
              onClick={submitReport}
            />
          </div>
        ) : null}
      </Modal>

      <Modal visible={blockedOpen} title="Blocked people" onClose={() => setBlockedOpen(false)} size="sm">
        {blocked.length === 0 ? (
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            You have not blocked anyone.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {blocked.map((b) => (
              <div
                key={b.userId}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                style={{ borderColor: colors.border, backgroundColor: colors.tile }}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color: colors.ink }}>
                  {b.name}
                </span>
                <Button
                  label="Unblock"
                  size="sm"
                  variant="secondary"
                  loading={unblockUser.isPending && unblockUser.variables === b.userId}
                  onClick={() => unblockUser.mutate(b.userId)}
                />
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );

  return {
    openActions: (message: TeamMessage) => setActionsFor(message),
    blockedCount: blocked.length,
    openBlocked: () => setBlockedOpen(true),
    modals,
  };
}
