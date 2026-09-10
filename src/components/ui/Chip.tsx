'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { useThemeColors } from '@/theme/ThemeProvider';

interface ChipProps {
  label: string;
  active?: boolean;
  highlight?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { label, active, highlight, disabled, onClick, className },
  ref,
) {
  const colors = useThemeColors();

  let bgColor = colors.tile;
  let borderColor = colors.border;
  let textColor = colors.inkMuted;

  if (active) {
    bgColor = 'rgba(255,107,43,0.12)';
    borderColor = colors.primary;
    textColor = colors.primary;
  } else if (highlight) {
    bgColor = 'rgba(56,189,248,0.12)';
    borderColor = colors.info;
    textColor = colors.info;
  }

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        // 40px tall: these are the session pickers coaches tap one-handed at
        // the rink, so they need a real target rather than a label-sized one.
        'inline-flex min-h-[40px] shrink-0 items-center rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-[filter,transform] duration-150',
        !disabled && onClick && 'hover:brightness-125 active:scale-[0.97]',
        disabled && 'opacity-30 pointer-events-none',
        className,
      )}
      style={{ backgroundColor: bgColor, borderColor, color: textColor }}
    >
      {label}
    </button>
  );
});
