'use client';

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

export function Chip({ label, active, highlight, disabled, onClick, className }: ChipProps) {
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
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-[36px] items-center rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors',
        !disabled && onClick && 'hover:brightness-125',
        disabled && 'opacity-30 pointer-events-none',
        className,
      )}
      style={{ backgroundColor: bgColor, borderColor, color: textColor }}
    >
      {label}
    </button>
  );
}
