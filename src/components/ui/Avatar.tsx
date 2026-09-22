'use client';

import { useState } from 'react';

import { useThemeColors } from '@/theme/ThemeProvider';
import { playerInitials } from '@/data/rubrics';
import { normalizePosition } from '@/data/positions';

interface AvatarProps {
  first: string;
  last: string;
  size?: number;
  pos?: string;
  uri?: string;
  /** Overrides the ring color (e.g. a team's brand color) ahead of `pos`/default. */
  ringColor?: string;
}

const posColors: Record<string, string> = {
  FWD: '#ff6b2b',
  DEF: '#6366f1',
  GTL: '#f59e0b',
  G: '#f59e0b',
  GK: '#f59e0b',
  LW: '#ff6b2b',
  RW: '#ff6b2b',
  C: '#ff6b2b',
  LD: '#6366f1',
  RD: '#6366f1',
  CB: '#6366f1',
  FB: '#6366f1',
  ST: '#ff6b2b',
  W: '#ff6b2b',
  CM: '#10b981',
  CDM: '#10b981',
  CAM: '#10b981',
};

/**
 * The colour a position is drawn in — the avatar ring here, and anywhere else
 * a position needs to render as a colour. Shared so those can never drift
 * apart, since it is the pairing that makes a position readable at a glance.
 */
export function positionColor(pos: string | undefined, fallback: string): string {
  if (!pos) return fallback;
  const normalized = normalizePosition(pos);
  return posColors[normalized] ?? posColors[pos.toUpperCase()] ?? fallback;
}

export function Avatar({ first, last, size = 44, pos, uri, ringColor }: AvatarProps) {
  const colors = useThemeColors();
  const accent = ringColor || positionColor(pos, colors.primary);
  // A broken/expired storage URL shouldn't leave a permanent broken-image icon —
  // fall back to the initials the same way a missing uri already does.
  const [broken, setBroken] = useState(false);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2"
      style={{
        width: size,
        height: size,
        backgroundColor: colors.tile,
        borderColor: accent,
      }}
    >
      {uri && !broken ? (
        // Player photos come from Supabase storage on an arbitrary project host,
        // so a plain img avoids next/image remote-host config for every deploy.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={uri}
          alt=""
          width={size - 4}
          height={size - 4}
          style={{ width: size - 4, height: size - 4, borderRadius: '50%', objectFit: 'cover' }}
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          className="font-bold"
          style={{ color: colors.ink, fontSize: size * 0.35, fontFamily: 'var(--font-space-grotesk)' }}
        >
          {playerInitials({ first, last })}
        </span>
      )}
    </span>
  );
}
