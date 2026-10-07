'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isSidebarDestination } from '@/lib/sidebarDestinations';
import { useThemeColors } from '@/theme/ThemeProvider';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  backHref?: string;
  onBack?: () => void;
  right?: ReactNode;
}

export function PageHeader({ title, subtitle, showBack, backHref, onBack, right }: PageHeaderProps) {
  const colors = useThemeColors();
  const router = useRouter();
  const pathname = usePathname();
  // No back chevron on pages reached straight from the sidebar (see sidebarDestinations).
  const canGoBack = !!showBack && !isSidebarDestination(pathname);

  const handleBack = () => {
    if (onBack) return onBack();
    if (backHref) return router.push(backHref);
    router.back();
  };

  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3 sm:flex-1">
        {canGoBack ? (
          <button
            type="button"
            onClick={handleBack}
            aria-label="Go back"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:brightness-125"
            style={{ backgroundColor: colors.tile }}
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <path
                d="M15 19l-7-7 7-7"
                stroke={colors.ink}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
        <div className="min-w-0">
          <h1
            className="text-2xl font-bold sm:text-3xl"
            style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
          >
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5" style={{ color: colors.inkMuted }}>
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}
