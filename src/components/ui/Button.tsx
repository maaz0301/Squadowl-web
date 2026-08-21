'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useThemeColors } from '@/theme/ThemeProvider';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'nav';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  label?: string;
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
  type?: 'button' | 'submit' | 'reset';
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm min-h-[36px]',
  md: 'px-4 py-2.5 text-[15px] min-h-[44px]',
  lg: 'px-5 py-3 text-base min-h-[52px]',
};

// The spinner's faint "track" ring is the same color at ~20% alpha. Appending a
// hex alpha pair only produces valid CSS for a 6-digit hex — `#fff` + `33` is
// `#fff33`, a 5-digit value the parser rejects, which silently dropped the whole
// `border` shorthand and left the spinner invisible on primary/nav buttons.
function trackColor(c: string, hexAlpha = '33') {
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    const [, r, g, b] = c;
    return `#${r}${r}${g}${g}${b}${b}${hexAlpha}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(c)) return `${c}${hexAlpha}`;
  // Named colors, rgb()/hsl(): mix toward transparent instead of concatenating.
  return `color-mix(in srgb, ${c} 20%, transparent)`;
}

export function Spinner({ size = 18, color }: { size?: number; color?: string }) {
  const colors = useThemeColors();
  const c = color ?? colors.primary;
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: `2px solid ${trackColor(c)}`,
        borderTopColor: c,
        display: 'inline-block',
        animation: 'aas-spin 0.7s linear infinite',
      }}
    />
  );
}

export function Button({
  label,
  children,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  fullWidth,
  icon,
  className,
  style,
  type = 'button',
  ...props
}: ButtonProps) {
  const colors = useThemeColors();

  const variantStyle: Record<ButtonVariant, React.CSSProperties> = {
    primary: { backgroundColor: colors.primary, color: '#fff', border: '1px solid transparent' },
    secondary: { backgroundColor: colors.tile, color: colors.ink, border: `1px solid ${colors.border}` },
    danger: {
      backgroundColor: 'rgba(248,113,113,0.14)',
      color: colors.danger,
      border: '1px solid rgba(248,113,113,0.35)',
    },
    ghost: { backgroundColor: 'transparent', color: colors.ink, border: '1px solid transparent' },
    nav: { backgroundColor: colors.nav, color: '#fff', border: '1px solid transparent' },
  };

  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-bold whitespace-nowrap transition-[filter,opacity,transform] duration-150',
        'hover:brightness-110 active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2',
        sizeClass[size],
        fullWidth && 'w-full',
        isDisabled && 'pointer-events-none',
        disabled && !loading && 'opacity-50',
        className,
      )}
      style={{ ...variantStyle[variant], outlineColor: colors.primary, ...style }}
      {...props}
    >
      {loading ? <Spinner size={16} color={variant === 'primary' || variant === 'nav' ? '#fff' : colors.primary} /> : icon}
      {label ?? children}
    </button>
  );
}
