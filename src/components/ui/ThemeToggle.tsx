'use client';

import { useThemeStore } from '@/state/themeStore';
import { useTheme } from '@/theme/ThemeProvider';

export function ThemeToggle() {
  const { isDark, colors } = useTheme();
  const toggle = useThemeStore((s) => s.toggle);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:brightness-125"
      style={{ backgroundColor: colors.tile }}
    >
      {isDark ? (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path
            d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
            stroke={colors.ink}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="5" stroke={colors.ink} strokeWidth={2} />
          <path
            d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
            stroke={colors.ink}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
