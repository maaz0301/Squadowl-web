'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { useMounted } from '@/lib/hooks';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button } from './Button';

interface ModalProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Wider shell for tables and multi-column forms. */
  size?: 'sm' | 'md' | 'lg';
  /** Omit the default "Close" footer button. */
  hideDefaultFooter?: boolean;
}

const widths: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
};

export function Modal({
  visible,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  hideDefaultFooter,
}: ModalProps) {
  const colors = useThemeColors();
  const mounted = useMounted();

  // Keeps the latest onClose reachable from the effect below without making
  // it a dependency — callers pass a fresh inline function on every render,
  // which would otherwise tear down and rebuild the scroll lock (and briefly
  // release document.body.style.overflow) on every re-render while open, not
  // just on actual open/close transitions.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [visible]);

  if (!mounted || !visible) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      style={{ backgroundColor: colors.overlay, animation: 'aas-fade-in 0.15s ease-out' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          // dvh, not vh: on mobile Safari/Chrome vh measures the tallest
          // viewport (URL bar hidden), so a 92vh sheet anchored to the bottom
          // pushed its own header off-screen while the bar was showing.
          'flex max-h-[92dvh] w-full flex-col rounded-t-3xl border sm:rounded-2xl',
          widths[size],
        )}
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          animation: 'aas-rise 0.18s ease-out',
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        <div
          className="flex items-center justify-between gap-4 border-b px-5 py-4"
          style={{ borderColor: colors.border }}
        >
          <h2
            className="text-lg font-bold"
            style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl leading-none transition-colors hover:brightness-125"
            style={{ backgroundColor: colors.tile, color: colors.inkMuted }}
          >
            ×
          </button>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
          style={
            hideDefaultFooter && !footer
              ? { paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }
              : undefined
          }
        >
          {children}
        </div>

        {footer ?? (hideDefaultFooter ? null : (
          <div
            className="border-t px-5 py-4"
            style={{
              borderColor: colors.border,
              // Clears the iPhone home indicator when the sheet is bottom-anchored.
              paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
            }}
          >
            <Button label="Close" variant="secondary" fullWidth onClick={onClose} />
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** Footer helper so screens don't repeat the border/padding wrapper. */
export function ModalFooter({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <div
      className="flex flex-wrap justify-end gap-2 border-t px-5 py-4"
      style={{
        borderColor: colors.border,
        paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
      }}
    >
      {children}
    </div>
  );
}
