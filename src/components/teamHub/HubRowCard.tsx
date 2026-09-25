'use client';

import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

import { Icon, type IconName } from '@/components/Icons';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useHubSurfaces } from './hubTheme';

/**
 * Full-width tappable row: icon chip, title + caption, chevron. `tone` picks
 * the blue panel (calendar sync) or the orange-outlined one (RSVPs).
 */
export function HubRowCard({
  icon,
  title,
  caption,
  tone = 'blue',
  trailing,
  buttonRef,
  ...props
}: {
  icon: IconName;
  title: string;
  caption: string;
  tone?: 'blue' | 'orange';
  /** Replaces the chevron, e.g. an expand caret. */
  trailing?: ReactNode;
  buttonRef?: Ref<HTMLButtonElement>;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'title'>) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const orange = tone === 'orange';
  const accent = orange ? colors.primary : s.blueInk;

  return (
    <button
      ref={buttonRef}
      type="button"
      className="flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3 text-left transition-[filter] hover:brightness-110"
      style={{
        backgroundColor: orange ? s.orangeBg : s.blueBg,
        borderColor: orange ? s.orangeBorder : s.blueBorder,
      }}
      {...props}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: orange ? 'rgba(255,107,43,0.16)' : 'rgba(59,130,246,0.16)' }}
      >
        <Icon name={icon} size={18} color={accent} />
      </span>
      <span className="min-w-0 flex-1 py-2">
        <span className="block text-sm font-bold" style={{ color: colors.ink }}>
          {title}
        </span>
        <span className="mt-0.5 block text-xs" style={{ color: colors.inkMuted }}>
          {caption}
        </span>
      </span>
      {trailing ?? <Icon name="chevronRight" size={16} color={colors.inkMuted} strokeWidth={2.5} />}
    </button>
  );
}
