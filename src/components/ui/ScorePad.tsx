'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  OBSERVATION_MAX,
  binaryLabels,
  getScoreHeatLevel,
  isBinaryScoringType,
  normalizeScore,
} from '@/data/rubrics';
import { themeTokens } from '@/theme/tokens';
import type { RankingDirection, ScoringType } from '@/data/types';
import { formatBenchmarkValue } from '@/data/benchmarks';

interface ScorePadProps {
  rubricKey?: string;
  label: string;
  scale?: '1-5' | '1-10';
  scoringType?: ScoringType;
  unit?: string;
  minVal?: number;
  maxVal?: number;
  value?: number;
  rankingDirection?: RankingDirection;
  onChange: (value: number) => void;
  /** Called when a measured entry is emptied, so a wrong figure can be taken back out. */
  onClear?: () => void;
  /** The coach's target for this rubric, shown under the entry with its explanation. */
  benchmark?: number;
  benchmarkNote?: string;
}

function BenchmarkHint({
  benchmark,
  note,
  scale,
  scoringType,
  unit,
}: {
  benchmark?: number;
  note?: string;
  scale?: '1-5' | '1-10';
  scoringType?: ScoringType;
  unit?: string;
}) {
  const colors = useThemeColors();
  if (benchmark == null) return null;
  return (
    <p className="mt-1 text-xs" style={{ color: colors.inkMuted }}>
      <span className="font-bold" style={{ color: colors.ink }}>
        Benchmark: {formatBenchmarkValue({ scoringType, scale, unit }, benchmark)}
      </span>
      {note ? ` · ${note}` : ''}
    </p>
  );
}

