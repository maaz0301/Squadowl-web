'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useThemeColors } from '@/theme/ThemeProvider';

type BadgeVariant = 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
type BadgeSize = 'sm' | 'lg';

interface BadgeProps {
  label: ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
  title?: string;
}

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-xs',
  lg: 'px-3.5 py-1.5 text-base',
};

export function Badge({ label, variant = 'default', size = 'sm', className, title }: BadgeProps) {
  const colors = useThemeColors();
  const styles: Record<BadgeVariant, { bg: string; text: string; border: string }> = {
    default: { bg: colors.tile, text: colors.inkMuted, border: colors.border },
    brand: { bg: 'rgba(255,107,43,0.12)', text: colors.primary, border: 'rgba(255,107,43,0.25)' },
    success: { bg: 'rgba(34,197,94,0.12)', text: colors.success, border: 'rgba(34,197,94,0.25)' },
    warning: { bg: 'rgba(251,146,60,0.12)', text: colors.warning, border: 'rgba(251,146,60,0.25)' },
    danger: { bg: 'rgba(248,113,113,0.12)', text: colors.danger, border: 'rgba(248,113,113,0.25)' },
    info: { bg: 'rgba(56,189,248,0.12)', text: colors.info, border: 'rgba(56,189,248,0.25)' },
  };
  const s = styles[variant];
  return (
    <span
      title={title}
      className={cn('inline-flex items-center rounded-full border font-bold whitespace-nowrap', SIZE_CLASSES[size], className)}
      style={{ backgroundColor: s.bg, borderColor: s.border, color: s.text }}
    >
      {label}
    </span>
  );
}
