'use client';

import type { ReactNode } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';

/** Uppercase section caption with the short orange bar — the only brand accent it carries. */
export function HomeSectionLabel({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="block h-3 w-[3px] rounded-sm" style={{ backgroundColor: colors.primary }} />
      <h2 className="text-xs font-bold tracking-wider uppercase" style={{ color: colors.inkMuted }}>
        {children}
      </h2>
    </div>
  );
}
