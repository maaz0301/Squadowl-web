'use client';

import type { ButtonHTMLAttributes, Ref } from 'react';

import { Icon, type IconName } from '@/components/Icons';
import { Spinner } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useHubSurfaces } from './hubTheme';

/** One of the four equal buttons under Team Status: icon over a short label. */
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
      className="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-[11px] font-bold transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-60 sm:text-xs"
      style={{
        backgroundColor: danger ? 'rgba(248,113,113,0.10)' : s.blueBg,
        borderColor: danger ? 'rgba(248,113,113,0.5)' : s.blueBorder,
        color: danger ? colors.danger : colors.ink,
      }}
      {...props}
    >
      {loading ? <Spinner size={15} color={tint} /> : <Icon name={icon} size={16} color={tint} />}
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}