export function ScorePad({
  label,
  scale = '1-5',
  scoringType = 'skill',
  unit,
  minVal,
  maxVal,
  value,
  rankingDirection,
  onChange,
  onClear,
  benchmark,
  benchmarkNote,
}: ScorePadProps) {
  const colors = useThemeColors();
  const [textVal, setTextVal] = useState(value != null ? String(value) : '');
  // Local edit buffer re-synced when `value` changes from outside (e.g.
  // switching players) — React's documented "storing information from
  // previous renders" pattern, adjusting state during render rather than in
  // an effect, so the buffer never visibly lags a render behind the prop.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setTextVal(value != null ? String(value) : '');
  }

  // Yes / No and Effective / Not Effective: a pair of buttons plus a slide
  // switch, either of which sets the same 1 (positive) / 0 (negative) score.
  if (isBinaryScoringType(scoringType)) {
    const [positive, negative] = binaryLabels(scoringType);
    const answered = value != null;
    const isPositive = answered && value > 0;

    return (
      <div className="mb-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold" style={{ color: colors.inkMuted }}>
            {label}
          </span>
          {answered ? (
            <span
              className="rounded px-2 py-0.5 text-xs font-extrabold"
              style={{ backgroundColor: colors.primary + '20', color: colors.primary }}
            >
              Score: {isPositive ? '5.0' : '1.0'} / 5.0
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BinaryButton label={positive} selected={answered && isPositive} tone="positive" onClick={() => onChange(1)} />
          <BinaryButton label={negative} selected={answered && !isPositive} tone="negative" onClick={() => onChange(0)} />
          <button
            type="button"
            role="switch"
            aria-checked={isPositive}
            aria-label={`${label}: ${isPositive ? positive : negative}`}
            onClick={() => onChange(isPositive ? 0 : 1)}
            className="ml-auto flex min-h-[48px] items-center gap-2 px-1"
          >
            <span
              className="relative block h-6 w-11 rounded-full border transition-colors"
              style={{
                backgroundColor: isPositive ? colors.primary : colors.tile,
                borderColor: isPositive ? colors.primary : colors.border,
              }}
            >
              <span
                className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-[left]"
                style={{ left: isPositive ? 22 : 2 }}
              />
            </span>
            <span className="text-xs font-bold" style={{ color: colors.inkMuted }}>
              {answered ? (isPositive ? positive : negative) : 'Not scored'}
            </span>
          </button>
        </div>
      </div>
    );
  }

  // Observation: a free 1–100 mark, entered on a slider or typed, with the
  // rubric's own ranking rule deciding whether 1 or 100 is the best mark.
  if (scoringType === 'observation') {
    const isLower = rankingDirection === 'lower_is_better';
    const parsed = parseFloat(textVal);
    const current = !isNaN(parsed) ? Math.max(1, Math.min(OBSERVATION_MAX, parsed)) : null;
    const calculatedScore =
      current !== null ? normalizeScore(current, scale, 'observation', undefined, undefined, rankingDirection) : null;

    const commit = (raw: string) => {
      setTextVal(raw);
      const p = parseFloat(raw);
      if (!isNaN(p)) onChange(Math.max(1, Math.min(OBSERVATION_MAX, Math.round(p))));
    };

    return (
      <div className="mb-4">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold" style={{ color: colors.inkMuted }}>
            {label}
          </span>
          <span className="flex items-center gap-2">
            {calculatedScore !== null ? (
              <span
                className="rounded px-2 py-0.5 text-xs font-extrabold"
                style={{ backgroundColor: colors.primary + '20', color: colors.primary }}
              >
                Score: {calculatedScore.toFixed(1)} / 5.0
              </span>
            ) : null}
            <span className="text-xs font-medium italic" style={{ color: colors.inkFaint }}>
              ({isLower ? 'Lowest number = highest rank' : 'Highest number = highest rank'})
            </span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={OBSERVATION_MAX}
            step={1}
            value={current ?? 1}
            aria-label={`${label} observation score`}
            onChange={(e) => commit(e.target.value)}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full accent-[color:var(--c-primary)]"
            style={{ backgroundColor: colors.border }}
          />
          <input
            value={textVal}
            inputMode="numeric"
            onChange={(e) => commit(e.target.value)}
            placeholder="1-100"
            className="h-12 w-20 rounded-xl border px-3 text-center text-base font-bold outline-none focus:border-[color:var(--c-primary)]"
            style={{ backgroundColor: colors.field, borderColor: colors.border, color: colors.ink }}
          />
        </div>
        <p className="mt-1 text-xs" style={{ color: colors.inkMuted }}>
          Observation range: 1 to {OBSERVATION_MAX} · {isLower ? '1 = best' : `${OBSERVATION_MAX} = best`}
        </p>
        <BenchmarkHint benchmark={benchmark} note={benchmarkNote} scale={scale} scoringType={scoringType} unit={unit} />
      </div>
    );
  }

  if (scoringType && scoringType !== 'skill') {
    const unitText = unit ?? (scoringType === 'time' ? 'sec' : scoringType === 'speed' ? 'mph' : 'ft');
    const isLower = rankingDirection === 'lower_is_better' || (scoringType === 'time' && !rankingDirection);
    const ruleText = isLower
      ? scoringType === 'time'
        ? 'Shortest time = highest score'
        : 'Lowest number = highest score'
      : scoringType === 'speed'
        ? 'Fastest speed = highest score'
        : scoringType === 'distance'
          ? 'Largest distance = highest score'
          : 'Highest number = highest score';

    const parsed = parseFloat(textVal);
    const calculatedScore =
      !isNaN(parsed) && minVal != null && maxVal != null
        ? normalizeScore(parsed, scale, scoringType, minVal, maxVal, rankingDirection)
        : null;

    const atBestBenchmark =
      !isNaN(parsed) && minVal != null && maxVal != null && maxVal !== minVal && (isLower ? parsed <= minVal : parsed >= maxVal);

    return (
      <div className="mb-4">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold" style={{ color: colors.inkMuted }}>
            {label}
          </span>
          <span className="flex items-center gap-2">
            {calculatedScore !== null ? (
              <span
                className="rounded px-2 py-0.5 text-xs font-extrabold"
                style={{ backgroundColor: colors.primary + '20', color: colors.primary }}
              >
                Score: {calculatedScore.toFixed(1)} / 5.0
              </span>
            ) : null}
            <span className="text-xs font-medium italic" style={{ color: colors.inkFaint }}>
              ({ruleText})
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={textVal}
            inputMode="decimal"
            onChange={(e) => {
              setTextVal(e.target.value);
              const p = parseFloat(e.target.value);
              if (!isNaN(p)) onChange(p);
              else if (e.target.value.trim() === '') onClear?.();
            }}
            placeholder={`Enter numeric ${scoringType}...`}
            className="h-12 flex-1 rounded-xl border px-3 text-base font-bold outline-none focus:border-[color:var(--c-primary)]"
            style={{ backgroundColor: colors.field, borderColor: colors.border, color: colors.ink }}
          />
          <span
            className="flex h-12 items-center justify-center rounded-xl border px-4 text-sm font-bold"
            style={{ backgroundColor: colors.tile, borderColor: colors.border, color: colors.primary }}
          >
            {unitText}
          </span>
        </div>
        {minVal != null && maxVal != null ? (
          <p className="mt-1 text-xs" style={{ color: colors.inkMuted }}>
            Benchmarked Range: Min = {minVal} {unitText} · Max = {maxVal} {unitText}
          </p>
        ) : null}
        {atBestBenchmark ? (
          <p className="mt-1 text-xs font-semibold" style={{ color: colors.primary }}>
            This is at or past the {isLower ? 'Min' : 'Max'} benchmark, so it scores the full 5.0. Raise the benchmark in
            Rubrics if players are reaching it easily.
          </p>
        ) : null}
        <BenchmarkHint benchmark={benchmark} note={benchmarkNote} scale={scale} scoringType={scoringType} unit={unit} />
      </div>
    );
  }

  const max = scale === '1-10' ? 10 : 5;
  const options = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <div className="mb-4">
      <p className="mb-2 text-sm font-bold" style={{ color: colors.inkMuted }}>
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((n) => (
          <ScoreButton key={n} value={n} max={max} selected={value === n} onClick={() => onChange(n)} />
        ))}
      </div>
      <BenchmarkHint benchmark={benchmark} note={benchmarkNote} scale={scale} scoringType={scoringType} unit={unit} />
    </div>
  );
}

