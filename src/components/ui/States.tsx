'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Spinner } from './Button';

interface EmptyStateProps {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** A second, lower-emphasis action alongside the primary one — e.g. "Import from File" beside "+ Add Player". */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  icon?: ReactNode;
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  icon,
}: EmptyStateProps) {
  const colors = useThemeColors();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon}
      <h3 className="text-xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
        {title}
      </h3>
      {message ? (
        <p className="max-w-md text-[15px]" style={{ color: colors.inkMuted }}>
          {message}
        </p>
      ) : null}
      {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {actionLabel && onAction ? <Button label={actionLabel} onClick={onAction} /> : null}
          {secondaryActionLabel && onSecondaryAction ? (
            <Button label={secondaryActionLabel} variant="secondary" onClick={onSecondaryAction} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function LoadingState({ message = 'Loading...' }: { message?: string }) {
  const colors = useThemeColors();
  return (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-3">
      <Spinner size={32} />
      <p className="text-[15px]" style={{ color: colors.inkMuted }}>
        {message}
      </p>
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  const colors = useThemeColors();
  return (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h3 className="text-xl font-bold" style={{ color: colors.danger, fontFamily: 'var(--font-space-grotesk)' }}>
        {title}
      </h3>
      <p className="max-w-md text-[15px]" style={{ color: colors.inkMuted }}>
        {message}
      </p>
      {onRetry ? <Button label="Try Again" variant="secondary" onClick={onRetry} /> : null}
    </div>
  );
}

/**
 * A single placeholder block.
 *
 * Sized by the caller so a skeleton can trace the shape of the thing it stands
 * in for — the point is that the layout doesn't jump when real content lands.
 * The travelling highlight is built from the theme's own tile/border colours so
 * it stays legible in both themes without a second palette.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = 8,
  className,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const colors = useThemeColors();
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        backgroundColor: colors.tile,
        backgroundImage: `linear-gradient(90deg, transparent 0%, ${colors.border} 50%, transparent 100%)`,
        backgroundSize: '200% 100%',
        animation: 'aas-shimmer 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  );
}

/**
 * The card-grid screens' loading state — dashboard, teams, archived.
 *
 * Preferred over LoadingState for a list that is *about* to appear: a centred
 * spinner throws the page away and replaces it with an empty half-screen, so
 * every arrival is a full re-layout and the wait reads as longer than it is.
 * This keeps the page's real shape on screen and swaps placeholder text for
 * real text in place.
 */
export function CardGridSkeleton({
  count = 6,
  lines = 2,
  columns = 'sm:grid-cols-2 lg:grid-cols-3',
}: {
  count?: number;
  /** Body lines under the title, matching the density of the real card. */
  lines?: number;
  /** Tailwind column classes, so each screen can mirror its own grid. */
  columns?: string;
}) {
  const colors = useThemeColors();
  return (
    <div className={`grid grid-cols-1 gap-3 ${columns}`} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2.5 rounded-2xl border p-4"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Skeleton width="62%" height={18} />
          {Array.from({ length: lines }, (_, j) => (
            <Skeleton key={j} width={j === lines - 1 ? '40%' : '78%'} height={12} />
          ))}
        </div>
      ))}
    </div>
  );
}
