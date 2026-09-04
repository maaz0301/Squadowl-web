'use client';

import { cn } from '@/lib/cn';
import { useChatUnreadCount } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * The count of unseen team-chat messages, for the places a Chat link lives that
 * don't take a badge of their own (the season tab strip, a guardian's list of
 * teams). Renders nothing when there is nothing new, so it can sit in the
 * markup unconditionally.
 */
export function ChatUnreadBadge({ seasonId, className }: { seasonId?: string; className?: string }) {
  const colors = useThemeColors();
  const unread = useChatUnreadCount(seasonId);
  if (unread <= 0) return null;
  return (
    <span
      aria-label={`${unread} unread ${unread === 1 ? 'message' : 'messages'}`}
      className={cn(
        'inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none text-white',
        className,
      )}
      style={{ backgroundColor: colors.primary }}
    >
      {unread > 99 ? '99+' : unread}
    </span>
  );
}
