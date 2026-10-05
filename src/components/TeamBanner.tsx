'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui';
import { TeamPlanBadge } from '@/components/TeamPlanBadge';
import { useThemeColors } from '@/theme/ThemeProvider';
import type { Team } from '@/data/types';

/**
 * The team's identity strip, meant to sit at the top of every team-scoped
 * screen so a coach who has drilled into a schedule or a player card can
 * still see whose team they're in.
 */
interface TeamBannerProps {
  team: Pick<Team, 'id' | 'name' | 'season' | 'logoUrl' | 'brandColor' | 'managed' | 'ownerPlanTier'>;
  /** Right-hand actions (chat, edit). */
  right?: ReactNode;
  /** Line under the team name; defaults to the season label. */
  subtitle?: string;
  /** Clicking the banner returns to the team hub. Off on the hub itself. */
  linkToHub?: boolean;
  className?: string;
}

export function TeamBanner({ team, right, subtitle, linkToHub = true, className }: TeamBannerProps) {
  const colors = useThemeColors();
  const line = subtitle ?? team.season;
  const [logoBroken, setLogoBroken] = useState(false);

  const body = (
    <div
      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${className ?? ''}`}
      style={{ backgroundColor: colors.tile, borderColor: colors.border }}
    >
      {team.logoUrl && !logoBroken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={team.logoUrl}
          alt=""
          width={44}
          height={44}
          className="shrink-0 rounded-full object-cover"
          style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
          onError={() => setLogoBroken(true)}
        />
      ) : (
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: colors.bgSecondary }}
        >
          <span className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            {team.name.trim().slice(0, 1).toUpperCase() || 'T'}
          </span>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p
          className="truncate text-lg font-bold"
          style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
        >
          {team.name}
        </p>
        {line ? (
          <p className="truncate text-xs" style={{ color: colors.inkMuted }}>
            {line}
          </p>
        ) : null}
      </div>

      {/* A delegated coach sees whose team this is, so a club-owned team is never
          mistaken for one of their own. */}
      {team.managed ? <Badge label="Managed" variant="info" /> : null}
      <TeamPlanBadge team={team} />
      {right}
    </div>
  );

  if (!linkToHub) return body;

  return (
    <Link href={`/team/${team.id}`} className="block">
      {body}
    </Link>
  );
}
