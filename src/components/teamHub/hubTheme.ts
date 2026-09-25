'use client';

import { useTheme } from '@/theme/ThemeProvider';

/**
 * Surfaces the home screen and Team Hub paint. Their panels carry a navy-blue
 * cast in dark mode (see the design), so they are derived here rather than
 * borrowed from `colors.card`; light mode falls back to the plain theme
 * surfaces.
 */
export function useHubSurfaces() {
  const { colors, isDark } = useTheme();
  return {
    isDark,
    /** Neutral panel: event cards, inactive tabs, section panels. */
    panelBg: isDark ? 'rgba(17,31,58,0.85)' : colors.card,
    panelBorder: isDark ? 'rgba(74,120,200,0.28)' : colors.border,
    /** Recessed row inside a panel. */
    rowBg: isDark ? 'rgba(8,14,28,0.55)' : colors.tile,
    /** Blue-tinted action panel: Add to Calendar, Directions, Edit. */
    blueBg: isDark ? 'rgba(20,52,104,0.42)' : colors.tile,
    blueBorder: isDark ? 'rgba(59,130,246,0.42)' : colors.border,
    blueInk: isDark ? '#7db4ff' : colors.primary,
    orangeBg: 'rgba(255,107,43,0.10)',
    orangeBorder: 'rgba(255,107,43,0.55)',
  };
}
