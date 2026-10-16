'use client';

import { useThemeColors } from '@/theme/ThemeProvider';

export interface DonutRing {
  label: string;
  pct: number;
  color: string;
}

const SIZE = 140;
const STROKE = 10;

/** Concentric progress rings with a legend: how much of the roster is scored in each skill. */
export function ScoredDonut({ scored, total, rings }: { scored: number; total: number; rings: DonutRing[] }) {
  const colors = useThemeColors();
  return (
    <div className="flex items-center gap-5 rounded-2xl border p-5" style={{ backgroundColor: colors.tile, borderColor: colors.border }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="shrink-0" role="img" aria-label="Skills scored">
        {rings.map((ring, i) => {
          const r = SIZE / 2 - STROKE / 2 - i * (STROKE + 3);
          const c = 2 * Math.PI * r;
          return (
            <g key={ring.label}>
              <circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={colors.border} strokeWidth={STROKE} fill="none" />
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={r}
                stroke={ring.color}
                strokeWidth={STROKE}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${(Math.min(100, ring.pct) / 100) * c} ${c}`}
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              />
            </g>
          );
        })}
      </svg>
      <div className="min-w-0 flex-1">
        <p style={{ color: colors.ink }}>
          <span className="text-4xl font-extrabold">{scored}</span>
          <span className="text-xl">/{total}</span>
        </p>
        <p className="mb-2 text-sm font-bold" style={{ color: colors.primary }}>players scored</p>
        <div className="flex flex-col gap-1.5">
          {rings.map((ring) => (
            <div key={ring.label} className="flex items-center gap-2 text-sm" style={{ color: colors.ink }}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ring.color }} />
              <span className="min-w-0 flex-1 truncate">{ring.label}</span>
              <span className="font-bold">{Math.round(ring.pct)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
