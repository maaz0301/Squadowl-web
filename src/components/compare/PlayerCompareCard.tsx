'use client';

import { useMemo } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { getPlayerCategories } from '@/data/rubrics';
import { POSITION_OPTIONS_BY_SPORT } from '@/data/positions';
import type { PlayerResult, Tryout } from '@/data/types';

export const COMPARE_MAX_PLAYERS = 3;
const SERIES_COLORS = ['#FF6B2B', '#3B82F6', '#94A3B8'];
const LIGHT = '#F8FAFC';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const WIDTH = 420;
const HEIGHT = 300;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const RADIUS = 100;
const RINGS = 3;

const formatScore = (v: number | undefined) => (v == null ? '-' : v.toFixed(1));

function ordinal(n: number) {
  const rem = n % 100;
  if (rem >= 11 && rem <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** Side-by-side of 2-3 players: score cards, a radar over every skill, and per-skill bars. */
export function PlayerCompareCard({
  tryout,
  results,
  population,
}: {
  tryout: Tryout;
  results: PlayerResult[];
  /** Everyone's results, so each percentile is against the whole roster. */
  population: PlayerResult[];
}) {
  const colors = useThemeColors();

  const axes = useMemo(() => {
    const labels = new Map<string, string>();
    for (const r of results) {
      for (const c of getPlayerCategories(tryout.sport, r.player.pos, tryout.settings.customRubrics)) {
        if (r.categoryScores[c.key] != null && !labels.has(c.key)) labels.set(c.key, c.label);
      }
    }
    return [...labels.entries()].map(([key, label]) => ({ key, label }));
  }, [results, tryout]);

  if (results.length === 0) return null;

  const positionLabel = (pos?: string) => {
    const code = (pos ?? '').trim();
    const option = POSITION_OPTIONS_BY_SPORT[tryout.sport]?.find((o) => o.code.toUpperCase() === code.toUpperCase());
    return (option?.label ?? code).toUpperCase();
  };
  const scoredPool = population.filter((r) => r.overall > 0);
  const percentile = (r: PlayerResult) =>
    r.overall > 0 && scoredPool.length > 0
      ? Math.round((scoredPool.filter((o) => o.overall <= r.overall).length / scoredPool.length) * 100)
      : null;

  const values = results.flatMap((r) => axes.map((a) => r.categoryScores[a.key] ?? 0));
  const hi = Math.max(10, Math.ceil(Math.max(0, ...values)));
  const lo = Math.max(0, Math.floor(Math.min(...values, hi) - 2));
  const point = (i: number, value: number, extra = 0) => {
    const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    const r = Math.max(0, Math.min(1, (value - lo) / (hi - lo))) * RADIUS + extra;
    return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
  };
  const ringValue = (k: number) => lo + ((hi - lo) * k) / RINGS;
  const ringPoints = (k: number) => axes.map((_, i) => point(i, ringValue(k))).map((p) => `${p.x},${p.y}`).join(' ');
  const mirrored = results.length === 2;
  const panel = { backgroundColor: colors.tile, borderColor: colors.border };

  const bar = (value: number | undefined, color: string, align: 'start' | 'end') => (
    <span className="flex flex-1 px-2" style={{ justifyContent: align === 'end' ? 'flex-end' : 'flex-start' }}>
      <span
        className="block h-1.5 rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, ((value ?? 0) / hi) * 100))}%`, backgroundColor: color }}
      />
    </span>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${results.length}, minmax(0, 1fr))` }}>
        {results.map((r, i) => {
          const pct = percentile(r);
          return (
            <div key={r.player.id} className="rounded-xl border px-3 py-2.5" style={{ ...panel, borderTop: `2px solid ${SERIES_COLORS[i]}` }}>
              <p className="break-words text-xs" style={{ fontFamily: MONO, color: LIGHT, letterSpacing: 0.3 }}>
                #{r.player.jersey ?? '-'} · {positionLabel(r.player.pos) || '-'}
              </p>
              <p className="mt-1 break-words text-base font-bold" style={{ color: colors.ink }}>
                {r.player.first} {r.player.last}
              </p>
              <div className="mt-1 flex items-end justify-between gap-2">
                <span className="text-3xl font-bold" style={{ color: SERIES_COLORS[i], fontFamily: 'var(--font-space-grotesk)' }}>
                  {r.overall > 0 ? r.overall.toFixed(1) : '-'}
                </span>
                {pct != null ? (
                  <span className="mb-1 text-xs" style={{ fontFamily: MONO, color: LIGHT }}>
                    {ordinal(pct)} pct
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {axes.length >= 3 ? (
        <div className="flex justify-center rounded-xl border py-2" style={panel}>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-[520px]" role="img" aria-label="Skill radar chart">
            {Array.from({ length: RINGS }, (_, k) => k + 1).map((k) => (
              <polygon key={k} points={ringPoints(k)} fill="none" stroke={colors.border} strokeWidth={1} />
            ))}
            {axes.map((a, i) => {
              const end = point(i, hi);
              const label = point(i, hi, 14);
              const anchor = label.x < CX - 6 ? 'end' : label.x > CX + 6 ? 'start' : 'middle';
              return (
                <g key={a.key}>
                  <line x1={CX} y1={CY} x2={end.x} y2={end.y} stroke={colors.border} strokeWidth={1} />
                  <text x={label.x} y={label.y + 3} fontSize={10} fontFamily={MONO} fill={LIGHT} textAnchor={anchor}>
                    {a.label.length > 16 ? `${a.label.slice(0, 15).toUpperCase()}…` : a.label.toUpperCase()}
                  </text>
                </g>
              );
            })}
            {results.map((r, si) => {
              const pts = axes.map((a, i) => point(i, r.categoryScores[a.key] ?? lo));
              return (
                <g key={r.player.id}>
                  <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill={SERIES_COLORS[si]} fillOpacity={0.18} stroke={SERIES_COLORS[si]} strokeWidth={1.5} />
                  {pts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={2.2} fill={SERIES_COLORS[si]} />
                  ))}
                </g>
              );
            })}
            {Array.from({ length: RINGS }, (_, k) => k + 1).map((k) => {
              const p = point(0, ringValue(k));
              return (
                <text key={k} x={p.x + 3} y={p.y + 3} fontSize={9} fontFamily={MONO} fill={LIGHT}>
                  {Math.round(ringValue(k))}
                </text>
              );
            })}
          </svg>
        </div>
      ) : null}

      {axes.length > 0 ? (
        <div className="rounded-xl border px-3" style={panel}>
          {axes.map((a, idx) => {
            const divider = idx < axes.length - 1 ? { borderBottom: `1px solid ${colors.border}` } : undefined;
            const num = 'text-sm font-bold';
            return mirrored ? (
              <div key={a.key} className="flex items-center py-2.5" style={divider}>
                <span className={`w-10 ${num}`} style={{ fontFamily: MONO, color: colors.ink }}>{formatScore(results[0].categoryScores[a.key])}</span>
                {bar(results[0].categoryScores[a.key], SERIES_COLORS[0], 'end')}
                <span className="w-36 break-words text-center text-xs" style={{ fontFamily: MONO, color: LIGHT }}>{a.label.toUpperCase()}</span>
                {bar(results[1].categoryScores[a.key], SERIES_COLORS[1], 'start')}
                <span className={`w-10 text-right ${num}`} style={{ fontFamily: MONO, color: colors.ink }}>{formatScore(results[1].categoryScores[a.key])}</span>
              </div>
            ) : (
              <div key={a.key} className="flex flex-col gap-1.5 py-2.5" style={divider}>
                <span className="text-xs" style={{ fontFamily: MONO, color: LIGHT }}>{a.label.toUpperCase()}</span>
                {results.map((r, si) => (
                  <div key={r.player.id} className="flex items-center">
                    {bar(r.categoryScores[a.key], SERIES_COLORS[si], 'start')}
                    <span className={`w-12 text-right ${num}`} style={{ fontFamily: MONO, color: colors.ink }}>{formatScore(r.categoryScores[a.key])}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="italic" style={{ color: colors.inkMuted }}>Selected athletes have no rubric scores yet.</p>
      )}
    </div>
  );
}
