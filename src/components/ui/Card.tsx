'use client';

import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { useThemeColors } from '@/theme/ThemeProvider';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  accent?: boolean;
  glass?: boolean;
  /** Adds hover lift + pointer cursor for cards that act as links. */
  interactive?: boolean;
  padded?: boolean;
}

export function Card({
  children,
  className,
  accent,
  glass,
  interactive,
  padded = true,
  style,
  ...props
}: CardProps) {
  const colors = useThemeColors();
  return (
    <div
      className={cn(
        'rounded-2xl border transition-[border-color,transform,box-shadow] duration-150',
        padded && 'p-4',
        interactive && 'cursor-pointer hover:-translate-y-0.5',
        className,
      )}
      style={{
        backgroundColor: glass ? colors.cardGlass : colors.card,
        borderColor: colors.border,
        borderLeftWidth: accent ? 3 : 1,
        borderLeftColor: accent ? colors.primary : colors.border,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

/** Small label above a group of content — the app's uppercase section captions. */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  const colors = useThemeColors();
  return (
    <p
      className={cn('text-xs font-bold uppercase tracking-wider', className)}
      style={{ color: colors.inkMuted }}
    >
      {children}
    </p>
  );
}
