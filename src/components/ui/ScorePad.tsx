'use client';

import { useEffect, useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { getScoreHeatLevel, normalizeScore } from '@/data/rubrics';
import { themeTokens } from '@/theme/tokens';
import type { RankingDirection, ScoringType } from '@/data/types';

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
}: ScorePadProps) {
  const colors = useThemeColors();
  const [textVal, setTextVal] = useState(value != null ? String(value) : '');

  useEffect(() => {
    setTextVal(value != null ? String(value) : '');
  }, [value]);

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
        ? normalizeScore(parsed, scale, scoringType, minVal, maxVal)
        : null;

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
