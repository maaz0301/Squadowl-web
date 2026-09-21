'use client';

import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import { useMounted } from '@/lib/hooks';
import { lockBodyScroll } from '@/lib/scrollLock';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Spinner } from '@/components/ui';

/**
 * Blocking overlay for a bulk delete, so a big one visibly works instead of
 * looking frozen. Deliberately not dismissable: closing it would not stop the
 * delete, only hide it.
 */
export function DeleteProgressModal({
  visible,
  progress,
  noun = 'players',
}: {
  visible: boolean;
  progress: { done: number; total: number } | null;
  noun?: string;
}) {
  const colors = useThemeColors();
  const mounted = useMounted();

  useEffect(() => {
    if (!visible) return;
    return lockBodyScroll();
  }, [visible]);

  if (!mounted || !visible) return null;

  const total = progress?.total ?? 0;
  const done = Math.min(progress?.done ?? 0, total);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const finishing = total > 0 && done >= total;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ backgroundColor: colors.overlay, animation: 'aas-fade-in 0.15s ease-out' }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-live="polite"
        aria-label={`Deleting ${noun}`}
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border px-6 py-8 text-center"
        style={{ backgroundColor: colors.card, borderColor: colors.border }}
      >
        <Spinner />
        <p className="font-display text-2xl font-bold" style={{ color: colors.ink }}>
          {finishing ? 'Finishing up...' : `Deleting ${noun}...`}
        </p>
        <p
          className="font-display text-5xl font-bold"
          style={{ color: colors.primary }}
          aria-label={`${pct} percent`}
        >
          {pct}%
        </p>
        <div className="h-3.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: colors.tile }}>
          <div
            className="h-full rounded-full transition-[width] duration-200"
            style={{ width: `${Math.max(3, pct)}%`, backgroundColor: colors.primary }}
          />
        </div>
        <p className="text-lg font-bold" style={{ color: colors.ink }}>
          {total > 0 ? `${done.toLocaleString()} of ${total.toLocaleString()} ${noun}` : 'Getting started...'}
        </p>
        <p className="text-base" style={{ color: colors.inkMuted }}>
          Please keep this page open until this finishes.
        </p>
      </div>
    </div>,
    document.body,
  );
}
