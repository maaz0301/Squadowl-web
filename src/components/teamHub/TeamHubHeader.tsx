'use client';

/* eslint-disable @next/next/no-img-element -- a team logo is an arbitrary user-uploaded URL */
import type { ReactNode } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

import { Icon } from '@/components/Icons';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useHubSurfaces } from './hubTheme';

interface TeamHubHeaderProps {
  name: string;
  subtitle?: string;
  logoUrl?: string | null;
  backHref: string;
  onChat: () => void;
  /** Unread pill, drawn on the chat button's corner. */
  chatBadge?: ReactNode;
  /** Omitted for people who can't edit the team. */
  onEdit?: () => void;
  /** e.g. the "Managed" badge for a club-delegated team. */
  extra?: ReactNode;
}

/**
 * The hub's top row: back, crest, "<Team> Hub" with its season, then the two
 * pill actions. One compact line instead of a title bar plus a banner card.
 */
export function TeamHubHeader({ name, subtitle, logoUrl, backHref, onChat, chatBadge, onEdit, extra }: TeamHubHeaderProps) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const router = useRouter();

  return (
    <div className="mb-4 flex items-center gap-2 sm:gap-3">
      <button
        type="button"
        onClick={() => router.push(backHref)}
        aria-label="Go back"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors hover:brightness-125"
        style={{ backgroundColor: s.panelBg, borderColor: s.panelBorder }}
      >
        <Icon name="chevronLeft" size={16} color={colors.ink} />
      </button>

      {logoUrl ? (
        <img src={logoUrl} alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-full object-cover" />
      ) : (
        <Image src="/images/tryouthq_t_logo_v2.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <h1
          className="truncate text-lg font-bold sm:text-2xl"
          style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
        >
          {name} Hub
        </h1>
        {subtitle ? (
          <p className="truncate text-xs sm:text-sm" style={{ color: colors.inkMuted }}>
            {subtitle}
          </p>
        ) : null}
      </div>

      {extra}

      <button
        type="button"
        onClick={onChat}
        className="relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors hover:brightness-125 sm:text-sm"
        style={{ backgroundColor: s.panelBg, borderColor: s.panelBorder, color: colors.ink }}
      >
        <Icon name="chat" size={14} color={colors.ink} />
        <span className="hidden min-[400px]:inline">Team Chat</span>
        <span className="min-[400px]:hidden">Chat</span>
        {chatBadge ? <span className="absolute -top-1.5 -right-1 pointer-events-none">{chatBadge}</span> : null}
      </button>

      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-9 shrink-0 items-center rounded-full border px-4 text-xs font-bold transition-colors hover:brightness-125 sm:text-sm"
          style={{ backgroundColor: s.orangeBg, borderColor: colors.primary, color: colors.primary }}
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}
