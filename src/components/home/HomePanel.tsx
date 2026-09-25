'use client';

import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/Icons';
import { useHubSurfaces } from '@/components/teamHub/hubTheme';
import { useThemeColors } from '@/theme/ThemeProvider';
import { cn } from '@/lib/cn';

/**
 * A home section as one container: header row (icon, label, optional action)
 * with the section's content inside the same bordered panel, rather than a
 * floating label above loose cards. Clips its children so art can bleed to the
 * panel's edge.
 */
export function HomePanel({
  icon,
  label,
  right,
  children,
  className,
}: {
  icon: IconName;
  label: string;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  return (
    <section
      className={cn('overflow-hidden rounded-2xl border p-3 sm:p-4', className)}
      style={{ backgroundColor: s.panelBg, borderColor: s.panelBorder }}
    >
      <div className={cn('flex min-h-9 flex-wrap items-center justify-between gap-2', children ? 'mb-3' : '')}>
        <div className="flex min-w-0 items-center gap-2">
          <Icon name={icon} size={16} color={colors.primary} />
          <h2 className="truncate text-xs font-bold tracking-wider uppercase" style={{ color: colors.ink }}>
            {label}
          </h2>
        </div>
        {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** The recessed row card that sits inside a HomePanel. */
export function PanelRow({ children, className }: { children: ReactNode; className?: string }) {
  const s = useHubSurfaces();
  return (
    <div
      className={cn('flex items-center gap-3 rounded-xl border px-3 py-3', className)}
      style={{ backgroundColor: s.rowBg, borderColor: s.panelBorder }}
    >
      {children}
    </div>
  );
}
