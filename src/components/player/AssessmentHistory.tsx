'use client';

import { useMemo, useState } from 'react';

import { Badge, Button, Card, EmptyState } from '@/components/ui';
import type { ThemeColors } from '@/theme/tokens';
import type { PlayerProfileAssessment } from '@/data/types';

const CHART_WIDTH = 320;
const CHART_HEIGHT = 130;
const CHART_PAD_X = 16;
const CHART_PAD_TOP = 24;
const CHART_PAD_BOTTOM = 14;
const CHART_MAX_SCORE = 5;
const TOOLTIP_CHAR_WIDTH = 5.5;
const TOOLTIP_HEIGHT = 18;

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Point labels (full assessment/season names) are never drawn for every point
// at once — with more than a couple of points, real names always overlap into
// an unreadable pile. Instead, click a point to see its name + score in a small
// tooltip; the list rendered right below the chart also spells out every
// name and exact score for anyone who'd rather just read them.
export function ScoreTrendChart({ points, colors }: { points: { label: string; overall: number }[]; colors: ThemeColors }) {
  const [selected, setSelected] = useState<number | null>(null);

  const innerWidth = CHART_WIDTH - CHART_PAD_X * 2;
  const innerHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const scaleY = (v: number) =>
    CHART_PAD_TOP + innerHeight - (Math.max(0, Math.min(CHART_MAX_SCORE, v)) / CHART_MAX_SCORE) * innerHeight;
  const xFor = (i: number) =>
    points.length > 1 ? CHART_PAD_X + (innerWidth / (points.length - 1)) * i : CHART_PAD_X + innerWidth / 2;

  const coords = points.map((p, i) => ({ x: xFor(i), y: scaleY(p.overall), label: p.label, overall: p.overall }));
  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  const sel = selected != null ? coords[selected] : null;
  const tooltipText = sel ? `${sel.label} · ${sel.overall.toFixed(1)}` : '';
  const tooltipWidth = Math.min(CHART_WIDTH - CHART_PAD_X * 2, tooltipText.length * TOOLTIP_CHAR_WIDTH + 14);
  const tooltipX = sel
    ? Math.max(CHART_PAD_X, Math.min(CHART_WIDTH - CHART_PAD_X - tooltipWidth, sel.x - tooltipWidth / 2))
    : 0;
  const tooltipY = sel ? Math.max(0, sel.y - CHART_PAD_TOP + 2) : 0;

  const toggle = (i: number) => setSelected((cur) => (cur === i ? null : i));

  return (
    <svg width="100%" height={CHART_HEIGHT} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
      {[0, 1, 2, 3, 4, 5].map((g) => (
        <line
          key={g}
          x1={CHART_PAD_X}
          x2={CHART_WIDTH - CHART_PAD_X}
          y1={scaleY(g)}
          y2={scaleY(g)}
          stroke={colors.border}
          strokeWidth={1}
        />
      ))}
      {coords.length > 1 ? <path d={pathD} stroke={colors.primary} strokeWidth={2.5} fill="none" /> : null}
      {sel ? (
        <line
          x1={sel.x}
          x2={sel.x}
          y1={CHART_PAD_TOP}
          y2={CHART_HEIGHT - CHART_PAD_BOTTOM}
          stroke={colors.primary}
          strokeWidth={1}
          strokeDasharray="3,3"
          opacity={0.4}
        />
      ) : null}
      {coords.map((c, i) => (
        <circle
          key={i}
          cx={c.x}
          cy={c.y}
          r={selected === i ? 6 : 4}
          fill={colors.primary}
          onClick={() => toggle(i)}
          style={{ cursor: 'pointer' }}
        />
      ))}
      {/* Larger invisible hit target layered on top — the visible dots (r=4) are too small to click reliably. */}
      {coords.map((c, i) => (
        <circle
          key={`hit-${i}`}
          cx={c.x}
          cy={c.y}
          r={14}
          fill="transparent"
          onClick={() => toggle(i)}
          style={{ cursor: 'pointer' }}
        />
      ))}
      {sel ? (
        <>
          <rect
            x={tooltipX}
            y={tooltipY}
            width={tooltipWidth}
            height={TOOLTIP_HEIGHT}
            rx={4}
            fill={colors.card ?? colors.tile}
            stroke={colors.border}
            strokeWidth={1}
          />
          <text
            x={tooltipX + tooltipWidth / 2}
            y={tooltipY + TOOLTIP_HEIGHT / 2 + 3.5}
            fontSize={10}
            fill={colors.ink}
            textAnchor="middle"
          >
            {tooltipText}
          </text>
        </>
      ) : null}
    </svg>
  );
}

