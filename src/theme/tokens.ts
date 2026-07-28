/**
 * SINGLE SOURCE OF TRUTH for all design tokens.
 * Edit this file to change the entire app's look & feel.
 *
 * Also update src/theme/tokens.tailwind.js (used by tailwind.config.js)
 * when changing colors/spacing/radius/fontSize values.
 */

export type ThemeMode = 'dark' | 'light';

export const brand = {
  DEFAULT: '#ff6b2b',
  soft: '#ff8c55',
  light: '#ff9a5c',
  hover: '#e85a1f',
  glow: 'rgba(255,107,43,0.22)',
  dim: 'rgba(255,107,43,0.09)',
  border: 'rgba(255,107,43,0.30)',
} as const;

export const navy = {
  950: '#070d1a',
  900: '#080c16',
  850: '#0c1528',
  800: '#0d1629',
  750: '#111827',
  700: '#121f38',
  650: '#152240',
  600: '#1a2236',
  500: '#1e2d45',
  DEFAULT: '#1e3a5f',
  400: '#162035',
} as const;

export const semantic = {
  success: '#22c55e',
  successLight: '#4ade80',
  danger: '#f87171',
  dangerDark: '#dc2626',
  warning: '#fb923c',
  warningDark: '#d97706',
  info: '#38BDF8',
} as const;

export const scoreColors = {
  great: '#4ade80',
  good: '#22c55e',
  avg: '#facc15',
  low: '#fb923c',
  poor: '#f87171',
} as const;

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
} as const;

export const radius = {
  xs: 6,
  sm: 8,
  md: 12,
  DEFAULT: 14,
  lg: 16,
  xl: 22,
  '2xl': 30,
  full: 9999,
} as const;

export const fontSize = {
  xs: 10,
  sm: 12,
  base: 15,
  md: 17,
  lg: 20,
  xl: 24,
  '2xl': 30,
  '3xl': 38,
  display: 52,
} as const;

export const fontFamily = {
  sans: 'Inter',
  display: 'SpaceGrotesk',
  mono: 'SpaceMono',
} as const;

export const shadows = {
  brandSm: '0 4px 14px rgba(249,115,22,0.30)',
  brandMd: '0 6px 18px rgba(249,115,22,0.38)',
  brandLg: '0 4px 20px rgba(255,107,43,0.45)',
} as const;

export interface ThemeColors {
  bg: string;
  bgSecondary: string;
  card: string;
  cardGlass: string;
  tile: string;
  field: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  placeholder: string;
  border: string;
  borderStrong: string;
  primary: string;
  primarySoft: string;
  nav: string;
  overlay: string;
  success: string;
  danger: string;
  warning: string;
  info: string;
}

export const darkColors: ThemeColors = {
  bg: navy[900],
  bgSecondary: navy[950],
  card: navy[750],
  cardGlass: 'rgba(12,21,40,0.82)',
  tile: navy[600],
  field: 'rgba(17,29,53,0.8)',
  ink: '#e8eeff',
  inkMuted: '#8fa3c8',
  inkFaint: '#8899bb',
  placeholder: '#3d5170',
  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.12)',
  primary: brand.DEFAULT,
  primarySoft: brand.soft,
  nav: navy[400],
  overlay: 'rgba(8,12,24,0.72)',
  success: semantic.success,
  danger: semantic.danger,
  warning: semantic.warning,
  info: semantic.info,
};

export const lightColors: ThemeColors = {
  bg: '#f0f4fa',
  bgSecondary: '#f9fcff',
  card: '#ffffff',
  cardGlass: 'rgba(255,255,255,0.92)',
  tile: '#e8f0fd',
  field: '#f5f8fe',
  ink: '#0d1629',
  inkMuted: '#4a5f82',
  inkFaint: '#8899bb',
  placeholder: '#94a3b8',
  border: 'rgba(10,30,61,0.12)',
  borderStrong: 'rgba(10,30,61,0.18)',
  primary: brand.DEFAULT,
  primarySoft: brand.soft,
  nav: navy.DEFAULT,
  overlay: 'rgba(8,12,24,0.52)',
  success: '#16a34a',
  danger: semantic.dangerDark,
  warning: semantic.warningDark,
  info: brand.DEFAULT,
};

export function getThemeColors(mode: ThemeMode): ThemeColors {
  return mode === 'dark' ? darkColors : lightColors;
}

export const themeTokens = {
  brand,
  navy,
  semantic,
  scoreColors,
  spacing,
  radius,
  fontSize,
  fontFamily,
  shadows,
  darkColors,
  lightColors,
} as const;

export type ThemeTokens = typeof themeTokens;
