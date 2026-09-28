'use client';

import type { ButtonHTMLAttributes, Ref } from 'react';

import { Icon, type IconName } from '@/components/Icons';
import { Spinner } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useHubSurfaces } from './hubTheme';

/**
 * One of the four equal buttons under Team Status: an icon chip beside a
 * label, on one line. Shaped to match TeamStatusTiles right above it (same
 * 52px height, same rounded-xl pill, same solid-color icon circle) — it used
 * to stack the icon over the label instead, which read as a different kind
 * of control sitting right under a row that already establishes this shape.
 */
export function HubActionTile({
  icon,
  label,
  danger,
  loading,
  buttonRef,
  ...props
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  loading?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'>) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const tint = danger ? colors.danger : s.blueInk;

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={loading || props.disabled}
      className="flex h-[52px] min-w-0 flex-1 items-center gap-2 rounded-xl border px-2.5 text-left transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-60"
      style={{
        backgroundColor: danger ? 'rgba(248,113,113,0.10)' : s.blueBg,
        borderColor: danger ? 'rgba(248,113,113,0.5)' : s.blueBorder,
      }}
      {...props}
    >
      <span
        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: tint }}
      >
        {loading ? <Spinner size={12} color="#ffffff" /> : <Icon name={icon} size={12} color="#ffffff" strokeWidth={3} />}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-xs font-bold sm:text-sm"
        style={{ color: danger ? colors.danger : colors.ink }}
      >
        {label}
      </span>
    </button>
  );
}