function DeltaLine({ delta, suffix, colors }: { delta: number; suffix: string; colors: ThemeColors }) {
  return (
    <p className="mt-1 text-sm" style={{ color: delta >= 0 ? colors.success : colors.warning }}>
      {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} {suffix}
    </p>
  );
}

interface SeasonGroup {
  seasonId: string;
  seasonName: string;
  avgOverall: number;
  earliestDate: string;
}

interface AssessmentHistoryProps {
  assessments: PlayerProfileAssessment[];
  colors: ThemeColors;
  /** Omit to render assessment rows as non-interactive (e.g. a shared snapshot the viewer can't navigate into). */
  onSelectAssessment?: (assessment: PlayerProfileAssessment) => void;
  emptyTitle?: string;
  emptyMessage?: string;
  /**
   * Filename-safe player name (e.g. "jane-doe") used to build the exported
   * CSV's filename. Omit entirely to hide the Export button — callers should
   * only pass this for coach-facing views (development history/trends export
   * is coach-only by product requirement).
   */
  exportFileName?: string;
}

/**
 * Season-over-season chart, score trend, and full assessment history list —
 * mirrors the mobile app's component so both render the same
 * `PlayerProfileAssessment[]` data identically.
 */
export function AssessmentHistory({
  assessments,
  colors,
  onSelectAssessment,
  emptyTitle = 'No assessments yet',
  emptyMessage = "This player's profile will build up as they're evaluated across tryouts and seasons.",
  exportFileName,
}: AssessmentHistoryProps) {
  const scoredAssessments = useMemo(() => assessments.filter((a) => a.evalCount > 0), [assessments]);

  const scoreTrend = useMemo(() => {
    const list: { id: string; date: string; overall: number; label?: string }[] = [];
    for (const a of scoredAssessments) {
      if (!a.evaluations) continue;
      for (const ev of a.evaluations) {
        list.push({
          id: `${a.tryoutId}-${ev.id}`,
          date: ev.date || a.date || '',
          overall: ev.overall,
          label: ev.session || 'Session',
        });
      }
    }
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [scoredAssessments]);

  const trendDelta =
    scoreTrend.length > 1 ? scoreTrend[scoreTrend.length - 1].overall - scoreTrend[0].overall : 0;

  // Group by season when the assessment is actually season-linked; otherwise
  // fall back to the assessment/tryout name so this section always has
  // something to show once there's scored data, instead of requiring a
  // season link that most standalone tryouts never have.
  const seasonGroups = useMemo<SeasonGroup[]>(() => {
    const points: SeasonGroup[] = [];
    for (const a of scoredAssessments) {
      if (!a.evaluations) continue;
      const groupLabel = a.seasonId ? a.seasonName || 'Unknown Season' : a.tryoutName;
      for (const ev of a.evaluations) {
        points.push({
          seasonId: `${a.tryoutId}-${ev.id}`,
          seasonName: `${groupLabel} (${ev.session || 'Session'})`,
          avgOverall: ev.overall,
          earliestDate: ev.date || a.date || '',
        });
      }
    }
    return points.sort((a, b) => a.earliestDate.localeCompare(b.earliestDate));
  }, [scoredAssessments]);

  const handleExport = () => {
    const header = 'tryout,event_type,sport,date,team,season,score,recommendation,evaluations';
    const rows = assessments.map((a) =>
      [
        a.tryoutName,
        a.eventType,
        a.sport,
        a.date || '',
        a.teamName || '',
        a.seasonName || '',
        a.evalCount > 0 ? a.overall.toFixed(1) : '',
        a.latestRecommendation || '',
        String(a.evalCount),
      ]
        .map(csvCell)
        .join(','),
    );
    downloadCsv(`${exportFileName || 'player'}-development-history.csv`, `${header}\n${rows.join('\n')}`);
  };

  if (assessments.length === 0) {
    return <EmptyState title={emptyTitle} message={emptyMessage} />;
  }

  return (
    <>
      {exportFileName ? (
        <div className="mb-2 flex justify-end">
          <Button label="Export" variant="secondary" size="sm" onClick={handleExport} />
        </div>
      ) : null}

      <Card className="mb-4 flex flex-col gap-2">
        <p className="font-display font-bold" style={{ color: colors.ink }}>
          Season-over-Season
        </p>
        {seasonGroups.length === 0 ? (
          <p style={{ color: colors.inkMuted }}>No scored evaluations yet.</p>
        ) : (
          <>
            <ScoreTrendChart points={seasonGroups.map((g) => ({ label: g.seasonName, overall: g.avgOverall }))} colors={colors} />
            {seasonGroups.map((g, i) => (
              <div key={g.seasonId} className="flex flex-col gap-1">
                <div className="flex justify-between">
                  <span style={{ color: colors.ink }}>{g.seasonName}</span>
                  <span style={{ color: colors.ink }}>{g.avgOverall.toFixed(1)}</span>
                </div>
                {i > 0 ? (
                  <DeltaLine delta={g.avgOverall - seasonGroups[i - 1].avgOverall} suffix="vs previous" colors={colors} />
                ) : null}
              </div>
            ))}
          </>
        )}
      </Card>

      <Card className="mb-4 flex flex-col gap-2">
        <p className="font-display font-bold" style={{ color: colors.ink }}>
          Score Trend
        </p>
        {scoreTrend.length === 0 ? (
          <p style={{ color: colors.inkMuted }}>No scored evaluations yet.</p>
        ) : (
          <>
            {scoreTrend.map((a) => (
              <div key={a.id} className="flex justify-between">
                <span style={{ color: colors.inkMuted }}>
                  {a.date || '—'} {a.label ? `· ${a.label}` : ''}
                </span>
                <span style={{ color: colors.ink }}>{a.overall.toFixed(1)}</span>
              </div>
            ))}
            {scoreTrend.length > 1 ? <DeltaLine delta={trendDelta} suffix="since first evaluation" colors={colors} /> : null}
          </>
        )}
      </Card>

      <p className="text-md mb-3 font-display font-bold" style={{ color: colors.ink }}>
        Assessment History ({assessments.length})
      </p>
      {assessments.map((a) => {
        const card = (
          <Card className="mb-2 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-bold" style={{ color: colors.ink }}>
                {a.tryoutName}
              </span>
              {a.latestRecommendation ? <Badge label={a.latestRecommendation} variant="brand" /> : null}
            </div>
            <span className="text-sm" style={{ color: colors.inkMuted }}>
              {a.eventType} · {a.date || 'No date'} · {a.sport}
              {a.teamName ? ` · ${a.teamName}` : ''}
            </span>
            <span className="text-sm" style={{ color: colors.ink }}>
              {a.evalCount > 0 ? `Score: ${a.overall.toFixed(1)}` : 'Not yet scored'}
            </span>
          </Card>
        );
        return onSelectAssessment ? (
          <button key={a.tryoutId} type="button" className="block w-full text-left" onClick={() => onSelectAssessment(a)}>
            {card}
          </button>
        ) : (
          <div key={a.tryoutId}>{card}</div>
        );
      })}
    </>
  );
}