interface ScoreButtonProps {
  value: number;
  selected?: boolean;
  max?: number;
  onClick: () => void;
}

export function ScoreButton({ value, selected, max = 5, onClick }: ScoreButtonProps) {
  const colors = useThemeColors();
  const heat = getScoreHeatLevel(value, max);
  const heatColor = themeTokens.scoreColors[heat];
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border text-base font-extrabold transition-transform active:scale-95 hover:brightness-125"
      style={{
        backgroundColor: selected ? colors.primary : colors.field,
        borderColor: selected ? colors.primary : colors.border,
        color: selected ? '#fff' : heatColor,
      }}
    >
      {value}
    </button>
  );
}

interface BinaryButtonProps {
  label: string;
  selected?: boolean;
  tone: 'positive' | 'negative';
  onClick: () => void;
}

function BinaryButton({ label, selected, tone, onClick }: BinaryButtonProps) {
  const colors = useThemeColors();
  const toneColor = tone === 'positive' ? themeTokens.scoreColors.great : themeTokens.scoreColors.poor;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className="flex min-h-[48px] items-center justify-center rounded-xl border px-4 text-sm font-extrabold uppercase tracking-wide transition-transform active:scale-95 hover:brightness-125"
      style={{
        backgroundColor: selected ? toneColor : colors.field,
        borderColor: selected ? toneColor : colors.border,
        color: selected ? '#fff' : toneColor,
      }}
    >
      {label}
    </button>
  );
}
