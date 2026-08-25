'use client';

import type { ReactNode } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Spinner } from './Button';

interface EmptyStateProps {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
}

export function EmptyState({ title, message, actionLabel, onAction, icon }: EmptyStateProps) {
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
      {actionLabel && onAction ? <Button label={actionLabel} onClick={onAction} className="mt-1" /> : null}
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
