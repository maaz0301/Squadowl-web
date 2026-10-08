'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useTheme } from '@/theme/ThemeProvider';
import { EmptyState, ErrorState, Spinner } from '@/components/ui';
import { useAlert } from '@/components/ui/Alert';
import {
  useDeleteTeamMessageMutation,
  useSendTeamMessageMutation,
  useTeamChatRealtimeSync,
  useTeamMessagesQuery,
} from '@/features/queries';
import { useChatSafety } from '@/components/ChatSafety';
import { useAuthStore } from '@/state/authStore';
import { useChatReadStore } from '@/state/chatReadStore';
import type { TeamMessage } from '@/data/types';
import type { ThemeColors } from '@/theme/tokens';

/** Messages closer together than this stay in one visual run. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Per-author name colors, WhatsApp-style, so a busy team roster stays readable. */
const NAME_COLORS = [
  '#e5786d', '#4ea1d3', '#7fb069', '#c58ad0', '#e0a458',
  '#5bc0be', '#d96c8f', '#8d99ea', '#63b7af', '#dba159',
];

function nameColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return NAME_COLORS[hash % NAME_COLORS.length];
}

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (sameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], {
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

/** The little pointer on the first bubble of a run. */
function Tail({ mine, color }: { mine: boolean; color: string }) {
  return (
    <svg
      width={9}
      height={13}
      viewBox="0 0 9 13"
      style={{ position: 'absolute', top: 0, [mine ? 'right' : 'left']: -8 }}
    >
      <path d={mine ? 'M0 0 H9 L0 13 Z' : 'M9 0 H0 L9 13 Z'} fill={color} />
    </svg>
  );
}

function DayPill({ label, colors, isDark }: { label: string; colors: ThemeColors; isDark: boolean }) {
  return (
    <div className="my-3 flex items-center justify-center">
      <div
        className="rounded-lg px-3 py-1"
        style={{ backgroundColor: isDark ? 'rgba(12,21,40,0.85)' : 'rgba(255,255,255,0.92)' }}
      >
        <span className="text-xs font-semibold" style={{ color: colors.inkMuted }}>{label}</span>
      </div>
    </div>
  );
}

function Bubble({
  message,
  mine,
  startsRun,
  colors,
  isDark,
  onDelete,
  onMore,
  deleting,
}: {
  message: TeamMessage;
  mine: boolean;
  startsRun: boolean;
  colors: ThemeColors;
  isDark: boolean;
  onDelete: () => void;
  /** Opens report and block for someone else's message. */
  onMore?: () => void;
  deleting: boolean;
}) {
  // Outgoing keeps the brand tint (WhatsApp's own green would fight the palette);
  // incoming is the neutral surface, same contrast relationship as the original.
  const bubbleColor = mine ? (isDark ? '#5c2c16' : '#ffe2d1') : isDark ? '#1b2740' : '#ffffff';
  const textColor = mine ? (isDark ? '#ffece0' : '#3d1a06') : colors.ink;
  const metaColor = mine ? (isDark ? 'rgba(255,236,224,0.6)' : 'rgba(61,26,6,0.65)') : colors.inkMuted;
  const timeText = clockTime(message.createdAt);

  return (
    <div className={`flex px-2 ${mine ? 'justify-end' : 'justify-start'}`} style={{ marginTop: startsRun ? 8 : 2 }}>
      {mine ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          title="Delete message"
          className="relative max-w-[82%] text-left"
          style={{ cursor: 'pointer', opacity: deleting ? 0.5 : 1 }}
        >
        <div
          style={{
            backgroundColor: bubbleColor,
            borderRadius: 8,
            borderTopRightRadius: mine && startsRun ? 0 : 8,
            borderTopLeftRadius: !mine && startsRun ? 0 : 8,
            paddingLeft: 9,
            paddingRight: 9,
            paddingTop: 6,
            paddingBottom: 5,
            boxShadow: isDark ? '0 1px 1px rgba(0,0,0,0.25)' : '0 1px 1px rgba(0,0,0,0.08)',
            position: 'relative',
          }}
        >
          {startsRun ? <Tail mine={mine} color={bubbleColor} /> : null}

          {!mine && startsRun ? (
            <p className="mb-0.5 text-[13px] font-bold" style={{ color: nameColor(message.authorUserId) }}>
              {message.authorName}
              {message.authorRole === 'coach' ? (
                <span className="text-[11px] font-semibold" style={{ color: colors.inkMuted }}>
                  {'  '}Coach
                </span>
              ) : null}
            </p>
          ) : null}

          <p
            className="whitespace-pre-wrap text-[15px] leading-5"
            style={{ color: textColor, paddingRight: timeText.length * 6.4 + 16 }}
          >
            {message.body}
          </p>
          <span className="absolute text-[11px]" style={{ color: metaColor, right: 9, bottom: 5 }}>
            {timeText}
          </span>
        </div>
        </button>
      ) : (
        <div className="relative max-w-[82%] text-left">
        <div
          style={{
            backgroundColor: bubbleColor,
            borderRadius: 8,
            borderTopRightRadius: mine && startsRun ? 0 : 8,
            borderTopLeftRadius: !mine && startsRun ? 0 : 8,
            paddingLeft: 9,
            paddingRight: 9,
            paddingTop: 6,
            paddingBottom: 5,
            boxShadow: isDark ? '0 1px 1px rgba(0,0,0,0.25)' : '0 1px 1px rgba(0,0,0,0.08)',
            position: 'relative',
          }}
        >
          {startsRun ? <Tail mine={mine} color={bubbleColor} /> : null}

          {!mine && startsRun ? (
            <p className="mb-0.5 text-[13px] font-bold" style={{ color: nameColor(message.authorUserId) }}>
              {message.authorName}
              {message.authorRole === 'coach' ? (
                <span className="text-[11px] font-semibold" style={{ color: colors.inkMuted }}>
                  {'  '}Coach
                </span>
              ) : null}
            </p>
          ) : null}

          <p
            className="whitespace-pre-wrap text-[15px] leading-5"
            style={{ color: textColor, paddingRight: timeText.length * 6.4 + 16 }}
          >
            {message.body}
          </p>
          <span className="absolute text-[11px]" style={{ color: metaColor, right: 9, bottom: 5 }}>
            {timeText}
          </span>
        </div>
          {onMore ? (
            <button
              type="button"
              onClick={onMore}
              aria-label={`Report or block ${message.authorName}`}
              title="Report or block"
              className="absolute flex h-6 w-6 items-center justify-center rounded-full text-base font-bold leading-none"
              style={{ top: 2, right: -28, color: colors.inkMuted }}
            >
              ⋯
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Team chat for a season. Everyone `can_access_season()` admits — the team's
 * coaching staff and the guardians of the athletes on its roster — reads and
 * posts here, so a coach's team/season pages and a guardian's portal render
 * the same conversation from the same component.
 */
export function TeamChat({
  seasonId,
  ensureSeason,
  noSeasonMessage = 'This athlete has not been added to a team yet. Once a coach adds them to a roster, the team chat opens up here.',
  heightClassName = 'h-[70dvh] min-h-[420px]',
}: {
  seasonId?: string;
  /**
   * Creates the season this conversation lives in, resolving with its id.
   * Passing it is what lets the chat open on a team that has no season yet:
   * the composer works from the start and the first message brings the season
   * into being. Only the team route can offer this — a guardian has no team of
   * their own to create one on, so their side still waits on a coach.
   */
  ensureSeason?: () => Promise<string>;
  /** Shown when there's no season to chat in and none can be made here. */
  noSeasonMessage?: string;
  /** Sizing classes for the outer panel — a fixed viewport-fraction height by
   *  default (chat sharing a tab with other content), or e.g. `flex-1` when
   *  a caller gives chat the whole page and wants it to fill what's left. */
  heightClassName?: string;
}) {
  const { colors, isDark } = useTheme();
  const { alert: alertDialog, confirm: confirmDialog } = useAlert();
  const currentUserId = useAuthStore((s) => s.session?.user?.id);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  // A season created by sending the first message is usable immediately, while
  // the seasons list this component's `seasonId` comes from is still refetching
  // — so hold the new id here rather than making the sender wait for the prop
  // to catch up with a message they have already sent.
  const [createdSeasonId, setCreatedSeasonId] = useState<string>();
  const [creatingSeason, setCreatingSeason] = useState(false);
  const activeSeasonId = seasonId ?? createdSeasonId;

  const messagesQuery = useTeamMessagesQuery(activeSeasonId);
  const sendMessage = useSendTeamMessageMutation();
  const deleteMessage = useDeleteTeamMessageMutation(activeSeasonId ?? '');
  useTeamChatRealtimeSync(activeSeasonId);
  const safety = useChatSafety();

  const rows = useMemo(() => {
    const chronological = messagesQuery.data ?? [];
    return chronological.map((message, i) => {
      const previous = chronological[i - 1];
      const showDay = !previous || !sameDay(new Date(previous.createdAt), new Date(message.createdAt));
      const startsRun =
        showDay ||
        previous.authorUserId !== message.authorUserId ||
        message.createdAt - previous.createdAt > GROUP_WINDOW_MS;
      return { message, showDay, startsRun };
    });
  }, [messagesQuery.data]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [rows.length]);

  // Having the conversation open is what counts as reading it — including
  // messages that arrive while it stays open, which is why this tracks the data
  // rather than firing once on mount.
  const markChatRead = useChatReadStore((s) => s.markChatRead);
  useEffect(() => {
    const newest = messagesQuery.data?.[messagesQuery.data.length - 1];
    if (activeSeasonId && newest) markChatRead(activeSeasonId, newest.createdAt);
  }, [activeSeasonId, messagesQuery.data, markChatRead]);

  const send = async () => {
    const body = draft.trim();
    if (!body || (!activeSeasonId && !ensureSeason)) return;
    setDraft('');
    try {
      let sid = activeSeasonId;
      if (!sid) {
        setCreatingSeason(true);
        sid = await ensureSeason!();
        setCreatedSeasonId(sid);
      }
      await sendMessage.mutateAsync({ seasonId: sid, body });
    } catch (e) {
      setDraft(body);
      alert(`Message Not Sent\n\n${(e as Error)?.message || 'Please try again.'}`);
    } finally {
      setCreatingSeason(false);
    }
  };

  const confirmDelete = async (message: TeamMessage) => {
    const ok = await confirmDialog({
      title: 'Delete Message',
      message: 'Remove this message for everyone on the team?',
      confirmLabel: 'Delete',
      destructive: true,
      requireText: 'DELETE',
    });
    if (!ok) return;
    try {
      await deleteMessage.mutateAsync(message.id);
    } catch (e) {
      await alertDialog('Error', (e as Error)?.message || 'Could not delete this message.');
    }
  };

  // Only when nothing here can produce a season — the guardian side, where the
  // athlete isn't on a roster yet. A team route hands over `ensureSeason` and
  // opens the conversation empty instead.
  if (!activeSeasonId && !ensureSeason) {
    return <EmptyState title="No team chat yet" message={noSeasonMessage} />;
  }

  if (messagesQuery.isError) {
    return <ErrorState message="Could not load the team chat." onRetry={() => messagesQuery.refetch()} />;
  }

  // Stands in for WhatsApp's wallpaper: a surface distinct from the page so
  // the bubbles read as a conversation rather than as page content.
  const wallpaper = isDark ? '#0b1220' : '#e7ecf5';

  // The very first message on a season-less team also creates the season and
  // syncs its roster, which is slower than a send and just as much a reason to
  // hold the button.
  const busy = sendMessage.isPending || creatingSeason;

  return (
    <div className={`flex ${heightClassName} flex-col overflow-hidden rounded-xl border`} style={{ borderColor: colors.border }}>
      {safety.blockedCount > 0 ? (
        <button
          type="button"
          onClick={safety.openBlocked}
          className="px-3 py-2 text-left text-xs font-bold"
          style={{ backgroundColor: colors.tile, color: colors.primary, borderBottom: `1px solid ${colors.border}` }}
        >
          Blocked people ({safety.blockedCount})
        </button>
      ) : null}
      <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ backgroundColor: wallpaper }}>
        {messagesQuery.isLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <Spinner size={20} color={colors.primary} />
            <span className="text-sm" style={{ color: colors.inkMuted }}>Loading messages...</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState title="No messages yet" message="Say hello — everyone on the roster and their guardians will see it." />
          </div>
        ) : (
          <div className="py-2">
            {rows.map(({ message, showDay, startsRun }) => (
              <div key={message.id}>
                {showDay ? <DayPill label={dayLabel(message.createdAt)} colors={colors} isDark={isDark} /> : null}
                <Bubble
                  message={message}
                  mine={message.authorUserId === currentUserId}
                  startsRun={startsRun}
                  colors={colors}
                  isDark={isDark}
                  onDelete={() => confirmDelete(message)}
                  onMore={() => safety.openActions(message)}
                  deleting={deleteMessage.isPending && deleteMessage.variables === message.id}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 px-2 py-2">
        <textarea
          className="max-h-28 flex-1 rounded-[30px] px-4 py-[11px] text-[15px]"
          placeholder="Message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          style={{
            backgroundColor: isDark ? '#1b2740' : '#ffffff',
            color: colors.ink,
            minHeight: 44,
            resize: 'none',
          }}
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim() || busy}
          className="flex items-center justify-center rounded-full"
          style={{
            backgroundColor: colors.primary,
            opacity: !draft.trim() || busy ? 0.5 : 1,
            width: 44,
            height: 44,
            cursor: !draft.trim() || busy ? 'default' : 'pointer',
          }}
          aria-label="Send message"
        >
          {busy ? (
            <Spinner size={18} color="#fff" />
          ) : (
            <svg width={20} height={20} viewBox="0 0 24 24">
              <path d="M3 20.5v-6l8-2.5-8-2.5v-6l19 8.5-19 8.5z" fill="#fff" />
            </svg>
          )}
        </button>
      </div>
      {safety.modals}
    </div>
  );
}
