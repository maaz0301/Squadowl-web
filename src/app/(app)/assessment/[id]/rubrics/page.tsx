'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorState,
  Input,
  LoadingState,
  SectionLabel,
  Spinner,
  useAlert,
} from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { UsageNudgeBanner } from '@/components/UsageNudgeBanner';
import { useTryoutQuery, useUpdateTryoutMutation } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { getPlanDefinition } from '@/data/plans';
import type { ScoringType, RankingDirection } from '@/data/types';

export default function RubricsPage() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const { alert } = useAlert();
  const tryoutQuery = useTryoutQuery(id);
  const updateTryout = useUpdateTryoutMutation();
  // Hook, so it runs before the loading/error guards below — skipping it on
  // the loading render would change hook order. A delegated team's tryout
  // gates against the owning club's tier, not the viewer's own.
  const tier = useEffectivePlanTier(tryoutQuery.data?.teamId);

  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('');
  const [scoringType, setScoringType] = useState<ScoringType>('skill');
  const [scale, setScale] = useState<'1-5' | '1-10'>('1-5');
  const [unit, setUnit] = useState('');
  const [minValStr, setMinValStr] = useState('');
  const [maxValStr, setMaxValStr] = useState('');
  const [rankingDirection, setRankingDirection] = useState<RankingDirection>('higher_is_better');

  const handleScoringTypeChange = (type: ScoringType) => {
    setScoringType(type);
    if (type === 'time') {
      setRankingDirection('lower_is_better');
    } else {
      setRankingDirection('higher_is_better');
    }
  };

  if (tryoutQuery.isLoading || !id) return <LoadingState message="Loading rubrics..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load rubrics." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  const custom = tryout.settings.customRubrics ?? [];
  const existingCategories = Array.from(new Set(custom.map((r) => r.category).filter((c): c is string => !!c)));
  const plan = getPlanDefinition(tier);
  const customLimit = plan.limits.customRubrics;
  const atCustomLimit = customLimit !== 'unlimited' && custom.length >= (customLimit as number);

  const addCustom = async () => {
    if (!label.trim() || atCustomLimit) return;
    const key = label.trim().toLowerCase().replace(/\s+/g, '_');

    let defaultUnit = unit.trim();

    if (scoringType === 'time') {
      if (!defaultUnit) defaultUnit = 'sec';
    } else if (scoringType === 'distance') {
      if (!defaultUnit) defaultUnit = 'ft';
    } else if (scoringType === 'speed') {
      if (!defaultUnit) defaultUnit = 'mph';
    }

    const minNum = minValStr.trim() !== '' ? parseFloat(minValStr) : undefined;
    const maxNum = maxValStr.trim() !== '' ? parseFloat(maxValStr) : undefined;

    const next = [
      ...custom,
      {
        key,
        label: label.trim(),
        category: category.trim() || undefined,
        scoringType,
        scale: scoringType === 'skill' ? scale : ('1-5' as const),
        unit: scoringType !== 'skill' ? defaultUnit : undefined,
        minVal: minNum != null && !isNaN(minNum) ? minNum : undefined,
        maxVal: maxNum != null && !isNaN(maxNum) ? maxNum : undefined,
        rankingDirection,
      },
    ];

    await updateTryout.mutateAsync({
      id: tryout.id,
      updates: { settings: { ...tryout.settings, customRubrics: next } },
    });

    // Category is deliberately not cleared — a coach usually adds several
    // drills to the same category back to back (e.g. five Skating drills),
    // so keeping it selected saves re-picking it each time.
    setLabel('');
    setUnit('');
    setMinValStr('');
    setMaxValStr('');
  };

  const removeCustom = async (keyToRemove: string) => {
    const next = custom.filter((r) => r.key !== keyToRemove);
    const nextSkaterWeights = { ...tryout.settings.skaterWeights };
    const nextGoalieWeights = { ...tryout.settings.goalieWeights };
    delete nextSkaterWeights[keyToRemove];
    delete nextGoalieWeights[keyToRemove];

    setRemovingKey(keyToRemove);
    try {
      await updateTryout.mutateAsync({
        id: tryout.id,
        updates: {
          settings: {
            ...tryout.settings,
            customRubrics: next,
            skaterWeights: nextSkaterWeights,
            goalieWeights: nextGoalieWeights,
          },
        },
      });
      await alert('Success', 'Custom rubric removed successfully.');
    } catch (err) {
      await alert('Error', err instanceof Error ? err.message : 'Failed to remove custom rubric.');
    } finally {
      setRemovingKey(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="flex flex-col gap-5">
        <Card accent className="flex flex-col gap-2">
          <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            Custom Rubric Builder
          </span>
          <span style={{ color: colors.inkMuted }}>
            All rubrics are fully custom. Define drill categories, metric units, and min/max score benchmarks.
          </span>
        </Card>

        <UsageNudgeBanner tier={tier} metric="customRubrics" count={custom.length} label="custom rubrics" />

        <Card className="flex flex-col gap-3">
          <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            Created Rubrics ({custom.length}
            {customLimit !== 'unlimited' ? ` / ${customLimit}` : ''})
          </span>

          {custom.map((r) => {
            const typeLabel = r.scoringType ?? 'skill';
            const ruleText = r.rankingDirection === 'lower_is_better' ? 'Shortest wins' : 'Highest wins';
            let details =
              r.scoringType === 'skill' || !r.scoringType
                ? `${r.scale ?? '1-5'} scale`
                : `${r.unit ?? ''} (${ruleText})`;
            if (r.minVal != null && r.maxVal != null) details += ` · Range: ${r.minVal} to ${r.maxVal}`;

            return (
              <div
                key={r.key}
                className="flex items-center justify-between gap-2 border-b py-2"
                style={{ borderColor: colors.border }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold" style={{ color: colors.ink }}>
                      {r.label}
                    </span>
                    <Badge label={typeLabel.toUpperCase()} variant="brand" />
                    {r.category ? <Badge label={r.category} /> : null}
                  </div>
                  <p className="text-xs" style={{ color: colors.inkMuted }}>
                    {details}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeCustom(r.key)}
                  disabled={removingKey !== null}
                  aria-label={`Remove ${r.label}`}
                  className="px-2 text-xl font-bold disabled:opacity-50"
                  style={{ color: colors.danger }}
                >
                  {removingKey === r.key ? <Spinner size={16} /> : '✕'}
                </button>
              </div>
            );
          })}

          {custom.length === 0 ? (
            <p style={{ color: colors.inkMuted }}>
              No custom rubrics added yet. Use the builder to add drills &amp; categories.
            </p>
          ) : null}
        </Card>
      </div>

      <PlanGate feature="customRubrics" title="Custom Rubrics (Coach+)" tierOverride={tier}>
        <Card accent className="flex flex-col gap-4">
          <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            Add Custom Drill / Category
          </span>

          <Input
            label="1. Drill Name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. 40-Yard Dash, Long Throw, Shot Speed"
          />

          <div>
            <Input
              label="2. Category (optional)"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Skating — groups several drills under one heading"
            />
            {existingCategories.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {existingCategories.map((c) => (
                  <Chip key={c} label={c} active={category === c} onClick={() => setCategory(c)} />
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <SectionLabel className="mb-2">3. Scoring Type</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <Chip label="Skill / Technique" active={scoringType === 'skill'} onClick={() => handleScoringTypeChange('skill')} />
              <Chip label="Time-based" active={scoringType === 'time'} onClick={() => handleScoringTypeChange('time')} />
              <Chip label="Distance-based" active={scoringType === 'distance'} onClick={() => handleScoringTypeChange('distance')} />
              <Chip label="Speed-based" active={scoringType === 'speed'} onClick={() => handleScoringTypeChange('speed')} />
            </div>
          </div>

          {scoringType === 'skill' ? (
            <div className="flex flex-col gap-2">
              <SectionLabel>4. Scale Choice</SectionLabel>
              <div className="flex flex-wrap gap-2">
                <Chip label="1-5 Scale" active={scale === '1-5'} onClick={() => setScale('1-5')} />
                <Chip label="1-10 Scale" active={scale === '1-10'} onClick={() => setScale('1-10')} />
              </div>
              <p className="text-xs italic" style={{ color: colors.inkMuted }}>
                Ranking Rule: Highest number = highest rank (Score 5)
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Input
                label="4. Unit Label (Free-form)"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder={
                  scoringType === 'time' ? 'e.g. sec, s, min' : scoringType === 'speed' ? 'e.g. mph, km/h' : 'e.g. ft, m, inches'
                }
              />

              <div>
                <SectionLabel className="mb-2">5. Ranking Rule</SectionLabel>
                <button
                  type="button"
                  onClick={() => setRankingDirection(rankingDirection === 'lower_is_better' ? 'higher_is_better' : 'lower_is_better')}
                  className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors hover:opacity-90"
                  style={{ borderColor: colors.border, backgroundColor: colors.field }}
                >
                  <div className="flex-1 pr-3">
                    <span className="text-sm font-bold" style={{ color: colors.ink }}>
                      {rankingDirection === 'lower_is_better' ? 'Lowest / Shortest wins' : 'Highest / Farthest wins'}
                    </span>
                    <p className="mt-0.5 text-xs" style={{ color: colors.inkMuted }}>
                      {rankingDirection === 'lower_is_better'
                        ? 'Best performance = lowest value (e.g. fastest sprint)'
                        : 'Best performance = highest value (e.g. longest throw)'}
                    </p>
                  </div>
                  <div
                    className="relative h-6 w-11 rounded-full transition-colors"
                    style={{ backgroundColor: rankingDirection === 'lower_is_better' ? colors.primary : colors.border }}
                  >
                    <div
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                      style={{ transform: rankingDirection === 'lower_is_better' ? 'translateX(22px)' : 'translateX(2px)' }}
                    />
                  </div>
                </button>
              </div>

              <SectionLabel className="mt-1">6. Score Range Benchmarks (Min &amp; Max)</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Min Value"
                  value={minValStr}
                  onChange={(e) => setMinValStr(e.target.value)}
                  inputMode="decimal"
                  placeholder={scoringType === 'time' ? '12 (Best)' : '5 (Worst)'}
                />
                <Input
                  label="Max Value"
                  value={maxValStr}
                  onChange={(e) => setMaxValStr(e.target.value)}
                  inputMode="decimal"
                  placeholder={scoringType === 'time' ? '25 (Worst)' : '25 (Best)'}
                />
              </div>

              <p className="text-xs font-bold italic" style={{ color: colors.primary }}>
                Score Benchmark Rule:{' '}
                {rankingDirection === 'lower_is_better'
                  ? `Min value (${minValStr || '10'}) = 5.0 points (Best)  ·  Max value (${maxValStr || '25'}) = 1.0 points (Worst)`
                  : `Min value (${minValStr || '5'}) = 1.0 points (Worst)  ·  Max value (${maxValStr || '25'}) = 5.0 points (Best)`}
              </p>
            </div>
          )}

          <Button
            label="Add Rubric Category"
            onClick={addCustom}
            loading={updateTryout.isPending}
            disabled={atCustomLimit || !label.trim()}
          />
        </Card>
      </PlanGate>
    </div>
  );
}
