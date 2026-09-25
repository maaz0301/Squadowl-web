'use client';

import { Icon, type IconName } from '@/components/Icons';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * Empty state that lives inside a HomePanel: icon and title on one line, one
 * line of guidance, and orange swooshes rising from the panel's bottom corners.
 * The negative margins cancel the panel's padding so the art reaches its edges.
 */
export function HomeEmptyCard({ icon, title, message }: { icon: IconName; title: string; message: string }) {
  const colors = useThemeColors();
  return (
    <div className="relative -mx-3 -mb-3 flex flex-col items-center px-6 pt-4 pb-16 text-center sm:-mx-4 sm:-mb-4">
      <svg
        aria-hidden
        className="pointer-events-none absolute right-0 bottom-0 left-0 h-14 w-full"
        viewBox="0 0 360 56"
        preserveAspectRatio="none"
      >
        <path d="M0 56 L0 26 C50 28 110 46 170 56 Z" fill="#ff6b2b" fillOpacity={0.55} />
        <path d="M0 56 L0 38 C40 40 90 52 130 56 Z" fill="#ff6b2b" />
        <path d="M360 56 L360 18 C310 24 250 44 190 56 Z" fill="#ff6b2b" fillOpacity={0.55} />
        <path d="M360 56 L360 32 C320 36 270 50 230 56 Z" fill="#ff6b2b" />
        <path d="M0 28 C50 30 110 48 170 56" stroke="#ff9a5c" strokeWidth={1.2} fill="none" />
        <path d="M360 20 C310 26 250 46 190 56" stroke="#ff9a5c" strokeWidth={1.2} fill="none" />
      </svg>

      <div className="relative flex items-center gap-2">
        <Icon name={icon} size={22} color={colors.primary} />
        <p className="text-base font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          {title}
        </p>
      </div>
      <p className="relative mt-2 max-w-md text-xs leading-snug" style={{ color: colors.inkMuted }}>
        {message}
      </p>
    </div>
  );
}
