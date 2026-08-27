'use client';

import { useRef } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { readableInkOn } from '@/lib/teamBrand';

/**
 * Brand colours offered when personalizing a team. A fixed swatch set rather
 * than a free colour wheel: every one of these has been picked to stay legible
 * under the banner's black/white ink rule, and they cover the jersey colours
 * clubs actually use. `null` means "no brand colour" — the banner falls back to
 * the app theme.
 */
export const TEAM_BRAND_COLORS = [
  '#ff6b2b', // brand orange
  '#e11d48', // red
  '#b91c1c', // maroon
  '#ea580c', // burnt orange
  '#f59e0b', // gold
  '#facc15', // yellow
  '#16a34a', // green
  '#047857', // forest
  '#0891b2', // teal
  '#0ea5e9', // sky
  '#2563eb', // royal blue
  '#1e3a8a', // navy
  '#6366f1', // indigo
  '#7c3aed', // purple
  '#db2777', // pink
  '#334155', // slate
] as const;

interface TeamColorPickerProps {
  value?: string | null;
  onChange: (color: string | null) => void;
  label?: string;
  className?: string;
}

const SWATCH = 46;

export function TeamColorPicker({ value, onChange, label = 'Team colour', className }: TeamColorPickerProps) {
  const colors = useThemeColors();
  const customInputRef = useRef<HTMLInputElement>(null);

  const isPreset = value != null && (TEAM_BRAND_COLORS as readonly string[]).includes(value);
  const customValue = value != null && !isPreset ? value : null;

  const swatch = (color: string | null) => {
    const selected = (value ?? null) === color;
    const check = color ? readableInkOn(color) : colors.ink;
    return (
      <button
        key={color ?? 'none'}
        type="button"
        onClick={() => onChange(color)}
        aria-label={color ? `Team colour ${color}` : 'No team colour'}
        aria-pressed={selected}
        className="flex items-center justify-center rounded-full"
        style={{
          width: SWATCH,
          height: SWATCH,
          backgroundColor: color ?? colors.tile,
          borderWidth: selected ? 3 : 1,
          borderStyle: 'solid',
          borderColor: selected ? colors.ink : colors.border,
        }}
      >
        {color === null ? (
          <span className="text-[11px] font-bold" style={{ color: colors.inkMuted }}>
            None
          </span>
        ) : selected ? (
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke={check} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </button>
    );
  };

  return (
    <div className={className}>
      <p className="mb-2 text-sm font-bold" style={{ color: colors.ink }}>
        {label}
      </p>
      <div className="flex flex-wrap gap-2.5">
        {swatch(null)}
        {TEAM_BRAND_COLORS.map((c) => swatch(c))}
        <button
          type="button"
          onClick={() => customInputRef.current?.click()}
          aria-label={customValue ? `Custom team colour ${customValue}` : 'Pick a custom team colour'}
          aria-pressed={customValue !== null}
          className="relative flex items-center justify-center overflow-hidden rounded-full"
          style={{
            width: SWATCH,
            height: SWATCH,
            background: customValue ?? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
            borderWidth: customValue !== null ? 3 : 1,
            borderStyle: 'solid',
            borderColor: customValue !== null ? colors.ink : colors.border,
          }}
        >
          {customValue !== null ? (
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <path
                d="M20 6L9 17l-5-5"
                stroke={readableInkOn(customValue)}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <span className="rounded-full" style={{ width: 18, height: 18, backgroundColor: colors.tile }} />
          )}
          <input
            ref={customInputRef}
            type="color"
            value={customValue ?? '#000000'}
            onChange={(e) => onChange(e.target.value)}
            aria-hidden="true"
            tabIndex={-1}
            className="absolute h-px w-px opacity-0"
          />
        </button>
      </div>
    </div>
  );
}
